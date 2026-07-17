# Vue 3 Renderer and Platform Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not use subagent-driven development or dispatch subagents.

**Goal:** Replace the React renderer with Vue 3, Pinia, and Element Plus while preserving Electron behavior and adding platform tags that distinguish duplicate installed resources.

**Architecture:** Keep Electron main, preload, IPC, persistence, and `xc-skills/core` intact. Build Vue beside React, port tested feature slices, then atomically switch the entry and remove React. Namespace installed asset IDs by `agentId` so duplicate rows remain independently selectable.

**Tech Stack:** Electron 43, TypeScript, electron-vite, Vue 3 Composition API, Pinia, Element Plus, Vitest, Testing Library Vue, Vue Test Utils, Playwright.

## Global Constraints

- Preserve central/global/project navigation and the three-pane layout.
- Show platform tags only for global and project sources.
- Keep same-name assets as separate rows.
- Use Element Plus for controls, dialogs, forms, tags, and feedback; keep shell/list styling custom.
- Do not change the persisted state schema or preload API shape.
- Do not ship React and Vue together in production.
- Execute inline; do not use SDD or subagents.

## Target File Structure

- `src/renderer/src/App.vue`: shell and global overlays.
- `src/renderer/src/main.ts`: Vue bootstrap.
- `src/renderer/src/app/types.ts`: renderer view types.
- `src/renderer/src/app/render-test-app.ts`: Pinia/Element Plus test bootstrap.
- `src/renderer/src/stores/explorer.ts`: sources, scans, filters, branches, selected asset.
- `src/renderer/src/stores/preferences.ts`: theme persistence and system theme.
- `src/renderer/src/stores/operation.ts`: operation state machine.
- `src/renderer/src/components/*.vue`: sidebar, explorer, list, detail, file tree, errors.
- `src/renderer/src/features/settings/*.vue`: settings and Agent editor.
- `src/renderer/src/features/operations/*.vue`: operation dialog and progress.

---

### Task 1: Give Installed Duplicates Stable Platform-qualified IDs

**Files:**
- Modify: `src/main/services/core-service.ts`
- Modify: `test/main/core-service.test.ts`

**Interfaces:**
- Consumes: `CoreService.scan(source: SourceSelection): Promise<AssetRecord[]>`
- Produces: installed IDs formatted as `${agentId}:${coreAssetId}`; central IDs remain unchanged.

- [ ] **Step 1: Write the failing duplicate identity test**

Add a test that returns the same core asset from Codex and Claude roots:

```ts
it('qualifies installed asset ids by Agent so duplicate names remain selectable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xc-desktop-identities-'))
  const codexRoot = join(root, 'codex', 'skills')
  const claudeRoot = join(root, 'claude', 'skills')
  await mkdir(codexRoot, { recursive: true })
  await mkdir(claudeRoot, { recursive: true })
  const assetAt = (path: string) => ({
    id: 'skills:backend:call-api', type: 'skills' as const, name: 'call-api', group: 'backend',
    path, entryPath: join(path, 'SKILL.md'), entryState: 'active' as const,
    description: 'API helper', version: '1.0.0',
  })
  const agents = [
    { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'codex'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
    { id: 'claude-code', name: 'Claude Code', projectBaseDir: '.claude', globalBaseDir: join(root, 'claude'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
  ]
  const service = new CoreService({
    appStore: new AppStore(join(root, 'state.json')),
    core: {
      BUILTIN_AGENTS: agents,
      resolveAgentAssetRoot: (agent, _scope, _base, type) => join(agent.globalBaseDir, agent.assetDirs[type]),
      scanAssets: async ({ root: scanRoot }) => scanRoot === codexRoot || scanRoot === claudeRoot ? [assetAt(join(scanRoot, 'backend', 'call-api'))] : [],
    },
  })
  const assets = await service.scan({ kind: 'global' })
  expect(assets.map((asset) => [asset.id, asset.agentId])).toEqual([
    ['codex:skills:backend:call-api', 'codex'],
    ['claude-code:skills:backend:call-api', 'claude-code'],
  ])
  await rm(root, { recursive: true, force: true })
})
```

