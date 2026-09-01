# Repository-scoped Asset Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hash-named managed entity directories with readable repository/type/group/resource paths while transactionally migrating existing stores and rebuilding managed symlinks.

**Architecture:** Core owns namespace allocation, manifest v2, path planning, migration, rollback, and recovery. Electron and CLI receive only Core-generated previews and opaque tokens; neither frontend calculates filesystem paths. Existing installation IDs remain stable, active symlinks are rebuilt, frozen symlinks remain absent, and copy installations remain untouched.

**Tech Stack:** TypeScript 5.9, Node.js filesystem APIs, fs-extra, Zod 4, Vitest 4, Electron, Vue 3, Element Plus, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-01-repository-scoped-asset-store-design.md`

## Global Constraints

- The central repository directory is exactly `xcSkill`.
- Third-party repository directories derive from their configured display names.
- Every entity path includes repository, resource type, group, and resource name; empty groups use `_root`.
- Managed entity IDs remain SHA-256 identities and never appear in new filesystem paths.
- Namespace collisions use a stable eight-character source-identity hash suffix.
- Renderer and CLI callers may submit identifiers and opaque tokens, never computed entity destinations.
- Active symlinks are rebuilt transactionally; frozen symlinks stay absent; copy installation targets remain byte-for-byte unchanged during layout migration.
- Unmanaged files are conflicts and are never deleted or silently moved.
- Core changes land and pass verification before Desktop pins the resulting Core commit.
- No dependency additions are required.

---

## File Structure

### Core repository: `xc-skills`

- Create `src/core/store-layout.ts`: safe segment normalization, repository namespace allocation, and readable entity relative-path planning.
- Modify `src/core/types.ts`: manifest v2, namespace records, layout/rename preview DTOs.
- Modify `src/core/errors.ts`: add the explicit `MIGRATION_REQUIRED` error code.
- Modify `src/core/managed-store.ts`: v1 compatibility reads, v2 writes, readable install paths, layout and namespace migrations, rollback, recovery, and pruning.
- Modify `src/core/index.ts`: export the new layout interfaces and helpers.
- Modify `src/commands/config.ts`: prompt for required layout migration even when the configured store directory does not change.
- Create `test/core/store-layout.test.ts`: pure layout contract tests.
- Modify `test/core/managed-store.test.ts`: manifest upgrade, install/update/uninstall, rename, migration, and recovery integration tests.
- Modify `test/cli/managed-install.test.ts`: CLI-visible readable target assertions.
- Modify `test/cli/compatibility.test.ts`: config migration confirmation/cancellation behavior.

### Desktop repository: `xc-skill-workbench`

- Modify `package.json` and `pnpm-lock.yaml`: pin the verified Core commit.
- Modify `src/shared/ipc.ts`: layout and namespace migration DTO schemas and channel contracts.
- Modify `src/main/ipc/register-ipc.ts`: validate identifiers/tokens and parse Core-generated previews.
- Modify `src/preload/index.ts`: expose the new read/execute methods.
- Modify `src/main/services/core-service.ts`: hold expiring preview tokens and coordinate repository rename transactions.
- Modify `src/main/services/third-party-repository-service.ts`: add non-persisting update validation/preparation used by rename transactions.
- Modify `src/renderer/src/features/settings/RepositoryConfigForm.vue`: show layout migration preview and require confirmation.
- Modify `src/renderer/src/features/repositories/ThirdPartyRepositoryDialog.vue`: show namespace rename impact before save.
- Modify `src/renderer/src/components/ErrorNotice.vue`: render safe actionable migration messages while retaining diagnostics in the local log.
- Modify focused Main, preload, renderer, and E2E tests listed in the tasks below.

---

### Task 1: Add Core repository layout primitives

**Files:**
- Create: `src/core/store-layout.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/index.ts`
- Create: `test/core/store-layout.test.ts`

**Interfaces:**
- Produces: `ManagedRepositoryNamespace`, `normalizeStoreSegment(value, fallback)`, `managedSourceKey(source)`, `allocateRepositoryNamespace(source, existing)`, and `managedEntityRelativePath(namespace, asset)`.
- Consumes: existing `ManagedSourceRecord` and `AssetRecord` from `src/core/types.ts`.

- [ ] **Step 1: Write failing pure path-contract tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  allocateRepositoryNamespace,
  managedEntityRelativePath,
  normalizeStoreSegment,
} from '../../src/core/index.js'

describe('repository-scoped store layout', () => {
  it('uses the fixed central namespace and keeps type and group levels', () => {
    const namespace = allocateRepositoryNamespace(
      { kind: 'central', id: 'central:catalog', name: '中央仓库', url: null },
      [],
    )
    expect(namespace.directoryName).toBe('xcSkill')
    expect(managedEntityRelativePath(namespace, {
      type: 'skills', group: 'backend', name: 'call-api', version: null,
    })).toBe('xcSkill/skills/backend/call-api')
  })

  it('uses _root for an empty group and sanitizes third-party names', () => {
    const namespace = allocateRepositoryNamespace(
      { kind: 'third-party', id: 'repo-1', name: ' Team / Skills ', url: 'https://example.com/team.git' },
      [],
    )
    expect(namespace.directoryName).toBe('Team-Skills')
    expect(managedEntityRelativePath(namespace, {
      type: 'skills', group: '', name: 'canvas-design', version: null,
    })).toBe('Team-Skills/skills/_root/canvas-design')
  })

  it('adds a stable suffix when another source owns the same name', () => {
    const first = allocateRepositoryNamespace(
      { kind: 'third-party', id: 'repo-1', name: 'mattpocock', url: null },
      [],
    )
    const second = allocateRepositoryNamespace(
      { kind: 'third-party', id: 'repo-2', name: 'mattpocock', url: null },
      [first],
    )
    expect(second.directoryName).toMatch(/^mattpocock-[a-f0-9]{8}$/u)
    const reserved = allocateRepositoryNamespace(
      { kind: 'third-party', id: 'repo-3', name: 'xcSkill', url: null },
      [],
    )
    expect(reserved.directoryName).toMatch(/^xcSkill-[a-f0-9]{8}$/u)
    expect(normalizeStoreSegment('../', 'repository')).toBe('repository')
  })
})
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `pnpm exec vitest run test/core/store-layout.test.ts`

Expected: FAIL because `store-layout.ts` and its exports do not exist.

- [ ] **Step 3: Define the v2 namespace type and implement the pure planner**

Add to `src/core/types.ts`:

```ts
export interface ManagedRepositoryNamespace {
  sourceKind: ManagedSourceRecord['kind']
  sourceId: string
  displayName: string
  directoryName: string
}
```

Implement in `src/core/store-layout.ts`:

```ts
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { AssetRecord, ManagedRepositoryNamespace, ManagedSourceRecord } from './types.js'

