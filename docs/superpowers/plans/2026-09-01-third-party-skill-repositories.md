# Third-Party Skill Repositories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task in the current session. Do not use subagent-driven development for this feature.

**Goal:** Add persistent third-party Git repositories that users can browse, refresh, install from, and use for explicit per-Skill updates.

**Architecture:** Extend `xc-skills/core` so repository default branches and single-Skill layouts remain trusted Core assets. In Desktop, store repository registrations and installation provenance in V2 state, resolve every third-party source in Main-owned caches, and expose only declarative IPC operations to Vue.

**Tech Stack:** Node.js 22, TypeScript, `xc-skills/core`, Electron 43, Vue 3, Pinia, Element Plus, Zod 4, Vitest, Playwright Electron.

**Spec:** `docs/superpowers/specs/2026-09-01-third-party-skill-repositories-design.md`

## Global Constraints

- Third-party V1 supports Skills only; Rules and Workflows remain central/project/global features.
- A repository is a remote HTTPS, SSH, or SCP-style `git@` source and uses system Git credentials; the app stores no secrets.
- Repository refresh never updates installed files automatically.
- Remote third-party installs and updates use copy mode only.
- Renderer never supplies cache paths, mutation paths, or Git commands.
- Different-source name conflicts require explicit replacement confirmation.
- Removing a repository never removes installed Skills.
- Existing central repository behavior and V1 state data must remain compatible.
- Work in the existing Core worktree `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core` on `codex/xc-skills-core` first, then `/Users/xc/Documents/xc_skill_workbench/.worktrees/desktop-implementation` on `codex/xc-skills-desktop`. Do not edit `/Users/xc/Desktop/XcSkill/xc-skills`, which is the separate `main` checkout.

---

### Task 1: Extend Core repository and scanner contracts

**Files:**
- Modify: `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core/package.json`
- Modify: `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core/src/core/types.ts`
- Modify: `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core/src/core/repository.ts`
- Modify: `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core/src/core/scanner.ts`
- Modify: `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core/src/core/index.ts`
- Modify: `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core/test/core/scanner.test.ts`
- Modify: `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core/test/integration/repository.test.ts`
- Modify: `/Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core/test/core/public-api.test.ts`

**Interfaces:**
- Produces: `type RepositoryLayout = 'auto' | 'catalog' | 'single-skill'`.
- Produces: `scanAssets({ root, types, groups, layout?, sourceName? }): Promise<AssetRecord[]>`.
- Produces: `detectRepositoryLayout({ root }): Promise<'catalog' | 'single-skill'>` using the same containment and validity rules as `scanAssets`.
- Produces: `resolveDefaultBranch(config: XcSkillsConfig): Promise<string>`.
- Exports the existing `normalizeRepositorySource(source): Promise<string>` so Main can use Core's canonical HTTPS/SSH/SCP validation for uniqueness and storage.
- Extends Core `RepositorySource` with immutable `commit: string`, populated from the verified HEAD used to build the published source.
- `layout: 'auto'` prefers a valid catalog and otherwise accepts a root `SKILL.md`.

- [ ] **Step 1: Write failing scanner tests**

Add cases that create a root `SKILL.md` with and without frontmatter `name`, then assert:

```ts
expect(await scanAssets({ root, layout: 'auto', sourceName: 'fallback-repo' }))
  .toMatchObject([{ type: 'skills', name: 'frontmatter-name', group: '', entryState: 'active' }])

expect(await scanAssets({ root: fallbackRoot, layout: 'single-skill', sourceName: 'fallback-repo' }))
  .toMatchObject([{ name: 'fallback-repo', path: fallbackRoot }])
```

Also assert `catalog` rejects a root-only Skill, `single-skill` ignores nested catalog assets, invalid fallback names are rejected, and a root entry resolving outside `root` is not returned. Assert `detectRepositoryLayout` returns `catalog` when both layouts are present, returns `single-skill` for a valid root-only Skill, and rejects a repository with neither layout.