- [ ] **Step 2: Verify the test fails**

Run `pnpm vitest run test/main/core-service.test.ts`.

Expected: both rows still have `skills:backend:call-api`.

- [ ] **Step 3: Qualify installed IDs in `scanRoot`**

Replace the asset conversion with:

```ts
const coreAsset = asDesktopAsset(raw)
const asset = agentId
  ? asDesktopAsset({ ...coreAsset, id: `${agentId}:${coreAsset.id}`, agentId })
  : coreAsset
```

Continue storing and returning `asset`, so catalog, metadata, detail, status, and operation lookups share the qualified ID.

- [ ] **Step 4: Update existing installed selections**

```ts
const scanned = await service.scan({ kind: 'global' })
const selection = { source: { kind: 'global' as const }, assetId: scanned[0]!.id }
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm vitest run test/main/core-service.test.ts test/main/ipc-contract.test.ts test/main/operation-service.test.ts
git add src/main/services/core-service.ts test/main/core-service.test.ts
git commit -m "fix(core): distinguish installed assets by platform"
```

---

### Task 2: Add Vue Tooling and a Parallel Test Harness

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`, `electron.vite.config.ts`, `tsconfig.web.json`, `src/renderer/src/env.d.ts`
- Create: `vitest.config.ts`, `src/renderer/src/app/render-test-app.ts`, `src/renderer/src/VueApp.vue`, `test/renderer/vue-app.test.ts`

**Interfaces:**
- Produces: `renderTestApp(component, options)` with Pinia and Element Plus.
- Preserves: the React entry remains active until Task 8.

- [ ] **Step 1: Write the failing Vue mount test**

```ts
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import VueApp from '../../src/renderer/src/VueApp.vue'
import { renderTestApp } from '../../src/renderer/src/app/render-test-app'

describe('Vue renderer scaffold', () => {
  it('mounts with Pinia and Element Plus', () => {
    renderTestApp(VueApp)
    expect(screen.getByTestId('vue-app')).toHaveTextContent('XC Skills')
  })
})
```

- [ ] **Step 2: Run and verify missing Vue support**

Run `pnpm vitest run test/renderer/vue-app.test.ts`.

- [ ] **Step 3: Install migration dependencies**

```bash
pnpm add vue@3 pinia element-plus @element-plus/icons-vue
pnpm add -D @vitejs/plugin-vue vue-tsc @vue/test-utils @testing-library/vue
```

- [ ] **Step 4: Enable Vue beside React**

Use `plugins: [react(), vue()]` in the renderer portion of `electron.vite.config.ts`. Create:

```ts
// vitest.config.ts
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
export default defineConfig({ plugins: [vue()] })
```

Add `.vue` includes to `tsconfig.web.json`, retain JSX until cutover, and add to `env.d.ts`:

```ts
/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
```

Add `"typecheck:vue": "vue-tsc -p tsconfig.web.json --noEmit"` to scripts.

- [ ] **Step 5: Create test bootstrap and scaffold**

```ts
import { render, type RenderOptions } from '@testing-library/vue'
import ElementPlus from 'element-plus'
import { createPinia } from 'pinia'
import type { Component } from 'vue'

