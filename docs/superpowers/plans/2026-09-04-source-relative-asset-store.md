# Source-relative Asset Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store every managed Skill, Rule, and Workflow below its repository namespace using the resource's original repository-relative path, while safely upgrading existing version 2 manifests and preserving Agent installations.

**Architecture:** Core owns source-path derivation, validation, entity identity, version 3 manifest persistence, transactional migration, collision detection, and repair. Electron and CLI only submit scanner-produced asset identities or opaque migration tokens; neither layer can inject filesystem paths. The managed store mirrors repository layout, while Agent targets remain platform-specific and name-based.

**Tech Stack:** Node.js 22, TypeScript 5, fs-extra, Zod, Vitest, Vue 3, Element Plus, Electron IPC, Playwright, pnpm

**Spec:** [Source-relative Asset Store Design](../specs/2026-09-04-source-relative-asset-store-design.md)

## Global Constraints

- Work in the existing Core worktree `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core` and Desktop worktree `/Users/xc/Documents/xc_skill_workbench/.worktrees/desktop-implementation`.
- Preserve unrelated Desktop changes already present in `AssetList.vue`, `operation.ts`, `app.css`, and their batch-operation tests. Stage only files named by each task.
- Apply test-driven development for every behavior change: add the focused failing test, run it and observe the expected failure, implement the smallest coherent change, then rerun the focused test.
- Do not trust `sourceRelativePath` from renderer payloads. It must originate from a Core scan or a Core-held migration candidate.
- Never call `realpath` on the final Agent target link when comparing logical installation locations. Canonicalize only its parent.
- Keep copied installations unchanged during layout migration. Rebuild only active soft links; frozen soft links stay absent.
- Reject unsafe or ambiguous paths. Never sanitize or silently rename repository-relative path segments.
- Every task ends with a focused commit in the repository where the change was made.

---

## Task 1: Add scanner-owned repository-relative paths

**Repository:** `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core`

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/scanner.ts`
- Modify: `test/core/scanner.test.ts`
- Modify: `test/core/public-api.test.ts`

- [ ] Add failing scanner tests covering these exact results:

  ```ts
  expect(asset.sourceRelativePath).toBe('backend/skills/auto-type-mapper')
  expect(rootSkill.sourceRelativePath).toBe('.')
  expect(rule.sourceRelativePath).toBe('backend/rules/request-policy.md')
  expect(workflow.sourceRelativePath).toBe('delivery/workflows/release.md')
  ```

  Include configured Skill roots nested more than two levels deep and verify Windows separators from configuration are normalized to `/`.

- [ ] Add failing tests proving that the scanner rejects absolute paths, `..`, empty segments, control characters, and a candidate whose canonical path escapes the repository through a symbolic link.

- [ ] Run the focused tests and confirm they fail because `AssetRecord` has no `sourceRelativePath`:

  ```bash
  pnpm vitest run test/core/scanner.test.ts test/core/public-api.test.ts
  ```

- [ ] Extend `AssetRecord` in `src/core/types.ts`:

  ```ts
  export interface AssetRecord {
    id: string
    name: string
    type: AssetType
    group: string
    sourceRelativePath: string
    path: string
    entryPath: string
    entryState: AssetEntryState
    description: string
    version: string | null
  }
  ```

- [ ] Add an exported `normalizeSourceRelativePath(value: string): string` in `scanner.ts`. It must return `.` only for the root resource and otherwise reject absolute paths, drive prefixes, `.`/`..`/empty segments, control characters, and `\\`. It must preserve valid segment spelling and Unicode.

- [ ] Derive the relative path from the canonical scan root and canonical asset path after containment validation. Populate it for catalog Skills, configured Skill roots, single-Skill repositories, Rules, and Workflows.

- [ ] Change scanner asset identity to hash `type + sourceRelativePath`, rather than `type + group + name`, so same-name resources in distinct source locations remain distinct.

- [ ] Include `sourceRelativePath` in scanner provenance snapshots so a caller cannot mutate it between scan and detail/hash operations.

- [ ] Run the focused tests and Core typecheck/build:

  ```bash
  pnpm vitest run test/core/scanner.test.ts test/core/public-api.test.ts
  pnpm build
  ```

- [ ] Commit only the scanner/type changes:

  ```bash
  git add src/core/types.ts src/core/scanner.ts test/core/scanner.test.ts test/core/public-api.test.ts
  git diff --cached --check
  git commit -m "feat(core): expose repository-relative asset paths"
  ```

## Task 2: Introduce manifest version 3 and mirrored entity planning

**Repository:** `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core`

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/store-layout.ts`
- Modify: `src/core/managed-store.ts`
- Modify: `src/core/index.ts`
- Modify: `test/core/store-layout.test.ts`
- Modify: `test/core/managed-store.test.ts`
- Modify: `test/core/public-api.test.ts`

