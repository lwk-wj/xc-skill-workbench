# Batch Resource Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strict, filter-aware batch install, freeze, thaw, and uninstall operations to the Electron resource list while preserving the existing single-resource operation behavior.

**Architecture:** Keep Core and IPC single-resource contracts unchanged. Add a shared renderer action-policy module, controlled list selection, and an independent Pinia batch-operation state machine that creates all single-resource plans before executing them sequentially. A dedicated Element Plus dialog renders configuration, validation, progress, cancellation, and grouped results.

**Tech Stack:** Electron, Vue 3, TypeScript, Pinia, Element Plus, Vitest, Testing Library Vue

**Spec:** `docs/superpowers/specs/2026-09-02-batch-resource-operations-design.md`

## Global Constraints

- “Select all” means every resource matching the current search and filters.
- Changing source, resource type, search text, or any filter clears the current selection.
- One ineligible selected resource disables the entire requested batch action and exposes the exact reason.
- Batch install uses one shared scope, project, Agent selection, and install method for every selected resource.
- All plans must be created successfully before execution is enabled.
- Execution is sequential and stops at the first failure or cancellation without rolling back completed items.
- Do not add batch-specific Core, preload, or IPC APIs.
- Do not add batch update, background jobs, automatic rollback, or batch source replacement.
- Preserve existing single-resource actions and the existing light blue industrial visual language.

---

### Task 1: Shared Asset Action Policy

**Files:**
- Create: `src/renderer/src/lib/asset-actions.ts`
- Create: `test/renderer/asset-actions.test.ts`
- Modify: `src/renderer/src/components/AssetList.vue`
- Test: `test/renderer/asset-list-vue.test.ts`

**Interfaces:**
- Consumes: `AssetRecord`, `AssetStatusLocation`, and `SourceSelection['kind']` from `src/shared/ipc.ts`.
- Produces:

```ts
export type AssetActionKind = 'install' | 'update' | 'update-with-warning' | 'freeze' | 'thaw' | 'uninstall' | 'relink-source'
export type AssetAction = { kind: AssetActionKind; label: string }
export type BatchActionKind = 'install' | 'freeze' | 'thaw' | 'uninstall'
export type ActionEligibility = { eligible: true } | { eligible: false; reason: string }

export function primaryAssetAction(input: {
  sourceKind: SourceSelection['kind']
  asset: AssetRecord
  location: AssetStatusLocation | null
}): AssetAction | null

export function overflowAssetActions(input: {
  sourceKind: SourceSelection['kind']
  asset: AssetRecord
  location: AssetStatusLocation | null
}): AssetAction[]

export function batchActionEligibility(input: {
  action: BatchActionKind
  sourceKind: SourceSelection['kind']
  asset: AssetRecord
  location: AssetStatusLocation | null
}): ActionEligibility
```

- [ ] **Step 1: Write failing action-policy tests**

Create table-driven tests with literal expectations:

```ts
it.each([
  ['install', 'central', activeAsset, null, true, null],
  ['freeze', 'project', activeAsset, currentLocation, true, null],
  ['freeze', 'project', frozenAsset, frozenLocation, false, '资源已经冻结'],
  ['thaw', 'project', frozenAsset, frozenLocation, true, null],
  ['thaw', 'project', activeAsset, currentLocation, false, '资源尚未冻结'],
  ['uninstall', 'project', activeAsset, null, false, '缺少受管安装位置'],
] as const)('%s validates %s resources', (action, sourceKind, asset, location, eligible, reason) => {
  const result = batchActionEligibility({ action, sourceKind, asset, location })
  expect(result.eligible).toBe(eligible)
  if (!eligible) expect(result).toEqual({ eligible: false, reason })
})
```

Add characterization expectations for the current single-row actions: central resources install; frozen Skills thaw; active installed Skills freeze; unavailable sources retain relink and uninstall.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm exec vitest run test/renderer/asset-actions.test.ts
```

Expected: FAIL because `src/renderer/src/lib/asset-actions.ts` does not exist.

- [ ] **Step 3: Implement the pure action-policy module**

Use the status from `location?.status.status` and explicit source rules. Return stable Chinese reasons from the policy rather than reconstructing them in components. Freeze and thaw must require a location; install must require `central` or `third-party`; uninstall must require a location.

- [ ] **Step 4: Refactor `AssetList.vue` to use the policy**

Replace local `primaryAction` and `overflowActions` branches with calls to `primaryAssetAction` and `overflowAssetActions`. Keep `runAction` and all emitted arguments unchanged.

- [ ] **Step 5: Run policy and existing row-operation tests**

Run:

```bash
pnpm exec vitest run test/renderer/asset-actions.test.ts test/renderer/asset-list-vue.test.ts
```

Expected: PASS with no single-row behavior changes.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/asset-actions.ts src/renderer/src/components/AssetList.vue test/renderer/asset-actions.test.ts test/renderer/asset-list-vue.test.ts
git commit -m "refactor(renderer): share resource action policy"
```