export const managedSourceKey = (source: ManagedSourceRecord): string =>
  `${source.kind}:${source.id}`

export function normalizeStoreSegment(value: string, fallback: string): string {
  const normalized = value.normalize('NFC').trim()
    .replace(/[\\/\u0000-\u001f\u007f:*?"<>|]+/gu, '-')
    .replace(/[\s-]+/gu, '-')
    .replace(/^[-.]+|[-.]+$/gu, '')
  return !normalized || normalized === '.' || normalized === '..' ? fallback : normalized
}

export function allocateRepositoryNamespace(
  source: ManagedSourceRecord,
  existing: ManagedRepositoryNamespace[],
): ManagedRepositoryNamespace {
  const owned = existing.find((entry) =>
    entry.sourceKind === source.kind && entry.sourceId === source.id)
  if (owned) return owned
  const base = source.kind === 'central' ? 'xcSkill' : normalizeStoreSegment(source.name, 'repository')
  const occupied = existing.some((entry) => entry.directoryName === base)
  const suffix = createHash('sha256').update(managedSourceKey(source)).digest('hex').slice(0, 8)
  const needsSuffix = source.kind !== 'central' && (base === 'xcSkill' || occupied)
  return {
    sourceKind: source.kind,
    sourceId: source.id,
    displayName: source.name,
    directoryName: needsSuffix ? `${base}-${suffix}` : base,
  }
}

export function managedEntityRelativePath(
  namespace: ManagedRepositoryNamespace,
  asset: Pick<AssetRecord, 'type' | 'group' | 'name'>,
): string {
  return posix.join(
    namespace.directoryName,
    asset.type,
    normalizeStoreSegment(asset.group, '_root'),
    normalizeStoreSegment(asset.name, 'resource'),
  )
}
```

Export the module from `src/core/index.ts`.

- [ ] **Step 4: Run the pure tests and Core typecheck/build**

Run: `pnpm exec vitest run test/core/store-layout.test.ts && pnpm build`

Expected: the new tests pass and the package builds.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/core/store-layout.ts src/core/types.ts src/core/index.ts test/core/store-layout.test.ts
git commit -m "feat: add repository-scoped store layout"
```

---

### Task 2: Introduce manifest v2 with safe v1 compatibility reads

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/errors.ts`
- Modify: `src/core/managed-store.ts`
- Modify: `test/core/managed-store.test.ts`
- Modify: `test/core/public-api.test.ts`

**Interfaces:**
- Consumes: layout primitives from Task 1.
- Produces: `ManagedAssetManifestV1`, `ManagedAssetManifest` version 2, `ManagedManifestSnapshot`, and `ManagedAssetStore.layoutStatus()`.

- [ ] **Step 1: Write failing manifest compatibility tests**

Add tests that write a literal v1 manifest and assert browsing is available but mutation is blocked:

```ts
it('reads a v1 manifest for status but requires layout migration before writes', async () => {
  const { root, asset, store } = await fixture()
  await fs.writeJson(join(root, '.xc-skills-managed-assets.json'), {
    version: 1,
    assets: [{
      id: 'a'.repeat(64),
      source: { kind: 'central', id: 'central:catalog', name: '中央仓库', url: null },
      asset: { type: 'skills', group: 'common', name: 'demo', version: '1.0.0' },
      sourceBranch: 'main', installedCommit: null, contentHash: 'b'.repeat(64),
      relativePath: `entities/${'a'.repeat(64)}/demo`,
    }],
    installations: [],
  })

  await expect(store.layoutStatus()).resolves.toEqual({ version: 1, migrationRequired: true })
  await expect(store.readManifest()).resolves.toMatchObject({ version: 2, repositories: [{ directoryName: 'xcSkill' }] })
  await expect(store.updateEntity({
    asset,
    source: { kind: 'central', id: 'central:catalog', name: '中央仓库', url: null },
    sourceBranch: 'main', installedCommit: null,
  })).rejects.toMatchObject({ code: 'MIGRATION_REQUIRED' })
})
```

Add a public API type test importing `ManagedRepositoryNamespace` and `ManagedAssetManifestV1` from `xc-skills/core`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm exec vitest run test/core/managed-store.test.ts test/core/public-api.test.ts`

Expected: FAIL because version 2 schemas, compatibility normalization, and `layoutStatus()` are absent.

- [ ] **Step 3: Add explicit v1/v2 schemas and snapshot parsing**

Define in `src/core/types.ts`:

```ts
export interface ManagedAssetManifestV1 {
  version: 1
  assets: ManagedAssetRecord[]
  installations: ManagedInstallationRecord[]
}

export interface ManagedAssetManifest {
  version: 2
  repositories: ManagedRepositoryNamespace[]
  assets: ManagedAssetRecord[]
  installations: ManagedInstallationRecord[]
}

export interface ManagedManifestSnapshot {
  storedVersion: 1 | 2
  manifest: ManagedAssetManifest
}
```

Add `'MIGRATION_REQUIRED'` to `CoreErrorCode` in `src/core/errors.ts` so Desktop and CLI can distinguish a required migration from a generic conflict.

In `managed-store.ts`, parse `z.union([manifestV1Schema, manifestV2Schema])`. Normalize v1 into an in-memory v2 manifest by allocating namespaces while retaining each old `relativePath`. Keep the stored version in a private `readManifestSnapshot()` result. `readManifest()` returns the normalized manifest for read-only consumers.

Add a mutation guard used by install, update, freeze, thaw, and uninstall:

```ts
private requireWritableLayout(snapshot: ManagedManifestSnapshot): void {
  if (snapshot.storedVersion !== 2) {
    throw new CoreError('MIGRATION_REQUIRED', '资源存储目录需要先迁移为按仓库分组的结构')
  }
}
```

Set the empty manifest to `{ version: 2, repositories: [], assets: [], installations: [] }`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run test/core/managed-store.test.ts test/core/public-api.test.ts && pnpm build`

Expected: compatibility reads pass, mutations reject v1, and Core builds.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/core/types.ts src/core/errors.ts src/core/managed-store.ts test/core/managed-store.test.ts test/core/public-api.test.ts
git commit -m "feat: add managed manifest v2"
```

---

### Task 3: Migrate v1 entity layouts transactionally

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/managed-store.ts`
- Modify: `test/core/managed-store.test.ts`

**Interfaces:**
- Produces: `AssetStoreLayoutMove`, `AssetStoreLayoutMigrationPreview`, `previewLayoutMigration()`, `migrateLayout(preview)`, and startup recovery for layout journals.
- Consumes: manifest snapshot and path planner from Tasks 1–2.

- [ ] **Step 1: Write failing preview, migration, and rollback tests**

Use real directories and literal v1 manifests. Cover central and third-party sources, `_root`, active/frozen symlinks, an unchanged copy target, and a simulated destination conflict. Assert the preview shape directly:

```ts
const preview = await store.previewLayoutMigration()
expect(preview).toMatchObject({
  fromVersion: 1,
  toVersion: 2,
  moves: [expect.objectContaining({
    fromRelativePath: expect.stringContaining('entities/'),
    toRelativePath: 'xcSkill/skills/common/demo',
  })],
  conflicts: [],
})

await store.migrateLayout(preview)
expect(await fs.realpath(linkedTarget)).toBe(join(storeRoot, 'xcSkill/skills/common/demo'))
expect(await fs.readFile(copyTargetSkillMd, 'utf8')).toBe(copyBefore)
expect((await store.readManifest()).version).toBe(2)
```

Add an interruption fixture with `.xc-skills-layout-migration.json`; assert `recoverMigration()` restores the committed or original layout and relinks active installations.

- [ ] **Step 2: Run the migration tests and verify RED**

Run: `pnpm exec vitest run test/core/managed-store.test.ts -t "layout migration|interrupted layout"`

Expected: FAIL because layout preview and migration APIs do not exist.

- [ ] **Step 3: Add layout preview DTOs and deterministic planning**

Define:

```ts
export interface AssetStoreLayoutMove {
  entityId: string
  fromRelativePath: string
  toRelativePath: string
}

export interface AssetStoreLayoutMigrationPreview {
  id: string
  fromVersion: 1
  toVersion: 2
  moves: AssetStoreLayoutMove[]
  namespaces: ManagedRepositoryNamespace[]
  symlinkTargets: string[]
  copyTargets: string[]
  conflicts: Array<{ path: string; reason: string }>
}
```

`previewLayoutMigration()` must allocate namespaces in stable source-key order, plan every entity path, reject duplicate destinations, report unmanaged destination content, and never mutate disk.

- [ ] **Step 4: Implement staged migration, rollback, and recovery**

Use a sibling staging root `${storePath}.xc-layout-next-${preview.id}` and backup `${storePath}.xc-layout-backup-${preview.id}`. Copy each old entity into its planned destination, verify recorded hashes, swap roots, rebuild active symlinks, write manifest v2, and then remove the backup and journal.

The journal records:

```ts
{
  version: 2,
  kind: 'layout',
  id: preview.id,
  storePath,
  stagingPath,
  backupPath,
  phase: 'staging' | 'swapped' | 'relinking' | 'manifest-written'
}
```

On any error, reverse completed symlink replacements, restore the old root and v1 manifest, remove staging, and retain user-owned copy targets unchanged. Extend `recoverMigration()` to dispatch by journal `kind` while retaining support for existing version 1 store-location journals.

- [ ] **Step 5: Run all managed-store tests**

Run: `pnpm exec vitest run test/core/managed-store.test.ts`

Expected: all v1/v2, rollback, and recovery tests pass.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/core/types.ts src/core/managed-store.ts test/core/managed-store.test.ts
git commit -m "feat: migrate managed stores to readable layout"
```

---

### Task 4: Use readable paths for all managed operations and repository renames

**Files:**
- Modify: `src/core/managed-store.ts`
- Modify: `src/core/types.ts`
- Modify: `test/core/managed-store.test.ts`
- Modify: `test/cli/managed-install.test.ts`

**Interfaces:**
- Produces: `RepositoryNamespaceMigrationPreview`, `RepositoryNamespaceMigrationResult`, `previewRepositoryNamespaceRename(source, displayName)`, `migrateRepositoryNamespace(preview)`, and `rollbackRepositoryNamespaceMigration(result)`.
- Consumes: manifest v2 and migration transaction helpers from Tasks 1–3.

- [ ] **Step 1: Write failing install/update/pruning tests**

Assert exact real paths for central, third-party, type, group, and `_root` resources:

```ts
expect(first.entity.path).toBe(join(root, 'managed', 'xcSkill', 'skills', 'common', 'demo'))
expect(thirdParty.entity.path).toBe(join(root, 'managed', 'mattpocock', 'skills', '_root', 'canvas-design'))
```

Add same-name fixtures across types, groups, and sources. Update content and branch and assert the entity path stays unchanged. Uninstall the final reference and assert only empty managed ancestors are pruned; place an unmanaged file beside a managed entity and assert it survives.

- [ ] **Step 2: Run focused operation tests and verify RED**

Run: `pnpm exec vitest run test/core/managed-store.test.ts test/cli/managed-install.test.ts -t "readable|same-name|prunes"`

Expected: FAIL because `entityPath()` still uses `entities/<id>/<name>`.

- [ ] **Step 3: Replace hash path generation with manifest namespace planning**

Change entity path resolution to use the manifest record:

```ts
private entityPath(root: string, entity: Pick<ManagedAssetRecord, 'relativePath'>): string {
  return join(root, entity.relativePath)
}
```

During `updateEntityUnlocked`, resolve or allocate the source namespace and call `managedEntityRelativePath`. Preserve an existing entity's `relativePath` for content or branch updates. Add the namespace to `manifest.repositories` before writing the entity.

Replace the current single-parent cleanup with an upward pruning function that stops at the repository namespace and only removes empty directories. When the last entity for a source disappears, remove its `ManagedRepositoryNamespace` record only after confirming the namespace directory contains no unmanaged files.

- [ ] **Step 4: Write failing repository rename tests**

```ts
const preview = await store.previewRepositoryNamespaceRename(source, 'Matt Skills')
expect(preview.moves[0]).toMatchObject({
  fromRelativePath: 'mattpocock/skills/_root/canvas-design',
  toRelativePath: 'Matt-Skills/skills/_root/canvas-design',
})
await store.migrateRepositoryNamespace(preview)
expect(await fs.realpath(linkTarget)).toContain('/Matt-Skills/skills/_root/canvas-design')
```

Also test a colliding display name receives the stable suffix and a simulated relink failure restores the original namespace and symlink.

- [ ] **Step 5: Implement namespace rename preview and transaction**

Define:

```ts
export interface RepositoryNamespaceMigrationPreview {
  id: string
  sourceKind: ManagedSourceRecord['kind']
  sourceId: string
  fromDirectoryName: string
  toDirectoryName: string
  moves: AssetStoreLayoutMove[]
  symlinkTargets: string[]
  conflicts: Array<{ path: string; reason: string }>
}

export interface RepositoryNamespaceMigrationResult {
  applied: RepositoryNamespaceMigrationPreview
  rollback: RepositoryNamespaceMigrationPreview
}
```

The migration moves only the selected source namespace through staging, verifies every moved entity, rebuilds active symlinks, updates repository and asset records atomically, and rolls back on failure. It returns a prevalidated inverse preview. `rollbackRepositoryNamespaceMigration(result)` executes that inverse preview, allowing Desktop to compensate if repository persistence fails after the filesystem migration succeeds.

- [ ] **Step 6: Run managed operation and CLI install tests**

Run: `pnpm exec vitest run test/core/managed-store.test.ts test/cli/managed-install.test.ts && pnpm build`

Expected: all focused tests pass and generated declarations expose the new APIs.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/core/managed-store.ts src/core/types.ts test/core/managed-store.test.ts test/cli/managed-install.test.ts
git commit -m "feat: store managed assets by repository"
```

---

### Task 5: Require layout migration in the CLI

**Files:**
- Modify: `src/commands/config.ts`
- Modify: `test/cli/compatibility.test.ts`
- Modify: `test/cli/managed-install.test.ts`

**Interfaces:**
- Consumes: `layoutStatus()`, `previewLayoutMigration()`, and `migrateLayout()` from Tasks 2–3.
- Produces: CLI confirmation flow for existing v1 layouts even when `assetStorePath` is unchanged.

- [ ] **Step 1: Write failing CLI behavior tests**

Stub prompt responses and use a real temporary manifest. Assert:

```ts
expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
  message: expect.stringContaining('按仓库重新整理'),
}))
expect(await fs.pathExists(join(storeRoot, 'xcSkill', 'skills', 'common', 'demo'))).toBe(true)
```

For cancellation, assert config, manifest, entity paths, and symlink targets remain unchanged.

- [ ] **Step 2: Run CLI tests and verify RED**

Run: `pnpm exec vitest run test/cli/compatibility.test.ts test/cli/managed-install.test.ts`

Expected: FAIL because `configCommand` checks only store-location changes.

- [ ] **Step 3: Add layout migration before store-location migration**

In `configCommand`, after reading the current config:

```ts
const managedStore = new ManagedAssetStore({ configPath: CONFIG_PATH })
const layout = await managedStore.layoutStatus()
if (layout.migrationRequired) {
  const preview = await managedStore.previewLayoutMigration()
  // render moves, conflicts, active links, and unchanged copies
  // require an affirmative prompt before migrateLayout(preview)
}
```

If the user also changes `assetStorePath`, complete layout migration first, re-read the manifest, and then run the existing location migration preview. Any cancellation exits before `saveConfig(newConfig)`.

- [ ] **Step 4: Run CLI tests and Core verification**

Run: `pnpm exec vitest run test/cli/compatibility.test.ts test/cli/managed-install.test.ts && pnpm test && pnpm build`

Expected: the focused tests and full Core suite pass.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/commands/config.ts test/cli/compatibility.test.ts test/cli/managed-install.test.ts
git commit -m "feat: migrate managed layout from cli config"
```