export function renderTestApp(component: Component, options: RenderOptions = {}) {
  return render(component, {
    ...options,
    global: { ...options.global, plugins: [createPinia(), ElementPlus, ...(options.global?.plugins ?? [])] },
  })
}
```

`VueApp.vue` initially contains `<template><main data-testid="vue-app">XC Skills</main></template>`.

- [ ] **Step 6: Verify and commit**

```bash
pnpm vitest run test/renderer/vue-app.test.ts
pnpm typecheck
pnpm typecheck:vue
git add package.json pnpm-lock.yaml electron.vite.config.ts tsconfig.web.json vitest.config.ts src/renderer/src/env.d.ts src/renderer/src/app/render-test-app.ts src/renderer/src/VueApp.vue test/renderer/vue-app.test.ts
git commit -m "build(renderer): add Vue 3 migration scaffold"
```

---

### Task 3: Port Theme and Explorer State to Pinia

**Files:**
- Create: `src/renderer/src/app/types.ts`, `src/renderer/src/stores/preferences.ts`, `src/renderer/src/stores/explorer.ts`
- Create: `test/renderer/preferences-store.test.ts`, `test/renderer/explorer-store.test.ts`

**Interfaces:**
- Produces: `usePreferencesStore()` with `initializeTheme`, `setTheme`, `applyTheme`.
- Produces: `useExplorerStore()` with Zustand behavior parity plus `agentName(agentId)`.

- [ ] **Step 1: Write failing store tests**

Explorer assertions:

```ts
const store = useExplorerStore()
await store.initialize()
expect(store.selectedSource.kind).toBe('central')
expect(store.agentName('codex')).toBe('Codex')
await store.selectSource(store.sources.find((source) => source.kind === 'project')!)
expect(store.query).toBe('')
expect(store.agentFilter).toBe('all')
```

Preferences assertions:

```ts
await store.initializeTheme()
expect(document.documentElement.dataset.theme).toBe('dark')
await store.setTheme('light')
media.dispatch(true)
expect(document.documentElement.dataset.theme).toBe('light')
```

- [ ] **Step 2: Run and verify missing stores**

Run `pnpm vitest run test/renderer/preferences-store.test.ts test/renderer/explorer-store.test.ts`.

- [ ] **Step 3: Define view types**

```ts
import type { SourceSelection } from '../../../shared/ipc.js'
export type AssetType = 'skills' | 'rules' | 'workflows'
export type ExplorerSource = SourceSelection & { id: string; label: string; path?: string }
```

- [ ] **Step 4: Implement stores**

Use `defineStore` with Composition API refs/computed values. Keep the monotonically increasing scan request ID. Resolve platform labels from loaded agents:

```ts
const agentMap = computed(() => new Map(agents.value.map((agent) => [agent.id, agent.name])))
const agentName = (agentId?: string): string => agentId ? agentMap.value.get(agentId) ?? agentId : ''
```

Expose `visibleAssets`, `groups`, and `selectedAsset`; never deduplicate installed assets. Port the current `matchMedia` compatibility behavior into the preferences store.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run test/renderer/preferences-store.test.ts test/renderer/explorer-store.test.ts
pnpm typecheck:vue
git add src/renderer/src/app/types.ts src/renderer/src/stores/preferences.ts src/renderer/src/stores/explorer.ts test/renderer/preferences-store.test.ts test/renderer/explorer-store.test.ts
git commit -m "feat(renderer): port explorer state to Pinia"
```

---

### Task 4: Port Shell, Filters, Resource List, and Platform Tags

**Files:**
- Create: `src/renderer/src/components/SourceSidebar.vue`, `ResourceExplorer.vue`, `AssetList.vue`
- Replace: `src/renderer/src/VueApp.vue`
- Modify: `src/renderer/src/styles/app.css`
- Create: `test/renderer/resource-explorer-vue.test.ts`

**Interfaces:**
- `AssetList.vue` props: `assets`, `selectedId`, `sourceKind`, `agentName`; emits `select(id)`.
- `ResourceExplorer.vue` consumes `useExplorerStore()`.

- [ ] **Step 1: Write the platform tag regression test**

Return two installed records with the same name:

```ts
const duplicates = [
  { ...skill, id: 'codex:skill-one', agentId: 'codex', path: '/project/.codex/skills/skill-one' },
  { ...skill, id: 'claude-code:skill-one', agentId: 'claude-code', path: '/project/.claude/skills/skill-one' },
]
```

Assert:

```ts
await user.click(screen.getByRole('button', { name: 'Demo', exact: true }))
expect(screen.getAllByText('Skill One')).toHaveLength(2)
expect(screen.getByText('Codex')).toBeInTheDocument()
expect(screen.getByText('Claude Code')).toBeInTheDocument()
expect(screen.getAllByRole('listitem')).toHaveLength(2)
```