- [ ] **Step 2: Write a failing default-branch integration test**

Create a bare remote whose symbolic HEAD points to `trunk`, then assert:

```ts
await expect(resolveDefaultBranch({ mode: 'remote', remoteUrl })).resolves.toBe('trunk')
```

Add malformed/missing symbolic HEAD coverage and expect `CoreError` with `GIT_FAILED` rather than silently choosing `main`. Extend existing `resolveRepositorySource` assertions so local worktrees, fresh branch caches, and stale fallback caches expose the exact verified HEAD as `source.commit`.

- [ ] **Step 3: Run Core tests to verify RED**

Run:

```bash
cd /Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core
npx vitest run test/core/scanner.test.ts test/integration/repository.test.ts test/core/public-api.test.ts
```

Expected: failures because `layout`, `sourceName`, and `resolveDefaultBranch` are not exported.

- [ ] **Step 4: Implement the Core contracts**

Extend `ScanAssetsOptions` and keep catalog traversal unchanged. Add a dedicated root-Skill path that validates `SKILL.md`, reads frontmatter with the same text limit, derives a safe name, registers provenance with root containment, and returns one active Skill.

Implement default branch discovery without a shell:

```ts
export async function resolveDefaultBranch(config: XcSkillsConfig): Promise<string> {
  const location = await repositoryLocation(config)
  if (location.mode === 'local') {
    const branch = await runGit(['branch', '--show-current'], { cwd: location.source })
    return validateBranchName(branch)
  }
  const output = await runGit(['ls-remote', '--symref', '--', location.source, 'HEAD'])
  const match = output.match(/^ref:\s+refs\/heads\/(.+)\tHEAD$/m)
  if (!match) throw new CoreError('GIT_FAILED', 'Unable to resolve remote default branch')
  return validateBranchName(match[1]!)
}
```

Export all new types/functions from `src/core/index.ts`, including the existing repository-source normalizer after making it public. Implement layout detection once and call it from `scanAssets({ layout: 'auto' })`; do not maintain a second heuristic in Desktop. Populate `RepositorySource.commit` from the same verified HEAD already read for local validation/cache metadata, including stale-cache recovery. Add `"prepare": "npm run build"` so a Desktop dependency pinned to a Git commit builds `dist` on clean install.

- [ ] **Step 5: Run Core verification**

Run:

```bash
npm test
npm run build
```

Expected: all Core/CLI tests pass and `dist/core/index.d.ts` exposes both new contracts.

- [ ] **Step 6: Commit Core changes**

```bash
git add src/core test/core test/integration package.json package-lock.json pnpm-lock.yaml
git commit -m "feat(core): support third-party skill repositories"
```

---

### Task 2: Add V2 Desktop state and third-party contracts

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/services/app-store.ts`
- Modify: `test/main/app-store.test.ts`
- Modify: `test/main/ipc-contract.test.ts`

**Interfaces:**
- Produces: `ThirdPartyRepository`, `ThirdPartyRepositoryView`, `ThirdPartyRepositoryInput`, and `InstallationSourceRecord` Zod schemas/types.
- Produces: `SourceSelection` variant `{ kind: 'third-party'; repositoryId: string }`.
- Produces Desktop `AssetStatusRecordSchema` value `source_unavailable`; Core's `AssetStatus` union remains unchanged because this status describes missing Desktop source registration/cache, not a Core filesystem comparison.
- Produces AppStore methods for repository registrations and installation provenance.

- [ ] **Step 1: Write failing V1-to-V2 migration tests**

Write a V1 JSON fixture and assert `AppStore.read()` returns V2 without losing fields:

```ts
expect(await store.read()).toMatchObject({
  version: 2,
  projects: legacy.projects,
  thirdPartyRepositories: [],
  installationSources: [],
})
```

Add tests for duplicate repository `url + branch`, duplicate normalized installation target keys, invalid timestamps, and a third-party `lastSource` whose repository ID does not exist.

- [ ] **Step 2: Run state tests to verify RED**

Run: `pnpm exec vitest run test/main/app-store.test.ts test/main/ipc-contract.test.ts`

Expected: V1 is returned unchanged and new schemas/methods are missing.

- [ ] **Step 3: Define exact V2 schemas**

Add the approved fields from the spec, including `id` on installation records. Define request schemas:

```ts
const ThirdPartyRepositoryInputSchema = z.object({
  url: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  branch: z.string().trim().min(1).max(255).optional(),
}).strict()