---

### Task 6: Publish the Core commit and pin Desktop

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: verified Core package exports from Tasks 1–5.
- Produces: Desktop dependency resolution to the exact Core commit.

- [ ] **Step 1: Verify Core before publishing**

Run in the Core worktree:

```bash
pnpm test
pnpm build
git status --short
```

Expected: all tests pass, build succeeds, and only intentional committed state remains.

- [ ] **Step 2: Obtain user authorization and push the Core branch**

Report the Core commit hash and request approval to run:

```bash
git push -u origin codex/xc-skills-core
```

Do not proceed with an unpublished Git SHA in Desktop. After authorization, push and verify it exists with:

```bash
CORE_COMMIT=$(git rev-parse HEAD)
git ls-remote origin refs/heads/codex/xc-skills-core | grep "$CORE_COMMIT"
```

Expected: `ls-remote` prints the pushed commit through the branch ref.

- [ ] **Step 3: Pin Desktop to the exact published commit**

Run in the Desktop worktree:

```bash
CORE_COMMIT=$(git -C ../xc-skills-core rev-parse HEAD)
pnpm add "xc-skills@git+https://github.com/lwk-wj/xc-skills.git#$CORE_COMMIT"
```

Confirm `package.json` and `pnpm-lock.yaml` both contain the same 40-character commit.

