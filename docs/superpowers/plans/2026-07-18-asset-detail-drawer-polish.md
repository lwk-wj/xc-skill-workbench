# Asset Detail Drawer Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the asset detail drawer into a compact professional workbench and move installation management into an independent, filterable `安装状态` tab.

**Architecture:** `App.vue` keeps drawer ownership and passes project/Agent metadata into `AssetDetail`. `AssetDetail` keeps the existing concurrent detail/status load lifecycle and delegates installation grouping, filtering, labels, and action rendering to a new presentational `AssetInstallationStatus.vue` component. Element Plus tabs provide the five-view navigation, while scoped CSS makes the header and tab row fixed and only the selected panel scrollable.

**Tech Stack:** Vue 3, TypeScript, Pinia, Element Plus, Vitest, Testing Library Vue, Playwright Electron

## Global Constraints

- Preserve the existing `min(760px, 64vw)` desktop drawer size and nearly full-width behavior below `900px`.
- Preserve all existing IPC calls and operation action payloads.
- Continue loading detail and status data concurrently; do not add lazy loading or caching.
- Preserve drawer close/reopen selection and source-change close behavior.
- Reuse existing light/dark design tokens; do not add a light-only palette.
- Rules and Workflows omit `演进历史` but retain `安装状态`.
- Use TDD for every behavior change and commit each task independently.
- Do not add routes, BrowserWindows, bulk operations, clipboard actions, persistent drawer sizing, or remembered detail tabs.

---

### Task 1: Focused installation status component

**Files:**
- Create: `src/renderer/src/components/AssetInstallationStatus.vue`
- Create: `test/renderer/asset-installation-status-vue.test.ts`

**Interfaces:**
- Consumes: `AssetRecord`, `ProjectRecord[]`, `AgentDefinition[]`, and the return element type of `DesktopApi['assets']['statuses']`.
- Produces: Vue event `action: [kind: string, location: StatusLocation]`.
- Owns: local `ScopeFilter = 'all' | 'global' | 'project'`, filtered rows, project/Agent display-name lookup, group ordering, status labels, and available actions.
- Performs no IPC calls and does not mutate input records.

- [ ] **Step 1: Write the failing component test**

Create `test/renderer/asset-installation-status-vue.test.ts` with a Skill fixture, one global current location, and one project locally-modified location. The test must verify resolved names, scope filtering, and the exact emitted action payload:

```ts
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AssetInstallationStatus from '../../src/renderer/src/components/AssetInstallationStatus.vue'
import { renderTestApp } from '../../src/renderer/src/app/render-test-app'
import type { AgentDefinition, AssetRecord, ProjectRecord } from '../../src/shared/ipc.js'

const asset: AssetRecord = {
  id: 'skill-one', type: 'skills', name: 'Skill One', group: 'backend',
  path: '/central/skill-one', entryPath: '/central/skill-one/SKILL.md',
  entryState: 'active', description: 'fixture', version: '1.0.0',
}

const projects: ProjectRecord[] = [{ id: 'proj', name: 'Demo Project', path: '/tmp/demo' }]
const agents: AgentDefinition[] = [
  { id: 'codex', name: 'Codex', projectBaseDir: '/tmp/project/.codex', globalBaseDir: '/tmp/global/.codex', assetDirs: { skills: '/skills', rules: '/rules', workflows: '/workflows' }, builtIn: true, enabled: true },
  { id: 'claude-code', name: 'Claude Code', projectBaseDir: '/tmp/project/.claude', globalBaseDir: '/tmp/global/.claude', assetDirs: { skills: '/skills', rules: '/rules', workflows: '/workflows' }, builtIn: true, enabled: true },
]

const statuses = [
  { projectId: null, agentId: 'codex', path: '/global/skills/skill-one', method: 'symlink' as const, status: { status: 'current' as const, updateAvailable: false, locallyModified: false, sourceHash: 'a', installedHash: 'a', sourceVersion: '1.0.0', installedVersion: '1.0.0', resolvedTarget: '/central/skill-one', reason: '' } },
  { projectId: 'proj', agentId: 'claude-code', path: '/project/skills/skill-one', method: 'copy' as const, status: { status: 'locally_modified' as const, updateAvailable: true, locallyModified: true, sourceHash: 'a', installedHash: 'b', sourceVersion: '1.0.0', installedVersion: '1.0.0', resolvedTarget: null, reason: '' } },
]

describe('AssetInstallationStatus', () => {
  afterEach(cleanup)

  it('groups named locations, filters by scope, and emits the unchanged action location', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    renderTestApp(AssetInstallationStatus, { props: { asset, statuses, projects, agents }, attrs: { onAction } })

    expect(screen.getByText('Global · 全局')).toBeInTheDocument()
    expect(screen.getByText('Demo Project · 项目')).toBeInTheDocument()
    expect(screen.getByText('Codex')).toBeInTheDocument()
    expect(screen.getByText('Claude Code')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: '项目' }))
    expect(screen.queryByText('Global · 全局')).toBeNull()
    expect(screen.getByText('Demo Project · 项目')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '查看影响并更新 Skill One' }))
    expect(onAction).toHaveBeenCalledWith('update-with-warning', statuses[1])
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm vitest run test/renderer/asset-installation-status-vue.test.ts
```