const ThirdPartySourceSelectionSchema = z.object({
  kind: z.literal('third-party'),
  repositoryId: safeId,
})
```

Define the Renderer-safe view explicitly; it contains no cache root or Core asset path:

```ts
const ThirdPartyRepositoryViewSchema = ThirdPartyRepositorySchema.extend({
  skillCount: z.number().int().nonnegative(),
  stale: z.boolean(),
  cachedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
})
```

Extend status schemas with `source_unavailable`. Keep repository URLs out of `safeAbsolutePath` fields.

- [ ] **Step 4: Implement atomic state migration and methods**

Parse a `DesktopStateV1Schema | DesktopStateV2Schema`, migrate V1 in memory, and make all existing writes emit V2. Add:

```ts
listThirdPartyRepositories(): Promise<ThirdPartyRepository[]>
saveThirdPartyRepository(repo: ThirdPartyRepository): Promise<ThirdPartyRepository[]>
removeThirdPartyRepository(id: string): Promise<void>
listInstallationSources(): Promise<InstallationSourceRecord[]>
upsertInstallationSource(record: InstallationSourceRecord): Promise<void>
removeInstallationSource(id: string): Promise<void>
```

Canonicalize installation target paths before uniqueness checks. Add `findInstallationSourceByTarget({ scope, projectId, agentId, targetPath })` so operations never guess an ID. When a saved last source references a removed repository, migrate it to `{ kind: 'central' }`.

- [ ] **Step 5: Run state/contract tests**

Run: `pnpm exec vitest run test/main/app-store.test.ts test/main/ipc-contract.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit Desktop contracts**

```bash
git add src/shared/ipc.ts src/main/services/app-store.ts test/main/app-store.test.ts test/main/ipc-contract.test.ts
git commit -m "feat(state): track third-party repositories and provenance"
```

---

### Task 3: Build the Main-owned third-party cache service