Render central records and assert `queryByText('Codex')` is null.

- [ ] **Step 2: Verify the Vue explorer is missing**

Run `pnpm vitest run test/renderer/resource-explorer-vue.test.ts`.

- [ ] **Step 3: Port sidebar and shell**

Use native buttons for source rows and exact removal labels. `VueApp.vue` renders:

```vue
<template>
  <main class="app-shell" data-testid="app-shell">
    <SourceSidebar />
    <ResourceExplorer />
    <aside class="detail-pane" aria-label="资源详情">
      <div v-if="!explorer.selectedAsset" class="detail-empty">选择资源查看详情</div>
    </aside>
  </main>
</template>
```

- [ ] **Step 4: Port controls with Element Plus**

Use `ElInput` for search, `ElSelect` for group/status/Agent, and `ElDropdown` for branches. The Agent filter remains conditional:

```vue
<ElSelect v-if="explorer.selectedSource.kind !== 'central'" v-model="explorer.agentFilter" aria-label="Agent筛选">
  <ElOption label="全部 Agent" value="all" />
  <ElOption v-for="agent in explorer.agents" :key="agent.id" :label="agent.name" :value="agent.id" />
</ElSelect>
```

- [ ] **Step 5: Render platform tags without merging rows**

```vue
<button
  v-for="asset in filteredAssets"
  :key="asset.id"
  role="listitem"
  class="asset-row"
  :class="{ selected: asset.id === selectedId }"
  @click="$emit('select', asset.id)"
>
  <span class="asset-copy">
    <span class="asset-title-line">
      <ElTag v-if="sourceKind !== 'central' && asset.agentId" class="platform-tag" effect="plain" size="small">
        {{ agentName(asset.agentId) }}
      </ElTag>
      <strong>{{ asset.name }}</strong>
    </span>
    <small>{{ asset.group }} · {{ asset.description }}</small>
  </span>
  <ElTag class="status-tag" effect="dark" size="small">{{ statusLabel(asset.entryState) }}</ElTag>
</button>
```

- [ ] **Step 6: Map styles and scrolling**

Map Element Plus primary/background/fill/border/text/overlay variables to existing tokens. Add `.asset-title-line` and `.platform-tag`. Retain `overflow: hidden` on `.explorer-pane`; only `.asset-list` gets `overflow-y: auto`.

- [ ] **Step 7: Verify and commit**

```bash
pnpm vitest run test/renderer/resource-explorer-vue.test.ts test/renderer/explorer-store.test.ts
pnpm typecheck:vue
git add src/renderer/src/components/SourceSidebar.vue src/renderer/src/components/ResourceExplorer.vue src/renderer/src/components/AssetList.vue src/renderer/src/VueApp.vue src/renderer/src/styles/app.css test/renderer/resource-explorer-vue.test.ts
git commit -m "feat(renderer): add Vue explorer and platform tags"
```

---

### Task 5: Port Asset Details and Safe Markdown

**Files:**
- Create: `src/renderer/src/components/AssetDetail.vue`, `AssetFileTree.vue`
- Modify: `src/renderer/src/VueApp.vue`
- Create: `test/renderer/asset-detail-vue.test.ts`
- Retain: `src/renderer/src/lib/markdown.ts`

**Interfaces:**
- Props: `asset`, `source`, optional `loadDetail`, optional `loadStatuses`.
- Emits: `action(kind, location)`.

- [ ] **Step 1: Port detail tests before implementation**

Cover preview/source/files/evolution, binary and size limits, statuses, action availability, safe links, request cancellation, and rules without freeze/evolution. Add:

```ts
expect(loadDetail).toHaveBeenCalledWith({
  source: { kind: 'project', projectId: 'proj' },
  assetId: 'codex:skill-one',
})
```

- [ ] **Step 2: Verify failure**

Run `pnpm vitest run test/renderer/asset-detail-vue.test.ts test/renderer/markdown.test.ts`.

