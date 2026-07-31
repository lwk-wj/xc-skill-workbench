# Editable Repository Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Do not use subagent-driven development for this task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the five XC Skills repository parameters editable in the Electron settings dialog, validate a candidate source before persisting it, and immediately refresh the central repository after a successful save.

**Architecture:** Add strict shared request/result schemas and expose two narrow repository IPC methods. `CoreService` validates and resolves a candidate configuration before writing the shared CLI config, then atomically swaps its in-memory repository state. A dedicated Vue form owns repository editing while the explorer store refreshes branches and central assets after save.

**Tech Stack:** Electron 43, Vue 3.5, Pinia 4, Element Plus 2.14, TypeScript 5.9, Zod 4, Vitest, Testing Library, Playwright

## Global Constraints

- Continue using `~/.xc-skills-config.json`; do not create a desktop-only repository configuration.
- Do not detect or install a global `xc-skills` CLI.
- Preserve inactive `repoPath` or `remoteUrl` values when switching modes.
- Validate and resolve the candidate repository before persisting or replacing the active in-memory configuration.
- A successful save immediately refreshes central branches and central assets when the central source is visible.
- Do not auto-save while the user is typing.
- Execute inline in the existing isolated worktree; do not use SDD or subagents.

---

### Task 1: Define the editable repository IPC contract

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `test/main/ipc-contract.test.ts`

**Interfaces:**
- Produces: `RepositoryConfigInput`, `RepositoryConfigUpdateResult`, `DesktopApi.repositories.chooseLocalPath()`, and `DesktopApi.repositories.updateConfig(input)`.
- Consumes: existing `XcSkillsConfigSchema` and `RepositoryViewSchema`.

- [ ] **Step 1: Write failing contract tests**

Add tests that parse a valid local and remote request, reject a missing active source and blank branch, normalize groups, and expose the two channel names:

```ts
expect(RepositoryConfigInputSchema.parse({
  mode: 'local',
  repoPath: '/tmp/catalog',
  remoteUrl: 'https://example.com/catalog.git',
  defaultBranch: ' main ',
  defaultGroups: [' backend ', 'backend', ''],
})).toEqual({
  mode: 'local',
  repoPath: '/tmp/catalog',
  remoteUrl: 'https://example.com/catalog.git',
  defaultBranch: 'main',
  defaultGroups: ['backend'],
})

expect(() => RepositoryConfigInputSchema.parse({
  mode: 'remote',
  repoPath: '/tmp/catalog',
  remoteUrl: '',
  defaultBranch: 'main',
  defaultGroups: [],
})).toThrow()

expect(Channels.repositoriesChooseLocalPath).toBe('repositories:chooseLocalPath')
expect(Channels.repositoriesUpdateConfig).toBe('repositories:updateConfig')
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
pnpm exec vitest run test/main/ipc-contract.test.ts
```

Expected: FAIL because `RepositoryConfigInputSchema` and the new channels do not exist.

- [ ] **Step 3: Implement strict schemas and API types**

Add a strict request schema that trims strings, deduplicates groups, and requires the active source:

```ts
const normalizedGroups = z.array(z.string()).transform((groups) =>
  [...new Set(groups.map((group) => group.trim()).filter(Boolean))]
)

export const RepositoryConfigInputSchema = z.object({
  mode: z.enum(['local', 'remote']),
  repoPath: z.string().trim(),
  remoteUrl: z.string().trim(),
  defaultBranch: z.string().trim().min(1, 'default branch required').max(255),
  defaultGroups: normalizedGroups,
}).strict().superRefine((value, ctx) => {
  if (value.mode === 'local' && !value.repoPath) {
    ctx.addIssue({ code: 'custom', path: ['repoPath'], message: 'local repository path required' })
  }
  if (value.mode === 'remote' && !value.remoteUrl) {
    ctx.addIssue({ code: 'custom', path: ['remoteUrl'], message: 'remote repository URL required' })
  }
})

export type RepositoryConfigInput = z.infer<typeof RepositoryConfigInputSchema>

export const RepositoryConfigUpdateResultSchema = z.object({
  config: XcSkillsConfigSchema,
  repository: RepositoryViewSchema,
})
export type RepositoryConfigUpdateResult = z.infer<typeof RepositoryConfigUpdateResultSchema>
```

Extend `DesktopApi.repositories` and `Channels` with:

```ts
chooseLocalPath(): Promise<string | null>
updateConfig(input: RepositoryConfigInput): Promise<RepositoryConfigUpdateResult>
```

- [ ] **Step 4: Run the contract test and verify GREEN**

Run:

```bash
pnpm exec vitest run test/main/ipc-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add src/shared/ipc.ts test/main/ipc-contract.test.ts
git commit -m "feat: define repository configuration contract"
```

---

### Task 2: Validate, persist, and activate repository configuration

**Files:**
- Modify: `src/main/services/core-service.ts`
- Modify: `test/main/core-service.test.ts`

**Interfaces:**
- Consumes: `RepositoryConfigInput`.
- Produces: `CoreService.updateConfig(input): Promise<RepositoryConfigUpdateResult>`.
- Depends on: `readConfig`, `writeConfig`, `resolveRepositorySource`, and `scanAssets` from `xc-skills/core`.

- [ ] **Step 1: Write failing service tests**

Add one success test and two rollback tests. The success test must verify normalization, preservation of unknown CLI fields, candidate validation before writing, and active-state replacement:

```ts
const calls: string[] = []
const service = new CoreService({
  appStore: store,
  configPath,
  cacheRoot,
  core: {
    readConfig: async () => ({ mode: 'local', repoPath: oldRoot, customCliFlag: true }),
    resolveRepositorySource: async (config, branch) => {
      calls.push(`resolve:${config.mode}:${branch}`)
      return { root: newRoot, branch, kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }
    },
    scanAssets: async ({ root }) => {
      calls.push(`scan:${root}`)
      return []
    },
    writeConfig: async (config) => {
      calls.push(`write:${config.repoPath}`)
      expect(config).toMatchObject({ customCliFlag: true, repoPath: newRoot })
    },
  },
})

const result = await service.updateConfig({
  mode: 'local',
  repoPath: newRoot,
  remoteUrl: '',
  defaultBranch: 'main',
  defaultGroups: ['backend'],
})

expect(calls).toEqual([`resolve:local:main`, `scan:${newRoot}`, `write:${newRoot}`])
expect(result.repository.branch).toBe('main')
expect(await service.getConfig()).toMatchObject({ repoPath: newRoot, customCliFlag: true })
```

For candidate resolution and write failures, assert `getConfig()` still returns the old in-memory configuration and `writeConfig` is not called after resolution failure.

- [ ] **Step 2: Run the service test and verify RED**

Run:

```bash
pnpm exec vitest run test/main/core-service.test.ts
```

Expected: FAIL because `CoreService.updateConfig` does not exist.

- [ ] **Step 3: Implement atomic candidate activation**

Add:

```ts
async updateConfig(input: RepositoryConfigInput): Promise<RepositoryConfigUpdateResult> {
  const current = await this.ensureConfig()
  const candidate: XcSkillsConfig = {
    ...current,
    mode: input.mode,
    repoPath: input.repoPath,
    remoteUrl: input.remoteUrl,
    defaultBranch: input.defaultBranch,
    defaultGroups: input.defaultGroups,
  }
  try {
    const repository = await this.core.resolveRepositorySource(candidate, input.defaultBranch, this.cacheRoot)
    await this.core.scanAssets({ root: repository.root })
    await this.core.writeConfig(candidate, this.configPath)
    this.config = candidate
    this.selectedBranch = input.defaultBranch
    this.repository = repository
    this.catalog.clear()
    this.coreCatalog.clear()
    this.metadata.clear()
    this.locations.clear()
    return {
      config: XcSkillsConfigSchema.parse(candidate),
      repository: this.repositoryView(),
    }
  } catch (error) {
    await this.log?.write('error', 'repository configuration update failed', {
      mode: input.mode,
      branch: input.defaultBranch,
      code: typeof error === 'object' && error && 'code' in error ? String(error.code) : 'UNKNOWN',
    })
    throw error
  }
}
```

Import only the shared input/result/config schema types needed by the method. Do not log repository credentials or full URLs.

- [ ] **Step 4: Run service tests and verify GREEN**

Run:

```bash
pnpm exec vitest run test/main/core-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the service**

```bash
git add src/main/services/core-service.ts test/main/core-service.test.ts
git commit -m "feat: atomically update repository configuration"
```

---

### Task 3: Expose repository update and directory selection through IPC

**Files:**
- Modify: `src/main/ipc/register-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `test/main/ipc-contract.test.ts`
- Create: `test/preload-api.test.ts`

**Interfaces:**
- Consumes: `RepositoryConfigInputSchema`, `RepositoryConfigUpdateResultSchema`, `CoreService.updateConfig`.
- Produces: renderer-safe `window.xcSkills.repositories.chooseLocalPath()` and `updateConfig(input)`.

- [ ] **Step 1: Write failing IPC and preload tests**

