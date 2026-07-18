# Asset Detail Drawer Polish Design

## Goal

Refine the asset detail drawer into a compact professional workbench and move installation management out of the document flow into its own `安装状态` tab.

The drawer must remain consistent with the current Vue 3, Element Plus, light/dark theme, and source-selection behavior. This change improves visual hierarchy and information scanning without changing installation semantics or introducing a new route or window.

## Confirmed Direction

The approved direction combines:

- the compact professional workbench visual style;
- a short structured asset header;
- a persistent five-tab navigation row;
- independent scrolling for each selected tab;
- an installation management view separated from preview, source, files, and evolution history.

The five tabs are:

1. `预览`
2. `源码`
3. `文件`
4. `演进历史` for Skills only
5. `安装状态`

For Rules and Workflows, `演进历史` remains omitted, while `安装状态` remains available.

## Alternatives Considered

### Compact professional workbench — selected

Uses a dense asset header, segmented tab navigation, framed content surfaces, and compact installation rows. It matches the current desktop application and makes both reading and management efficient.

### Immersive reader

Prioritizes document typography and whitespace and reduces installation data to a summary. It improves long-form reading but hides frequently used management actions behind an extra expansion step.

### IDE inspector

Uses a dark code-oriented surface and a vertical navigation rail. It gives source and file browsing a stronger identity but conflicts with the existing light desktop shell and consumes useful horizontal space.

## Drawer Structure

### Header

The drawer header is reduced to a compact title lockup:

- a small asset-type monogram (`SK`, `RU`, or `WF`);
- asset name as the primary line;
- group, human-readable type, and version on a single muted metadata line;
- the existing Element Plus close control aligned to the right.

The header uses the raised surface token and a single bottom divider. It must not contain oversized vertical padding or duplicate the title inside `AssetDetail`.

### Tab navigation

The tab row sits immediately below the header and remains visible while the selected panel scrolls. The active tab uses a soft accent fill instead of the current long underline. Tabs use compact rounded rectangles with clear hover and focus states.

`安装状态` uses a neutral count badge containing the number of installation locations after status data loads. It does not use a warning dot because an uninstalled platform is often normal and should not imply an error.

### Content panels

Only the selected tab panel scrolls. Switching tabs preserves the drawer, asset selection, source selection, and list scroll position. The selected detail tab may reset when a different asset is selected, matching current behavior.

Preview content uses a readable maximum line length, stronger heading spacing, and a plain raised reading surface. Source content uses a framed editor-like surface with the entry filename in a small header strip. No clipboard action is added in this scope. File and evolution panels reuse their existing data and empty states.

## Installation Status View

Installation statuses are removed from below the document tabs and rendered only inside the `安装状态` tab.

### Scope filters

The installation tab contains a three-way segmented filter:

- `全部`
- `全局`
- `项目`

The default is `全部`. Filtering is presentation-only and does not reload status data.

### Grouping and naming

Rows are grouped in this order:

1. `Global · 全局`
2. project groups sorted by project display name

Project identifiers must be resolved to names using the explorer project records. If a matching project record is unavailable, the project identifier is used as a safe fallback.

Within each group, rows remain sorted by agent and path. Each row displays:

- platform monogram and platform display name;
- scope name;
- install path in a truncated monospace line with the full path retained in the DOM title;
- current status badge;
- install method when available;
- the existing context-appropriate action buttons.

Status colors use existing semantic tokens:

- current: success;
- update available: accent/info;
- locally modified or frozen: warning;
- conflict, invalid, or broken link: danger;
- not installed and unknown: neutral.

Actions keep the current `install`, `update`, `update-with-warning`, `uninstall`, `freeze`, `thaw`, and `diagnose` event behavior. The visual change must not alter operation payloads.

## Component Boundaries

### `App.vue`

Continues to own drawer visibility and the accessible drawer title. It supplies the selected asset, source, and project records to `AssetDetail`.

### `AssetDetail.vue`

Continues to own detail/status loading, error state, and selected tab state. It renders preview, source, files, and evolution panels and delegates installation presentation to a focused child component.

### `AssetInstallationStatus.vue`

A new presentational component receives:

- the selected asset;
- loaded status records;
- project records.

It owns only the local scope filter and derived grouping. It emits the existing action kind and status location without modifying either value. It performs no IPC calls.

This boundary keeps status layout and filtering independent from markdown, source, and file rendering while retaining one loading lifecycle in `AssetDetail`.

## Data Flow

1. Selecting an asset opens the drawer as it does today.
2. `AssetDetail` loads detail content and installation statuses concurrently through the existing IPC methods.
3. Detail content is routed to the reading/source/file/evolution tabs.
4. Status records and project records are passed to `AssetInstallationStatus`.
5. The installation component filters and groups data locally.
6. An installation action is emitted through `AssetDetail` to `App.vue`, which opens the existing operation workflow.
7. Closing the drawer preserves the selected row. Changing source clears the selected asset and closes the drawer as it does today.

## Loading, Empty, and Error States

- While both requests are pending, the existing detail loading state remains visible.
- A detail/status load failure continues to use the current actionable error surface; this design does not split the IPC error contract.
- If no installation locations exist, the installation tab shows a compact empty state explaining that no configured platform locations were found.
- If a scope filter has no matches, the empty state names the active scope and offers a one-click reset to `全部`.
- Oversized or binary detail files retain the existing metadata-only behavior.

## Responsive Behavior

- Desktop drawer size remains `min(760px, 64vw)`.
- Below `900px`, the drawer remains nearly full viewport width.
- The header metadata truncates rather than wrapping into a tall header.
- At narrow drawer widths, installation rows move status and actions below the platform/path column while preserving readable tap targets.
- Horizontal tab overflow is allowed, but the installation tab must remain reachable by keyboard and pointer scrolling.

## Accessibility

- The Element Plus drawer keeps its accessible title and close button.
- The five views remain true tabs with correct selected state and keyboard behavior.
- Scope filters are an explicitly labelled single-select control.
- Status meaning is always present in text and never depends only on color.
- Action buttons retain asset-specific accessible labels.
- Focus rings use existing design tokens and remain visible in light and dark themes.

## Visual Tokens

The implementation reuses existing tokens from `tokens.css`:

- surfaces: `--surface`, `--surface-muted`, `--surface-raised`, `--code-surface`;
- borders: `--border`, `--border-strong`, `--divider`;
- text: `--text-primary`, `--text-secondary`, `--text-tertiary`;
- actions and states: `--accent`, `--accent-soft`, success/warning/danger tokens;
- shadows: `--shadow-sm` and `--shadow-md`.

No hard-coded light-only palette is introduced. Both themes must preserve contrast and hierarchy.

## Verification

Automated coverage must verify:

- installation statuses appear only in the `安装状态` tab;
- Skills expose five tabs, while Rules and Workflows omit evolution history but keep installation status;
- global/project filtering changes visible rows without new IPC calls;
- project identifiers render as project names when records are available;
- existing action kinds and location payloads are emitted unchanged;
- drawer close/reopen and source-change behavior remains intact;
- Electron E2E can open the installation tab, see grouped status rows, and return to preview.

Real Electron visual QA must cover:

- compact header and tab spacing;
- preview/source scrolling independent from the tab row;
- installation grouping, long-path truncation, and responsive wrapping;
- both light and dark themes.

## Non-goals

- No route, separate BrowserWindow, or standalone detail page.
- No change to installation operations or IPC contracts.
- No lazy status-fetching or caching redesign.
- No new clipboard, export, bulk install, or bulk update actions.
- No persistent drawer size or remembered detail tab.