- [ ] **Step 3: Implement detail components**

Use `watch` on asset/source with an incrementing token. Use `ElTabs` and `ElButton`. Only render HTML returned by `renderSafeMarkdown` and route link clicks through `handleSafeMarkdownClick`:

```ts
const selection: AssetSelection = { source: props.source, assetId: props.asset.id }
const token = ++requestToken
const [nextDetail, nextStatuses] = await Promise.all([
  props.loadDetail(selection),
  props.loadStatuses(selection),
])
if (token !== requestToken) return
detail.value = nextDetail
statuses.value = nextStatuses
```

- [ ] **Step 4: Mount detail in the shell**

```vue
<AssetDetail
  v-if="explorer.selectedAsset"
  :asset="explorer.selectedAsset"
  :source="explorer.selectedSource"
  @action="openOperation"
/>
<div v-else class="detail-empty">选择资源查看详情</div>
```

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run test/renderer/asset-detail-vue.test.ts test/renderer/markdown.test.ts
pnpm typecheck:vue
git add src/renderer/src/components/AssetDetail.vue src/renderer/src/components/AssetFileTree.vue src/renderer/src/VueApp.vue test/renderer/asset-detail-vue.test.ts
git commit -m "feat(renderer): port asset details to Vue"
```

---

### Task 6: Port Settings, Theme Controls, and Structured Errors

**Files:**
- Create: `src/renderer/src/components/ErrorNotice.vue`
- Create: `src/renderer/src/features/settings/CustomAgentForm.vue`, `SettingsDialog.vue`
- Modify: `src/renderer/src/VueApp.vue`
- Create: `test/renderer/settings-vue.test.ts`

**Interfaces:**
- `ErrorNotice.vue`: `error`, optional retry/action callbacks.
- `CustomAgentForm.vue`: optional `agent`; emits `save(agent)` and `cancel`.
- `SettingsDialog.vue`: `v-model` visibility; uses existing preferences/repository/agent APIs.

- [ ] **Step 1: Port failing settings tests**

Prove invalid IDs, absolute asset subdirectories, traversal, built-in read-only IDs, theme persistence, Agent save/remove/toggle, and secret redaction:

```ts
await user.type(screen.getByLabelText('Agent ID'), '../bad')
await user.type(screen.getByLabelText('Skills 相对目录'), '/absolute')
await user.click(screen.getByRole('button', { name: '保存 Agent' }))
expect(screen.getByRole('alert')).toHaveTextContent(/ID|相对目录/)
expect(onSave).not.toHaveBeenCalled()
```

- [ ] **Step 2: Verify failure**

Run `pnpm vitest run test/renderer/settings-vue.test.ts`.

- [ ] **Step 3: Implement safe errors and Element Plus forms**

Port current error-code mapping and path redaction. Use `ElAlert` for guidance but never expose raw structured backend messages. Use `ElDialog`, `ElForm`, `ElFormItem`, `ElInput`, `ElSwitch`, `ElSelect`, and `ElButton`; preserve all current validation and saved `AgentDefinition` fields.

- [ ] **Step 4: Integrate settings**

Sidebar emits `settings`; the shell controls visibility. Load theme/config/agents on open and refresh explorer agents after save/remove/toggle.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run test/renderer/settings-vue.test.ts test/renderer/preferences-store.test.ts
pnpm typecheck:vue
git add src/renderer/src/components/ErrorNotice.vue src/renderer/src/features/settings/CustomAgentForm.vue src/renderer/src/features/settings/SettingsDialog.vue src/renderer/src/VueApp.vue test/renderer/settings-vue.test.ts
git commit -m "feat(renderer): port settings and errors to Vue"
```

---

### Task 7: Port Operation Planning, Progress, and Cancellation

**Files:**
- Create: `src/renderer/src/stores/operation.ts`
- Create: `src/renderer/src/features/operations/OperationDialog.vue`, `OperationProgress.vue`
- Modify: `src/renderer/src/VueApp.vue`
- Create: `test/renderer/operation-dialog-vue.test.ts`