---

### Task 2: Filter-Aware List Selection and Batch Toolbar

**Files:**
- Modify: `src/renderer/src/components/AssetList.vue`
- Modify: `src/renderer/src/components/ResourceExplorer.vue`
- Modify: `src/renderer/src/styles/app.css`
- Test: `test/renderer/asset-list-vue.test.ts`
- Test: `test/renderer/resource-explorer-vue.test.ts`

**Interfaces:**
- Consumes: `BatchActionKind` and `batchActionEligibility` from Task 1.
- Produces these `AssetList` props and events:

```ts
selectedIds: string[]

'update:selectedIds': [ids: string[]]
'batch-action': [action: BatchActionKind, assets: AssetRecord[]]
```

- Produces this `ResourceExplorer` event:

```ts
'batch-action': [action: BatchActionKind, assets: AssetRecord[]]
```

- [ ] **Step 1: Write failing `AssetList` selection tests**

Add component tests that render three assets with only two matching `query: 'api'`, then assert:

```ts
await user.click(screen.getByRole('checkbox', { name: '全选当前筛选结果' }))
expect(onUpdateSelectedIds).toHaveBeenLastCalledWith(['skill-api-1', 'skill-api-2'])
```

Also verify:

- One selected row makes the select-all checkbox indeterminate.
- Clicking a row checkbox does not emit `select`.
- Central source shows only “批量安装”.
- Project source shows freeze, thaw, and uninstall controls.
- A mixed active/frozen selection disables freeze and exposes `Frozen Skill：资源已经冻结`.

- [ ] **Step 2: Run `AssetList` tests and verify RED**

Run:

```bash
pnpm exec vitest run test/renderer/asset-list-vue.test.ts
```

Expected: FAIL because selection props, checkboxes, and toolbar do not exist.

- [ ] **Step 3: Implement controlled selection in `AssetList.vue`**

Keep `filteredAssets` as the authoritative current-view set. Implement literal selection helpers:

```ts
const filteredIds = computed(() => filteredAssets.value.map((asset) => asset.id))
const selectedSet = computed(() => new Set(props.selectedIds))
const allFilteredSelected = computed(() => filteredIds.value.length > 0 && filteredIds.value.every((id) => selectedSet.value.has(id)))
const someFilteredSelected = computed(() => !allFilteredSelected.value && filteredIds.value.some((id) => selectedSet.value.has(id)))

const toggleAsset = (id: string, checked: boolean): void => {
  const next = new Set(props.selectedIds)
  checked ? next.add(id) : next.delete(id)
  emit('update:selectedIds', [...next])
}

const toggleAllFiltered = (checked: boolean): void => {
  const next = new Set(props.selectedIds)
  for (const id of filteredIds.value) checked ? next.add(id) : next.delete(id)
  emit('update:selectedIds', [...next])
}
```

Render the tri-state checkbox and each row checkbox with accessible names. Show the toolbar only when at least one resource is selected.

- [ ] **Step 4: Implement strict toolbar eligibility**

For each action, evaluate every selected asset through `batchActionEligibility`. Disable the action when any result is ineligible. Render a compact popover/list containing every `{ assetName, reason }`. Emit only when the complete selection is eligible.

- [ ] **Step 5: Add selection reset tests in `ResourceExplorer`**

Select an item, then independently change source, type, query, group, status, and Agent filter. Each case must end with no checked row and no batch toolbar. Use real Element Plus controls and the existing mocked API.

- [ ] **Step 6: Implement selection ownership and reset in `ResourceExplorer.vue`**

Add:

```ts
const selectedAssetIds = ref<string[]>([])
const selectionContext = computed(() => [
  explorer.selectedSource.id,
  explorer.assetType,
  explorer.query,
  explorer.groupFilter,
  explorer.statusFilter,
  explorer.agentFilter,
].join('\u0000'))

watch(selectionContext, () => { selectedAssetIds.value = [] })
```

Bind `v-model:selected-ids` on `AssetList` and forward `batch-action` to `App.vue`.

- [ ] **Step 7: Style the selection UI**

