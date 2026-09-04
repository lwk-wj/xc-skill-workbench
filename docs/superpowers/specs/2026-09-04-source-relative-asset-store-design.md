# Source-relative Asset Store Design

## Summary

Change the managed asset store from a normalized `repository/type/group/name` layout to a repository-mirroring layout. The first directory continues to isolate repository sources, while every managed resource below it keeps the relative path it had in that source repository.

```text
<assetStorePath>/
├── xcSkill/
│   ├── backend/skills/auto-type-mapper/
│   ├── common/skills/self-evolution/
│   └── skills/frontend-design/
├── mattpocock/
│   └── <the original repository-relative path>/
└── authropics/
    └── <the original repository-relative path>/
```

Agent installation targets do not mirror this hierarchy. They continue to follow each Agent's required convention, such as `.codex/skills/auto-type-mapper`. The managed store is source-oriented; Agent targets are consumer-oriented.

## Goals

- Make Finder and terminal views match the structure users see in the source repository.
- Support arbitrary third-party repository layouts without inventing type/group ordering rules.
- Keep different repository sources isolated by their stable repository namespace.
- Preserve stable entity paths across content updates and branch changes when the source-relative path is unchanged.
- Migrate existing managed entities and rebuild active soft links transactionally.
- Keep copied installations as independent snapshots.

## Non-goals

- Agent installation directories will not reproduce repository subdirectories.
- The asset store will not become a full repository clone or retain unrelated repository files.
- Upstream resource moves and renames will not be guessed automatically when identity is ambiguous.
- The asset store remains application-managed and is not a supported editing surface.

## Chosen Structure

Each repository retains its existing namespace allocation rules:

- the central repository uses `xcSkill`;
- each third-party repository uses its normalized display name;
- namespace collisions receive the existing stable source-hash suffix.

The managed entity path becomes:

```text
<repository-namespace>/<source-relative-path>
```

Examples:

```text
Repository path                              Managed path
backend/skills/auto-type-mapper              xcSkill/backend/skills/auto-type-mapper
skills/frontend-design                       xcSkill/skills/frontend-design
engineering/ask-matt                         mattpocock/engineering/ask-matt
skills/design/canvas-design                  authropics/skills/design/canvas-design
```

There is no generated `skills`, `rules`, `workflows`, group, or `_root` segment. Those segments appear only when they already exist in the repository.

Only the selected resource is copied into the managed store. Parent directories are created to reproduce its location, but sibling resources and unrelated repository files are not copied.

## Scanner and Data Model

Add `sourceRelativePath` to `AssetRecord`. It is the safe POSIX-style path from the repository root to the asset root:

- Skill: path to the directory containing `SKILL.md`;
- Rule or Workflow: path to the source file or resource directory;
- root single-Skill repository: `.`.

The scanner derives this value from the validated canonical repository root and the validated asset path. Renderer and IPC callers may display it but cannot supply or modify it for file operations.

Configured third-party Skill roots keep their current discovery behavior. The optional `group` remains presentation and filtering metadata; it no longer determines the managed filesystem path.

Upgrade the managed manifest to version 3. `ManagedAssetRecord` gains:

```ts
sourceRelativePath: string | null
```

Newly imported entities always have a non-null value. `null` exists only for an unresolved legacy entity whose original location cannot be reconstructed during migration.

Entity identity changes to:

```text
repository source identity + resource type + source-relative path
```

This allows two resources with the same name and group to coexist when they occupy different source paths. Content updates and branch changes at the same path retain the same identity. An upstream move is treated as a removed resource plus a new resource unless the user explicitly repairs the association.

## Path Validation

Before planning an entity destination, Core must:

1. normalize separators to `/` without changing valid segment names;
2. reject empty paths except the single-Skill `.` case;
3. reject absolute paths, drive-prefixed paths, empty segments, `.` segments inside a path, `..`, control characters, and platform-invalid characters;
4. verify that the scanned source remains inside the canonical repository root;
5. verify that every managed destination remains inside the repository namespace;
6. reject a destination whose existing parent traverses an unmanaged symbolic link;
7. reject collisions with another managed entity or unmanaged filesystem entry.

The repository namespace is still generated and sanitized separately. Original source-relative path segments are validated, not silently renamed, because renaming them would stop the managed tree from matching the repository.

For a root single-Skill repository, `.` maps to the repository namespace directory itself. Such a repository can contain only that one managed root entity, so it cannot collide with catalog entities from the same source.

## Install and Update Flow

On install or managed update:

1. Main resolves the source repository and scans the asset.
2. Core receives the scanner-produced `sourceRelativePath`; renderer input is never trusted for this field.
3. Core resolves or creates the repository namespace.
4. Core stages the resource at `<namespace>/<sourceRelativePath>`.
5. Core verifies the staged content hash and atomically replaces the entity.
6. Core creates or refreshes the requested copy or soft-link installation at the Agent-defined target.
7. Core atomically updates the version 3 manifest.

Soft-link installations point to the stable mirrored entity path. Copy installations are generated from that entity but do not change when the entity is later updated.

Repository refresh still updates only available source data. It does not update a managed entity or any installation until the user requests an update.

## Agent Target Collisions