Expected: FAIL because `AssetInstallationStatus.vue` does not exist.

- [ ] **Step 3: Implement the component logic**

Create `AssetInstallationStatus.vue`. Define the exact props and emits, then derive filtered and grouped data without IPC:

```ts
<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElButton, ElRadioButton, ElRadioGroup } from 'element-plus'
import type { AgentDefinition, AssetRecord, AssetStatusRecord, InstallMethod, ProjectRecord } from '../../../shared/ipc.js'

type StatusLocation = Awaited<ReturnType<NonNullable<Window['xcSkills']>['assets']['statuses']>>[number]
type ScopeFilter = 'all' | 'global' | 'project'

const props = withDefaults(defineProps<{
  asset: AssetRecord
  statuses: StatusLocation[]
  projects?: ProjectRecord[]
  agents?: AgentDefinition[]
}>(), { projects: () => [], agents: () => [] })

const emit = defineEmits<{ action: [kind: string, location: StatusLocation] }>()
const scopeFilter = ref<ScopeFilter>('all')

const statusLabels: Record<AssetStatusRecord['status'], string> = {
  not_installed: '未安装', current: '最新', update_available: '可更新', locally_modified: '本地有修改',
  frozen: '已冻结', broken_link: '链接失效', conflict: '冲突', invalid: '无效', unknown: '未知',
}

const filteredStatuses = computed(() => props.statuses.filter((location) => {
  if (scopeFilter.value === 'global') return location.projectId === null
  if (scopeFilter.value === 'project') return location.projectId !== null
  return true
}))

const projectName = (projectId: string): string => props.projects.find((project) => project.id === projectId)?.name ?? projectId
const agentName = (agentId: string): string => props.agents.find((agent) => agent.id === agentId)?.name ?? agentId
const agentMark = (agentId: string): string => agentName(agentId).split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
const methodName = (method: InstallMethod | null): string => method ?? '—'

const groups = computed(() => {
  const grouped = new Map<string, StatusLocation[]>()
  for (const location of filteredStatuses.value) {
    const key = location.projectId ?? 'global'
    grouped.set(key, [...(grouped.get(key) ?? []), location])
  }
  return [...grouped.entries()].map(([key, locations]) => ({
    key,
    label: key === 'global' ? 'Global · 全局' : `${projectName(key)} · 项目`,
    locations: [...locations].sort((a, b) => `${agentName(a.agentId)}/${a.path}`.localeCompare(`${agentName(b.agentId)}/${b.path}`)),
  })).sort((a, b) => {
    if (a.key === 'global') return -1
    if (b.key === 'global') return 1
    return a.label.localeCompare(b.label)
  })
})

const actionsFor = (location: StatusLocation): Array<{ label: string; kind: string }> => {
  const status = location.status.status
  if (status === 'not_installed') return [{ label: '安装到…', kind: 'install' }]
  if (status === 'update_available') return [{ label: '更新', kind: 'update' }]
  if (status === 'locally_modified') return [{ label: '查看影响并更新', kind: 'update-with-warning' }]
  if (status === 'current') return [{ label: '卸载', kind: 'uninstall' }, ...(props.asset.type === 'skills' ? [{ label: '冻结', kind: 'freeze' }] : [])]
  if (status === 'frozen') return props.asset.type === 'skills'
    ? [{ label: '解冻', kind: 'thaw' }, { label: '卸载', kind: 'uninstall' }, { label: '更新', kind: 'update' }]
    : [{ label: '查看诊断', kind: 'diagnose' }]
  if (status === 'broken_link' || status === 'conflict' || status === 'invalid') return [{ label: '查看诊断', kind: 'diagnose' }]
  return []
}
</script>
```