- [ ] Add failing layout tests for:

  ```ts
  managedEntityRelativePath(namespace, { sourceRelativePath: 'backend/skills/auto-type-mapper' })
  // => 'xcSkill/backend/skills/auto-type-mapper'

  managedEntityRelativePath(namespace, { sourceRelativePath: '.' })
  // => 'xcSkill'
  ```

  Verify `_root`, generated type directories, and generated group directories are absent unless they already occur in `sourceRelativePath`.

- [ ] Add failing managed-store tests proving that two same-name Skills at different source paths receive different 64-character managed IDs and different destinations.

- [ ] Add failing tests for destination collision with another managed entity, an unmanaged entry, and an existing parent that is a symbolic link.

- [ ] Run the focused tests and confirm the old normalized layout causes failures:

  ```bash
  pnpm vitest run test/core/store-layout.test.ts test/core/managed-store.test.ts test/core/public-api.test.ts
  ```

- [ ] Add explicit versioned types in `types.ts`:

  ```ts
  export interface ManagedAssetRecordV2 {
    id: string
    source: ManagedSourceRecord
    asset: Pick<AssetRecord, 'type' | 'group' | 'name' | 'version'>
    sourceBranch: string
    installedCommit: string | null
    contentHash: string
    relativePath: string
  }

  export interface ManagedAssetRecord extends ManagedAssetRecordV2 {
    sourceRelativePath: string | null
  }

  export interface ManagedAssetManifestV2 {
    version: 2
    repositories: ManagedRepositoryNamespace[]
    assets: ManagedAssetRecordV2[]
    installations: ManagedInstallationRecord[]
  }

  export interface ManagedAssetManifest {
    version: 3
    repositories: ManagedRepositoryNamespace[]
    assets: ManagedAssetRecord[]
    installations: ManagedInstallationRecord[]
  }
  ```

- [ ] Update `ManagedManifestSnapshot.storedVersion` to `1 | 2 | 3`, set the empty manifest to version 3, and keep schemas for reading versions 1 and 2 without writing new records in either version.

- [ ] Replace `managedEntityRelativePath` with a validator-backed join of `namespace.directoryName` and `sourceRelativePath`. For `.`, return only the namespace directory.

- [ ] Change managed identity to hash `[source.kind, source.id, asset.type, asset.sourceRelativePath]`.

- [ ] Before staging, verify that the destination remains in the namespace and that every existing parent below the store root is a real directory rather than a symbolic link. Reject an occupied destination unless it belongs to the same entity being updated.

- [ ] Update `updateEntityUnlocked` to persist `sourceRelativePath`, retain the same entity/path for content or branch updates at an unchanged source path, and block writes while a version 1 or 2 manifest still requires migration.

- [ ] Export all new public types and helpers from `src/core/index.ts`.

- [ ] Run focused tests and the Core build:

  ```bash
  pnpm vitest run test/core/store-layout.test.ts test/core/managed-store.test.ts test/core/public-api.test.ts
  pnpm build
  ```

