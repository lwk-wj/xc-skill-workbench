# Installation Status Compact Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the installation status view as the selected compact table direction while preserving every existing filter and operation behavior.

**Architecture:** Keep `AssetInstallationStatus.vue` data flow and emitted actions unchanged. Use the component's existing semantic children as CSS grid cells through `display: contents`, then verify the row geometry in the real Electron renderer with Playwright.

**Tech Stack:** Vue 3, TypeScript, Element Plus, CSS grid/container queries, Vitest, Playwright Electron.

## Global Constraints

- Preserve all current installation, update, freeze, thaw, uninstall, and diagnose behavior.
- Do not change IPC, Pinia stores, status calculations, props, or emitted event signatures.
- Use existing light/dark design tokens only; add no dependency or external icon asset.
- Desktop rows align platform, path, method, state, and action on one line.
- Narrow drawer rows fold into two readable lines without hiding actions or full-path tooltips.

---

### Task 1: Compact installation table layout

**Files:**
- Modify: `src/renderer/src/styles/app.css`
- Modify: `test/e2e/app.spec.ts`

**Interfaces:**
- Consumes: existing `.installation-view`, `.installation-scope-filter`, `.installation-group`, `.status-location`, `.status-location-copy`, `.status-location-state`, `.status-badge`, and `.status-actions` markup.
- Produces: computed desktop row layout with `grid-template-areas: "mark name path method badge actions"`; drawer body and tab scrolling remain unchanged.

- [ ] **Step 1: Extend the Electron test with compact-row assertions**

After opening the installation tab, select the global filter and inspect the first row:

```ts
await drawer.getByRole('radio', { name: '全局' }).check()
const firstLocation = drawer.locator('.status-location').first()
const layout = await firstLocation.evaluate((element) => {
  const style = getComputedStyle(element)
  const name = element.querySelector('.status-location-copy strong')!.getBoundingClientRect()
  const path = element.querySelector('.status-location-copy code')!.getBoundingClientRect()
  return {
    columns: style.gridTemplateColumns.split(' ').length,
    radius: style.borderRadius,
    nameTop: Math.round(name.top),
    pathTop: Math.round(path.top),
  }
})
expect(layout.columns).toBeGreaterThanOrEqual(6)
expect(layout.radius).toBe('0px')
expect(Math.abs(layout.nameTop - layout.pathTop)).toBeLessThanOrEqual(2)
```

- [ ] **Step 2: Build and run the focused E2E test to verify RED**

Run:

```bash
pnpm build && pnpm exec playwright test test/e2e/app.spec.ts -g "wide drawer"
```

Expected: FAIL because each location is still a three-column rounded card and name/path are vertically stacked.

- [ ] **Step 3: Implement the compact utility header and table grid**

Replace the installation layout rules in `app.css` with the following structure:

```css
.installation-view {
  container-type: inline-size;
  width: min(100%, 760px);
  margin: 0 auto;
  padding: 20px 0 8px;
}

.installation-view-header {
  align-items: center;
  margin-bottom: 10px;
}

.installation-summary span {
  border: 1px solid var(--border);
  background: var(--surface-raised);
}

.installation-scope-filter {
  width: min(100%, 280px);
  margin-bottom: 15px;
  border-radius: 9px;
  background: var(--surface-raised);
}

.installation-group {
  margin-top: 14px;
}

.status-location {
  display: grid;
  grid-template-columns: 28px minmax(90px, .65fr) minmax(160px, 1.65fr) 48px auto auto;
  grid-template-areas: "mark name path method badge actions";
  align-items: center;
  gap: 10px;
  min-height: 48px;
  margin-top: -1px;
  border: 1px solid var(--border);
  border-radius: 0;
  background: var(--surface-raised);
  padding: 8px 10px;
  box-shadow: none;
}

.installation-group .status-location:first-of-type {
  margin-top: 7px;
  border-radius: 10px 10px 0 0;
}

.installation-group .status-location:last-child {
  border-radius: 0 0 10px 10px;
}

.installation-group .status-location:only-of-type {
  border-radius: 10px;
}

.status-location:hover {
  position: relative;
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  background: color-mix(in srgb, var(--surface-hover) 42%, var(--surface-raised));
  z-index: 1;
}

.status-platform-mark { grid-area: mark; width: 28px; height: 28px; border-radius: 7px; }
.status-location-copy,
.status-location-state { display: contents; }
.status-location-copy strong { grid-area: name; }
.status-location-copy code { grid-area: path; }
.status-location-copy small { grid-area: method; }
.status-badge { grid-area: badge; }
.status-actions { grid-area: actions; justify-content: flex-end; }
.status-actions button { min-height: 26px; padding: 3px 7px; }
```

Add container-query folding:

```css
@container (max-width: 620px) {
  .status-location {
    grid-template-columns: 28px minmax(0, 1fr) auto;
    grid-template-areas:
      "mark name badge"
      ". path actions"
      ". method actions";
    gap: 3px 9px;
    padding: 9px 10px;
  }

  .status-actions { align-self: center; }
}
```

- [ ] **Step 4: Run focused renderer and Electron tests**

Run:

```bash
pnpm vitest run test/renderer/asset-installation-status-vue.test.ts test/renderer/asset-detail-vue.test.ts
pnpm build
pnpm exec playwright test test/e2e/app.spec.ts -g "wide drawer"
```

Expected: renderer tests pass and the Electron test confirms at least six aligned desktop grid columns, square middle rows, functional scope filtering, and unchanged drawer behavior.

- [ ] **Step 5: Commit the compact layout**

```bash
git add src/renderer/src/styles/app.css test/e2e/app.spec.ts
git commit -m "style(renderer): compact installation status table"
```

---

### Task 2: Visual and complete verification

**Files:**
- Verify: `src/renderer/src/styles/app.css`
- Verify: `src/renderer/src/components/AssetInstallationStatus.vue`

**Interfaces:**
- Consumes: Task 1 compact table CSS.
- Produces: verified light/dark Electron presentation with no source changes unless a visual defect is found.

- [ ] **Step 1: Inspect the real Electron window in light theme**

Open a resource with at least four global locations and verify platform/name/path/method/status/action alignment, hover containment, and path ellipsis.

- [ ] **Step 2: Inspect the same view in dark theme**

Verify border, path, badge, and action contrast; restore the user's original theme after inspection.

- [ ] **Step 3: Run complete verification**

Run:

```bash
pnpm test && pnpm typecheck && pnpm build && pnpm test:e2e && git diff --check
```

Expected: 14 renderer/unit test files pass, 5 Electron E2E tests pass, typecheck and production build exit `0`, and `git diff --check` produces no output.