Add semantic classes such as `.asset-batch-toolbar`, `.asset-row-select`, and `.asset-batch-invalid-list`. The toolbar must be sticky below the explorer header, use the existing border and blue tokens, keep row text alignment stable, and use the existing danger token for uninstall.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
pnpm exec vitest run test/renderer/asset-list-vue.test.ts test/renderer/resource-explorer-vue.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/renderer/src/components/AssetList.vue src/renderer/src/components/ResourceExplorer.vue src/renderer/src/styles/app.css test/renderer/asset-list-vue.test.ts test/renderer/resource-explorer-vue.test.ts
git commit -m "feat(renderer): add batch resource selection"
```

---

### Task 3: Batch Planning State Machine

**Files:**
- Create: `src/renderer/src/stores/batch-operation.ts`
- Create: `test/renderer/batch-operation-store.test.ts`

**Interfaces:**
- Consumes existing `window.xcSkills.operations` methods and the shared IPC types.
- Produces:

```ts
export type BatchOperationStage = 'closed' | 'configure' | 'preview' | 'confirm' | 'executing' | 'done'
export type BatchOperationItem = { asset: AssetRecord; location: AssetStatusLocation | null }
export type BatchPlanEntry = {
  key: string
  asset: AssetRecord
  agentId: string
  agentName: string
  request: OperationRequest
  plan: OperationPlan | null
  planningError: string | null
}

export type OpenBatchOperation = {
  kind: BatchActionKind
  items: BatchOperationItem[]
  source: SourceSelection
  projects: ProjectRecord[]
  agents: AgentDefinition[]
  onRescan?: (paths: string[]) => void
}

Named export: `useBatchOperationStore`, created with Pinia setup-store id `batch-operation`.
```

- [ ] **Step 1: Write failing install planning tests**

Open 2 central assets with 2 enabled Agents and assert four literal targets are sent to `operations.plan`:

```ts
expect(plan.mock.calls.map(([request]) => request.target)).toEqual([
  { scope: 'project', projectId: 'proj', agentId: 'codex' },
  { scope: 'project', projectId: 'proj', agentId: 'claude-code' },
  { scope: 'project', projectId: 'proj', agentId: 'codex' },
  { scope: 'project', projectId: 'proj', agentId: 'claude-code' },
])
```

Assert all requests share `method: 'copy'`, the store defaults to project scope when projects exist, and `planEntries` preserve resource-then-Agent order.

- [ ] **Step 2: Write failing local-operation planning tests**

Open two project items for freeze and assert each request uses its exact location:

```ts
expect(plan.mock.calls.map(([request]) => request.target)).toEqual([
  { scope: 'project', projectId: 'proj', agentId: 'codex' },
  { scope: 'project', projectId: 'proj', agentId: 'claude-code' },
])
```

Assert missing locations become planning errors and prevent `canConfirm`.

- [ ] **Step 3: Run store tests and verify RED**

Run:

```bash
pnpm exec vitest run test/renderer/batch-operation-store.test.ts
```

Expected: FAIL because the batch store does not exist.

- [ ] **Step 4: Implement batch request construction**

Use plain, non-proxy source data via `plainSource`. Install creates a Cartesian product of items and selected enabled Agents. Freeze, thaw, and uninstall create one request per exact location and set `method: null`.

- [ ] **Step 5: Implement all-plan gating**

Use `Promise.allSettled` so every predictable problem appears in one preview. For install requests, call `inspectSourceConflict` first; represent any returned conflict as a planning error and do not pass `replaceExistingSource`. Compute:

```ts
const canConfirm = computed(() =>
  planEntries.value.length > 0
  && planEntries.value.every((entry) => entry.plan !== null && entry.planningError === null)
)
```

Ignore stale asynchronous planning results through an incrementing planning token, matching the existing `OperationStore` pattern.

- [ ] **Step 6: Run planning tests and commit**

Run:

```bash
pnpm exec vitest run test/renderer/batch-operation-store.test.ts
```

Expected: planning tests PASS.

Commit:

```bash
git add src/renderer/src/stores/batch-operation.ts test/renderer/batch-operation-store.test.ts
git commit -m "feat(renderer): plan batch resource operations"
```

---

### Task 4: Sequential Batch Execution and Cancellation

**Files:**
- Modify: `src/renderer/src/stores/batch-operation.ts`
- Modify: `test/renderer/batch-operation-store.test.ts`

**Interfaces:**
- Extends Task 3 with:

```ts
export type BatchExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'not_run'
export type BatchExecutionEntry = BatchPlanEntry & {
  status: BatchExecutionStatus
  result: OperationResult | null
  error: string | null
}