- [ ] **Step 4: Implement the component template**

Render an accessible scope filter, grouped rows, neutral empty states, full path titles, semantic status classes, and existing action buttons:

```vue
<template>
  <section class="installation-view" aria-label="安装状态">
    <header class="installation-view-header">
      <div><h3>安装状态</h3><p>查看和管理各平台的安装位置</p></div>
      <div class="installation-summary"><span>{{ statuses.filter((item) => item.status.status === 'current').length }} 已安装</span><span>{{ statuses.length }} 个位置</span></div>
    </header>
    <ElRadioGroup v-model="scopeFilter" class="installation-scope-filter" aria-label="安装范围筛选" size="small">
      <ElRadioButton value="all">全部</ElRadioButton>
      <ElRadioButton value="global">全局</ElRadioButton>
      <ElRadioButton value="project">项目</ElRadioButton>
    </ElRadioGroup>

    <div v-if="!groups.length" class="installation-empty">
      <strong>{{ statuses.length ? '当前范围没有安装位置' : '暂无安装位置' }}</strong>
      <button v-if="statuses.length" type="button" @click="scopeFilter = 'all'">查看全部位置</button>
    </div>

    <section v-for="group in groups" :key="group.key" class="installation-group">
      <h4>{{ group.label }}</h4>
      <article v-for="location in group.locations" :key="`${location.agentId}:${location.path}`" class="status-location">
        <span class="status-platform-mark" aria-hidden="true">{{ agentMark(location.agentId) }}</span>
        <div class="status-location-copy">
          <strong>{{ agentName(location.agentId) }}</strong>
          <code :title="location.path">{{ location.path }}</code>
          <small>{{ methodName(location.method) }}</small>
        </div>
        <div class="status-location-state">
          <span class="status-badge" :data-status="location.status.status">{{ statusLabels[location.status.status] }}</span>
          <div class="status-actions">
            <ElButton v-for="action in actionsFor(location)" :key="action.kind" size="small" :aria-label="`${action.label} ${asset.name}`" :data-operation-kind="action.kind" @click="emit('action', action.kind, location)">{{ action.label }}</ElButton>
          </div>
        </div>
      </article>
    </section>
  </section>
</template>
```

- [ ] **Step 5: Run the focused tests and typecheck**

Run:

```bash
pnpm vitest run test/renderer/asset-installation-status-vue.test.ts && pnpm typecheck
```

Expected: the new test file passes and both TypeScript projects exit `0`.

- [ ] **Step 6: Commit the focused component**

```bash
git add src/renderer/src/components/AssetInstallationStatus.vue test/renderer/asset-installation-status-vue.test.ts
git commit -m "feat(renderer): add installation status view"
```

---

### Task 2: Independent installation tab and compact asset header

**Files:**
- Modify: `src/renderer/src/components/AssetDetail.vue`
- Modify: `src/renderer/src/App.vue`
- Modify: `test/renderer/asset-detail-vue.test.ts`
- Modify: `test/renderer/resource-explorer-vue.test.ts`