- [ ] **Step 4: Verify Desktop resolves the new exports**

Run: `pnpm typecheck`

Expected: TypeScript resolves manifest v2 and migration preview exports from `xc-skills/core`.

- [ ] **Step 5: Commit Task 6**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: pin repository-scoped core"
```

---

### Task 7: Expose layout migration through strict Electron IPC

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipc/register-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/services/core-service.ts`
- Modify: `test/main/core-service.test.ts`
- Modify: `test/main/ipc-contract.test.ts`
- Modify: `test/preload-api.test.ts`

**Interfaces:**
- Produces: `repositories.layoutStatus()`, `repositories.previewLayoutMigration()`, and `repositories.executeLayoutMigration(token)`.
- Consumes: Core layout APIs and preview types from Tasks 2–3.

- [ ] **Step 1: Write failing service and IPC contract tests**

Use a real `CoreService` v1 fixture and assert the public preview omits Core's internal `id`:

```ts
const preview = await service.previewAssetStoreLayoutMigration()
expect(preview).not.toHaveProperty('id')
expect(preview).toMatchObject({ token: expect.any(String), fromVersion: 1, toVersion: 2 })
```

Register IPC handlers and assert forged objects are rejected while a server-issued token succeeds. Update preload tests to require all three methods.

- [ ] **Step 2: Run focused Desktop tests and verify RED**