executeAll(): Promise<void>
cancelActive(): Promise<void>
close(): void
```

- [ ] **Step 1: Write the failing first-error-stop test**

Configure three valid plans. Make the first resolve `completed`, the second throw `disk full`, and assert:

```ts
expect(execute.mock.calls.map(([planId]) => planId)).toEqual(['plan-1', 'plan-2'])
expect(store.executionEntries.map((entry) => entry.status)).toEqual(['completed', 'failed', 'not_run'])
expect(store.stage).toBe('done')
```

Assert `onRescan` is called once after execution stops and receives only the completed plan’s deduplicated affected paths.

- [ ] **Step 2: Write the failing cancellation test**

Keep the first execution pending, call `cancelActive`, verify `operations.cancel('plan-1')`, resolve the active execution as cancelled, and assert remaining entries are `not_run` and never execute.

- [ ] **Step 3: Run the new tests and verify RED**

Run:

```bash
pnpm exec vitest run test/renderer/batch-operation-store.test.ts -t "stops|cancels"
```

Expected: FAIL because execution and cancellation are not implemented.

- [ ] **Step 4: Implement sequential execution**

Iterate over entries in order. Mark one entry `running`, await `execute`, and only advance for `result.status === 'completed'`. On thrown errors or non-completed results, set the current terminal status, mark all remaining entries `not_run`, and stop.

Subscribe once to `onProgress` when opening the batch and update progress only when `event.planId` matches the current plan. Dispose the listener on close and scope disposal.

- [ ] **Step 5: Implement cancellation**

Track `cancelRequested` and `cancelling`. Call `cancel` only for the active plan. Do not report cancellation until the active `execute` promise resolves or rejects. Keep the dialog in the executing stage if cancel itself rejects.

- [ ] **Step 6: Run all store tests and commit**

Run:

```bash
pnpm exec vitest run test/renderer/batch-operation-store.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/renderer/src/stores/batch-operation.ts test/renderer/batch-operation-store.test.ts
git commit -m "feat(renderer): execute batch operations sequentially"
```

---

### Task 5: Batch Operation Dialog

**Files:**
- Create: `src/renderer/src/features/operations/BatchOperationDialog.vue`
- Create: `test/renderer/batch-operation-dialog-vue.test.ts`
- Modify: `src/renderer/src/styles/app.css`

**Interfaces:**
- Consumes the complete `useBatchOperationStore` from Tasks 3–4.
- Produces no public events; it is mounted once and controlled by store stage.

- [ ] **Step 1: Write failing configuration and preview tests**

For a central batch install, assert the dialog renders shared target scope, project, Agent checkboxes, and install method. Change project and method, then verify replanning uses those values.

Assert the preview includes literal summary text such as `2 个资源 · 2 个 Agent · 4 项操作`, collapsible affected paths, grouped warnings, and a disabled confirmation button when any `planningError` exists.

- [ ] **Step 2: Write failing progress and result tests**

Assert the executing view contains `正在处理 2/4：auto-type-mapper · Claude Code`. After a simulated failure, assert separate headings and item counts for `已完成 1`, `失败 1`, and `未执行 2`.

Assert clicking close during execution opens a confirmation guard instead of closing immediately.

- [ ] **Step 3: Run dialog tests and verify RED**

Run:

```bash
pnpm exec vitest run test/renderer/batch-operation-dialog-vue.test.ts
```

Expected: FAIL because the dialog does not exist.

- [ ] **Step 4: Implement the Element Plus dialog**

Use one `ElDialog` with stage-specific sections:

- `configure`: shared install configuration.
- `preview`: count summary, target summary, paths, warnings, and errors.
- `confirm`: destructive-action warning and final execute button.
- `executing`: overall progress, current resource/Agent, and cancel.
- `done`: completed, failed/cancelled, and not-run groups.

Freeze/thaw/uninstall skip the configure section and enter preview after planning. Uninstall uses `ElButton type="danger"`; other primary actions use the existing primary blue.

- [ ] **Step 5: Add polished, scoped semantic styling**

Use shared application tokens in `app.css`. Keep the dialog within `min(760px, calc(100vw - 48px))`, make long path lists independently scrollable, and prevent modal body scroll chaining with `overscroll-behavior: contain`. Do not introduce gradients, new font families, or unrelated theme changes.

- [ ] **Step 6: Run dialog tests and commit**

Run:

```bash
pnpm exec vitest run test/renderer/batch-operation-dialog-vue.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/renderer/src/features/operations/BatchOperationDialog.vue src/renderer/src/styles/app.css test/renderer/batch-operation-dialog-vue.test.ts
git commit -m "feat(renderer): add batch operation dialog"
```

---

### Task 6: Application Integration

**Files:**
- Modify: `src/renderer/src/App.vue`
- Modify: `src/renderer/src/components/ResourceExplorer.vue`
- Modify: `test/renderer/resource-explorer-vue.test.ts`

**Interfaces:**
- Consumes `BatchActionKind`, `BatchOperationItem`, `useBatchOperationStore`, and `BatchOperationDialog`.
- `ResourceExplorer` emits selected assets; `App` enriches them with `managementStatuses[asset.id]?.[0] ?? null` before opening the store.

- [ ] **Step 1: Write failing end-to-end renderer integration tests**

For central source:

1. Select two filtered resources.
2. Click “批量安装”.
3. Verify the single-resource detail drawer stays closed.
4. Verify the batch dialog opens with both resources and defaults to project scope.

For project source, verify mixed states disable freeze and an all-frozen selection opens batch thaw with exact project/Agent locations.

- [ ] **Step 2: Run integration tests and verify RED**

Run:

```bash
pnpm exec vitest run test/renderer/resource-explorer-vue.test.ts -t "批量"
```

Expected: FAIL because `App.vue` does not mount or open the batch dialog.

- [ ] **Step 3: Wire the batch flow in `App.vue`**

Add:

```ts
const batchOperation = useBatchOperationStore()