**Interfaces:**
- `AssetDetail` adds optional props `projects?: ProjectRecord[]` and `agents?: AgentDefinition[]` with empty-array defaults.
- `AssetDetail` continues to emit `action: [kind: string, location: StatusLocation]` unchanged.
- `App.vue` passes `explorer.projects` and `explorer.agents` into `AssetDetail`.
- `App.vue` produces `assetKindMark` and `assetKindLabel` computed values for the header.

- [ ] **Step 1: Rewrite the detail interaction test for independent status visibility**

In the first `asset-detail-vue.test.ts` case, remove the expectations that `Global` is immediately visible. Add project/Agent props, assert the status content is absent in preview, then open the installation tab and verify it:

```ts
const projects = [{ id: 'proj', name: 'Demo Project', path: '/tmp/demo' }]
const agents = [
  { id: 'codex', name: 'Codex', projectBaseDir: '/tmp/.codex', globalBaseDir: '/tmp/.codex', assetDirs: { skills: '/skills', rules: '/rules', workflows: '/workflows' }, builtIn: true, enabled: true },
  { id: 'claude-code', name: 'Claude Code', projectBaseDir: '/tmp/.claude', globalBaseDir: '/tmp/.claude', assetDirs: { skills: '/skills', rules: '/rules', workflows: '/workflows' }, builtIn: true, enabled: true },
]

renderTestApp(AssetDetail, { props: { asset, source: { kind: 'project', projectId: 'proj' }, loadDetail, loadStatuses, projects, agents } })
await waitFor(() => expect(screen.getByTestId('markdown-preview')).toHaveTextContent('Skill One'))
expect(screen.queryByText('Global · 全局')).toBeNull()
await user.click(screen.getByRole('tab', { name: /安装状态/ }))
expect(screen.getByText('Global · 全局')).toBeInTheDocument()
expect(screen.getByText('Demo Project · 项目')).toBeInTheDocument()
```

Extend the Rule rerender case to assert `安装状态` remains present and `演进历史` remains absent:

```ts
expect(screen.queryByRole('tab', { name: '演进历史' })).toBeNull()
expect(screen.getByRole('tab', { name: /安装状态/ })).toBeInTheDocument()
```

- [ ] **Step 2: Add the compact header assertion**

In the drawer test in `resource-explorer-vue.test.ts`, after opening the drawer assert the Skill mark and structured metadata:

```ts
expect(within(drawer).getByText('SK')).toBeInTheDocument()
expect(within(drawer).getByText('开发 · Skill · v1.0.0')).toBeInTheDocument()
```

- [ ] **Step 3: Run both tests and verify RED**

Run:

```bash
pnpm vitest run test/renderer/asset-detail-vue.test.ts test/renderer/resource-explorer-vue.test.ts
```

Expected: FAIL because installation status is still below the tab set, the new props/tab do not exist, and the compact header metadata is absent.

- [ ] **Step 4: Integrate `AssetInstallationStatus` into `AssetDetail`**

Import `AgentDefinition`, `ProjectRecord`, and the new component. Add props with defaults and remove the status-label, grouping, method-name, and action-selection logic now owned by the child:

```ts
import type { AgentDefinition, AssetDetail as AssetDetailRecord, AssetRecord, AssetSelection, ProjectRecord, SourceSelection } from '../../../shared/ipc.js'
import AssetInstallationStatus from './AssetInstallationStatus.vue'

const props = withDefaults(defineProps<{
  asset: AssetRecord
  source?: SourceSelection
  projects?: ProjectRecord[]
  agents?: AgentDefinition[]
  loadDetail?: DetailLoader
  loadStatuses?: StatusLoader
  showHeader?: boolean
}>(), {
  source: () => ({ kind: 'central' }),
  projects: () => [],
  agents: () => [],
  showHeader: true,
})

const entryFileName = computed(() => props.asset.entryPath.split('/').at(-1) ?? props.asset.entryPath)
```

Move installation markup into the final tab and frame source content with its filename:

```vue
<ElTabPane label="源码" name="source">
  <div class="detail-content">
    <p v-if="showTextLimit || metadataOnly" class="detail-muted">{{ metadataOnly ? '文件为二进制或过大，无法显示源码。' : '文件过大，无法显示源码。' }}</p>
    <div v-else class="source-panel">
      <header class="source-panel-header"><code>{{ entryFileName }}</code></header>
      <pre class="markdown-source">{{ detail.markdown || '暂无源码' }}</pre>
    </div>
  </div>
</ElTabPane>

<ElTabPane name="installations">
  <template #label><span class="installation-tab-label">安装状态 <small>{{ statuses.length }}</small></span></template>
  <AssetInstallationStatus :asset="asset" :statuses="statuses" :projects="projects" :agents="agents" @action="(kind, location) => emit('action', kind, location)" />
</ElTabPane>
```

Delete the old `asset-statuses` section below `ElTabs`.

- [ ] **Step 5: Render the structured drawer header in `App.vue`**

Import `computed`, define type metadata, and pass project/Agent records:

```ts
import { computed, onMounted, ref, watch } from 'vue'

const assetKindMark = computed(() => ({ skills: 'SK', rules: 'RU', workflows: 'WF' })[explorer.selectedAsset?.type ?? 'skills'])
const assetKindLabel = computed(() => ({ skills: 'Skill', rules: 'Rule', workflows: 'Workflow' })[explorer.selectedAsset?.type ?? 'skills'])
```

```vue
<template #header="{ titleId, titleClass }">
  <div class="asset-detail-title-lockup">
    <span class="asset-kind-mark" aria-hidden="true">{{ assetKindMark }}</span>
    <div class="asset-detail-header">
      <h2 :id="titleId" :class="titleClass">{{ explorer.selectedAsset?.name ?? '资源详情' }}</h2>
      <small v-if="explorer.selectedAsset">{{ explorer.selectedAsset.group }} · {{ assetKindLabel }} · {{ explorer.selectedAsset.version ? `v${explorer.selectedAsset.version.replace(/^v/, '')}` : '无版本' }}</small>
    </div>
  </div>
</template>

<AssetDetail
  v-if="explorer.selectedAsset"
  :asset="explorer.selectedAsset"
  :source="explorer.selectedSource"
  :projects="explorer.projects"
  :agents="explorer.agents"
  :show-header="false"
  @action="openOperation"
/>
```

- [ ] **Step 6: Run the integration tests and typecheck**

Run:

```bash
pnpm vitest run test/renderer/asset-installation-status-vue.test.ts test/renderer/asset-detail-vue.test.ts test/renderer/resource-explorer-vue.test.ts && pnpm typecheck
```

Expected: all three test files pass and typecheck exits `0`.

- [ ] **Step 7: Commit the independent tab integration**

```bash
git add src/renderer/src/App.vue src/renderer/src/components/AssetDetail.vue test/renderer/asset-detail-vue.test.ts test/renderer/resource-explorer-vue.test.ts
git commit -m "feat(renderer): separate installation status tab"
```

---

### Task 3: Workbench styling and real Electron coverage

**Files:**
- Modify: `src/renderer/src/styles/app.css`
- Modify: `test/e2e/app.spec.ts`

**Interfaces:**
- `.asset-detail-drawer` becomes a fixed-header/fixed-tabs shell whose `.el-tabs__content` owns scrolling.
- `.installation-view` and descendants style the Task 1 component in both themes using existing tokens.
- Existing drawer width, visibility, and operation actions remain unchanged.

- [ ] **Step 1: Extend the Electron test before styling**

In the existing `opens readable asset details in a wide drawer` test, add a project, return to central, and verify the independent installation view:

```ts
await e2e.page.getByRole('button', { name: /添加项目/ }).click()
await e2e.page.getByRole('button', { name: '中央仓库', exact: true }).click()
const row = e2e.page.getByRole('listitem').filter({ hasText: 'demo' }).first()
await row.click()
const drawer = e2e.page.getByRole('dialog', { name: 'demo' })
await expect(drawer).toBeVisible()
await expect(drawer.getByText('SK')).toBeVisible()
await expect(drawer.getByRole('tab', { name: /安装状态/ })).toBeVisible()
await expect(drawer.getByText('Global · 全局')).toBeHidden()

await drawer.getByRole('tab', { name: /安装状态/ }).click()
await expect(drawer.getByText('Global · 全局')).toBeVisible()
await expect(drawer.getByText('project · 项目')).toBeVisible()
await drawer.getByRole('tab', { name: '预览' }).click()
await expect(drawer.getByTestId('markdown-preview')).toBeVisible()

const bodyOverflow = await drawer.locator('.el-drawer__body').evaluate((element) => getComputedStyle(element).overflowY)
const panelOverflow = await drawer.locator('.el-tabs__content').evaluate((element) => getComputedStyle(element).overflowY)
expect(bodyOverflow).toBe('hidden')
expect(panelOverflow).toBe('auto')
```

Retain the existing width, close, selected-row, and reopen assertions.

- [ ] **Step 2: Run the Electron test and verify RED**

Build before running because the fixture launches `out/main/index.js`:

```bash
pnpm build && pnpm exec playwright test test/e2e/app.spec.ts -g "wide drawer"
```

Expected: FAIL because the drawer body still owns scrolling and the selected tab content is not yet the independent scroll container.

- [ ] **Step 3: Replace shared legacy tab styling with scoped Element Plus drawer styling**

In `app.css`, remove `.detail-tabs` from the shared `.tabs` selector blocks near the explorer toolbar so those rules apply only to `.tabs`. Replace the drawer block with the fixed workbench shell:

```css
.asset-detail-drawer.el-drawer {
  border-left: 1px solid var(--border);
  background: var(--surface-muted);
  box-shadow: var(--shadow-lg);
}

.asset-detail-drawer .el-drawer__header {
  min-height: 74px;
  margin: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface-raised);
  padding: 16px 22px;
}

.asset-detail-drawer .el-drawer__body {
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.asset-detail-title-lockup {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 11px;
}

.asset-kind-mark {
  display: grid;
  width: 36px;
  height: 36px;
  flex: none;
  place-items: center;
  border-radius: 10px;
  background: linear-gradient(145deg, var(--accent), var(--accent-hover));
  color: var(--text-on-accent);
  font-size: 10px;
  font-weight: 800;
  box-shadow: 0 7px 18px color-mix(in srgb, var(--accent) 24%, transparent);
}

.asset-detail {
  display: flex;
  min-width: 0;
  height: 100%;
  flex-direction: column;
}

.detail-tabs.el-tabs {
  display: flex;
  min-height: 0;
  height: 100%;
  flex-direction: column;
}

.detail-tabs > .el-tabs__header {
  flex: none;
  margin: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface-raised);
  padding: 9px 18px;
}

.detail-tabs .el-tabs__nav-wrap::after,
.detail-tabs .el-tabs__active-bar {
  display: none;
}

.detail-tabs .el-tabs__item {
  height: 34px;
  border-radius: 8px;
  color: var(--text-tertiary);
  padding: 0 11px !important;
  font-size: 11px;
  font-weight: 650;
  transition: background 140ms ease, color 140ms ease;
}

.detail-tabs .el-tabs__item:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.detail-tabs .el-tabs__item.is-active {
  background: var(--accent-soft);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 14%, transparent);
}

.detail-tabs > .el-tabs__content {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 0 24px 28px;
}

.installation-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.installation-tab-label small {
  display: grid;
  min-width: 17px;
  height: 17px;
  place-items: center;
  border-radius: 99px;
  background: color-mix(in srgb, var(--text-tertiary) 12%, transparent);
  padding: 0 5px;
  font-size: 9px;
}
```

- [ ] **Step 4: Add source and installation view styling**

Add the exact structural rules below, preserving existing markdown typography rules:

```css
.detail-content {
  width: min(100%, 720px);
  margin: 0 auto;
  padding: 22px 0 8px;
  color: var(--text-secondary);
  font-size: 13.5px;
  line-height: 1.78;
}

.source-panel {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--code-surface);
  box-shadow: var(--shadow-sm);
}

.source-panel-header {
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface-raised) 72%, var(--code-surface));
  padding: 9px 12px;
}

.source-panel-header code {
  color: var(--text-tertiary);
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
  font-size: 10px;
}

.source-panel .markdown-source {
  margin: 0;
  border: 0;
  border-radius: 0;
  padding: 16px;
  font-size: 11.5px;
  line-height: 1.72;
}

.installation-view {
  width: min(100%, 720px);
  margin: 0 auto;
  padding: 22px 0 8px;
}

.installation-view-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.installation-view-header h3,
.installation-group h4 {
  margin: 0;
}

.installation-view-header p {
  margin: 4px 0 0;
  color: var(--text-tertiary);
  font-size: 11px;
}

.installation-summary {
  display: flex;
  gap: 6px;
}

.installation-summary span,
.status-badge {
  border-radius: 99px;
  background: var(--surface-hover);
  color: var(--text-secondary);
  padding: 4px 7px;
  font-size: 9px;
  white-space: nowrap;
}

.installation-scope-filter {
  display: flex;
  margin-bottom: 18px;
}

.installation-scope-filter .el-radio-button {
  flex: 1;
}

.installation-scope-filter .el-radio-button__inner {
  width: 100%;
}

.installation-group {
  margin-top: 17px;
}

.installation-group h4 {
  color: var(--text-tertiary);
  font-size: 10px;
  letter-spacing: .04em;
}

.status-location {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface-raised);
  padding: 11px 12px;
  box-shadow: var(--shadow-sm);
}

.status-platform-mark {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 9px;
  background: var(--surface-hover);
  color: var(--text-secondary);
  font-size: 9px;
  font-weight: 800;
}

.status-location-copy code {
  display: block;
  max-width: 100%;
  overflow: hidden;
  border: 0;
  background: transparent;
  padding: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-location-state {
  display: grid;
  justify-items: end;
  gap: 7px;
}

.status-badge[data-status="current"] { background: var(--success-soft); color: var(--success); }
.status-badge[data-status="update_available"] { background: var(--info-soft); color: var(--info); }
.status-badge[data-status="locally_modified"],
.status-badge[data-status="frozen"] { background: var(--warning-soft); color: var(--warning); }
.status-badge[data-status="broken_link"],
.status-badge[data-status="conflict"],
.status-badge[data-status="invalid"] { background: var(--danger-soft); color: var(--danger); }

.installation-empty {
  display: grid;
  min-height: 220px;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: var(--text-tertiary);
  text-align: center;
}
```

Extend the existing narrow media query:

```css
@media (max-width: 900px) {
  .asset-detail-drawer.el-drawer { width: calc(100vw - 24px) !important; }
  .status-location { grid-template-columns: 34px minmax(0, 1fr); }
  .status-location-state { grid-column: 2; justify-items: start; }
}
```

- [ ] **Step 5: Run targeted unit and Electron tests**

Run:

```bash
pnpm vitest run test/renderer/asset-installation-status-vue.test.ts test/renderer/asset-detail-vue.test.ts test/renderer/resource-explorer-vue.test.ts
pnpm build
pnpm exec playwright test test/e2e/app.spec.ts -g "wide drawer"
```

Expected: all targeted tests pass; the Electron test opens installation status, sees Global and project groups, returns to preview, closes, and reopens the drawer.

- [ ] **Step 6: Inspect the real Electron window**

Run `pnpm dev`, open `auto-type-mapper`, and verify:

- compact `SK` header and one-line metadata;
- fixed segmented tab row while preview/source/install content scrolls;
- source filename frame and readable code spacing;
- installation scope filters, project names, path truncation, semantic badges, and actions;
- light and dark themes;
- close/reopen selection preservation.

- [ ] **Step 7: Run complete verification**

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
pnpm why react
git diff --check
```

Expected: every command exits `0`, Vitest has zero failures, all Electron E2E tests pass, React is absent, and the diff has no whitespace errors.

- [ ] **Step 8: Commit the visual polish and E2E coverage**

```bash
git add src/renderer/src/styles/app.css test/e2e/app.spec.ts
git commit -m "style(renderer): polish asset detail workbench"
```