Run: `pnpm exec vitest run test/main/core-service.test.ts test/main/ipc-contract.test.ts test/preload-api.test.ts`

Expected: FAIL because the shared schemas, channels, and service methods do not exist.

- [ ] **Step 3: Add strict shared schemas and channels**

Add Zod schemas mirroring the Core public DTO, with `.strict()` on every object. The renderer-facing preview replaces internal `id` with `token` and adds an ISO `expiresAt`.

Extend the public API:

```ts
repositories: {
  layoutStatus(): Promise<{ version: 1 | 2; migrationRequired: boolean }>
  previewLayoutMigration(): Promise<AssetStoreLayoutMigrationPreview>
  executeLayoutMigration(token: string): Promise<{ version: 2; migrationRequired: false }>
}
```

- [ ] **Step 4: Implement expiring token storage in CoreService**

Store `{ preview, expiresAt }` in a private map keyed by Core preview ID. Return `{ ...publicPreview, token: id, expiresAt }` after explicitly destructuring `id`. Execution accepts only the token, consumes it once, rejects expired tokens, calls `managedStore.migrateLayout(preview)`, and resets cached repository/config state. Catch execution errors long enough to call `this.log?.write('error', 'asset store layout migration failed', { code, message })`, then rethrow the original structured Core error.

