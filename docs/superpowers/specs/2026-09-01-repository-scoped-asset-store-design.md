# Repository-scoped Asset Store Design

## Summary

Replace the machine-oriented `entities/<managed-id>/<name>` layout with a readable repository-oriented layout. The configured asset store remains an application-managed directory, but its immediate children represent repository sources:

```text
<assetStorePath>/
├── xcSkill/
│   ├── skills/<group>/<name>/
│   ├── rules/<group>/<name>
│   └── workflows/<group>/<name>
├── mattpocock/
│   ├── skills/<group>/<name>/
│   ├── rules/<group>/<name>
│   └── workflows/<group>/<name>
└── anthropics/
    └── ...
```

The central repository always uses `xcSkill`. Each third-party repository gets a directory derived from its configured display name. Resource identity remains manifest-backed and is not inferred from the readable path.

## Goals

- Make the selected asset store understandable when opened in Finder or a terminal.
- Keep resources from different repositories isolated.
- Preserve type and group boundaries so same-name resources do not collide.
- Keep managed entity identity stable across content updates and branch changes.
- Migrate existing stores and rebuild symlinks transactionally.
- Preserve copy installations as independent snapshots.

## Non-goals

- The asset store is not a user-editable source repository.
- The store does not retain historical resource versions.
- Repository refresh still does not update installed entities automatically.
- This change does not alter Agent target directory conventions.

## Directory Rules

### Repository namespace

The central repository namespace is fixed:

```text
xcSkill
```

A third-party namespace is generated from its display name. The normalizer will:

1. normalize Unicode to NFC;
2. trim leading and trailing whitespace;
3. replace path separators, control characters, and platform-invalid characters with `-`;
4. collapse repeated whitespace and separators;
5. reject `.` and `..` and fall back to `repository` if the result is empty.

Examples:

```text
mattpocock  -> mattpocock
Team Skills -> Team-Skills
设计技能库   -> 设计技能库
```

Namespace ownership is recorded in the managed manifest. If a normalized name is already owned by another source, append the first eight hexadecimal characters of the stable source identity hash:

```text
mattpocock-a31f83c2
```

The same source reuses its recorded namespace on every installation. A third-party repository rename produces a namespace-migration preview; after confirmation, all of that repository's entities are moved and active symlinks are rebuilt.

### Type, group, and resource segments

Every repository namespace has fixed type segments:

- `skills`
- `rules`
- `workflows`

The next segment is the resource group. An empty group is represented by `_root`; resources are never implicitly flattened into the type directory.

The final segment is the resource name. Skills remain directories. Rules and workflows retain the file-or-directory shape supplied by the scanner.

Examples:

```text
xcSkill/skills/backend/call-api/
xcSkill/skills/_root/frontend-design/
mattpocock/skills/_root/canvas-design/
anthropics/rules/common/review.md
```

All generated segments pass the same safe-relative-path validation. A planned destination that escapes the store, traverses a symlinked parent, or collides with another managed entity is rejected before any write.

## Manifest Model

Upgrade the managed manifest to version 2 and add repository namespace records:

```ts
interface ManagedRepositoryNamespace {
  sourceKind: 'central' | 'third-party'
  sourceId: string
  displayName: string
  directoryName: string
}
```

`ManagedAssetRecord.id` remains the SHA-256 identity derived from source identity, type, group, and name. This ID continues to connect installations to entities, but it no longer appears in the filesystem path.

`ManagedAssetRecord.relativePath` becomes:

```text
<repository-directory>/<type>/<group-or-_root>/<resource-name>
```

`ManagedInstallationRecord` does not change. Its `managedAssetId` remains the stable relationship to the entity, while `targetPath` remains the logical Agent location and must not be canonicalized through the final symlink.

Version 1 manifests are readable only through the migration path. Once migration commits, the manifest is atomically replaced with version 2.

## Install and Update Flow

On install or managed update:

1. Resolve or create the repository namespace record.
2. Calculate the readable relative path from namespace, type, group, and resource name.
3. Verify that the source, store, repository cache, and Agent target do not overlap.
4. Copy the repository resource into a staged entity path.
5. Hash and verify the staged entity.
6. Atomically replace the entity at its readable destination.
7. Create or replace the Agent target using the selected `copy` or `symlink` method.
8. Atomically update the manifest.