- [ ] Commit the version 3 model and path planner:

  ```bash
  git add src/core/types.ts src/core/store-layout.ts src/core/managed-store.ts src/core/index.ts test/core/store-layout.test.ts test/core/managed-store.test.ts test/core/public-api.test.ts
  git diff --cached --check
  git commit -m "feat(core): mirror repository paths in managed store"
  ```

## Task 3: Block Agent target collisions instead of replacing sources

**Repository:** `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core`

**Files:**

- Modify: `src/core/managed-store.ts`
- Modify: `test/core/managed-store.test.ts`
- Modify: `test/cli/managed-install.test.ts`

- [ ] Add a failing managed-store test that installs two same-name assets from different repositories or source paths to the same logical Agent target. Assert that the second install throws `CoreError('ENTRY_CONFLICT')`, leaves the first target and manifest record unchanged, and exposes both sources in error details.

- [ ] Add a failing test for an unmanaged filesystem entry at the target and a regression test proving reinstall/update of the same managed entity remains allowed.

- [ ] Add a CLI regression test proving a collision exits non-zero and prints the requested repository/path and the existing repository/path.

- [ ] Run the tests and confirm `installUnlocked` currently replaces the existing installation:

  ```bash
  pnpm vitest run test/core/managed-store.test.ts test/cli/managed-install.test.ts
  ```

- [ ] Add a typed collision detail payload containing `targetPath`, `existing` and `requested`, with repository identity, display name, resource type, and `sourceRelativePath`.

- [ ] In `installUnlocked`, compare the logical target to the manifest before calling `replacePath`. Permit reuse only when the existing installation references the same managed entity or the caller explicitly references that same installation ID. Reject all other managed and unmanaged occupancy.

- [ ] Preserve the existing rule that the final target link is not resolved during target comparison.

- [ ] Run focused tests and build:

  ```bash
  pnpm vitest run test/core/managed-store.test.ts test/cli/managed-install.test.ts
  pnpm build
  ```

- [ ] Commit:

  ```bash
  git add src/core/managed-store.ts test/core/managed-store.test.ts test/cli/managed-install.test.ts
  git diff --cached --check
  git commit -m "fix(core): block managed target source collisions"
  ```

## Task 4: Add transactional version 2 to version 3 migration

**Repository:** `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core`

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/managed-store.ts`
- Modify: `src/core/index.ts`
- Modify: `test/core/managed-store.test.ts`

- [ ] Define migration contracts and export them:

  ```ts
  export interface SourceLayoutCandidate {
    source: ManagedSourceRecord
    asset: AssetRecord
  }

  export interface SourceLayoutMigrationMove extends AssetStoreLayoutMove {
    sourceRelativePath: string
  }

  export interface SourceLayoutMigrationUnresolved {
    entityId: string
    fromRelativePath: string
    reason: 'source-unavailable' | 'not-found' | 'ambiguous'
    candidateAssetIds: string[]
  }

  export interface SourceLayoutMigrationPreview {
    id: string
    fromVersion: 2
    toVersion: 3
    moves: SourceLayoutMigrationMove[]
    unresolved: SourceLayoutMigrationUnresolved[]
    namespaces: ManagedRepositoryNamespace[]
    symlinkTargets: string[]
    copyTargets: string[]
    conflicts: Array<{ path: string; reason: string }>
  }
  ```

- [ ] Add failing tests for unique source resolution by source identity/type/group/name, missing source preservation, multiple-match ambiguity, mirrored destination collisions, active-link rebuild, frozen-link absence, and copy-target preservation.

- [ ] Add a failing rollback test that injects an error after the store swap and asserts the version 2 manifest, old entity tree, and old active links are fully restored.

- [ ] Add a failing recovery test for every journal phase: `staging`, `swapped`, `relinking`, and `manifest-written`.

- [ ] Run the migration tests and confirm version 2 currently has no upgrade path:

  ```bash
  pnpm vitest run test/core/managed-store.test.ts -t "source layout migration|version 3|layout recovery"
  ```

- [ ] Change `layoutStatus()` to return `{ version: 1 | 2 | 3; migrationRequired: boolean }`. Keep version 1 to version 2 support, but require a second source-aware migration before writes when stored version is 2.

- [ ] Implement:

  ```ts
  previewSourceLayoutMigration(candidates: SourceLayoutCandidate[]): Promise<SourceLayoutMigrationPreview>
  migrateSourceLayout(preview: SourceLayoutMigrationPreview, candidates: SourceLayoutCandidate[]): Promise<void>
  ```

  Preview matching must use source kind/id, type, group, and name. Execution must recompute candidates and reject a stale preview.

- [ ] Build a sibling staging store. Copy and hash-verify resolved entities at mirrored destinations, preserve unresolved entities at their current relative paths with `sourceRelativePath: null`, then atomically swap the store.

- [ ] Rebuild active soft links against version 3 locations, leave frozen links absent, leave copy targets untouched, atomically write the version 3 manifest, and remove backups only after verification.

- [ ] Extend the layout migration journal schema with source-layout phases and enough information to restore store, manifest, and links after interruption. Run recovery before any managed write.

- [ ] Keep version 1 migration behavior intact by migrating 1 to 2 first and then requiring the source-aware 2 to 3 preview.

- [ ] Run the complete managed-store suite and Core build:

  ```bash
  pnpm vitest run test/core/managed-store.test.ts test/core/store-layout.test.ts
  pnpm build
  ```

- [ ] Commit:

  ```bash
  git add src/core/types.ts src/core/managed-store.ts src/core/index.ts test/core/managed-store.test.ts
  git diff --cached --check
  git commit -m "feat(core): migrate managed store to source-relative layout"
  ```

## Task 5: Support explicit repair of unresolved legacy entities

**Repository:** `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core`

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/managed-store.ts`
- Modify: `src/core/index.ts`
- Modify: `test/core/managed-store.test.ts`

