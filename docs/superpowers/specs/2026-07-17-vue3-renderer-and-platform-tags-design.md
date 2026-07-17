# Vue 3 Renderer and Platform Tags Design

## Background

XC Skills Desktop currently uses Electron, React, TypeScript, Zustand, and custom CSS. Its Electron main process already models Codex, Claude Code, Trae, Antigravity, and custom agents as platforms with separate global and project roots. The current renderer browses the central catalog, global installations, and configured projects.

When the same asset is installed for more than one platform, the scan returns one row per platform. Because the current rows do not show `agentId`, identical names and descriptions appear as unexplained duplicates.

## Goals

- Replace the React renderer with Vue 3 and TypeScript.
- Use Pinia for renderer state.
- Use Element Plus for controls, dialogs, forms, tags, and feedback components.
- Preserve the current custom visual language, three-pane layout, themes, and navigation structure.
- Keep duplicate installed-resource rows and label each row with its installation platform.
- Preserve the Electron main process, preload API, IPC contracts, persistence format, scanning behavior, and operation safety rules.
- Keep the application runnable and testable throughout the migration, then switch to Vue in one atomic cutover.

## Non-goals

- Do not reorganize navigation into a platform-first tree, installation matrix, or aggregated inventory.
- Do not merge duplicate assets into one row.
- Do not rewrite the Electron main process or the `xc-skills/core` package.
- Do not change central repository semantics, branch handling, installation paths, or update detection.
- Do not adopt the default visual appearance of an Element Plus admin template.
- Do not ship React and Vue together in the production renderer.

## Product Decisions

### Navigation and resource identity

The sidebar remains:

1. Central repository
2. Global installations
3. Configured projects
4. Add project
5. Settings

The central pane retains Skills, Rules, and Workflows tabs plus search, group, status, and Agent filters. An installed asset remains a distinct row for each scanned platform root. Installed records receive a platform-qualified desktop asset ID, so selecting a duplicate name resolves the exact platform path instead of whichever duplicate was scanned last.

### Platform tags

Platform tags appear only for global and project sources. Central catalog assets have no installation platform and therefore show no platform tag.

Each installed row places a compact Element Plus tag before the resource name on the title line. Built-in IDs use their configured display names:

| `agentId` | Display label |
| --- | --- |
| `codex` | Codex |
| `claude-code` | Claude Code |
| `trae` | Trae |
| `antigravity` | Antigravity |

Custom agents use the `name` from `AgentDefinition`. If an asset contains an unknown `agentId`, the renderer displays the identifier rather than hiding the platform.

The tag explains duplicate rows but does not replace the Agent filter. Users can still narrow a global or project view to one platform.

## Technical Approach

### Migration strategy

The Vue renderer is built alongside the existing React renderer in source control. Components, stores, and renderer tests are ported feature by feature while the existing application remains usable. Once Vue behavior reaches parity, the renderer entry and Vite plugin switch to Vue, React files and dependencies are removed, and the production bundle contains only Vue.

This avoids a long-lived hybrid runtime and avoids an in-place rewrite that leaves the desktop application unusable during migration.

### Preserved layers

The following layers remain unchanged except for type imports or test selectors required by the renderer cutover:

- `src/main/**`
- `src/preload/index.ts`
- `src/shared/ipc.ts`
- `window.xcSkills` API shape
- desktop state schema and stored state version
- `xc-skills/core` integration

### Vue renderer stack

- Vue 3 Composition API and `<script setup lang="ts">`
- Pinia stores
- Element Plus components and icons
- electron-vite with the Vue Vite plugin
- Existing CSS tokens and custom layout styles
- Vitest, Testing Library Vue, and Vue Test Utils
- Playwright Electron end-to-end tests

## Renderer Architecture

### Application shell

`App.vue` owns only composition of the three panes and global overlays:

- `SourceSidebar.vue`
- `ResourceExplorer.vue`
- `AssetDetail.vue`
- `OperationDialog.vue`
- `SettingsDialog.vue`

The shell does not implement scanning, filtering, or operation planning directly.

### Explorer store

The explorer Pinia store owns:

- sources and projects
- agents/platforms
- selected source and branch
- scanned assets
- selected asset
- asset type
- search, group, status, and Agent filters
- loading, stale-cache, and error state

It exposes the same actions as the current Zustand store: initialize, select source, select branch, set default branch, add project, remove project, and update filters. Request sequencing continues to prevent stale scans from replacing newer results.

Derived getters provide visible assets, available groups, the selected asset, and the platform label for each asset. Platform labels are resolved from the loaded agents list rather than hard-coded into list components.

### Installed asset identity

The core scanner can return the same asset ID from multiple platform roots. The current desktop catalog keys records only by source and asset ID, so a later duplicate can overwrite an earlier duplicate's detail mapping.

For global and project scans, `CoreService.scanRoot` namespaces the desktop-facing ID with the platform ID while preserving the scanned path, entry path, type, group, name, and metadata. A logical asset such as `skills:backend:call-api` therefore becomes distinct desktop records such as `codex:skills:backend:call-api` and `claude-code:skills:backend:call-api`. The existing safe ID schema already permits colons.