Register IPC handlers that accept no renderer path for preview and only `safeId` for execution. Expose exact methods from preload.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm exec vitest run test/main/core-service.test.ts test/main/ipc-contract.test.ts test/preload-api.test.ts && pnpm typecheck`

Expected: all focused contracts pass without `unrecognized_keys` errors.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/shared/ipc.ts src/main/ipc/register-ipc.ts src/preload/index.ts src/main/services/core-service.ts test/main/core-service.test.ts test/main/ipc-contract.test.ts test/preload-api.test.ts
git commit -m "feat: expose asset layout migration"
```

---

### Task 8: Add the Electron layout migration experience

**Files:**
- Modify: `src/renderer/src/features/settings/RepositoryConfigForm.vue`
- Modify: `src/renderer/src/components/ResourceExplorer.vue`
- Modify: `src/renderer/src/components/ErrorNotice.vue`
- Modify: `test/renderer/settings-vue.test.ts`
- Modify: `test/renderer/resource-explorer-vue.test.ts`
- Modify: `test/e2e/app.spec.ts`
- Modify: `test/e2e/fixtures.ts`

**Interfaces:**
- Consumes: layout IPC methods from Task 7.
- Produces: settings UI that detects, previews, confirms, executes, and refreshes after layout migration.

- [ ] **Step 1: Write failing renderer tests**