- [ ] Add failing tests proving an unresolved entity with `sourceRelativePath: null` can still be frozen, thawed, and uninstalled, but cannot be updated.

- [ ] Add failing repair tests for a valid candidate, a candidate from the wrong source/type/name, an occupied destination, an active soft link, a frozen soft link, and a copied installation.

- [ ] Run focused tests:

  ```bash
  pnpm vitest run test/core/managed-store.test.ts -t "unresolved|repair"
  ```

- [ ] Add a Core repair API that accepts an entity ID and a scanner-produced `SourceLayoutCandidate`, validates source identity/type/group/name, stages the entity at its mirrored path, updates the entity ID if required by the new identity formula, rewrites installation references, and rebuilds active soft links transactionally.

- [ ] Return a result containing the repaired entity, old/new relative paths, and rebuilt soft-link targets. Do not accept a raw repository-relative path string as repair input.

- [ ] Ensure a failure restores the unresolved entity, installation references, manifest, and links.

- [ ] Run focused tests and build:

  ```bash
  pnpm vitest run test/core/managed-store.test.ts
  pnpm build
  ```

- [ ] Commit:

  ```bash
  git add src/core/types.ts src/core/managed-store.ts src/core/index.ts test/core/managed-store.test.ts
  git diff --cached --check
  git commit -m "feat(core): repair unresolved managed asset sources"
  ```

## Task 6: Integrate source-layout migration into the CLI

**Repository:** `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core`

**Files:**

- Modify: `src/commands/config.ts`
- Modify: `src/commands/add.ts`
- Modify: `src/install.ts`
- Modify: `test/cli/compatibility.test.ts`
- Modify: `test/cli/managed-install.test.ts`

- [ ] Add CLI tests for a version 2 store with a unique match, missing source, ambiguous source, user cancellation, and successful migration followed by install.

- [ ] Add tests proving CLI output includes old/new repository-relative paths, unresolved reasons, active link count, and unchanged copy count.

- [ ] Run the focused tests and confirm config only handles version 1 layout migration:

  ```bash
  pnpm vitest run test/cli/compatibility.test.ts test/cli/managed-install.test.ts
  ```

- [ ] Create a shared CLI candidate loader that scans the resolved central repository and configured third-party repositories, then supplies only Core `AssetRecord` objects to `previewSourceLayoutMigration`.