The qualified ID is used consistently by the list key, selection, detail lookup, status lookup, and operation request. Central catalog IDs remain unchanged. This is an internal identity correction; it does not merge rows or change filesystem paths.

### Preferences store

The preferences store owns the persisted light, dark, and system theme selection. It applies a document-level theme attribute and observes `prefers-color-scheme` only when the preference is `system`.

### Operation store

The operation store owns the active operation request, plan, warnings, progress, cancellation, result, and error state. It delegates all filesystem changes to the existing preload API and never performs filesystem work in the renderer.

## Element Plus Usage

Element Plus provides behavior-heavy primitives:

- `ElSelect` for group, status, Agent, theme, project, and install-method choices
- `ElDropdown` for branch switching and branch actions
- `ElDialog` for settings and operations
- `ElForm` and `ElFormItem` for custom Agent and operation forms
- `ElTag` for platform and status labels
- `ElButton`, `ElInput`, `ElProgress`, `ElAlert`, and `ElEmpty` where appropriate
- `ElMessage` or inline alerts for short operation feedback

The application retains custom CSS for the shell, sidebar, tabs, list rows, detail pane, density, typography, colors, and responsive behavior. Element Plus theme variables are mapped to the existing application tokens so controls match the current design rather than introducing a second visual system.

## Data Flow

1. The renderer initializes projects, agents, theme, and last source through `window.xcSkills`.
2. Selecting central, global, or project source calls the existing `assets.scan` IPC method.
3. Global and project scans return assets containing `agentId`.
4. The main service gives each installed record a platform-qualified ID, and the explorer store keeps every record as an independent row.
5. `AssetList.vue` resolves `asset.agentId` through the agent map and renders an `ElTag` for non-central sources.
6. Selecting a row passes its platform-qualified `asset.id` and selected source to detail and status IPC calls.
7. Install, update, uninstall, freeze, and thaw continue through the existing plan/execute/cancel APIs.

No additional IPC channel is required for platform tags.

## Error Handling

- Initialization and scan failures remain visible in the explorer pane and clear stale list results.
- Detail failures remain isolated to the detail pane.
- Unknown platform IDs render as readable fallback tags.
- Operation planning and execution failures remain inside the operation dialog with actionable messages.
- Element Plus overlays must close on outside click and Escape where the action is dismissible.
- Destructive or overwrite-sensitive operations retain explicit confirmation.

## Accessibility and Interaction

- Native and Element Plus controls retain accessible names in Chinese.
- Keyboard users can navigate tabs, filters, dropdowns, list rows, dialogs, and actions.
- Dialog focus is trapped and restored by Element Plus.
- Platform identity is communicated by text, not color alone.
- Status and platform tags use distinct roles and visual treatments.
- Only the resource list scrolls; the title, tabs, search, and filters remain fixed.

## Testing Strategy

### Renderer unit and component tests

React Testing Library tests are replaced with Testing Library Vue and Vue Test Utils tests covering:

- initial central scan and source changes
- Skills, Rules, and Workflows tabs
- search and filters
- Agent filter visibility for installed sources
- platform tags on global and project rows
- no platform tags on central rows
- duplicate names rendered as separate rows with different platform tags and independently selectable IDs
- branch dropdown selection and dismissal
- project add/remove behavior
- theme persistence and system-theme changes
- asset details, settings forms, operation plans, progress, cancellation, and errors

### Main-process tests

Existing main process, IPC contract, app-store, and operation tests remain unchanged unless a renderer-independent test defect is found.

### End-to-end tests

Playwright tests verify that the packaged Vue renderer starts, loads the central repository, adds a project, switches branches without modifying the configured checkout, and shows platform tags for duplicate installed assets. Selectors use exact accessible names to avoid ambiguous matches with removal buttons.

## Acceptance Criteria

- The production renderer has no React, ReactDOM, Zustand, or React Vite plugin dependency.
- Vue 3, Pinia, Element Plus, and the Vue Vite plugin are installed and used.
- The Electron main process and preload API behavior remain compatible.
- Existing navigation and three-pane layout remain recognizable and functionally equivalent.
- Global and project rows display the correct platform tag.
- Central repository rows display no platform tag.
- Same-name assets from different platforms remain separate and are visibly distinguishable.
- Selecting a same-name row loads details and operations for that row's platform path.
- Branch, filter, dialog, settings, theme, and operation interactions retain behavior parity.
- Type checking, renderer tests, main-process tests, production build, and Electron end-to-end smoke tests pass.

## Risks and Mitigations

- **Behavior drift during framework migration:** port tests before removing React and compare the real Electron window at parity checkpoints.
- **Element Plus visual mismatch:** map its CSS variables to existing tokens and keep layout/list styling custom.
- **Ambiguous duplicate selection:** qualify installed IDs by `agentId` and retain each record's exact scanned paths.
- **Bundle contains both frameworks:** remove React dependencies and assert the final dependency graph after cutover.
- **Overlay regressions:** rely on Element Plus dismissal behavior and add explicit component tests for outside click and Escape.
