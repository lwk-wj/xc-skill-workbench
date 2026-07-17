# Asset Detail Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed 280px asset detail column with a wide Element Plus drawer that preserves list context and closes safely when the source changes.

**Architecture:** `App.vue` owns drawer visibility and renders the selected `AssetDetail` inside `ElDrawer`. `ResourceExplorer.vue` emits a generic asset-selection event so a previously selected row can reopen a closed drawer without coupling the explorer to drawer behavior. The explorer store continues to clear selection on source changes, and an App watcher closes the drawer when that happens.

**Tech Stack:** Vue 3, TypeScript, Pinia, Element Plus, Vitest, Testing Library Vue, Playwright Electron

## Global Constraints

- Reuse the existing `AssetDetail` loading, tabs, status actions, and error handling.
- Drawer desktop width is `min(760px, 64vw)` and becomes nearly full width below `900px`.
- Closing the drawer must preserve source, filters, list scroll position, and selected asset.
- Changing source must clear the old selection and close the drawer.
- Do not add routing, a new BrowserWindow, draggable sizing, or persistent drawer size.

---

### Task 1: Drawer interaction and component ownership

**Files:**
- Modify: `test/renderer/resource-explorer-vue.test.ts`
- Modify: `src/renderer/src/components/ResourceExplorer.vue`
- Modify: `src/renderer/src/components/AssetDetail.vue`
- Modify: `src/renderer/src/App.vue`

**Interfaces:**
- `ResourceExplorer` produces the Vue event `asset-selected` after assigning `explorer.selectedAssetId`.
- `App.vue` consumes `asset-selected` by setting `detailOpen.value = true`.
- `App.vue` watches `explorer.selectedAsset` and closes the drawer when it becomes `null`.

- [ ] **Step 1: Write the failing drawer interaction test**

Add this case to `test/renderer/resource-explorer-vue.test.ts`:

```ts
it('opens asset details in a drawer and preserves the selection when closed', async () => {
  const user = userEvent.setup()
  renderTestApp(App)
  const row = await screen.findByText('Skill One')

  await user.click(row)
  const drawer = await screen.findByRole('dialog', { name: 'Skill One' })
  expect(drawer).toBeInTheDocument()
  expect(screen.queryByText('选择资源查看详情')).toBeNull()

  await user.click(within(drawer).getByRole('button', { name: /close/i }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Skill One' })).toBeNull())
  expect(row.closest('[role="listitem"]')).toHaveClass('selected')

  await user.click(row)
  expect(await screen.findByRole('dialog', { name: 'Skill One' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test and verify the fixed-column implementation fails**

Run:

```bash
pnpm vitest run test/renderer/resource-explorer-vue.test.ts -t "opens asset details in a drawer"
```

Expected: FAIL because no dialog named `Skill One` exists.

- [ ] **Step 3: Emit selection intent from the explorer**

In `ResourceExplorer.vue`, define and use a generic event:

```ts
const emit = defineEmits<{ 'asset-selected': [] }>()

const selectAsset = (assetId: string): void => {
  explorer.selectedAssetId = assetId
  emit('asset-selected')
}
```

Replace the direct assignment:

```vue
@select="selectAsset"
```

- [ ] **Step 4: Render details inside `ElDrawer`**

In `App.vue`, import `ElDrawer`, `watch`, and add:

```ts
const detailOpen = ref(false)
watch(() => explorer.selectedAsset, (asset) => {
  if (!asset) detailOpen.value = false
})
```

Replace the fixed `<aside>` with:

```vue
<ResourceExplorer @asset-selected="detailOpen = true" />
<ElDrawer
  v-model="detailOpen"
  class="asset-detail-drawer"
  direction="rtl"
  size="min(760px, 64vw)"
  destroy-on-close
>
  <template #header="{ titleId, titleClass }">
    <div class="asset-detail-header">
      <h2 :id="titleId" :class="titleClass">{{ explorer.selectedAsset?.name ?? '资源详情' }}</h2>
      <small v-if="explorer.selectedAsset?.version">· {{ explorer.selectedAsset.version }}</small>
    </div>
  </template>
  <AssetDetail
    v-if="explorer.selectedAsset"
    :asset="explorer.selectedAsset"
    :source="explorer.selectedSource"
    @action="openOperation"
  />