- [ ] In `xc-skills config`, perform version 1 to 2 migration first when needed, then preview and confirm version 2 to 3 migration. Cancellation must leave the store unchanged and keep browsing/read commands available.

- [ ] In install/update entry points, detect a pending version 2 migration and print an actionable instruction to run `xc-skills config`; do not modify the store.

- [ ] Add an interactive repair path for unresolved entities that lists candidates by repository name and `sourceRelativePath`, then passes the selected scanned candidate to Core.

- [ ] Run CLI tests and full Core verification:

  ```bash
  pnpm test
  pnpm build
  ```

- [ ] Commit:

  ```bash
  git add src/commands/config.ts src/commands/add.ts src/install.ts test/cli/compatibility.test.ts test/cli/managed-install.test.ts
  git diff --cached --check
  git commit -m "feat(cli): migrate and repair source-relative assets"
  ```

## Task 7: Pin the new Core revision in Electron

**Repositories:** Core first, then Desktop

**Files:**

- Modify in Desktop: `package.json`
- Modify in Desktop: `pnpm-lock.yaml`

- [ ] In Core, verify the branch is clean and push or otherwise obtain the exact commit SHA containing Tasks 1 through 6:

  ```bash
  git status --short
  git rev-parse HEAD
  ```

- [ ] In Desktop, replace the `xc-skills` dependency fragment in `package.json` with that exact SHA and regenerate only the dependency resolution:

  ```bash
  pnpm install --lockfile-only
  pnpm install --offline=false
  ```

- [ ] Confirm Desktop resolves the expected Core commit and new exports:

  ```bash
  node -e "import('xc-skills/core').then(m => console.log(Boolean(m.ManagedAssetStore), Boolean(m.scanAssets)))"
  pnpm typecheck
  ```

- [ ] Commit only dependency files:

  ```bash
  git add package.json pnpm-lock.yaml
  git diff --cached --check
  git commit -m "build: pin source-relative xc-skills core"
  ```

## Task 8: Expose migration and repair through strict Electron IPC

**Repository:** `/Users/xc/Documents/xc_skill_workbench/.worktrees/desktop-implementation`

**Files:**