**Files:**
- Create: `src/main/services/third-party-repository-service.ts`
- Create: `test/main/third-party-repository-service.test.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: Core `resolveDefaultBranch`, `resolveRepositorySource`, `detectRepositoryLayout`, and layout-aware `scanAssets`.
- Produces: `ThirdPartyRepositoryService.list/add/update/remove/refresh/resolve`.
- `resolve(id)` returns `{ repository, root, branch, commit, layout, stale, cachedAt, lastError, assets }`; only `ThirdPartyRepositoryView` is allowed through IPC.

- [ ] **Step 1: Write failing service tests**

Use injected Core functions and a temporary cache root. Cover:

```ts
await service.add({ url: 'ssh://git@example.com/team/skills.git' })
expect(await store.listThirdPartyRepositories()).toMatchObject([
  { name: 'skills', branch: 'trunk', layout: 'catalog' },
])
```

Also test single-Skill detection, duplicate normalized URL/branch rejection, edit retaining ID, failed first add writing nothing, refresh returning stale cached data after a network failure, same-ID refresh serialization, different-ID parallel refresh, and owned-cache-only removal. Active-plan edit/remove rejection belongs to CoreService in Task 6, where plan snapshots exist.

- [ ] **Step 2: Run service tests to verify RED**

Run: `pnpm exec vitest run test/main/third-party-repository-service.test.ts`

Expected: module not found.

- [ ] **Step 3: Implement cache preparation and registration**

Allocate the stable repository UUID in Main before any cache path is constructed, then use one cache root per repository ID:

```ts
const repositoryCacheRoot = (id: string) => resolve(cacheRoot, 'third-party', id)
const normalizedUrl = await core.normalizeRepositorySource(input.url)
const config = { mode: 'remote' as const, remoteUrl: normalizedUrl, defaultBranch: branch }
const source = await core.resolveRepositorySource(config, branch, repositoryCacheRoot(id))
const layout = await core.detectRepositoryLayout({ root: source.root })
const assets = await core.scanAssets({
  root: source.root,
  types: ['skills'],
  layout,
  sourceName: inferredName,
})
```

Infer the default display name from the normalized URL/SCP path's final component, remove one trailing `.git`, percent-decode URL paths, and validate the result with the same safe-name schema used by `sourceName`; an explicit display name overrides it. Require at least one Skill and save only after validation. Persist `source.commit` in installation provenance only after a completed operation. Queue refreshes by repository ID. Before removal, resolve and compare the cache path against the canonical managed root; never accept a caller-provided path.

- [ ] **Step 4: Wire service construction in Main**

Construct the service with `join(userData, 'cache')`, `AppStore`, logging, and injected Core functions. Inject it into `CoreService` and IPC registration rather than importing a singleton. CoreService—not the cache service—owns active-plan mutation guards.

- [ ] **Step 5: Run service and Main tests**

Run: `pnpm exec vitest run test/main/third-party-repository-service.test.ts test/main/core-service.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit the cache service**

```bash
git add src/main/services/third-party-repository-service.ts src/main/index.ts test/main/third-party-repository-service.test.ts test/main/core-service.test.ts
git commit -m "feat(main): manage third-party repository caches"
```

---

### Task 4: Expose declarative third-party IPC

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/services/core-service.ts`
- Modify: `src/main/ipc/register-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `test/main/ipc-contract.test.ts`
- Modify: `test/preload-api.test.ts`

**Interfaces:**
- Produces `DesktopApi.thirdPartyRepositories.list/add/update/remove/refresh`; relink is added after source resolution in Task 5.
- Produces channels `third-party-repositories:list|add|update|remove|refresh`.

- [ ] **Step 1: Write failing IPC and preload tests**

Assert exact forwarding and strict parsing:

```ts
await api.thirdPartyRepositories.add({ url, name: 'Team Skills' })
expect(electron.invoke).toHaveBeenCalledWith(Channels.thirdPartyRepositoriesAdd, { url, name: 'Team Skills' })
```

Reject extra properties, empty IDs, unsupported URL schemes, URL credentials, unsafe branch names, and forged cache paths before service handlers run.

- [ ] **Step 2: Run IPC tests to verify RED**

Run: `pnpm exec vitest run test/main/ipc-contract.test.ts test/preload-api.test.ts`

Expected: new channels and API are undefined.

- [ ] **Step 3: Implement API schemas and handlers**

Use strict request objects:

```ts
update(id, input)
remove(id)
refresh(id)
```

Parse all responses with `ThirdPartyRepositoryViewSchema`. Keep cache paths and Core asset paths out of repository responses. Bind handlers to CoreService wrapper methods; the wrappers delegate to the repository service and reject edit/remove when `hasActiveRepositoryPlans(id)` is true.

- [ ] **Step 4: Run IPC/preload tests**