**Interfaces:**
- Store actions: `open`, `refreshPlans`, `confirm`, `executeAll`, `cancelActive`, `close`.
- Dialog uses existing IPC only; no Node APIs.

- [ ] **Step 1: Port operation tests and add qualified-ID coverage**

Verify returned paths, multi-Agent install planning, exact installed-location actions, overwrite confirmation, progress disposer, sequential execution, cancellation, rescan, and residual paths:

```ts
expect(plan).toHaveBeenCalledWith(expect.objectContaining({
  asset: { source: { kind: 'project', projectId: 'proj' }, assetId: 'codex:skill-one' },
  target: { scope: 'project', projectId: 'proj', agentId: 'codex' },
}))
```

- [ ] **Step 2: Verify failure**

Run `pnpm vitest run test/renderer/operation-dialog-vue.test.ts`.

- [ ] **Step 3: Implement operation store and views**

Use this stage type:

```ts
export type OperationStage = 'closed' | 'preview' | 'confirm' | 'executing' | 'done'
```

Subscribe once per open operation and dispose on close/store disposal. Execute plans sequentially and stop after the first non-completed result. Use `ElDialog`, `ElSelect`, `ElCheckboxGroup`, `ElRadioGroup`, `ElAlert`, `ElProgress`, and `ElButton`. Keep affected/residual paths visible.

- [ ] **Step 4: Wire detail actions**

Normalize `update-with-warning` to `update`, pass the exact status location, and rescan the current source after completed plans.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run test/renderer/operation-dialog-vue.test.ts test/main/operation-service.test.ts
pnpm typecheck:vue
git add src/renderer/src/stores/operation.ts src/renderer/src/features/operations/OperationDialog.vue src/renderer/src/features/operations/OperationProgress.vue src/renderer/src/VueApp.vue test/renderer/operation-dialog-vue.test.ts
git commit -m "feat(renderer): port operations to Vue"
```

---

### Task 8: Cut Over and Remove React

**Files:**
- Create: `src/renderer/src/main.ts`
- Delete: `src/renderer/src/main.tsx`, all superseded renderer `.tsx` source/tests
- Rename: `src/renderer/src/VueApp.vue` to `src/renderer/src/App.vue`
- Modify: `src/renderer/index.html`, `electron.vite.config.ts`, `tsconfig.web.json`, `package.json`, `pnpm-lock.yaml`
- Create: `test/renderer/vue-cutover.test.ts`

**Interfaces:**
- Produces: production renderer importing only Vue, Pinia, and Element Plus.

- [ ] **Step 1: Add a failing dependency guard**

```ts
// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Vue renderer cutover', () => {
  it('does not ship React renderer dependencies', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    expect(pkg.dependencies).not.toHaveProperty('react')
    expect(pkg.dependencies).not.toHaveProperty('react-dom')
    expect(pkg.dependencies).not.toHaveProperty('zustand')
    expect(pkg.devDependencies).not.toHaveProperty('@vitejs/plugin-react')
    expect(pkg.devDependencies).not.toHaveProperty('@testing-library/react')
  })
})
```

- [ ] **Step 2: Verify React is still present**

Run `pnpm vitest run test/renderer/vue-cutover.test.ts`.

- [ ] **Step 3: Create the Vue production entry**

```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/tokens.css'
import './styles/app.css'
import App from './App.vue'