Agent target paths remain name-based because Agent platforms expect resources under paths such as:

```text
.codex/skills/<skill-name>
.claude/skills/<skill-name>
```

Therefore, distinct source paths can still resolve to the same Agent target. Before installation, Core checks the logical target path without resolving the final soft link. If another managed installation or unmanaged entry occupies the target, planning is blocked and the UI identifies both repository names and source-relative paths. The application never chooses one implicitly.

## Version 2 Migration

When a version 2 manifest is detected, browsing and non-destructive status inspection remain available. New installs and managed updates require a version 3 migration preview.

For each existing entity, Core loads the corresponding repository source and searches the current scan by source identity, resource type, group, and name:

- exactly one match: record its `sourceRelativePath` and plan a move to the mirrored destination;
- no match: retain the entity at its current location with `sourceRelativePath: null`;
- multiple matches: retain it with `sourceRelativePath: null` and report every candidate as a conflict requiring manual repair.

The preview contains:

- old and new entity paths;
- unchanged unresolved entities and their reason;
- active soft links that will be rebuilt;
- frozen installations that remain absent;
- copy targets that remain untouched;
- destination collisions and unmanaged entries.

Execution uses the existing global lock, staging directory, backup, and journal:

1. re-read the manifest and reject a stale preview token;
2. construct the complete version 3 store in a sibling staging directory;
3. copy and hash-verify each resolved entity at its mirrored path;
4. preserve each unresolved entity at its current relative path;
5. swap the staged store into place;
6. rebuild every active managed soft link;
7. write the version 3 manifest atomically;
8. delete the backup only after entity and link verification succeeds.

Any failure restores the version 2 store, manifest, and active links. Startup recovery continues or rolls back an interrupted migration from the journal.

Unresolved legacy entities remain freezable, thawable, and uninstallable. Updating them is blocked until the source is available and the user selects one scanned resource to repair the association. Repair records the selected `sourceRelativePath`, moves the entity transactionally, and rebuilds active links.

## Repository Rename and Removal

Renaming a third-party repository changes only its namespace prefix. The source-relative suffix remains byte-for-byte equivalent after separator normalization. Existing namespace migration previews continue to list moved entities and rebuilt soft links.

Removing a third-party repository does not remove referenced entities. Its managed resources remain usable, freezable, thawable, and uninstallable. Source-based update and repair are unavailable until the repository is configured again.

## Electron and CLI Integration

Electron and CLI consume the same Core APIs and manifest:

- scan results include read-only `sourceRelativePath`;
- migration previews distinguish resolved moves from unresolved legacy records;
- install and update plans show the repository-relative source location;
- target collision errors show both conflicting source-relative paths;
- repair accepts a scanned asset identity or opaque token, never an arbitrary filesystem path.

No new configuration field is required. `assetStorePath` continues to select the root of the managed store.

## Error Handling

- Unsafe source path: reject the resource during scanning with its repository-relative candidate.
- Destination escape or symlinked parent: reject before staging.
- Managed destination collision: block the operation and identify both entity IDs and source paths.
- Agent target collision: block installation and identify both resources.
- Source unavailable during migration: preserve the entity as unresolved instead of deleting it.
- Hash mismatch: discard staging and retain the previous entity and manifest.
- Interrupted migration: recover from the journal before permitting another write.

User-facing errors remain concise; diagnostic details include source identity, source-relative path, managed destination, and error code in the local log.

## Test Plan

### Core

- Scanner records correct source-relative paths for catalog Skills, Rules, Workflows, configured Skill roots, nested groups, and root single-Skill repositories.
- Central and third-party managed paths reproduce repository hierarchy below their namespaces.
- No generated type, group, or `_root` segments appear unless present in the repository.
- Same-name resources at different source paths have distinct identities and managed locations.
- Invalid traversal, absolute paths, symlink escapes, unmanaged parent links, and destination collisions are rejected.
- Content and branch updates at the same path retain entity identity and active soft links.
- Agent target collisions between same-name resources are blocked with both source paths reported.
- Version 2 migration resolves unique resources, preserves unresolved resources, rebuilds active links, and leaves copy targets unchanged.
- Migration failure and interrupted recovery restore the old store, manifest, and links.
- Repository namespace rename preserves the source-relative suffix.

### Electron

- Migration preview shows original repository paths and unresolved records.
- IPC rejects renderer-supplied or mutated source-relative paths.
- Install and collision dialogs display repository plus relative path where disambiguation is needed.
- Existing unresolved entities remain manageable but cannot be updated until repaired.

### CLI

- CLI shows the same migration preview and repair behavior as Electron.
- Cancellation leaves the version 2 store unchanged.
- Electron and CLI observe identical version 3 entities and installations.

### Full verification

- Core: `pnpm test && pnpm build`
- Electron: `pnpm test && pnpm typecheck && pnpm build && pnpm test:e2e`

## Rollout

1. Release Core scanner metadata, manifest version 3, mirrored path planning, migration, repair, and recovery.
2. Pin Electron to that Core revision and add migration/repair presentation.
3. Update CLI install, update, configuration, and compatibility flows to require the same migration.
4. Retain version 2 read and migration support for one compatibility cycle; never create new version 2 records.