Run: `pnpm exec vitest run test/main/ipc-contract.test.ts test/preload-api.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit IPC support**

```bash
git add src/shared/ipc.ts src/main/services/core-service.ts src/main/ipc/register-ipc.ts src/preload/index.ts test/main/ipc-contract.test.ts test/preload-api.test.ts
git commit -m "feat(ipc): expose third-party repository management"
```

---

### Task 5: Integrate third-party sources into CoreService

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/services/core-service.ts`
- Modify: `src/main/ipc/register-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `test/main/core-service.test.ts`
- Modify: `test/main/ipc-contract.test.ts`
- Modify: `test/preload-api.test.ts`

**Interfaces:**
- Consumes: `{ kind: 'third-party', repositoryId }` source selections.
- Produces trusted catalog/detail/status behavior for third-party assets.
- Produces `CoreService.relinkInstallation(input)` and `hasActiveRepositoryPlans(repositoryId)`.
- Produces `DesktopApi.thirdPartyRepositories.relinkInstallation({ installationId, repositoryId, assetId })` and its strict IPC channel.

- [ ] **Step 1: Write failing source and status tests**

Cover scanning a registered repository, reading its detail from Core provenance, isolated catalog keys for two repositories with the same Skill name, and repository removal:

```ts
expect((await service.statuses(installedSelection))[0]?.status.status)
  .toBe('source_unavailable')
```

Verify an available stale cache still computes the previous status and exposes stale repository metadata separately.

Add IPC/preload coverage that rejects extra properties before `CoreService.relinkInstallation` runs, and CoreService coverage that rejects well-formed but unknown installation/repository IDs.

- [ ] **Step 2: Run CoreService tests to verify RED**

Run: `pnpm exec vitest run test/main/core-service.test.ts`

Expected: `third-party` source is not handled.

- [ ] **Step 3: Generalize source catalog resolution**

Keep cache keys as `JSON.stringify(source) + assetId`. For third-party scans, call the repository service, store raw Core assets/provenance, and return only Skills. Central scans remain unchanged.

Replace central-only source matching with:

```ts
resolveRecordedSource(record: InstallationSourceRecord): Promise<{
  selection: AssetSelection
  asset: AssetRecord
  coreAsset: CoreAsset
}>
```

Use exact repository ID + type + group + name. Do not fall back to central for recorded third-party installs.

- [ ] **Step 4: Implement status and relink rules**

When a project/global target has provenance, evaluate against that source. Return `source_unavailable` when registration/cache/asset is unavailable. Relink only when `hashAsset(installed) === hashAsset(selectedSource)`; otherwise throw a conflict directing the caller to update/replace.

- [ ] **Step 5: Run CoreService tests**

Run: `pnpm exec vitest run test/main/core-service.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit source integration**

```bash
git add src/shared/ipc.ts src/main/services/core-service.ts src/main/ipc/register-ipc.ts src/preload/index.ts test/main/core-service.test.ts test/main/ipc-contract.test.ts test/preload-api.test.ts
git commit -m "feat(main): resolve third-party skill sources"
```

---

### Task 6: Make operations provenance-aware and conflict-safe

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/services/core-service.ts`
- Modify: `src/main/ipc/register-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `test/main/core-service.test.ts`
- Modify: `test/main/operation-service.test.ts`
- Modify: `test/main/ipc-contract.test.ts`
- Modify: `test/preload-api.test.ts`

**Interfaces:**
- Adds `replaceExistingSource?: boolean` to `OperationRequest`.
- Stores `{ plan, request, sourceSnapshot, targetSnapshot }` in Main-only plan state.
- Updates installation provenance only after a completed operation.
- Adds `operations.inspectSourceConflict(input): Promise<SourceConflict | null>` so Renderer receives structured conflict data without depending on serialized exception details.

Define `SourceConflictSchema` exactly as:

```ts
const SourceConflictPartySchema = z.object({
  kind: z.enum(['central', 'third-party', 'untracked']),
  repositoryId: safeId.nullable(),
  label: z.string().min(1),
}).strict()

const SourceConflictSchema = z.object({
  targetPath: safeAbsolutePath,
  existing: SourceConflictPartySchema,
  requested: SourceConflictPartySchema,
}).strict()
```

- [ ] **Step 1: Write failing operation lifecycle tests**

Test these exact outcomes:

```ts
install completed  -> provenance inserted
update completed   -> commit/hash updated
replace completed  -> source repository replaced
uninstall completed -> provenance removed
freeze/thaw completed -> provenance unchanged
rolled_back/cancelled/needs_attention -> provenance unchanged
```

Add same-target different-source coverage: `inspectSourceConflict` returns the exact old/new labels and Main-derived target path; no replacement flag makes `plan` throw `ENTRY_CONFLICT`; `replaceExistingSource: true` produces a warning and a plan. Renderer-supplied paths remain impossible. Verify edit/remove of a repository referenced by an unexpired plan is rejected, then succeeds after execute/cancel/expiry clears that plan.

- [ ] **Step 2: Run operation tests to verify RED**

Run: `pnpm exec vitest run test/main/core-service.test.ts test/main/operation-service.test.ts`

Expected: provenance is never updated and replacement flag is rejected.

- [ ] **Step 3: Resolve the correct update source**

For update from project/global, look up the installation record by canonical target. Third-party records resolve only their repository. Legacy records without provenance retain the current central matching path. Implement conflict inspection and planning through one shared Main-only resolver so a conflict cannot pass inspection and then bypass enforcement during planning.

Always send `method: 'copy'` for third-party install/update and `allowSymlink: false` to Core planning.

- [ ] **Step 4: Commit provenance after successful execution**

Store a concrete `sourceSnapshot` containing source selection, repository ID/name/URL snapshot, Core asset identity, `RepositorySource.commit`, and source hash; store a `targetSnapshot` containing scope, project ID, Agent ID, canonical target root/path, and any previous installation-record ID. Build the final record only from these Main-owned snapshots. After Core returns `completed`, hash the resulting installed target and store that verified value as `installedHash` rather than assuming the plan's source hash; for uninstall, remove the previous record by ID. If target hashing or the state write fails, return `needs_attention` and log the target so the user can repair provenance rather than falsely reporting full success.

- [ ] **Step 5: Run operation tests**

Run: `pnpm exec vitest run test/main/core-service.test.ts test/main/operation-service.test.ts`

Expected: all lifecycle and conflict cases pass.

- [ ] **Step 6: Commit operation integration**

```bash
git add src/shared/ipc.ts src/main/services/core-service.ts src/main/ipc/register-ipc.ts src/preload/index.ts test/main/core-service.test.ts test/main/operation-service.test.ts test/main/ipc-contract.test.ts test/preload-api.test.ts
git commit -m "feat(operations): track and replace skill sources safely"
```

---

### Task 7: Add third-party repositories to explorer navigation

**Files:**
- Modify: `src/renderer/src/app/types.ts`
- Modify: `src/renderer/src/stores/explorer.ts`
- Modify: `src/renderer/src/components/SourceSidebar.vue`
- Modify: `src/renderer/src/components/ResourceExplorer.vue`
- Modify: `src/renderer/src/styles/app.css`
- Modify: `test/renderer/explorer-store.test.ts`
- Modify: `test/renderer/resource-explorer-vue.test.ts`

**Interfaces:**
- Explorer exposes `thirdPartyRepositories`, `add/update/remove/refreshThirdPartyRepository`.
- Sidebar emits `add-third-party`, `edit-third-party`, `remove-third-party`, and `refresh-third-party`.

- [ ] **Step 1: Write failing store/component tests**

Assert sidebar grouping and source-safe serialization:

```ts
expect(plainSource(externalSource)).toEqual({ kind: 'third-party', repositoryId: 'repo-1' })
expect(screen.getByRole('heading', { name: '第三方仓库' })).toBeVisible()
```

Verify selecting a repository scans only that ID, refresh reloads its assets, standard layout shows group filter, single-Skill layout hides it, and central/project navigation remains unchanged.

- [ ] **Step 2: Run renderer tests to verify RED**

Run: `pnpm exec vitest run test/renderer/explorer-store.test.ts test/renderer/resource-explorer-vue.test.ts`

Expected: no third-party sources or controls exist.

- [ ] **Step 3: Implement store and sidebar grouping**