Register IPC with a fake dialog and service, invoke the captured handlers, and assert:

```ts
expect(await handlers.get(Channels.repositoriesChooseLocalPath)?.({}, undefined)).toBe('/tmp/catalog')
expect(updateConfig).toHaveBeenCalledWith({
  mode: 'remote',
  repoPath: '/tmp/catalog',
  remoteUrl: 'https://example.com/catalog.git',
  defaultBranch: 'main',
  defaultGroups: ['backend'],
})
```

Add a cancellation case returning `null`, an invalid input case rejected by the schema, and preload forwarding assertions for both methods.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/main/ipc-contract.test.ts test/preload-api.test.ts
```

Expected: FAIL because the handlers and preload methods are missing.

- [ ] **Step 3: Implement the handlers and preload methods**

Extend `IpcServices` and `coreBindings`:

```ts
updateConfig?: (input: RepositoryConfigInput) => Promise<RepositoryConfigUpdateResult>
```

Register:

```ts
invoke(Channels.repositoriesChooseLocalPath, noInput, async () => {
  if (!dialog) return null
  const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  return picked.canceled || !picked.filePaths[0] ? null : picked.filePaths[0]
})

invoke(Channels.repositoriesUpdateConfig, RepositoryConfigInputSchema, async (input) => {
  const result = services.updateConfig
    ? await services.updateConfig(input)
    : unsupported('repositories.updateConfig')
  return RepositoryConfigUpdateResultSchema.parse(result)
})
```

Forward both calls from preload through the new channels.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run test/main/ipc-contract.test.ts test/preload-api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the IPC surface**

```bash
git add src/main/ipc/register-ipc.ts src/preload/index.ts test/main/ipc-contract.test.ts test/preload-api.test.ts
git commit -m "feat: expose repository configuration IPC"
```

---

### Task 4: Build the editable repository form

**Files:**
- Create: `src/renderer/src/features/settings/RepositoryConfigForm.vue`
- Modify: `src/renderer/src/features/settings/SettingsDialog.vue`
- Modify: `test/renderer/settings-vue.test.ts`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: initial `XcSkillsConfig` prop and `window.xcSkills.repositories.chooseLocalPath/updateConfig`.
- Produces: `saved(config: XcSkillsConfig)` event.

- [ ] **Step 1: Write failing Vue interaction tests**

Cover remote/local conditional fields, directory selection, group normalization, dirty state, successful save, and retained input after failure:

```ts
renderTestApp(RepositoryConfigForm, {
  props: {
    config: {
      mode: 'remote',
      repoPath: '/tmp/local',
      remoteUrl: 'https://example.com/old.git',
      defaultBranch: 'main',
      defaultGroups: ['backend'],
    },
    onSaved,
  },
})

expect(screen.getByLabelText('远程仓库 URL')).toBeInTheDocument()
expect(screen.queryByLabelText('本地仓库路径')).not.toBeInTheDocument()

await user.click(screen.getByRole('radio', { name: '本地' }))
expect(screen.getByLabelText('本地仓库路径')).toHaveValue('/tmp/local')
await user.click(screen.getByRole('button', { name: '选择文件夹' }))
expect(screen.getByLabelText('本地仓库路径')).toHaveValue('/tmp/chosen')
await user.click(screen.getByRole('button', { name: '保存并刷新' }))

expect(window.xcSkills.repositories.updateConfig).toHaveBeenCalledWith({
  mode: 'local',
  repoPath: '/tmp/chosen',
  remoteUrl: 'https://example.com/old.git',
  defaultBranch: 'main',
  defaultGroups: ['backend'],
})
```

Assert the save button is disabled before changes and while the promise is pending. On rejection, assert an alert is visible and the edited value remains.

- [ ] **Step 2: Run the Vue test and verify RED**

Run:

```bash
pnpm exec vitest run test/renderer/settings-vue.test.ts
```

Expected: FAIL because `RepositoryConfigForm.vue` does not exist.

- [ ] **Step 3: Implement the Element Plus form**

Create a focused component with:

```ts
const props = defineProps<{ config: XcSkillsConfig }>()
const emit = defineEmits<{ saved: [config: XcSkillsConfig] }>()
const form = reactive<RepositoryConfigInput>(toEditableConfig(props.config))
const saving = ref(false)
const error = ref<unknown>(null)
const saved = ref(false)
const dirty = computed(() => JSON.stringify(normalize(form)) !== JSON.stringify(normalize(toEditableConfig(props.config))))
```

Use:

- `ElRadioGroup` for mode.
- `ElInput` plus an appended `ElButton` for the local path.
- `ElInput` for remote URL and default branch.
- `ElSelect` with `multiple`, `filterable`, `allow-create`, and `default-first-option` for groups.
- `ElAlert` or the existing `ErrorNotice` for errors and a compact success state.
- `ElButton type="primary"` labelled “保存并刷新”.

Keep inactive source fields in `form`. Validate active source and branch before calling IPC. On success, replace the local baseline with the returned config, clear the dirty state, and emit `saved`.

Replace the read-only `<dl>` in `SettingsDialog.vue` with:

```vue
<RepositoryConfigForm :config="config" @saved="handleRepositorySaved" />
```

and add:

```ts
const emit = defineEmits<{ agentsChanged: []; repositoryChanged: [] }>()
const handleRepositorySaved = (next: XcSkillsConfig): void => {
  config.value = next
  emit('repositoryChanged')
}
```

Style the form to match the existing light/dark settings dialog, with aligned labels, full-width source fields, compact help text, and responsive stacking below 640px.

- [ ] **Step 4: Run Vue tests and verify GREEN**

Run:

```bash
pnpm exec vitest run test/renderer/settings-vue.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the settings form**