Mock `layoutStatus()` as migration-required and return a preview containing central and third-party moves. Assert the form displays:

```text
旧结构：entities/…/canvas-design
新结构：mattpocock/skills/_root/canvas-design
将重建 2 个软链接
1 个复制安装保持不变
```

Assert cancellation does not call execution or config update. Assert confirmation calls `executeLayoutMigration(preview.token)` before `updateConfig` or store-location migration.

- [ ] **Step 2: Run renderer tests and verify RED**

Run: `pnpm exec vitest run test/renderer/settings-vue.test.ts`

Expected: FAIL because the settings component does not query layout status.

- [ ] **Step 3: Implement the migration panel and save ordering**

On component load, request `layoutStatus()`. When required, show a dedicated warning card with the readable path preview and a primary “迁移资源目录结构” action. Disable managed-write save actions until migration succeeds.

Save ordering is exact:

```ts
if (layoutStatus.migrationRequired) await confirmAndExecuteLayoutMigration()
if (assetStorePathChanged) await confirmAndExecuteStoreLocationMigration()
await updateConfig(candidate)
```

Keep the existing fixed header/footer scroll behavior. Map migration codes (`MIGRATION_REQUIRED`, `ENTRY_CONFLICT`, `SOURCE_CHANGED`) to actionable Chinese messages in `ErrorNotice`. `MIGRATION_REQUIRED` exposes a “前往设置迁移” action; `ResourceExplorer` wires that action to the existing settings-dialog open event. Main-process logging is already performed by the service boundary from Task 7.

- [ ] **Step 4: Add an E2E v1 fixture and migrate it**

Create an E2E fixture with one central entity under `entities/<id>/demo`, one active Agent symlink, and a literal v1 manifest. Open settings, confirm migration, and assert through the app-visible status plus filesystem checks that the link resolves under `xcSkill/skills/common/demo`.

- [ ] **Step 5: Run renderer and E2E tests**

Run: `pnpm exec vitest run test/renderer/settings-vue.test.ts test/renderer/resource-explorer-vue.test.ts && pnpm test:e2e`

Expected: settings tests pass and the E2E migrated installation remains “正常”.

- [ ] **Step 6: Commit Task 8**

```bash
git add src/renderer/src/features/settings/RepositoryConfigForm.vue src/renderer/src/components/ResourceExplorer.vue src/renderer/src/components/ErrorNotice.vue test/renderer/settings-vue.test.ts test/renderer/resource-explorer-vue.test.ts test/e2e/app.spec.ts test/e2e/fixtures.ts
git commit -m "feat: guide asset layout migration"
```

---