- Modify: `src/shared/ipc.ts`
- Modify: `src/main/services/core-service.ts`
- Modify: `src/main/ipc/register-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `test/main/core-service.test.ts`
- Modify: `test/main/ipc-contract.test.ts`
- Modify: `test/preload-api.test.ts`

- [ ] Add `sourceRelativePath` to `AssetRecordSchema` and add strict Zod schemas for public source-layout previews and repair inputs. Public execution inputs must contain only opaque tokens/IDs:

  ```ts
  repositories.previewSourceLayoutMigration(): Promise<SourceLayoutMigrationPreview>
  repositories.executeSourceLayoutMigration(token: string): Promise<SourceLayoutMigrationPreview>
  repositories.previewManagedEntityRepair(installationId: string): Promise<ManagedEntityRepairPreview>
  repositories.executeManagedEntityRepair(candidateToken: string): Promise<void>
  ```

- [ ] Add failing IPC tests proving forged `fromRelativePath`, `toRelativePath`, `sourceRelativePath`, filesystem paths, repository roots, and candidate objects are rejected.

- [ ] Add CoreService tests for candidate collection from central and every registered third-party repository, unavailable repository handling, preview expiry, stale execution, successful execution, and unresolved repair.

- [ ] Run focused tests:

  ```bash
  pnpm vitest run test/main/core-service.test.ts test/main/ipc-contract.test.ts test/preload-api.test.ts
  ```

- [ ] Add CoreService pending maps that retain the private Core migration preview and each scanner-produced repair candidate behind independent random tokens with the existing ten-minute expiry. `ManagedEntityRepairPreview` exposes repository labels and source-relative paths for display, but only an opaque `candidateToken` for execution.

- [ ] Gather central candidates through `resolveRepositorySource` and third-party candidates through `ThirdPartyRepositoryService.resolve`. Treat an unavailable source as an unresolved migration input rather than failing the entire preview.

- [ ] Return only display-safe old/new paths, unresolved reasons, repository labels, source-relative paths, link/copy counts, conflicts, and expiry to the renderer.

- [ ] Add channels, service registrations, and preload methods for both repair phases. Parse every input and output with strict schemas; execution rejects an installation ID, entity ID, asset ID, candidate object, or filesystem path in place of the opaque candidate token.

- [ ] Update `resolveManagedEntitySource` to match version 3 records by source identity/type/`sourceRelativePath`; use group/name only for unresolved legacy records.

- [ ] Run focused tests and typecheck:

  ```bash
  pnpm vitest run test/main/core-service.test.ts test/main/ipc-contract.test.ts test/preload-api.test.ts
  pnpm typecheck
  ```

- [ ] Commit only IPC/service files and tests:

  ```bash
  git add src/shared/ipc.ts src/main/services/core-service.ts src/main/ipc/register-ipc.ts src/preload/index.ts test/main/core-service.test.ts test/main/ipc-contract.test.ts test/preload-api.test.ts
  git diff --cached --check
  git commit -m "feat(electron): expose source-layout migration safely"
  ```

## Task 9: Add settings migration preview and unresolved repair UI

**Repository:** `/Users/xc/Documents/xc_skill_workbench/.worktrees/desktop-implementation`

**Files:**

- Modify: `src/renderer/src/features/settings/RepositoryConfigForm.vue`
- Modify: `src/renderer/src/features/repositories/RelinkSourceDialog.vue`
- Modify: `src/renderer/src/styles/app.css`
- Modify: `test/renderer/settings-vue.test.ts`
- Modify: `test/renderer/relink-source-dialog-vue.test.ts`

- [ ] First reconcile `app.css` with the existing unrelated batch-operation changes. Stage only the exact migration/repair style hunks from this task.

- [ ] Add failing settings tests for resolved moves, unresolved rows, conflicts, active-link count, copy count, cancellation, successful execution, and expired preview refresh.

- [ ] Add failing repair-dialog tests verifying candidates are disambiguated as `仓库名称 · sourceRelativePath`, the renderer sends only the candidate token, and update remains unavailable until repair completes.

- [ ] Run focused renderer tests:

  ```bash
  pnpm vitest run test/renderer/settings-vue.test.ts test/renderer/relink-source-dialog-vue.test.ts
  ```

- [ ] In `RepositoryConfigForm.vue`, load the source-layout preview on mount after legacy-installation preview. Show a compact migration card with counts first and an expandable list of moves/unresolved items. Require an Element Plus confirmation before execution.

- [ ] Disable managed install/update actions while version 2 migration is pending, but leave scanning, browsing, details, freeze, thaw, and uninstall available.

- [ ] Extend `RelinkSourceDialog.vue` to support unresolved managed entities. Display repository-relative paths for all candidates and submit the CoreService-issued repair token. Keep existing legacy third-party relink behavior for old Desktop installation records.

- [ ] Present collision errors with the target path and both `repository · sourceRelativePath` values. Do not show raw stack traces in alerts.

- [ ] Add focused styles consistent with the existing Element Plus settings cards and drawers, without changing typography or unrelated batch table rules.

- [ ] Run focused tests, typecheck, and build:

  ```bash
  pnpm vitest run test/renderer/settings-vue.test.ts test/renderer/relink-source-dialog-vue.test.ts
  pnpm typecheck
  pnpm build
  ```

- [ ] Stage by hunk where necessary and commit:

  ```bash
  git add src/renderer/src/features/settings/RepositoryConfigForm.vue src/renderer/src/features/repositories/RelinkSourceDialog.vue test/renderer/settings-vue.test.ts test/renderer/relink-source-dialog-vue.test.ts
  git add -p src/renderer/src/styles/app.css
  git diff --cached --check
  git commit -m "feat(renderer): guide source-layout migration and repair"
  ```

## Task 10: Verify namespace rename and cross-feature compatibility

**Repositories:** Core and Desktop

**Files:**

- Modify in Core if tests expose gaps: `src/core/managed-store.ts`
- Modify in Core: `test/core/managed-store.test.ts`
- Modify in Desktop if tests expose gaps: `src/main/services/core-service.ts`
- Modify in Desktop: `test/main/core-service.test.ts`
- Modify in Desktop: `test/e2e/app.spec.ts`

- [ ] Add a Core test proving repository namespace rename changes only the namespace prefix and preserves the repository-relative suffix byte-for-byte after `/` normalization.

- [ ] Add Desktop regression tests for central install, third-party install, update, freeze, thaw, uninstall, batch preflight, and status display against a version 3 manifest.

- [ ] Add an E2E scenario that opens settings, confirms a prepared version 2 migration, installs a nested-path Skill by soft link, freezes it, thaws it, and verifies the target link resolves to `<assetStorePath>/<namespace>/<sourceRelativePath>`.

- [ ] Run focused tests first:

  ```bash
  cd /Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core
  pnpm vitest run test/core/managed-store.test.ts -t "namespace|source-relative"

  cd /Users/xc/Documents/xc_skill_workbench/.worktrees/desktop-implementation
  pnpm vitest run test/main/core-service.test.ts test/e2e/app.spec.ts
  ```

- [ ] Make only the compatibility fixes demonstrated by those failures, then rerun the focused tests.

- [ ] Commit Core compatibility changes if any:

  ```bash
  cd /Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core
  git add src/core/managed-store.ts test/core/managed-store.test.ts
  git diff --cached --check
  git commit -m "test(core): cover source-relative namespace lifecycle"
  ```

- [ ] Commit Desktop compatibility/E2E changes:

  ```bash
  cd /Users/xc/Documents/xc_skill_workbench/.worktrees/desktop-implementation
  git add src/main/services/core-service.ts test/main/core-service.test.ts test/e2e/app.spec.ts
  git diff --cached --check
  git commit -m "test(electron): cover source-relative asset lifecycle"
  ```

## Task 11: Full verification and handoff

**Repositories:** Core and Desktop

- [ ] Confirm no migration fixtures or application code still create manifest version 2 records:

  ```bash
  cd /Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core
  rg -n "version:\s*2|version.: 2" src test
  ```

  Version 2 occurrences must be limited to legacy schemas, migration fixtures, journals with independently versioned formats, and assertions that intentionally exercise upgrade behavior.

- [ ] Confirm no managed path construction still injects type/group/`_root`:

  ```bash
  rg -n "_root|managedEntityRelativePath|normalizeStoreSegment" src/core test/core
  ```

- [ ] Run complete Core verification:

  ```bash
  pnpm test
  pnpm build
  git status --short
  ```

- [ ] Run complete Desktop verification without discarding the user's unrelated dirty changes:

  ```bash
  cd /Users/xc/Documents/xc_skill_workbench/.worktrees/desktop-implementation
  pnpm test
  pnpm typecheck
  pnpm build
  pnpm test:e2e
  git status --short
  ```

- [ ] Manually verify with a temporary store, never the user's live `/Users/xc/Desktop/agent-skill` directory:

  1. install central `backend/skills/auto-type-mapper` by soft link;
  2. verify the entity is `<temp-store>/xcSkill/backend/skills/auto-type-mapper`;
  3. verify the Agent target remains `<project>/.codex/skills/auto-type-mapper`;
  4. freeze and confirm the Agent link disappears while the entity remains;
  5. thaw and confirm the link returns;
  6. install a third-party nested Skill and verify its repository namespace;
  7. attempt a same-name install to the same Agent target and confirm it is blocked with both source paths.

- [ ] Review both repositories' final diffs and commit history, ensuring no unrelated Desktop batch-operation changes entered the feature commits.

- [ ] Report the Core commit SHA, Desktop commit SHA, verification commands/results, any intentionally unresolved version 2 entities, and the exact temporary paths used for manual verification.