```bash
git add src/renderer/src/features/settings/RepositoryConfigForm.vue src/renderer/src/features/settings/SettingsDialog.vue src/renderer/src/styles.css test/renderer/settings-vue.test.ts
git commit -m "feat: edit repository settings"
```

---

### Task 5: Refresh explorer state immediately after save

**Files:**
- Modify: `src/renderer/src/stores/explorer.ts`
- Modify: `src/renderer/src/App.vue`
- Modify: `test/renderer/explorer-store.test.ts`
- Modify: `test/e2e/app.spec.ts`

**Interfaces:**
- Consumes: `SettingsDialog.repositoryChanged`.
- Produces: `explorer.refreshRepository()` that reloads branches and refreshes central assets only when central is selected.

- [ ] **Step 1: Write failing store and E2E tests**

For the store:

```ts
await explorer.initialize()
await explorer.refreshRepository()

expect(window.xcSkills.repositories.listBranches).toHaveBeenCalledTimes(2)
expect(window.xcSkills.assets.scan).toHaveBeenLastCalledWith({ kind: 'central' })
```

Add a non-central case proving the active project asset list is not replaced. In E2E, open Settings, switch the configured local repository to a second temporary fixture, save, and assert the central list shows the second fixture asset without restarting the app.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/renderer/explorer-store.test.ts
pnpm exec playwright test test/e2e/app.spec.ts
```

Expected: FAIL because `refreshRepository` and the save event wiring do not exist.

- [ ] **Step 3: Implement refresh wiring**

Add to the explorer store:

```ts
const refreshRepository = async (): Promise<void> => {
  try {
    await loadBranches()
    if (selectedSource.value.kind === 'central') await scan(selectedSource.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '刷新中央仓库失败'
  }
}
```

Expose it from the store and wire:

```vue
<SettingsDialog
  v-model="settingsOpen"
  @agents-changed="explorer.refreshAgents()"
  @repository-changed="explorer.refreshRepository()"
/>
```

Extend the E2E fixture to create two local catalog repositories without sharing user state outside the temporary test root.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run test/renderer/explorer-store.test.ts
pnpm exec playwright test test/e2e/app.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit refresh behavior**

```bash
git add src/renderer/src/stores/explorer.ts src/renderer/src/App.vue test/renderer/explorer-store.test.ts test/e2e/app.spec.ts test/e2e/fixtures.ts
git commit -m "feat: refresh repository after configuration save"
```

---

### Task 6: Verify the complete desktop application

**Files:**
- Modify only files required by failures found during verification.

**Interfaces:**
- Verifies the complete configuration flow across shared schemas, main process, preload, Vue renderer, and Electron E2E.

- [ ] **Step 1: Run the full unit and component suite**

```bash
pnpm test
```

Expected: all test files pass with zero failures.

- [ ] **Step 2: Run type checking**

```bash
pnpm typecheck
```

Expected: both Node and Vue TypeScript checks exit successfully.

- [ ] **Step 3: Run the Electron E2E suite**

```bash
pnpm test:e2e
```

Expected: all Playwright tests pass.

- [ ] **Step 4: Run the production build**

```bash
pnpm build
```

Expected: main, preload, and renderer bundles build successfully.

- [ ] **Step 5: Inspect final changes**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and no unrelated files.

- [ ] **Step 6: Commit any verification-only fixes**

If verification required code changes, stage only those files and commit:

```bash
git commit -m "fix: finalize repository configuration flow"
```

If no files changed, do not create an empty commit.