### Task 9: Coordinate third-party repository rename migrations

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipc/register-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/services/core-service.ts`
- Modify: `src/main/services/third-party-repository-service.ts`
- Modify: `src/renderer/src/features/repositories/ThirdPartyRepositoryDialog.vue`
- Modify: `test/main/third-party-repository-service.test.ts`
- Modify: `test/main/core-service.test.ts`
- Modify: `test/main/ipc-contract.test.ts`
- Modify: `test/preload-api.test.ts`
- Modify: `test/renderer/third-party-repository-dialog-vue.test.ts`

**Interfaces:**
- Produces: `thirdPartyRepositories.previewUpdate(id, input)` and `thirdPartyRepositories.executeUpdate(token)`.
- Consumes: Core namespace rename preview/migration from Task 4.

- [ ] **Step 1: Write failing prepared-update and transaction tests**

Test that `ThirdPartyRepositoryService.prepareUpdate(id, input)` validates Git URL, branch, and Skill roots without mutating AppStore. Test `CoreService.previewThirdPartyRepositoryUpdate` returns a token plus namespace moves only when the display name changes and managed entities exist.

Assert execution order with controlled fakes:

```ts
expect(events).toEqual([
  'repository-validated',
  'namespace-migrated',
  'repository-persisted',
])
```

Simulate persistence failure and assert Core calls `rollbackRepositoryNamespaceMigration(result)`, restores the old namespace, and keeps the old repository record active. Also remove a repository with referenced managed entities and assert its namespace and installations remain until the last entity is uninstalled.

- [ ] **Step 2: Run focused Main tests and verify RED**

Run: `pnpm exec vitest run test/main/third-party-repository-service.test.ts test/main/core-service.test.ts`

Expected: FAIL because preparation and transactional update methods are absent.

- [ ] **Step 3: Implement non-persisting repository preparation**

Add:

```ts
interface PreparedThirdPartyRepositoryUpdate {
  current: ThirdPartyRepositoryView
  next: ThirdPartyRepositoryView
  commit(): Promise<ThirdPartyRepositoryView>
  rollback(): Promise<void>
}
```

`prepareUpdate` performs existing validation and cache staging but does not update AppStore until `commit()`. `rollback()` removes only newly staged cache content.

- [ ] **Step 4: Add tokenized preview/execute IPC**

`previewUpdate(id, input)` stores the prepared update and optional Core namespace preview under one expiring token. `executeUpdate(token)` consumes it, migrates the namespace, commits the repository record, and rolls back both sides if either step fails.

IPC input contains `{ id, input }` for preview and only the opaque token for execute. Zod schemas reject cache paths and renderer-supplied filesystem moves.

- [ ] **Step 5: Implement the rename confirmation UI**

The third-party dialog always previews an edit before saving. If `namespaceMigration.moves.length > 0`, show the old/new repository directory and affected link count in an Element Plus confirmation dialog. Confirmation executes the token; cancellation leaves the repository and store unchanged. URL/branch-only edits execute without an extra namespace warning.

- [ ] **Step 6: Run all focused rename tests**

Run: `pnpm exec vitest run test/main/third-party-repository-service.test.ts test/main/core-service.test.ts test/main/ipc-contract.test.ts test/preload-api.test.ts test/renderer/third-party-repository-dialog-vue.test.ts && pnpm typecheck`

Expected: all rename transaction and contract tests pass.

- [ ] **Step 7: Commit Task 9**

```bash
git add src/shared/ipc.ts src/main/ipc/register-ipc.ts src/preload/index.ts src/main/services/core-service.ts src/main/services/third-party-repository-service.ts src/renderer/src/features/repositories/ThirdPartyRepositoryDialog.vue test/main/third-party-repository-service.test.ts test/main/core-service.test.ts test/main/ipc-contract.test.ts test/preload-api.test.ts test/renderer/third-party-repository-dialog-vue.test.ts
git commit -m "feat: migrate repository namespaces on rename"
```

---

### Task 10: Full regression, packaging check, and documentation alignment

**Files:**
- Verify: `docs/superpowers/specs/2026-09-01-repository-scoped-asset-store-design.md`
- Verify: all production and test files committed by Tasks 1–9.

**Interfaces:**
- Consumes: all Core and Desktop deliverables from Tasks 1–9.
- Produces: verified release-ready branches and a concise migration handoff.

- [ ] **Step 1: Run Core verification from a clean process**

Run in the Core worktree:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: zero failed tests, successful package build, and no whitespace errors.

- [ ] **Step 2: Run Desktop verification from a clean process**

Run in the Desktop worktree:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
git diff --check
```

Expected: zero failed tests, successful Electron build, all E2E scenarios pass, and no whitespace errors.

- [ ] **Step 3: Manually verify the user-visible filesystem contract**

Use an isolated temporary HOME, add a central and `mattpocock` resource, install both by symlink, and inspect without editing:

```bash
find "$ASSET_STORE_PATH" -maxdepth 5 -print | sort
readlink "$PROJECT_ROOT/.codex/skills/canvas-design"
```

Expected paths include:

```text
xcSkill/skills/<group>/<resource>
mattpocock/skills/<group-or-_root>/<resource>
```

No new path contains `entities/<64-character-id>`.

- [ ] **Step 4: Verify recovery and cancellation once more**

Run only the named migration/recovery tests with `--reporter=verbose` and confirm they demonstrate v1 migration, namespace rename rollback, frozen-link preservation, and unchanged copy targets.

- [ ] **Step 5: Review the spec line by line against delivered behavior**

Confirm every goal, directory rule, migration rule, error case, and rollout condition in the spec has a passing test or an explicit manual verification result. If a mismatch is found, change implementation and tests together, rerun the relevant full suite, and commit the focused correction.

- [ ] **Step 6: Record final branch state**

```bash
git log --oneline --decorate -8
git status --short
```

Report Core and Desktop commit hashes, verification counts, and whether any remote push or merge still requires user authorization.