const openBatchOperation = async (kind: BatchActionKind, assets: AssetRecord[]): Promise<void> => {
  await batchOperation.open({
    kind,
    items: assets.map((asset) => ({
      asset,
      location: explorer.managementStatuses[asset.id]?.[0] ?? null,
    })),
    source: currentSource(),
    projects: explorer.projects,
    agents: explorer.agents,
    onRescan: () => { void explorer.refreshCurrentSource() },
  })
}
```

Bind `@batch-action="openBatchOperation"` on `ResourceExplorer` and mount `<BatchOperationDialog />` next to the existing `<OperationDialog />`.

- [ ] **Step 4: Run renderer integration and regression tests**

Run:

```bash
pnpm exec vitest run \
  test/renderer/asset-actions.test.ts \
  test/renderer/asset-list-vue.test.ts \
  test/renderer/batch-operation-store.test.ts \
  test/renderer/batch-operation-dialog-vue.test.ts \
  test/renderer/operation-dialog-vue.test.ts \
  test/renderer/resource-explorer-vue.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.vue src/renderer/src/components/ResourceExplorer.vue test/renderer/resource-explorer-vue.test.ts
git commit -m "feat(renderer): integrate batch resource operations"
```

---

### Task 7: Full Verification and Manual Electron Check

**Files:**
- Modify only files required by failures directly caused by Tasks 1–6.

**Interfaces:**
- Consumes the completed feature; produces verification evidence only.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: all commands exit 0. If an existing unrelated test is already failing, record its exact name and prove all feature-focused suites pass; do not silently change unrelated behavior.

- [ ] **Step 2: Start or refresh the Electron development app**

Run:

```bash
pnpm dev
```

Use the existing dev process when it is healthy; restart only when HMR cannot load the new Pinia store or component.

- [ ] **Step 3: Manually verify batch install**

In the central repository:

1. Filter to at least two Skills and choose “全选当前筛选结果”.
2. Open batch install.
3. Select one project, two Agents, and soft-link installation.
4. Verify the preview count equals resources × Agents.
5. Execute and use `lstat`/`readlink` to confirm every target is a symbolic link to the configured managed asset store.

- [ ] **Step 4: Manually verify strict state gating**

In a project source, select one active and one frozen resource. Verify batch freeze is disabled and both the resource name and reason are visible. Select only active resources and verify batch freeze succeeds; then select only frozen resources and verify batch thaw succeeds.

- [ ] **Step 5: Manually verify stop-on-error and uninstall confirmation**

Create or use a controlled target conflict in a disposable fixture project. Confirm plan errors prevent execution. For an execution-time failure fixture, verify later plans remain unexecuted. Verify batch uninstall uses a danger confirmation and removes only selected managed installations.

- [ ] **Step 6: Review the final diff and commit verification fixes**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

If verification requires code changes, return to the owning task above, repeat its listed RED/GREEN test cycle, and use that task’s exact `git add` file list. Commit the correction with `git commit -m "fix(renderer): harden batch resource operations"`.
