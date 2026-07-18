# Installation Status Compact Table Design

## Goal

Replace the visually heavy installation cards with a compact table-like list that makes platform, path, installation method, state, and action easy to scan in one line. Preserve all existing installation behavior and data flow.

## Visual Direction

The selected direction is **A — compact table**.

- Keep the existing restrained desktop workbench aesthetic and current light/dark tokens.
- Reduce the installation header and summary to a compact utility bar.
- Render the scope selector as a short segmented control rather than a full-width dominant strip.
- Present each location as one aligned row inside a shared list surface, separated by subtle dividers instead of individual floating cards.
- Use platform initials as small identifiers, not decorative tiles.
- Keep paths visually dominant enough to scan, while allowing ellipsis with the full path available through the existing title tooltip.
- Keep status badges quiet and semantic; installation actions remain the strongest affordance in the row.

## Component and CSS Boundaries

`AssetInstallationStatus.vue` keeps its current props, emitted action contract, computed filters, grouping, status labels, and action selection logic unchanged. The existing semantic markup remains the source of truth.

The implementation is primarily scoped CSS in `app.css`:

- the group becomes a bordered list container;
- `.status-location-copy` and `.status-location-state` use `display: contents` at desktop widths so their children participate in a shared row grid;
- the row grid aligns mark, platform, path, method, badge, and action columns;
- borders and radii move from each row to the group/list shell;
- hover and focus states use existing surface and accent tokens;
- the current semantic status token mapping is preserved.

No IPC, store, status calculation, or operation behavior changes are in scope.

## Responsive Behavior

At narrow drawer widths, each row changes to a two-line grid:

- line one: platform mark, platform name, status, action;
- line two: path and installation method;
- path truncation remains enabled;
- actions remain fully visible and keyboard accessible.

## Error and Empty States

The existing filtered empty state remains unchanged functionally. Its visual treatment will match the compact list surface without adding new copy or actions.

## Verification

- Existing component interaction tests must continue to pass without changing action expectations.
- Add or extend renderer coverage to assert the compact table hooks remain present.
- Build and run the Electron E2E suite.
- Inspect the installation tab in both light and dark themes, including long paths and the global/project filters.

## Out of Scope

- Changing which locations are returned.
- Changing installation/freeze/update behavior.
- Adding bulk selection or bulk installation.
- Adding platform logos or external icon assets.