Load repositories during explorer initialization. Keep top-level Central and Global, project rows, then a labeled third-party section. Repository row menus call emitted actions and stop click propagation.

For third-party headers, replace the central branch selector with a branch badge and reuse the “拉取更新” action. Render `缓存数据 · <time>` when stale.

- [ ] **Step 4: Implement layout-aware filters and action eligibility**

Treat both `central` and `third-party` as installable catalog sources in `AssetList`. Show group filter only for central or `layout === 'catalog'`. Do not show Agent filter on repository sources.

- [ ] **Step 5: Run renderer tests**

Run: `pnpm exec vitest run test/renderer/explorer-store.test.ts test/renderer/resource-explorer-vue.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit explorer navigation**

```bash
git add src/renderer/src/app/types.ts src/renderer/src/stores/explorer.ts src/renderer/src/components/SourceSidebar.vue src/renderer/src/components/ResourceExplorer.vue src/renderer/src/styles/app.css test/renderer
git commit -m "feat(renderer): browse third-party repositories"
```

---

### Task 8: Add repository dialogs and replacement/update UX

**Files:**
- Create: `src/renderer/src/features/repositories/ThirdPartyRepositoryDialog.vue`
- Create: `test/renderer/third-party-repository-dialog-vue.test.ts`
- Modify: `src/renderer/src/App.vue`
- Modify: `src/renderer/src/stores/operation.ts`
- Modify: `src/renderer/src/features/operations/OperationDialog.vue`
- Modify: `src/renderer/src/components/AssetList.vue`
- Modify: `src/renderer/src/components/AssetInstallationStatus.vue`
- Modify: `src/renderer/src/lib/asset-status-label.ts`
- Modify: `src/renderer/src/styles/app.css`
- Modify: `test/renderer/operation-dialog-vue.test.ts`
- Modify: `test/renderer/asset-list-vue.test.ts`

**Interfaces:**
- Dialog emits validated add/update results and never saves before Main validation succeeds.
- Operation store exposes `replaceExistingSource`, structured `sourceConflict`, and third-party copy-only behavior.

- [ ] **Step 1: Write failing dialog and operation tests**

Cover blank branch auto-detection, inferred name, validation loading, first-add failure, edit preserving ID, explicit removal confirmation, copy-only installation, and replacement confirmation text containing old source, new source, and target path.

Assert `source_unavailable` renders “来源已移除”, disables update, retains uninstall/freeze, and exposes “重新关联来源”.

- [ ] **Step 2: Run UI tests to verify RED**

Run:

```bash
pnpm exec vitest run test/renderer/third-party-repository-dialog-vue.test.ts test/renderer/operation-dialog-vue.test.ts test/renderer/asset-list-vue.test.ts
```

Expected: dialog is missing and status/action assertions fail.

- [ ] **Step 3: Implement the repository dialog**

Use Element Plus form controls with fields `Git URL`, `显示名称`, and `分支`. Submit to Main and show the returned layout and Skill count before closing. Keep one visible validation/error region and disable duplicate submissions.

- [ ] **Step 4: Implement operation conflict/relink UX**

Third-party source opening sets method to copy and hides the method selector. Before requesting a plan, call `operations.inspectSourceConflict` with the declarative request. When it returns a conflict, display a replacement card using its old source, new source, and Main-derived target path; require a dedicated checkbox/button that regenerates plans with `replaceExistingSource: true`. Do not parse error message text and do not overload the normal confirm button.

For relink, present registered repositories and exact matching Skills; submit the selected repository/asset IDs and refresh statuses without executing a filesystem operation.

- [ ] **Step 5: Run UI tests and accessibility checks**

Run:

```bash
pnpm exec vitest run test/renderer/third-party-repository-dialog-vue.test.ts test/renderer/operation-dialog-vue.test.ts test/renderer/asset-list-vue.test.ts test/renderer/asset-installation-status-vue.test.ts
```

Expected: all tests pass; dialogs have accessible names and buttons expose loading/disabled states.

- [ ] **Step 6: Commit the repository UX**

```bash
git add src/renderer/src test/renderer
git commit -m "feat(renderer): manage and install third-party skills"
```

---

### Task 9: Refresh the local Core dependency and add end-to-end coverage

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml` if the local package snapshot hash changes
- Modify: `test/e2e/fixtures.ts`
- Modify: `test/e2e/app.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes the committed `xc-skills` 1.3.0 Core build from Task 1 through an immutable Git commit dependency, replacing the machine-local `file:../../Desktop/XcSkill/xc-skills` dependency.
- Produces an Electron workflow covering add, install, refresh, update, removal, and source-unavailable behavior.

- [ ] **Step 1: Publish the Core branch checkpoint and pin the dependency**

Stop here and obtain explicit user authorization to push the Core branch; do not push implicitly. After authorization:

```bash
cd /Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core
git push -u origin codex/xc-skills-core
CORE_SHA=$(git rev-parse HEAD)
cd /Users/xc/Documents/xc_skill_workbench/.worktrees/desktop-implementation
pnpm add "xc-skills@git+https://github.com/lwk-wj/xc-skills.git#$CORE_SHA"
pnpm typecheck
```

Verify `package.json` and `pnpm-lock.yaml` pin the 40-character commit rather than a branch or local path, and `node_modules/xc-skills/dist/core/index.d.ts` contains `RepositoryLayout`, `detectRepositoryLayout`, and `resolveDefaultBranch`. Run a clean frozen-lockfile install in a temporary clone before continuing.

- [ ] **Step 2: Extend the E2E fixture**

Create two temporary Git remotes:

- catalog repository with `backend/skills/team-api/SKILL.md`;
- single-Skill repository with root `SKILL.md` and frontmatter `name: solo-skill`.

Expose their paths through test-only environment injection accepted only when `XC_SKILLS_E2E=1`; production validation remains network URL-only.

- [ ] **Step 3: Write the failing Electron workflow**

Exercise:

```text
add catalog repository -> browse team-api -> install to project Codex
commit changed SKILL.md -> refresh -> see 可更新 -> explicit update -> project content changes
add single-Skill repository -> browse solo-skill without group filter
attempt same-name different-source install -> blocked -> confirm replacement -> source label changes
remove repository -> installed file remains -> 来源已移除 -> update disabled
```

- [ ] **Step 4: Run E2E to verify RED, then complete fixture-only hooks**

Run: `pnpm test:e2e`

Expected before the fixture hook: add rejects local test remotes. Add a Main-only E2E override that maps fixture IDs to absolute paths without accepting arbitrary Renderer paths, then rerun until PASS.

- [ ] **Step 5: Update README**

Document supported repository layouts, Git credential behavior, copy-only installs, manual updates, source replacement, removal semantics, and the “来源已移除” recovery flow. Do not document automatic updates or stored credentials.

- [ ] **Step 6: Run full verification**

Core:

```bash
cd /Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core
npm test
npm run build
git status --short
```

Desktop:

```bash
cd /Users/xc/Documents/xc_skill_workbench/.worktrees/desktop-implementation
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
git diff --check
```

Expected: all commands exit 0, no tracked build artifacts are dirty, and only intentional source/test/docs/lockfile changes remain.

- [ ] **Step 7: Commit integration coverage**

```bash
git add package.json pnpm-lock.yaml test/e2e README.md
git commit -m "test: cover third-party skill repository workflow"
```

- [ ] **Step 8: Review commits without pushing**

```bash
git -C /Users/xc/Documents/xc_skill_workbench/.worktrees/xc-skills-core log --oneline -5
git -C /Users/xc/Documents/xc_skill_workbench/.worktrees/desktop-implementation log --oneline -10
```

Confirm each task produced a focused commit. Push only after the user explicitly requests it.