Content updates and branch changes keep the same managed ID and destination, so active symlinks continue to point at a stable path. Copy installations remain unchanged until explicitly updated.

Removing the final installation reference removes the entity. Empty group, type, and repository directories are pruned only when they contain no unmanaged files.

## Existing Store Migration

When a version 1 manifest or `entities/` layout is detected, browsing remains available but managed writes require migration first.

The migration preview lists:

- every old and new entity path;
- repository namespaces to be created;
- path and namespace collisions;
- active symlinks that will be rebuilt;
- frozen installations retained only in the manifest;
- copy installations that remain untouched.

Execution uses the existing global lock and transaction journal:

1. Re-read the manifest and reject a stale preview token.
2. Build the complete version 2 store in a sibling staging directory.
3. Copy every entity from its old path to its planned readable path.
4. Verify each staged entity against its recorded content hash.
5. Move the old store to a transaction backup and promote the staged store.
6. Rebuild every active managed symlink to the new entity path.
7. Atomically write the version 2 manifest.
8. Remove the backup after all links and hashes verify.

On failure, restore the old store, manifest, and symlinks. The journal records the current phase so application startup can complete rollback after interruption. Copy installation targets are never rewritten during layout migration.

Unmanaged files inside the configured store are reported as conflicts and are not deleted or silently moved.

## Repository Rename and Removal

Renaming a third-party repository display name first creates a namespace-migration preview. If the repository has no managed entities, only its manifest namespace record changes. Otherwise, confirmation shows all moved entities and rebuilt symlinks.

Removing a third-party repository does not remove referenced entities. Existing installations remain manageable from the shared manifest, but source-based updates are unavailable. Its namespace directory is removed only after the last referenced entity is uninstalled.

## Electron and CLI Integration

Both Electron and CLI use Core APIs for:

- layout migration preview and execution;
- namespace rename preview and execution;
- install, update, freeze, thaw, and uninstall;
- startup recovery.

Electron must not calculate directory paths in the renderer or accept renderer-supplied destination paths. IPC accepts only validated source/resource identifiers and opaque preview tokens. The CLI presents the same conflicts and asks for confirmation before migration.

## Error Handling

- Unsafe path segment: reject before staging and identify the source field.
- Namespace collision: allocate a stable short-hash suffix and record it.
- Entity destination collision: block migration and show both entity identities.
- Target occupied during relink: roll back without replacing user content.
- Hash verification failure: discard staging and retain the old store.
- Interrupted migration: recover from the journal before allowing writes.
- Cross-volume store movement: copy, verify, and swap instead of assuming rename works.

Errors returned to Electron include a safe user-facing message and a diagnostic code; full details are written to the local log.

## Test Plan

### Core

- Central resources resolve below `xcSkill/<type>/<group>/<name>`.
- Third-party resources resolve below their recorded normalized namespace.
- Empty groups use `_root` and never flatten.
- Skills, Rules, and Workflows with the same name do not collide.
- Same-name resources in different groups and repositories remain isolated.
- Duplicate repository display names receive stable source-hash suffixes.
- Content and branch updates preserve entity paths and active links.
- Repository rename migration moves entities and rebuilds active links.
- Version 1 migration verifies hashes and produces a version 2 manifest.
- Frozen links remain absent; copy installations remain byte-for-byte unchanged.
- Conflicts, simulated failures, cross-volume migration, and startup recovery restore prior state.
- Final-reference uninstall prunes only empty managed directories.

### Electron

- Migration preview renders readable old/new paths and conflicts.
- IPC rejects forged paths, namespace names, and expired tokens.
- Saving settings requires migration when the old layout is detected.
- Repository rename requests confirmation when managed entities are affected.
- Errors expose actionable messages instead of a generic failure only.

### CLI

- Interactive migration and rename share Core preview tokens.
- Cancellation leaves the store and manifest unchanged.
- Electron and CLI observe the same namespaces, entities, and installations.

### Full verification

- Core: `pnpm test && pnpm build`
- Electron: `pnpm test && pnpm typecheck && pnpm build && pnpm test:e2e`

## Rollout

1. Release Core manifest v2, readable path planning, migration, and recovery support.
2. Pin Electron to the new Core commit and add migration/rename UI.
3. Update CLI configuration and write commands to require migration.
4. Keep version 1 read detection for one compatibility cycle; never create new version 1 records.