const root = document.getElementById('root')
if (!root) throw new Error('Renderer root element is missing')
createApp(App).use(createPinia()).use(ElementPlus).mount(root)
```

Update HTML to load `/src/main.ts`.

- [ ] **Step 4: Remove React build/type settings and dependencies**

Use only `vue()` in electron-vite. Remove JSX and `.tsx` includes. Set:

```json
"typecheck": "tsc -p tsconfig.node.json --noEmit && vue-tsc -p tsconfig.web.json --noEmit"
```

Run:

```bash
pnpm remove react react-dom zustand
pnpm remove -D @vitejs/plugin-react @testing-library/react @types/react @types/react-dom
```

Delete React `.tsx` files only after every Vue replacement test passes. Keep framework-neutral `.ts` utilities/tests.

- [ ] **Step 5: Verify production cutover**

```bash
pnpm vitest run test/renderer
pnpm typecheck
pnpm build
pnpm why react
```

Expected: tests/typecheck/build pass and no production React dependency is reported.

- [ ] **Step 6: Commit the cutover**

```bash
git add package.json pnpm-lock.yaml electron.vite.config.ts tsconfig.web.json src/renderer test/renderer
git commit -m "refactor(renderer): switch Electron UI to Vue 3"
```

---

### Task 9: Repair and Extend Electron E2E Coverage

**Files:**
- Modify: `test/e2e/fixtures.ts`, `test/e2e/app.spec.ts`
- Modify: `playwright.config.ts` only if teardown needs a separate timeout.

**Interfaces:**
- Produces: deterministic Electron shutdown and exact selectors.

- [ ] **Step 1: Add platform fixtures**

```ts
await mkdir(join(home, '.codex', 'skills', 'backend', 'call-api'), { recursive: true })
await mkdir(join(project, '.claude', 'skills', 'backend', 'call-api'), { recursive: true })
await writeFile(join(home, '.codex', 'skills', 'backend', 'call-api', 'SKILL.md'), '# call-api\n\nCodex global fixture.\n')
await writeFile(join(project, '.claude', 'skills', 'backend', 'call-api', 'SKILL.md'), '# call-api\n\nClaude project fixture.\n')
```

- [ ] **Step 2: Add failing tag smoke tests and exact selectors**

```ts
await e2e.page.getByRole('button', { name: '全局安装', exact: true }).click()
await expect(e2e.page.getByText('Codex', { exact: true })).toBeVisible()
await e2e.page.getByRole('button', { name: 'project', exact: true }).click()
await expect(e2e.page.getByText('Claude Code', { exact: true })).toBeVisible()
```

Change the add-project assertion to `{ name: 'project', exact: true }` so it does not match the removal button.

- [ ] **Step 3: Bound Electron teardown**

```ts
const closed = app.close().then(() => true).catch(() => false)
const graceful = await Promise.race([
  closed,
  new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
])
if (!graceful) app.process().kill('SIGKILL')
await rm(root, { recursive: true, force: true })
```

- [ ] **Step 4: Verify and commit**

```bash
pnpm test:e2e
git add test/e2e/fixtures.ts test/e2e/app.spec.ts playwright.config.ts
git commit -m "test(e2e): cover Vue platform labels"
```

Expected: all Electron smoke tests pass without teardown timeouts.

---

### Task 10: Final Visual QA and Verification

**Files:**
- Modify only files tied to a reproduced parity defect.

**Interfaces:**
- Produces: verified Vue Electron UI and clean repository state.

- [ ] **Step 1: Run the complete automated gate**

```bash
git diff --check
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
```

Expected: zero failures.

- [ ] **Step 2: Start the real application**

Run `pnpm dev` and verify in the Electron window:

- Central rows show no platform tag.
- Global/project duplicate names show distinct tags.
- Clicking each duplicate loads its exact platform path.
- Filters open beneath controls; branch closes outside and on Escape.
- Only the list scrolls; header/tabs/search/filters stay fixed.
- Settings and operations preserve close/focus behavior.
- Light/dark/system themes match the current design.

- [ ] **Step 3: Verify dependencies and repository state**

```bash
pnpm list vue pinia element-plus react react-dom zustand --depth 0
git status --short
git log --oneline -10
```

Expected: Vue/Pinia/Element Plus present; React/ReactDOM/Zustand absent; no generated artifacts untracked.

- [ ] **Step 4: Commit only reproduced parity fixes**

For any live defect, first add a failing regression test, implement the smallest fix, rerun the full gate, then commit:

```bash
git add src test
git commit -m "fix(renderer): complete Vue parity verification"
```

If no defect is found, do not create an empty commit.