</ElDrawer>
```

Remove the now-duplicated `asset-detail-header` from `AssetDetail.vue`; the drawer header slot becomes the accessible title, version, and close area.

- [ ] **Step 5: Run the interaction tests**

Run:

```bash
pnpm vitest run test/renderer/resource-explorer-vue.test.ts test/renderer/asset-detail-vue.test.ts
```

Expected: both files PASS, including close-and-reopen and source-change regression cases.

- [ ] **Step 6: Commit the interaction change**

```bash
git add src/renderer/src/App.vue src/renderer/src/components/ResourceExplorer.vue src/renderer/src/components/AssetDetail.vue test/renderer/resource-explorer-vue.test.ts
git commit -m "feat(renderer): open asset details in a drawer"
```

---

### Task 2: Responsive drawer layout and Electron verification

**Files:**
- Modify: `src/renderer/src/styles/app.css`
- Modify: `test/e2e/app.spec.ts`

**Interfaces:**
- `.app-shell` changes from three columns to `220px minmax(480px, 1fr)`.
- `.asset-detail-drawer` styles Element Plus drawer header, body, and narrow-window width.

- [ ] **Step 1: Write the failing Electron drawer test**

Add this case to `test/e2e/app.spec.ts`:

```ts
test('opens readable asset details in a wide drawer', async ({ e2e }) => {
  await e2e.page.getByRole('listitem').filter({ hasText: 'call-api' }).first().click()
  const drawer = e2e.page.getByRole('dialog', { name: 'call-api' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('tab', { name: '预览' })).toBeVisible()
  const width = await drawer.evaluate((element) => element.getBoundingClientRect().width)
  expect(width).toBeGreaterThanOrEqual(600)
  await drawer.getByRole('button', { name: /close/i }).click()
  await expect(drawer).toBeHidden()
})
```

- [ ] **Step 2: Run the E2E test and verify it fails**

Run:

```bash
pnpm exec playwright test test/e2e/app.spec.ts -g "wide drawer"
```

Expected: FAIL because the existing detail pane is not a dialog and is only `280px` wide.

- [ ] **Step 3: Replace fixed-column CSS with drawer CSS**

Update the grid and remove obsolete `.detail-pane` / `.detail-empty` styles:

```css
.app-shell {
  grid-template-columns: 220px minmax(480px, 1fr);
}

.asset-detail-drawer.el-drawer {
  border-left: 1px solid var(--border);
  background: var(--surface-muted);
}

.asset-detail-drawer .el-drawer__header {
  margin: 0;
  border-bottom: 1px solid var(--border);
  padding: 24px 28px 18px;
}

.asset-detail-drawer .el-drawer__body {
  padding: 0 28px 32px;
  overflow: auto;
}

.asset-detail-drawer .detail-content {
  font-size: 14px;
  line-height: 1.76;
}

@media (max-width: 900px) {
  .asset-detail-drawer.el-drawer {
    width: calc(100vw - 24px) !important;
  }
}
```

Keep detail tab and code block styling, but remove rules that only position the old third column.

- [ ] **Step 4: Run targeted tests and inspect the real Electron window**

Run:

```bash
pnpm vitest run test/renderer/resource-explorer-vue.test.ts test/renderer/asset-detail-vue.test.ts
pnpm exec playwright test test/e2e/app.spec.ts -g "wide drawer"
```

Expected: PASS. Then run `pnpm dev`, open `frontend-design`, and visually confirm the preview, tabs, close button, scrolling, and list state after close.

- [ ] **Step 5: Run full verification**

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
git diff --check
```

Expected: all commands exit `0`; Vitest and all four existing E2E tests plus the new drawer test pass.

- [ ] **Step 6: Commit responsive layout and coverage**

```bash
git add src/renderer/src/styles/app.css test/e2e/app.spec.ts
git commit -m "style(renderer): widen asset detail drawer"
```
