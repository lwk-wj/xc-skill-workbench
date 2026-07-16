# XC Skills Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS-first Electron application that safely browses and manages Skills, Rules, and Workflows across the central repository, global Agent installations, and explicitly registered projects while sharing core behavior with the existing `xc-skills` CLI.

**Architecture:** Extract prompt-free scanning, status, config, repository, and operation logic into `xc-skills/core`, then consume that API from the existing CLI and from an Electron main process. The renderer is a React three-pane resource explorer behind a typed, runtime-validated preload IPC boundary; it never accesses Node.js or Git directly.

**Tech Stack:** Node.js 22.12.0, pnpm 10.24.0, TypeScript 5.9.3, Electron 43.1.1, electron-vite 5.0.0, Vite 7.3.6, React 19.2.7, Zod 4.4.3, Zustand 5.0.14, Vitest 4.1.10, Playwright 1.61.1, electron-builder 26.15.3.

## Global Constraints

- Work in isolated worktrees created with `superpowers:using-git-worktrees` when execution begins.
- CLI repository root: `/Users/xc/Desktop/XcSkill/xc-skills`.
- Desktop repository root: `/Users/xc/Documents/xc_skill_workbench`.
- Re-run `git status --short` in both repositories before every task; preserve all user changes and stop if a planned edit overlaps them.
- macOS is the only packaged platform in V1; path and domain types must remain cross-platform.
- Keep existing CLI command names, flags, aliases, and interactive defaults compatible.
- Do not add a manifest or desktop metadata file to business projects.
- Browsing, searching, filtering, and listing branches must not modify a project or the configured central repository working tree.
- Never run `git checkout`, `git reset`, or `git clean` against the configured central repository.
- Renderer security is non-negotiable: `contextIsolation: true`, `nodeIntegration: false`, sandbox enabled, and a minimal preload API.
- Git commands use `spawn`/`execFile` argument arrays with `GIT_TERMINAL_PROMPT=0`; no shell-composed command strings.
- Every filesystem mutation starts with an operation plan, shows exact affected paths, runs atomically where possible, and rolls back on failure.
- Remote and cached alternate-branch assets support copy installation only. Symlinks are allowed only when the selected branch equals the local central repository checkout.
- Freeze only Skills at a concrete installation location by renaming `SKILL.md` to `SKILL.md.xc-disabled`.
- Use TDD for every behavior: write a focused failing test, verify the expected failure, implement the minimum behavior, then verify the focused and affected suites.
- Pin exact dependency versions in both lockfiles; do not use `latest`, `*`, or unbounded ranges.

## Repository and File Map

### Existing CLI repository

- `package.json` — scripts, test dependencies, `xc-skills/core` subpath export.
- `tsconfig.json` — include tests only through Vitest, keep production output in `dist`.
- `vitest.config.ts` — Node test environment and deterministic test timeouts.
- `src/core/types.ts` — stable domain contracts shared by CLI and desktop.
- `src/core/errors.ts` — structured error codes and safe serialization.
- `src/core/scanner.ts` — Skills/Rules/Workflows discovery and detail loading.
- `src/core/hash.ts` — deterministic normalized content hashing.
- `src/core/status.ts` — per-location status evaluation.
- `src/core/config.ts` — schema validation and atomic shared-config writes.
- `src/core/agents.ts` — built-in Agent definitions and path resolution.
- `src/core/git.ts` — safe Git process adapter.
- `src/core/repository.ts` — branch listing and cache/source resolution.
- `src/core/operations/plan.ts` — read-only mutation planning and path validation.
- `src/core/operations/execute.ts` — atomic copy/link/remove/freeze/thaw execution and rollback.
- `src/core/index.ts` — public `xc-skills/core` entry point.
- `src/types.ts`, `src/agents.ts`, `src/utils.ts`, `src/install.ts` — compatibility adapters over Core.
- `src/commands/config.ts`, `src/commands/list.ts`, `src/commands/pull.ts` — Core-backed CLI commands.
- `test/core/*.test.ts` — domain unit tests.
- `test/integration/*.test.ts` — temporary-directory and temporary-Git-repository tests.
- `test/cli/*.test.ts` — CLI compatibility tests.

### Desktop repository

- `package.json`, `pnpm-lock.yaml` — pinned application dependencies and scripts.
- `electron.vite.config.ts`, `tsconfig*.json`, `vitest.config.ts` — build and test configuration.
- `electron-builder.yml` — unsigned macOS DMG/ZIP packaging.
- `src/shared/ipc.ts` — runtime schemas, channel constants, and `DesktopApi` contract.
- `src/main/index.ts`, `src/main/window.ts` — application lifecycle and hardened BrowserWindow.
- `src/main/ipc/register-ipc.ts` — validated IPC handlers.
- `src/main/services/app-store.ts` — atomic userData state for projects, Agents, theme, and window bounds.
- `src/main/services/core-service.ts` — `xc-skills/core` orchestration and operation task registry.
- `src/main/services/log-service.ts` — redacted local structured logs.
- `src/preload/index.ts` — narrow `contextBridge` implementation.
- `src/renderer/index.html`, `src/renderer/src/main.tsx` — renderer entry.
- `src/renderer/src/app/App.tsx`, `src/renderer/src/app/store.ts` — shell and renderer state.
- `src/renderer/src/components/*.tsx` — sidebar, asset list, details, status, branch selection.
- `src/renderer/src/features/projects/*.tsx` — project registration UI.
- `src/renderer/src/features/operations/*.tsx` — install/update/uninstall/freeze/thaw planning UI.
- `src/renderer/src/features/settings/*.tsx` — theme, repository, and custom-Agent settings.
- `src/renderer/src/lib/markdown.ts` — safe Markdown rendering.
- `src/renderer/src/styles/*.css` — semantic light/dark tokens and layout.
- `test/e2e/*.spec.ts` — Playwright Electron flows.

---

### Task 1: Establish the Core Public Contract and Test Harness

**Files:**
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/package.json`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/tsconfig.json`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/vitest.config.ts`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/types.ts`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/errors.ts`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/index.ts`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/test/core/public-api.test.ts`

**Interfaces:**
- Consumes: existing `AssetType` and `ASSET_CONFIG` semantics from `src/types.ts`.
- Produces: `AssetRecord`, `AssetDetail`, `AssetStatusRecord`, `AgentDefinition`, `XcSkillsConfig`, `RepositorySource`, `OperationPlan`, `OperationResult`, `CoreError`, and the `xc-skills/core` package export used by every later task.

- [ ] **Step 1: Record the clean baseline**

Run:

```bash
cd /Users/xc/Desktop/XcSkill/xc-skills
git status --short
npm run build
```

Expected: status is empty and the existing CLI build exits 0. If status is non-empty, record the paths and avoid overlapping edits.

- [ ] **Step 2: Add a failing public-contract test**

Create `test/core/public-api.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ASSET_CONFIG, CoreError, type AssetStatus } from '../../src/core/index.js'

describe('core public API', () => {
  it('exports stable asset configuration and structured errors', () => {
    const status: AssetStatus = 'frozen'
    const error = new CoreError('INVALID_PATH', 'Path is outside an allowed root', {
      path: '/tmp/outside',
    })

    expect(ASSET_CONFIG.skills.installDir).toBe('skills')
    expect(status).toBe('frozen')
    expect(error.toJSON()).toEqual({
      code: 'INVALID_PATH',
      message: 'Path is outside an allowed root',
      details: { path: '/tmp/outside' },
    })
  })
})
```

- [ ] **Step 3: Run the focused test and verify the expected failure**

Run: `pnpm vitest run test/core/public-api.test.ts`

Expected: FAIL because `src/core/index.ts` and the exported types do not exist.

- [ ] **Step 4: Add the Core contract and error implementation**

Create `src/core/types.ts` with these exact public discriminants and fields:

```ts
export type AssetType = 'skills' | 'rules' | 'workflows'
export type AssetEntryState = 'active' | 'frozen' | 'conflict' | 'invalid'
export type AssetStatus =
  | 'not_installed'
  | 'current'
  | 'update_available'
  | 'locally_modified'
  | 'frozen'
  | 'broken_link'
  | 'conflict'
  | 'invalid'
  | 'unknown'

export interface AssetConfig {
  label: string
  needsEvolution: boolean
  needsTag: boolean
  installDir: string
  isFolder: boolean
}

export const ASSET_CONFIG: Record<AssetType, AssetConfig> = {
  skills: { label: '技能 (Skills)', needsEvolution: true, needsTag: true, installDir: 'skills', isFolder: true },
  rules: { label: '规则 (Rules)', needsEvolution: false, needsTag: false, installDir: 'rules', isFolder: false },
  workflows: { label: '工作流 (Workflows)', needsEvolution: false, needsTag: false, installDir: 'workflows', isFolder: false },
}

export interface AssetRecord {
  id: string
  name: string
  type: AssetType
  group: string
  path: string
  entryPath: string
  entryState: AssetEntryState
  description: string
  version: string | null
}

export interface AssetFile {
  relativePath: string
  size: number
  kind: 'text' | 'binary'
}

export interface AssetDetail extends AssetRecord {
  markdown: string | null
  evolution: string | null
  files: AssetFile[]
}

export interface AssetStatusRecord {
  status: AssetStatus
  updateAvailable: boolean
  locallyModified: boolean
  sourceHash: string | null
  installedHash: string | null
  sourceVersion: string | null
  installedVersion: string | null
  resolvedTarget: string | null
  reason: string
}

export interface AgentDefinition {
  id: string
  name: string
  projectBaseDir: string
  globalBaseDir: string
  assetDirs: Record<AssetType, string>
  builtIn: boolean
  enabled: boolean
}

export interface XcSkillsConfig extends Record<string, unknown> {
  mode?: 'local' | 'remote'
  repoPath?: string
  remoteUrl?: string
  defaultBranch?: string
  defaultGroups?: string[]
}

export interface RepositoryBranch { name: string; current: boolean; default: boolean; remote: boolean }
export interface RepositorySource {
  root: string
  branch: string
  kind: 'local-worktree' | 'branch-cache'
  allowSymlink: boolean
  stale: boolean
  cachedAt: string | null
}

export type OperationKind = 'install' | 'update' | 'uninstall' | 'freeze' | 'thaw'
export type InstallMethod = 'copy' | 'symlink'
export interface OperationStep {
  kind: 'ensure_dir' | 'copy' | 'symlink' | 'backup' | 'remove' | 'rename'
  source?: string
  target: string
}
export interface OperationPlan {
  id: string
  kind: OperationKind
  asset: Pick<AssetRecord, 'id' | 'name' | 'type' | 'path'>
  sourceBranch: string
  sourceHash: string
  targetRoot: string
  targetPath: string
  method: InstallMethod | null
  steps: OperationStep[]
  warnings: string[]
  requiresOverwriteConfirmation: boolean
}
export interface OperationProgress { planId: string; completed: number; total: number; message: string }
export interface OperationResult {
  planId: string
  status: 'completed' | 'cancelled' | 'rolled_back' | 'needs_attention'
  affectedPaths: string[]
  residualPaths: string[]
}
```

Create `src/core/errors.ts`:

```ts
export type CoreErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_PATH'
  | 'INVALID_ASSET'
  | 'PERMISSION_DENIED'
  | 'BROKEN_LINK'
  | 'ENTRY_CONFLICT'
  | 'GIT_FAILED'
  | 'NETWORK_FAILED'
  | 'SOURCE_CHANGED'
  | 'OPERATION_CANCELLED'
  | 'ROLLBACK_FAILED'

export class CoreError extends Error {
  constructor(
    public readonly code: CoreErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'CoreError'
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details }
  }
}
```

Create `src/core/index.ts`:

```ts
export * from './types.js'
export * from './errors.js'
```

- [ ] **Step 5: Configure Vitest and the package subpath export**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    restoreMocks: true,
  },
})
```

Update `package.json` so the relevant fields are exactly:

```json
{
  "type": "module",
  "bin": { "xc-skills": "./dist/cli.js" },
  "exports": {
    "./core": {
      "types": "./dist/core/index.d.ts",
      "import": "./dist/core/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "dev": "tsup src/cli.ts src/core/index.ts --watch --format esm",
    "build": "tsup src/cli.ts src/core/index.ts --format esm --clean --minify --dts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "22.20.1",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  }
}
```

Preserve all existing dependencies and metadata not shown above. Keep `tsconfig.json` production include as `['src']`; Vitest transpiles tests independently.

- [ ] **Step 6: Verify the contract, declaration output, and package contents**

Run:

```bash
pnpm install
pnpm test -- test/core/public-api.test.ts
pnpm build
npm pack --dry-run
```

Expected: focused test PASS; build exits 0; dry-run output contains `dist/core/index.js` and `dist/core/index.d.ts`.

- [ ] **Step 7: Commit the Core contract**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts src/core test/core/public-api.test.ts
git commit -m "feat(core): establish public API contract"
```

### Task 2: Implement Asset Scanning and Safe Detail Loading

**Files:**
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/scanner.ts`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/index.ts`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/test/helpers/fixtures.ts`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/test/core/scanner.test.ts`

**Interfaces:**
- Consumes: `AssetRecord`, `AssetDetail`, `AssetType`, and `ASSET_CONFIG` from Task 1.
- Produces: `scanAssets(options: ScanAssetsOptions): Promise<AssetRecord[]>`, `readAssetDetail(asset: AssetRecord): Promise<AssetDetail>`.

- [ ] **Step 1: Write scanner fixtures and failing tests**

Create `test/helpers/fixtures.ts`:

```ts
import fs from 'fs-extra'
import { join } from 'node:path'

export async function createRepositoryFixture(root: string) {
  await fs.outputFile(join(root, 'common/skills/design-audit/SKILL.md'), '---\ndescription: Audit UI\n---\n# Audit')
  await fs.outputFile(join(root, 'common/skills/design-audit/EVOLUTION.md'), '# History\n\n## v2.1.0 — 2026-07-16')
  await fs.outputFile(join(root, 'backend/rules/api.md'), '# API Rule')
  await fs.outputFile(join(root, 'common/workflows/release.md'), '# Release')
  await fs.outputFile(join(root, 'common/skills/frozen/SKILL.md.xc-disabled'), '# Frozen')
  await fs.outputFile(join(root, 'common/skills/conflict/SKILL.md'), '# Active')
  await fs.outputFile(join(root, 'common/skills/conflict/SKILL.md.xc-disabled'), '# Disabled')
}
```

Create `test/core/scanner.test.ts`:

```ts
import fs from 'fs-extra'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readAssetDetail, scanAssets } from '../../src/core/index.js'
import { createRepositoryFixture } from '../helpers/fixtures.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.remove(root))))

describe('scanAssets', () => {
  it('discovers grouped assets and frozen/conflicting skill entries', async () => {
    const root = await fs.mkdtemp(join(os.tmpdir(), 'xc-scan-'))
    roots.push(root)
    await createRepositoryFixture(root)

    const assets = await scanAssets({ root })

    expect(assets.map(({ name, type, group, entryState }) => ({ name, type, group, entryState }))).toEqual([
      { name: 'api.md', type: 'rules', group: 'backend', entryState: 'active' },
      { name: 'conflict', type: 'skills', group: 'common', entryState: 'conflict' },
      { name: 'design-audit', type: 'skills', group: 'common', entryState: 'active' },
      { name: 'frozen', type: 'skills', group: 'common', entryState: 'frozen' },
      { name: 'release.md', type: 'workflows', group: 'common', entryState: 'active' },
    ])

    const detail = await readAssetDetail(assets.find((asset) => asset.name === 'design-audit')!)
    expect(detail.markdown).toContain('# Audit')
    expect(detail.version).toBe('v2.1.0')
    expect(detail.files.map((file) => file.relativePath)).toEqual(['EVOLUTION.md', 'SKILL.md'])
  })
})
```

- [ ] **Step 2: Verify scanner tests fail**

Run: `pnpm vitest run test/core/scanner.test.ts`

Expected: FAIL because `scanAssets` and `readAssetDetail` are not exported.

- [ ] **Step 3: Implement deterministic scanning**

Create `src/core/scanner.ts` with the following public contract and rules:

```ts
import fs from 'fs-extra'
import { basename, join, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { CoreError } from './errors.js'
import type { AssetDetail, AssetEntryState, AssetFile, AssetRecord, AssetType } from './types.js'

export interface ScanAssetsOptions {
  root: string
  types?: AssetType[]
  groups?: string[]
}

const TYPE_DIRS = new Set<AssetType>(['skills', 'rules', 'workflows'])
const TEXT_LIMIT = 1024 * 1024

function parseDescription(content: string) {
  return content.match(/^description:\s*['"]?([^'"\n\r]+)['"]?$/m)?.[1]?.trim() ?? ''
}

function parseVersion(content: string | null) {
  return content?.match(/^##\s*(v\d+\.\d+\.\d+)\s*[—-]\s*\d{4}-\d{2}-\d{2}/m)?.[1] ?? null
}

function assetId(type: AssetType, group: string, name: string) {
  return createHash('sha256').update(`${type}\0${group}\0${name}`).digest('hex').slice(0, 16)
}

async function entryState(directory: string): Promise<{ state: AssetEntryState; entryPath: string }> {
  const active = join(directory, 'SKILL.md')
  const frozen = join(directory, 'SKILL.md.xc-disabled')
  const [hasActive, hasFrozen] = await Promise.all([fs.pathExists(active), fs.pathExists(frozen)])
  if (hasActive && hasFrozen) return { state: 'conflict', entryPath: active }
  if (hasFrozen) return { state: 'frozen', entryPath: frozen }
  if (hasActive) return { state: 'active', entryPath: active }
  return { state: 'invalid', entryPath: active }
}

export async function scanAssets(options: ScanAssetsOptions): Promise<AssetRecord[]> {
  const root = resolve(options.root)
  if (!(await fs.pathExists(root))) throw new CoreError('INVALID_PATH', 'Scan root does not exist', { root })
  const types = new Set(options.types ?? ['skills', 'rules', 'workflows'])
  const allowedGroups = options.groups ? new Set(options.groups) : null
  const assets: AssetRecord[] = []

  async function walk(directory: string, group = ''): Promise<void> {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    const directoryName = basename(directory) as AssetType
    if (TYPE_DIRS.has(directoryName) && types.has(directoryName)) {
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const path = join(directory, entry.name)
        if (directoryName === 'skills' && (entry.isDirectory() || entry.isSymbolicLink())) {
          const { state, entryPath } = await entryState(path)
          if (state === 'invalid') continue
          const markdown = await fs.readFile(entryPath, 'utf8').catch(() => '')
          const evolution = await fs.readFile(join(path, 'EVOLUTION.md'), 'utf8').catch(() => null)
          assets.push({ id: assetId(directoryName, group, entry.name), name: entry.name, type: directoryName, group, path, entryPath, entryState: state, description: parseDescription(markdown), version: parseVersion(evolution) })
        } else if (directoryName !== 'skills' && (entry.isFile() || entry.isSymbolicLink())) {
          assets.push({ id: assetId(directoryName, group, entry.name), name: entry.name, type: directoryName, group, path, entryPath: path, entryState: 'active', description: '', version: null })
        }
      }
      return
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || !entry.isDirectory()) continue
      const isTypeDirectory = TYPE_DIRS.has(entry.name as AssetType)
      const nextGroup = isTypeDirectory ? group : (group || entry.name)
      if (!allowedGroups || !nextGroup || allowedGroups.has(nextGroup) || isTypeDirectory) await walk(join(directory, entry.name), nextGroup)
    }
  }

  await walk(root)
  return assets.sort((a, b) => `${a.type}/${a.group}/${a.name}`.localeCompare(`${b.type}/${b.group}/${b.name}`))
}

async function listFiles(root: string): Promise<AssetFile[]> {
  const result: AssetFile[] = []
  async function walk(directory: string) {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git' || entry.name === 'history') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else {
        const stat = await fs.stat(path)
        result.push({ relativePath: relative(root, path).split(sep).join('/'), size: stat.size, kind: stat.size <= TEXT_LIMIT ? 'text' : 'binary' })
      }
    }
  }
  await walk(root)
  return result
}

export async function readAssetDetail(asset: AssetRecord): Promise<AssetDetail> {
  const markdown = asset.type === 'skills' ? await fs.readFile(asset.entryPath, 'utf8') : await fs.readFile(asset.path, 'utf8')
  const evolution = asset.type === 'skills' ? await fs.readFile(join(asset.path, 'EVOLUTION.md'), 'utf8').catch(() => null) : null
  const files = asset.type === 'skills' ? await listFiles(asset.path) : [{ relativePath: basename(asset.path), size: Buffer.byteLength(markdown), kind: 'text' as const }]
  return { ...asset, markdown, evolution, files }
}
```

Export the two functions and `ScanAssetsOptions` from `src/core/index.ts`.

- [ ] **Step 4: Run focused tests and type/build checks**

Run:

```bash
pnpm vitest run test/core/scanner.test.ts
pnpm build
```

Expected: scanner test PASS and build exits 0.

- [ ] **Step 5: Commit scanner behavior**

```bash
git add src/core/scanner.ts src/core/index.ts test/helpers/fixtures.ts test/core/scanner.test.ts
git commit -m "feat(core): scan assets and load details"
```

### Task 3: Add Deterministic Hashing and Installation Status

**Files:**
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/hash.ts`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/status.ts`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/index.ts`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/test/core/status.test.ts`

**Interfaces:**
- Consumes: `AssetRecord`, `AssetStatusRecord`, scanner entry-state semantics.
- Produces: `hashAsset(asset: AssetRecord): Promise<string>`, `evaluateAssetStatus(source: AssetRecord, installedPath: string): Promise<AssetStatusRecord>`.

- [ ] **Step 1: Write failing status tests**

Create `test/core/status.test.ts` with cases for missing, current copy, frozen copy, broken link, newer source version, and same-version modified content:

```ts
import fs from 'fs-extra'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluateAssetStatus, scanAssets } from '../../src/core/index.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.remove(root))))

describe('evaluateAssetStatus', () => {
  it('distinguishes current, frozen, update-available, and locally modified copies', async () => {
    const root = await fs.mkdtemp(join(os.tmpdir(), 'xc-status-'))
    roots.push(root)
    const sourceRoot = join(root, 'source')
    const targetRoot = join(root, 'target')
    await fs.outputFile(join(sourceRoot, 'skills/demo/SKILL.md'), '# Demo')
    await fs.outputFile(join(sourceRoot, 'skills/demo/EVOLUTION.md'), '## v2.0.0 — 2026-07-16')
    const source = (await scanAssets({ root: sourceRoot }))[0]

    expect((await evaluateAssetStatus(source, join(targetRoot, 'missing'))).status).toBe('not_installed')

    await fs.copy(source.path, join(targetRoot, 'current'))
    expect((await evaluateAssetStatus(source, join(targetRoot, 'current'))).status).toBe('current')

    await fs.copy(source.path, join(targetRoot, 'frozen'))
    await fs.rename(join(targetRoot, 'frozen/SKILL.md'), join(targetRoot, 'frozen/SKILL.md.xc-disabled'))
    expect(await evaluateAssetStatus(source, join(targetRoot, 'frozen'))).toMatchObject({ status: 'frozen', updateAvailable: false, locallyModified: false })

    await fs.copy(source.path, join(targetRoot, 'older'))
    await fs.writeFile(join(targetRoot, 'older/EVOLUTION.md'), '## v1.0.0 — 2026-01-01')
    expect((await evaluateAssetStatus(source, join(targetRoot, 'older'))).status).toBe('update_available')

    await fs.copy(source.path, join(targetRoot, 'modified'))
    await fs.writeFile(join(targetRoot, 'modified/SKILL.md'), '# Local edit')
    expect((await evaluateAssetStatus(source, join(targetRoot, 'modified'))).status).toBe('locally_modified')
  })
})
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm vitest run test/core/status.test.ts`

Expected: FAIL because the status functions are missing.

- [ ] **Step 3: Implement normalized hashes and conservative status rules**

Implement `src/core/hash.ts` so it sorts POSIX-style relative paths, follows file symlinks, normalizes `SKILL.md.xc-disabled` to `SKILL.md`, and excludes `.git`, `history`, `.DS_Store`, and `PENDING_SYNC.md`:

```ts
import fs from 'fs-extra'
import { createHash } from 'node:crypto'
import { basename, join, relative, sep } from 'node:path'
import type { AssetRecord } from './types.js'

const EXCLUDED = new Set(['.git', 'history', '.DS_Store', 'PENDING_SYNC.md'])

export async function hashAsset(asset: AssetRecord): Promise<string> {
  const hash = createHash('sha256')
  const root = asset.type === 'skills' ? asset.path : undefined
  const files: string[] = []
  async function collect(path: string): Promise<void> {
    const stat = await fs.stat(path)
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(path)).sort()) if (!EXCLUDED.has(name)) await collect(join(path, name))
    } else files.push(path)
  }
  await collect(asset.path)
  for (const path of files.sort()) {
    const rawName = root ? relative(root, path).split(sep).join('/') : basename(path)
    const name = rawName === 'SKILL.md.xc-disabled' ? 'SKILL.md' : rawName
    hash.update(name).update('\0').update(await fs.readFile(path)).update('\0')
  }
  return hash.digest('hex')
}
```

Implement `src/core/status.ts` with this decision order: missing, entry conflict, broken symlink, exact hash, version difference, then conservative local modification. Build an installed `AssetRecord` from the target entry and reuse `hashAsset`; do not infer `update_available` for Rules/Workflows without version proof. Frozen is orthogonal to version/modified flags: return `status: 'frozen'` while setting `updateAvailable` or `locallyModified` accurately, so the UI can show `已冻结 · 可更新` without losing the disabled state.

All missing/conflict/broken/invalid early returns set both booleans to `false`. Use this final decision core after installed-entry inspection:

```ts
const base = {
  sourceHash,
  installedHash,
  sourceVersion: source.version,
  installedVersion: installed.version,
  resolvedTarget,
}
const frozen = installed.entryState === 'frozen'
if (sourceHash === installedHash) {
  return { ...base, status: frozen ? 'frozen' : 'current', updateAvailable: false, locallyModified: false, reason: '内容与当前中央分支一致' }
}
if (source.version && installed.version && source.version !== installed.version) {
  return { ...base, status: frozen ? 'frozen' : 'update_available', updateAvailable: true, locallyModified: false, reason: `已安装 ${installed.version}，中央分支为 ${source.version}` }
}
return { ...base, status: frozen ? 'frozen' : 'locally_modified', updateAvailable: false, locallyModified: true, reason: '内容不同且没有可证明的旧版本' }
```

- [ ] **Step 4: Verify status behavior and all Core tests**

Run:

```bash
pnpm vitest run test/core/status.test.ts
pnpm test
pnpm build
```

Expected: all tests PASS and build exits 0.

- [ ] **Step 5: Commit status behavior**

```bash
git add src/core/hash.ts src/core/status.ts src/core/index.ts test/core/status.test.ts
git commit -m "feat(core): evaluate asset installation status"
```

### Task 4: Add Shared Config and Agent Definitions

**Files:**
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/config.ts`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/agents.ts`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/index.ts`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/package.json`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/test/core/config.test.ts`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/test/core/agents.test.ts`

**Interfaces:**
- Consumes: `XcSkillsConfig`, `AgentDefinition`, `AssetType`.
- Produces: `readConfig`, `writeConfig`, `setDefaultBranch`, `BUILTIN_AGENTS`, `resolveAgentAssetRoot`.

- [ ] **Step 1: Write failing config and Agent tests**

Test that unknown JSON keys survive a default-branch update, invalid fields raise `INVALID_CONFIG`, built-in IDs are stable, and project/global roots resolve exactly.

```ts
const original = { mode: 'local', repoPath: '/repo', defaultBranch: 'main', companyKey: 7 }
await fs.writeJson(configPath, original)
await setDefaultBranch('feature/demo', configPath)
expect(await fs.readJson(configPath)).toEqual({ ...original, defaultBranch: 'feature/demo' })

expect(resolveAgentAssetRoot(BUILTIN_AGENTS.find((agent) => agent.id === 'codex')!, 'project', '/project', 'skills'))
  .toBe(join('/project', '.codex', 'skills'))
```

- [ ] **Step 2: Verify both focused tests fail**

Run: `pnpm vitest run test/core/config.test.ts test/core/agents.test.ts`

Expected: FAIL because config and Agent APIs are missing.

- [ ] **Step 3: Implement validated atomic config writes**

Add exact dependency `zod: 4.4.3`. Implement a passthrough Zod object for the known config keys. The default config path is `resolve(homedir(), '.xc-skills-config.json')`; every public function accepts an optional override for tests. `writeConfig` must create a sibling temporary file with mode `0o600`, fsync it, rename it over the destination, and remove the temporary file in `finally`. `setDefaultBranch` must trim and reject an empty branch, merge with the full passthrough object, and call `writeConfig`.

Use this public schema:

```ts
export const xcSkillsConfigSchema = z.object({
  mode: z.enum(['local', 'remote']).optional(),
  repoPath: z.string().min(1).optional(),
  remoteUrl: z.string().min(1).optional(),
  defaultBranch: z.string().min(1).optional(),
  defaultGroups: z.array(z.string().min(1)).optional(),
}).passthrough()
```

- [ ] **Step 4: Implement built-in and custom Agent path resolution**

Define exactly four built-ins with IDs `antigravity`, `trae`, `codex`, and `claude-code`. Each uses project directories `.agents`, `.trae`, `.codex`, and `.claude`, the matching home directory, and relative asset directories `skills`, `rules`, and `workflows`. `resolveAgentAssetRoot` must return a normalized absolute path and must not create it.

- [ ] **Step 5: Verify config, Agent, and package tests**

Run:

```bash
pnpm install
pnpm vitest run test/core/config.test.ts test/core/agents.test.ts
pnpm test
pnpm build
```

Expected: all tests PASS and build exits 0.

- [ ] **Step 6: Commit shared configuration**

```bash
git add package.json pnpm-lock.yaml src/core/config.ts src/core/agents.ts src/core/index.ts test/core/config.test.ts test/core/agents.test.ts
git commit -m "feat(core): share config and agent definitions"
```

### Task 5: Implement Safe Git and Branch Source Resolution

**Files:**
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/git.ts`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/repository.ts`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/index.ts`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/test/integration/repository.test.ts`

**Interfaces:**
- Consumes: `XcSkillsConfig`, `RepositoryBranch`, `RepositorySource`, `CoreError`.
- Produces: `runGit(args, options)`, `listBranches(config)`, `resolveRepositorySource(config, selectedBranch, cacheRoot)`.

- [ ] **Step 1: Write failing temporary-Git-repository tests**

Create a fixture repository with `main` and `feature/demo`, commit a different `skills/demo/SKILL.md` on each branch, leave the configured checkout on `main`, and assert:

```ts
const branches = await listBranches({ mode: 'local', repoPath: repository, defaultBranch: 'main' })
expect(branches.map(({ name, current, default: isDefault }) => ({ name, current, default: isDefault }))).toContainEqual({
  name: 'feature/demo', current: false, default: false,
})

const current = await resolveRepositorySource(config, 'main', cacheRoot)
expect(current).toMatchObject({ root: repository, kind: 'local-worktree', allowSymlink: true, stale: false })

const alternate = await resolveRepositorySource(config, 'feature/demo', cacheRoot)
expect(alternate).toMatchObject({ branch: 'feature/demo', kind: 'branch-cache', allowSymlink: false, stale: false })
expect(await fs.readFile(join(alternate.root, 'skills/demo/SKILL.md'), 'utf8')).toContain('feature')
expect(execFileSync('git', ['branch', '--show-current'], { cwd: repository, encoding: 'utf8' }).trim()).toBe('main')
```

Add a second test that makes the source unavailable after a successful cache, calls resolution again, and expects the same cache root with `stale: true`.

- [ ] **Step 2: Verify repository tests fail**

Run: `pnpm vitest run test/integration/repository.test.ts`

Expected: FAIL because Git and repository functions are missing.

- [ ] **Step 3: Implement the non-shell Git adapter**

Create `src/core/git.ts` around `node:child_process.spawn`:

```ts
import { spawn } from 'node:child_process'
import { CoreError } from './errors.js'

export interface RunGitOptions { cwd?: string; signal?: AbortSignal }
function redactGitArg(value: string) {
  try {
    const url = new URL(value)
    if (url.username || url.password) {
      url.username = '[redacted]'
      url.password = ''
      return url.toString()
    }
  } catch {
    return value
  }
  return value
}

function redactGitText(value: string) {
  return value.replace(/(https?:\/\/)[^@\s/]+@/g, '$1[redacted]@')
}

export async function runGit(args: string[], options: RunGitOptions = {}): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: options.cwd,
      shell: false,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: options.signal,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => reject(new CoreError('GIT_FAILED', error.message)))
    child.on('close', (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new CoreError('GIT_FAILED', 'Git command failed', { args: args.map(redactGitArg), cwd: options.cwd, stderr: redactGitText(stderr.trim()), exitCode: code })))
  })
}
```

Do not log environment variables, credentials, or a URL containing user info.

- [ ] **Step 4: Implement branch listing and safe cache snapshots**

In `src/core/repository.ts`:

- Local branch list: `git for-each-ref --format=%(refname:short) refs/heads refs/remotes/origin` plus `git branch --show-current`.
- Remote branch list: `git ls-remote --heads <remoteUrl-or-repoPath>`.
- Deduplicate `origin/name` to `name`, drop symbolic `origin/HEAD`, and sort names.
- For a local selected branch equal to the checkout, return the real worktree without running a write command.
- Otherwise derive `cacheId = sha256(repositoryIdentity + '\0' + branch).slice(0, 20)`, clone into `<cacheRoot>/<cacheId>.next`, validate the checked-out branch content, rename the old cache to `.previous`, rename `.next` to the stable cache path, then remove `.previous`.
- Use `git clone --depth 1 --branch <branch> <source> <nextPath>` with separate arguments.
- If refresh fails and a stable cache exists, return it with `stale: true` and its persisted `cachedAt`; otherwise rethrow the structured Git error.
- Store cache metadata in `<stablePath>.json` under userData, never in a business project.

- [ ] **Step 5: Verify branch safety and the complete Core suite**

Run:

```bash
pnpm vitest run test/integration/repository.test.ts
pnpm test
pnpm build
```

Expected: branch tests PASS; the configured repository remains on `main`; complete suite and build exit 0.

- [ ] **Step 6: Commit repository resolution**

```bash
git add src/core/git.ts src/core/repository.ts src/core/index.ts test/integration/repository.test.ts
git commit -m "feat(core): resolve repository branches safely"
```

### Task 6: Implement Read-Only Operation Planning and Path Safety

**Files:**
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/operations/plan.ts`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/index.ts`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/test/core/operation-plan.test.ts`

**Interfaces:**
- Consumes: `AssetRecord`, `RepositorySource`, `AgentDefinition`, `OperationPlan`, `CoreError`.
- Produces: `planOperation(input: PlanOperationInput): Promise<OperationPlan>` and `assertPathInside(path, allowedRoot)`.

- [ ] **Step 1: Write failing planner tests**

Cover these exact cases:

```ts
await expect(planOperation({ kind: 'install', asset, sourceBranch: 'main', targetRoot, method: 'symlink', allowSymlink: false, allowedRoot: targetRoot }))
  .rejects.toMatchObject({ code: 'INVALID_ASSET' })

await expect(planOperation({ kind: 'uninstall', asset, sourceBranch: 'main', targetRoot: '/project/.codex/skills', targetPath: '/project/README.md', method: null, allowSymlink: false, allowedRoot: '/project/.codex/skills' }))
  .rejects.toMatchObject({ code: 'INVALID_PATH' })

const plan = await planOperation({ kind: 'freeze', asset, sourceBranch: 'main', targetRoot, targetPath: join(targetRoot, asset.name), method: null, allowSymlink: true, allowedRoot: targetRoot })
expect(plan.steps).toEqual([{ kind: 'rename', source: join(targetRoot, asset.name, 'SKILL.md'), target: join(targetRoot, asset.name, 'SKILL.md.xc-disabled') }])
```

Also assert that install/update plans list backup, temporary preparation, and exact final paths without modifying the filesystem.

- [ ] **Step 2: Verify planner tests fail**

Run: `pnpm vitest run test/core/operation-plan.test.ts`

Expected: FAIL because the planner is missing.

- [ ] **Step 3: Implement canonical containment and operation planning**

Define:

```ts
export interface PlanOperationInput {
  kind: OperationKind
  asset: AssetRecord
  sourceBranch: string
  targetRoot: string
  targetPath?: string
  method: InstallMethod | null
  allowSymlink: boolean
  allowedRoot: string
  installedStatus?: AssetStatus
  overwriteModified?: boolean
}
```

`assertPathInside` must compare `resolve` plus `relative`; reject an empty allowed root, `..` traversal, absolute relative results, and a target equal to the asset root when the operation expects a child asset. Resolve existing parent symlinks before accepting the final path.

Planner rules:

- `install`: reject symlink when `allowSymlink` is false; prepare a sibling `.<asset>.xc-next-<planId>`, optionally back up only the selected existing asset, then replace it.
- `update`: same atomic plan; set `requiresOverwriteConfirmation` when `installedStatus` is `locally_modified` and reject unless `overwriteModified` is true.
- `uninstall`: back up and remove only `targetPath`.
- `freeze`: Skills only; rename active entry to disabled entry; reject if both exist.
- `thaw`: Skills only; rename disabled entry to active entry; reject if both exist.
- Never include a step that empties an Agent asset root.
- Plan IDs use `randomUUID()` and all paths in the plan are absolute.
- Compute `sourceHash` with `hashAsset` after path validation and store it in the plan.

- [ ] **Step 4: Verify the planner is pure and secure**

Run:

```bash
pnpm vitest run test/core/operation-plan.test.ts
pnpm test
```

Expected: tests PASS; fixture directory tree is byte-for-byte unchanged after planning.

- [ ] **Step 5: Commit operation planning**

```bash
git add src/core/operations/plan.ts src/core/index.ts test/core/operation-plan.test.ts
git commit -m "feat(core): plan safe asset operations"
```

### Task 7: Execute Operations Atomically, Including Freeze and Rollback

**Files:**
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/operations/execute.ts`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/src/core/index.ts`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/test/integration/operations.test.ts`

**Interfaces:**
- Consumes: `OperationPlan`, `OperationProgress`, `OperationResult`, planner step semantics.
- Produces: `executeOperation(plan, options): Promise<OperationResult>`.

- [ ] **Step 1: Write failing integration tests for each mutation**

Use real temporary directories. Assert:

- copy install excludes `.git`, `history`, and `PENDING_SYNC.md`;
- symlink install creates per-file links and does not modify the source;
- uninstall removes only the selected asset, preserving sibling assets and the root;
- freeze renames only the installed entry, including when that entry is a symlink;
- thaw restores it;
- update of a frozen copy writes the new content as `SKILL.md.xc-disabled`;
- an injected failure after backup restores the exact original bytes;
- an aborted signal stops at the next safe boundary and returns `cancelled` or `rolled_back`.

Use an injectable filesystem adapter only for the failure test:

```ts
await expect(executeOperation(plan, {
  onProgress: (event) => progress.push(event),
  faultAfterStep: 2,
})).resolves.toMatchObject({ status: 'rolled_back', residualPaths: [] })
expect(await fs.readFile(originalEntry, 'utf8')).toBe('# Original')
```

- [ ] **Step 2: Verify operation tests fail**

Run: `pnpm vitest run test/integration/operations.test.ts`

Expected: FAIL because the executor is missing.

- [ ] **Step 3: Implement the transactional executor**

Define:

```ts
export interface ExecuteOperationOptions {
  signal?: AbortSignal
  onProgress?: (progress: OperationProgress) => void
  faultAfterStep?: number
}
```

Implementation requirements:

- Revalidate every source and target against the plan immediately before mutation.
- Recompute the source hash before the first mutation and fail with `SOURCE_CHANGED` when it differs from `plan.sourceHash`; the user must generate and confirm a new plan.
- Emit progress before and after each completed step.
- Check `signal.aborted` only between steps.
- Copy with dereference for copy mode and the scanner exclusion set.
- For symlink Skills, create the destination directory and per-file links; skip `.git`, `history`, and `PENDING_SYNC.md`.
- Rename the old target to a unique sibling backup before publishing the prepared target.
- Track inverse actions in memory. On any failure, run inverses in reverse order.
- Return `needs_attention` with exact residual paths if an inverse fails; never return `completed` after a partial rollback.
- Remove temporary and backup paths only after success or successful rollback.

- [ ] **Step 4: Verify operation and regression suites**

Run:

```bash
pnpm vitest run test/integration/operations.test.ts
pnpm test
pnpm build
```

Expected: all operation scenarios PASS and build exits 0.

- [ ] **Step 5: Commit transactional operations**

```bash
git add src/core/operations/execute.ts src/core/index.ts test/integration/operations.test.ts
git commit -m "feat(core): execute reversible asset operations"
```

### Task 8: Adapt the Existing CLI to Core Without Regressions

**Files:**
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/src/types.ts`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/src/agents.ts`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/src/utils.ts`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/src/install.ts`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/src/commands/config.ts`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/src/commands/list.ts`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/src/commands/pull.ts`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/package.json`
- Modify: `/Users/xc/Desktop/XcSkill/xc-skills/pnpm-lock.yaml`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/test/cli/compatibility.test.ts`
- Create: `/Users/xc/Desktop/XcSkill/xc-skills/test/cli/frozen-pull.test.ts`

**Interfaces:**
- Consumes: all Core APIs from Tasks 1–7.
- Produces: existing CLI behavior backed by Core, including frozen-state-preserving pull/update.

- [ ] **Step 1: Capture CLI help and non-interactive baseline**

Before edits, save command output in test assertions, not committed snapshot blobs:

```ts
const help = execFileSync(process.execPath, ['dist/cli.js', '--help'], { encoding: 'utf8' })
expect(help).toContain('add [source]')
expect(help).toContain('remove')
expect(help).toContain('list')
expect(help).toContain('publish [dir]')
expect(help).toContain('sync')
expect(help).toContain('pull [dir]')
expect(help).toContain('view <skill>')
```

Add fixture-backed checks for `add --yes`, project/global `list`, and the config JSON reader.

- [ ] **Step 2: Add the failing frozen-pull regression**

Prepare an installed `demo/SKILL.md.xc-disabled` and a newer central `demo/SKILL.md`; invoke the refactored pull helper directly and assert the target still has only `SKILL.md.xc-disabled` with new content.

Run: `pnpm vitest run test/cli/compatibility.test.ts test/cli/frozen-pull.test.ts`

Expected: frozen-pull test FAIL with the current implementation because it only recognizes `SKILL.md`.

- [ ] **Step 3: Replace compatibility modules with thin Core adapters**

- `src/types.ts` re-exports `AssetType`, `AssetConfig`, `ASSET_CONFIG` and keeps `inferAssetType` as a compatibility helper.
- `src/agents.ts` maps `BUILTIN_AGENTS` to the current `{ name, path, description }` shape.
- `src/utils.ts` delegates descriptions and recursive scanning to `scanAssets`, preserving current `SkillItem` output.
- `src/install.ts` retains Clack progress presentation but creates plans and executes them through Core.
- `src/commands/config.ts` delegates `getConfig` and `saveConfig` to Core atomic config functions; keep the interactive prompts unchanged.
- `src/commands/list.ts` uses Core scanning and renders `[已冻结]` beside frozen Skills without changing aliases or flags.
- `src/commands/pull.ts` uses Core repository resolution and operation execution. When a frozen target is found, build an update plan that preserves the disabled entry.
- Bump the package version from `1.2.3` to `1.3.0` because `xc-skills/core` is a new public API. Do not run `npm publish`; publishing requires a separate explicit approval after implementation verification.

Do not refactor `publish`, `sync`, or `view` beyond changing imports required by the compatibility modules. Do not change `remove` semantics in this task; the safer per-item uninstall belongs to Desktop.

- [ ] **Step 4: Verify CLI compatibility and package export**

Run:

```bash
pnpm test
pnpm build
node dist/cli.js --help
npm pack --dry-run
git diff --check
```

Expected: all tests PASS; help contains every existing command; dry-run contains CLI and Core outputs; diff check exits 0.

- [ ] **Step 5: Commit the CLI adapters**

```bash
git add package.json pnpm-lock.yaml src/types.ts src/agents.ts src/utils.ts src/install.ts src/commands/config.ts src/commands/list.ts src/commands/pull.ts test/cli
git commit -m "refactor(cli): consume shared core services"
```

### Task 9: Scaffold the Hardened Electron Application

**Files:**
- Create: `/Users/xc/Documents/xc_skill_workbench/package.json`
- Create: `/Users/xc/Documents/xc_skill_workbench/pnpm-lock.yaml`
- Create: `/Users/xc/Documents/xc_skill_workbench/electron.vite.config.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/tsconfig.json`
- Create: `/Users/xc/Documents/xc_skill_workbench/tsconfig.node.json`
- Create: `/Users/xc/Documents/xc_skill_workbench/tsconfig.web.json`
- Create: `/Users/xc/Documents/xc_skill_workbench/vitest.config.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/main/index.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/main/window.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/preload/index.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/index.html`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/main.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/app/App.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/test/main/window.test.ts`

**Interfaces:**
- Consumes: built `xc-skills/core` from Task 8 through local file dependency during development.
- Produces: a secure launchable Electron shell and the renderer mount point.

- [ ] **Step 1: Add a failing BrowserWindow security test**

Extract a pure `createWindowOptions(preloadPath)` function and test:

```ts
expect(createWindowOptions('/tmp/preload.js').webPreferences).toMatchObject({
  preload: '/tmp/preload.js',
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
})
```

Run: `pnpm vitest run test/main/window.test.ts`

Expected: FAIL because the desktop project and function do not exist.

- [ ] **Step 2: Create the pinned desktop package definition**

Create `package.json`:

```json
{
  "name": "xc-skills-desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "package:mac": "pnpm build && electron-builder --mac dmg zip"
  },
  "dependencies": {
    "dompurify": "3.4.12",
    "marked": "18.0.6",
    "react": "19.2.7",
    "react-dom": "19.2.7",
    "xc-skills": "file:../../Desktop/XcSkill/xc-skills",
    "zod": "4.4.3",
    "zustand": "5.0.14"
  },
  "devDependencies": {
    "@playwright/test": "1.61.1",
    "@testing-library/jest-dom": "6.9.1",
    "@testing-library/react": "16.3.2",
    "@testing-library/user-event": "14.6.1",
    "@types/node": "22.20.1",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "@vitejs/plugin-react": "5.2.0",
    "electron": "43.1.1",
    "electron-builder": "26.15.3",
    "electron-vite": "5.0.0",
    "jsdom": "28.1.0",
    "typescript": "5.9.3",
    "vite": "7.3.6",
    "vitest": "4.1.10"
  }
}
```

The `file:` dependency is for the known two-repository development layout. Before distributing beyond this checkout, replace it with the exact released `xc-skills` version containing `./core` and regenerate `pnpm-lock.yaml`.

- [ ] **Step 3: Create build and TypeScript configuration**

Use electron-vite inputs `src/main/index.ts`, `src/preload/index.ts`, and `src/renderer/index.html`; use `externalizeDepsPlugin()` for main/preload and React plugin for renderer. Create `electron.vite.config.ts`:

```ts
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
  },
})
```

Configure NodeNext for main/preload, Bundler + DOM for renderer, strict mode everywhere, and `noUncheckedIndexedAccess: true`.

Configure Vitest with Node environment by default and a `test/renderer/**` glob using jsdom.

- [ ] **Step 4: Implement a minimal hardened window and renderer**

`createWindowOptions` must return width 1280, height 800, minimum 980×640, hidden until `ready-to-show`, and the exact security flags from Step 1. Deny all `window.open` requests and prevent navigation away from the app URL. Do not expose Node in the initial preload.

`App.tsx` must render a stable `data-testid="app-shell"` and the text `XC Skills` so launch tests have a deterministic target.

- [ ] **Step 5: Install, test, typecheck, and build**

Run:

```bash
pnpm install
pnpm vitest run test/main/window.test.ts
pnpm typecheck
pnpm build
```

Expected: security test PASS; main, preload, and renderer bundles are created under `out`; all commands exit 0.

- [ ] **Step 6: Commit the Electron skeleton**

```bash
git add package.json pnpm-lock.yaml electron.vite.config.ts tsconfig.json tsconfig.node.json tsconfig.web.json vitest.config.ts src test/main/window.test.ts
git commit -m "feat(desktop): scaffold secure electron shell"
```

### Task 10: Define Typed IPC, Preload, and Atomic Desktop State

**Files:**
- Create: `/Users/xc/Documents/xc_skill_workbench/src/shared/ipc.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/main/services/app-store.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/main/ipc/register-ipc.ts`
- Modify: `/Users/xc/Documents/xc_skill_workbench/src/main/index.ts`
- Modify: `/Users/xc/Documents/xc_skill_workbench/src/preload/index.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/env.d.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/test/main/app-store.test.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/test/main/ipc-contract.test.ts`

**Interfaces:**
- Consumes: Core domain types and Zod.
- Produces: `DesktopApi`, `DesktopState`, `AppStore`, runtime-validated IPC channels, and `window.xcSkills`.

- [ ] **Step 1: Write failing state and contract tests**

State test requirements:

```ts
const store = new AppStore(join(root, 'state.json'))
await store.addProject({ id: 'project-1', name: 'Admin', path: '/repo/admin' })
await store.setTheme('dark')
expect(await store.read()).toMatchObject({ version: 1, theme: 'dark', projects: [{ id: 'project-1', name: 'Admin', path: '/repo/admin' }] })
```

Contract test must reject a custom Agent asset directory containing `..`, an operation request with an unknown Agent ID, a non-HTTP external URL, and an invalid theme before a handler runs.

- [ ] **Step 2: Verify the focused tests fail**

Run: `pnpm vitest run test/main/app-store.test.ts test/main/ipc-contract.test.ts`

Expected: FAIL because contracts and store are missing.

- [ ] **Step 3: Define the exact shared API**

`src/shared/ipc.ts` must define Zod schemas and this API shape:

```ts
export type ThemePreference = 'light' | 'dark' | 'system'
export interface ProjectRecord { id: string; name: string; path: string }
export type SourceSelection = { kind: 'central' } | { kind: 'global' } | { kind: 'project'; projectId: string }
export interface WindowBounds { x?: number; y?: number; width: number; height: number }
export interface DesktopState {
  version: 1
  projects: ProjectRecord[]
  customAgents: AgentDefinition[]
  theme: ThemePreference
  lastSource: SourceSelection
  windowBounds: WindowBounds | null
}
export interface AssetSelection { source: SourceSelection; assetId: string }
export type RepositoryView = Omit<RepositorySource, 'root'>
export interface OperationTarget { scope: 'project' | 'global'; projectId?: string; agentId: string }
export interface OperationRequest {
  kind: OperationKind
  asset: AssetSelection
  target: OperationTarget
  method: InstallMethod | null
  overwriteModified?: boolean
}

export interface DesktopApi {
  projects: {
    list(): Promise<ProjectRecord[]>
    chooseAndAdd(): Promise<ProjectRecord | null>
    remove(id: string): Promise<void>
  }
  agents: {
    list(): Promise<AgentDefinition[]>
    saveCustom(agent: AgentDefinition): Promise<AgentDefinition[]>
    removeCustom(id: string): Promise<AgentDefinition[]>
  }
  repositories: {
    getConfig(): Promise<XcSkillsConfig>
    listBranches(): Promise<RepositoryBranch[]>
    selectBranch(branch: string): Promise<RepositoryView>
    setDefaultBranch(branch: string): Promise<XcSkillsConfig>
    refresh(): Promise<RepositoryView>
  }
  assets: {
    scan(source: SourceSelection): Promise<AssetRecord[]>
    detail(asset: AssetSelection): Promise<AssetDetail>
    statuses(asset: AssetSelection): Promise<Array<{ projectId: string | null; agentId: string; path: string; method: InstallMethod | null; status: AssetStatusRecord }>>
  }
  operations: {
    plan(input: OperationRequest): Promise<OperationPlan>
    execute(planId: string): Promise<OperationResult>
    cancel(planId: string): Promise<void>
    onProgress(listener: (progress: OperationProgress) => void): () => void
  }
  preferences: {
    getTheme(): Promise<ThemePreference>
    setTheme(theme: ThemePreference): Promise<void>
    getLastSource(): Promise<SourceSelection>
  }
  system: {
    openExternal(url: string): Promise<void>
  }
}
```

- [ ] **Step 4: Implement atomic userData state**

`AppStore` must validate on read, use defaults `{ version: 1, projects: [], customAgents: [], theme: 'system', lastSource: { kind: 'central' }, windowBounds: null }`, canonicalize project paths with realpath, reject duplicate canonical paths, preserve state through sibling temp-file + rename writes, and never write inside a project. Main stores validated window bounds on move/resize/close. CoreService stores `lastSource` whenever a scan source is selected.

- [ ] **Step 5: Register validated IPC and expose the narrow preload**

Create channel constants instead of raw strings in handlers. Every `ipcMain.handle` must parse inputs with the matching schema. Asset detail/status requests use `AssetSelection`, and operation requests use only asset/project/Agent IDs; Main resolves every real path from its own catalog and AppStore. `execute` accepts only a stored `planId`. Preload uses `contextBridge.exposeInMainWorld('xcSkills', api)` and wraps progress subscriptions so unsubscribe removes only the caller's listener. Do not expose `ipcRenderer`, `send`, filesystem authority, or arbitrary channel names.

- [ ] **Step 6: Verify state, contracts, typecheck, and build**

Run:

```bash
pnpm vitest run test/main/app-store.test.ts test/main/ipc-contract.test.ts
pnpm test
pnpm typecheck
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit the IPC boundary**

```bash
git add src/shared src/main/services/app-store.ts src/main/ipc src/main/index.ts src/preload src/renderer/src/env.d.ts test/main
git commit -m "feat(desktop): add typed ipc and app state"
```

### Task 11: Orchestrate Projects, Agents, Repositories, and Asset Queries

**Files:**
- Create: `/Users/xc/Documents/xc_skill_workbench/src/main/services/core-service.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/main/services/log-service.ts`
- Modify: `/Users/xc/Documents/xc_skill_workbench/src/main/ipc/register-ipc.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/test/main/core-service.test.ts`

**Interfaces:**
- Consumes: `DesktopApi`, `AppStore`, all Core query APIs.
- Produces: `CoreService` methods backing projects, Agents, config, branch, scan, detail, and status channels.

- [ ] **Step 1: Write failing CoreService tests with a fake dialog and fixture repository**

Assert that `chooseAndAddProject` canonicalizes and stores the selected folder, `selectBranch` changes only in-memory session state, `setDefaultBranch` writes shared config, and central scan uses the selected branch source. Also assert project removal leaves files intact.

```ts
const service = new CoreService({ appStore, configPath, cacheRoot, chooseDirectory: async () => projectRoot, log })
await service.chooseAndAddProject()
await service.selectBranch('feature/demo')
expect((await service.getConfig()).defaultBranch).toBe('main')
await service.setDefaultBranch('feature/demo')
expect((await service.getConfig()).defaultBranch).toBe('feature/demo')
```

- [ ] **Step 2: Verify CoreService tests fail**

Run: `pnpm vitest run test/main/core-service.test.ts`

Expected: FAIL because `CoreService` is missing.

- [ ] **Step 3: Implement source orchestration and status fan-out**

CoreService must:

- import config from `~/.xc-skills-config.json` on first call;
- initialize selected branch from `defaultBranch` without writing;
- keep the last `RepositorySource` and refresh only on explicit branch selection/refresh;
- scan central through the resolved source root;
- scan global/project roots for every enabled built-in and custom Agent;
- cache each scan in a Main-only catalog keyed by canonical `SourceSelection` plus `assetId`; detail, status, and operation requests must resolve assets from this catalog rather than trusting Renderer-supplied paths;
- for project/global assets, match the active central catalog by `type + group + name` before evaluating current/update/modified status; return `unknown` with reason `中央分支不存在同名资产` when no source match exists;
- use canonical paths and skip missing roots without treating them as fatal;
- compute per-location statuses with bounded concurrency of 8;
- return per-asset errors without aborting other assets;
- update default branch only through Core atomic config.

The log service writes JSON lines under userData, redacts credential URL userinfo, `token`, `password`, `authorization`, and home-directory usernames, and caps retained logs at 10 files × 2 MB.

- [ ] **Step 4: Bind all read-side IPC handlers**

Wire project, Agent, repository, asset scan/detail/status, preference, and system handlers to CoreService/AppStore. `chooseAndAdd` must invoke Electron's native directory dialog in Main; Renderer never supplies an arbitrary project path. `system.openExternal` must accept only parsed `https:`, `http:`, or `mailto:` URLs and call Electron `shell.openExternal` in Main.

- [ ] **Step 5: Verify services and security checks**

Run:

```bash
pnpm vitest run test/main/core-service.test.ts test/main/ipc-contract.test.ts
pnpm test
pnpm typecheck
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit read-side orchestration**

```bash
git add src/main/services src/main/ipc/register-ipc.ts test/main/core-service.test.ts
git commit -m "feat(desktop): query projects and repository assets"
```

### Task 12: Build the Three-Pane Resource Explorer and Branch Picker

**Files:**
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/app/store.ts`
- Modify: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/app/App.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/components/SourceSidebar.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/components/AssetList.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/components/BranchPicker.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/components/StatusBadge.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/features/projects/AddProjectButton.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/styles/tokens.css`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/styles/app.css`
- Create: `/Users/xc/Documents/xc_skill_workbench/test/renderer/resource-explorer.test.tsx`

**Interfaces:**
- Consumes: read-side `DesktopApi` from Tasks 10–11.
- Produces: source navigation, type tabs, search/filter list, selected asset state, and branch switching UI.

- [ ] **Step 1: Write the failing renderer interaction test**

Mock `window.xcSkills`; render `App`; assert:

```ts
await user.click(screen.getByRole('button', { name: '中央仓库' }))
expect(await screen.findByText('design-audit')).toBeVisible()
await user.type(screen.getByRole('searchbox'), 'audit')
expect(screen.getByText('design-audit')).toBeVisible()
expect(screen.queryByText('api-contract')).not.toBeInTheDocument()
await user.click(screen.getByRole('button', { name: /main/ }))
await user.click(screen.getByRole('option', { name: 'feature/demo' }))
expect(window.xcSkills.repositories.selectBranch).toHaveBeenCalledWith('feature/demo')
```

Also test Skills/Rules/Workflows tabs, group/status/Agent filters, add-project, and removing a project registration without a delete confirmation for files.

- [ ] **Step 2: Verify renderer tests fail**

Run: `pnpm vitest run test/renderer/resource-explorer.test.tsx`

Expected: FAIL because explorer components are missing.

- [ ] **Step 3: Implement the Zustand app store**

State fields: `sources`, `selectedSource`, `assetType`, `query`, `groupFilter`, `statusFilter`, `agentFilter`, `assets`, `selectedAssetId`, `branches`, `selectedBranch`, `loading`, and `error`. Initialization loads `preferences.getLastSource()` and falls back to Central if its project no longer exists. Actions call only `window.xcSkills`, discard stale async responses with a monotonically increasing request ID, and preserve the selected asset only when it still exists.

- [ ] **Step 4: Implement the accessible three-pane shell**

- Left pane: Central, Global, registered projects, Add Project, Settings.
- Center: BranchPicker only for Central, tabs, searchbox, three filters, virtualizable list-ready rows, empty/loading/error states.
- Right placeholder: selected asset name and status loading target for Task 13.
- Branch selection is session-only. A separate menu action `设为默认分支` shows confirmation, then calls `setDefaultBranch`.
- Show `缓存数据 · <timestamp>` whenever `RepositoryView.stale` is true.
- Use buttons/listbox/options with visible focus, keyboard navigation, and Chinese UI labels.

- [ ] **Step 5: Verify UI behavior and visual token structure**

Run:

```bash
pnpm vitest run test/renderer/resource-explorer.test.tsx
pnpm test
pnpm typecheck
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the resource explorer**

```bash
git add src/renderer/src test/renderer/resource-explorer.test.tsx
git commit -m "feat(desktop): add unified resource explorer"
```

### Task 13: Add Safe Asset Details, File Tree, Evolution, and Statuses

**Files:**
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/components/AssetDetail.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/components/AssetFileTree.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/lib/markdown.ts`
- Modify: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/app/App.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/test/renderer/asset-detail.test.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/test/renderer/markdown.test.ts`

**Interfaces:**
- Consumes: `assets.detail`, `assets.statuses`, selected asset from Task 12.
- Produces: preview/source/files/evolution tabs and per-location status rows used by operation actions.

- [ ] **Step 1: Write failing Markdown security and detail tests**

Security assertions:

```ts
const html = renderSafeMarkdown('# Safe\n<script>alert(1)</script>\n[bad](javascript:alert(1))')
expect(html).toContain('<h1>Safe</h1>')
expect(html).not.toContain('<script')
expect(html).not.toContain('javascript:')
```

Detail assertions: switching between `预览`, `源码`, `文件`, and `演进历史`; Rules/Workflows omit history; statuses render project, Agent, install path, state, and installation method.

- [ ] **Step 2: Verify focused tests fail**

Run: `pnpm vitest run test/renderer/markdown.test.ts test/renderer/asset-detail.test.tsx`

Expected: FAIL because detail and sanitizer functions are missing.

- [ ] **Step 3: Implement safe Markdown rendering**

`renderSafeMarkdown(markdown)` must call Marked with raw HTML disabled at token-render level, then DOMPurify with an allowlist for headings, paragraphs, lists, tables, blockquotes, code/pre, links, and emphasis. Allow only `http:`, `https:`, and `mailto:` hrefs. Add `rel="noreferrer noopener"` to external anchors, prevent their default renderer navigation, and call `window.xcSkills.system.openExternal` with the sanitized URL; do not use `dangerouslySetInnerHTML` with unsanitized text.

- [ ] **Step 4: Implement the detail pane**

Load detail and statuses together with stale-request cancellation. Limit source rendering to the Core 1 MB text limit; show binary/oversized files as metadata only. The status section groups Global first, then projects, and renders explicit labels for `最新`, `可更新`, `本地有修改`, `已冻结`, `链接失效`, `冲突`, and `无效`.

Buttons are determined by location status:

- `not_installed` → 安装到…
- `update_available` → 更新
- `locally_modified` → 查看影响并更新
- `current` → 卸载; add 冻结 only when `asset.type === 'skills'`
- `frozen` → 解冻 / 卸载 / 更新; this state is valid only for Skills
- broken/conflict/invalid → 查看诊断; no blind write action

- [ ] **Step 5: Verify detail, security, and full renderer tests**

Run:

```bash
pnpm vitest run test/renderer/markdown.test.ts test/renderer/asset-detail.test.tsx
pnpm test
pnpm typecheck
pnpm build
```

Expected: security assertions and all suites PASS.

- [ ] **Step 6: Commit asset details**

```bash
git add src/renderer/src/components/AssetDetail.tsx src/renderer/src/components/AssetFileTree.tsx src/renderer/src/lib/markdown.ts src/renderer/src/app/App.tsx test/renderer
git commit -m "feat(desktop): show safe asset details and statuses"
```

### Task 14: Wire Write Operations Through Plan, Confirm, Progress, and Rescan

**Files:**
- Modify: `/Users/xc/Documents/xc_skill_workbench/src/main/services/core-service.ts`
- Modify: `/Users/xc/Documents/xc_skill_workbench/src/main/ipc/register-ipc.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/features/operations/OperationDialog.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/features/operations/OperationProgress.tsx`
- Modify: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/components/AssetDetail.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/test/main/operation-service.test.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/test/renderer/operation-dialog.test.tsx`

**Interfaces:**
- Consumes: Core planner/executor, operation IPC, detail status rows.
- Produces: install/update/uninstall/freeze/thaw end-to-end behavior with cancellation and rescan.

- [ ] **Step 1: Write failing Main operation task tests**

Assert that Main owns AbortControllers by plan ID, rejects an unknown or expired plan ID, streams progress only to the requesting webContents, rescans affected targets on completion, and removes task state in `finally`.

```ts
const plan = await service.planOperation(input)
const progress: OperationProgress[] = []
const result = await service.executeOperation(plan.id, (event) => progress.push(event))
expect(result.status).toBe('completed')
expect(progress.at(-1)).toMatchObject({ completed: plan.steps.length, total: plan.steps.length })
expect(service.hasTask(plan.id)).toBe(false)
```

- [ ] **Step 2: Write failing operation-dialog tests**

Cover target project, one or more Agents, allowed method selection, exact affected path list, overwrite warning for local modifications, destructive confirmation text, progress, cancel, success rescan, rollback result, and `needs_attention` residual paths.

Uninstall confirmation must display only the selected asset path and must not contain an Agent root deletion.

- [ ] **Step 3: Verify operation tests fail**

Run: `pnpm vitest run test/main/operation-service.test.ts test/renderer/operation-dialog.test.tsx`

Expected: FAIL because operation orchestration/UI is incomplete.

- [ ] **Step 4: Implement Main operation orchestration**

CoreService keeps an in-memory `Map<planId, { plan, controller, ownerWebContentsId, createdAt }>` with a 10-minute expiry. The high-level `OperationRequest` is resolved against Main-only asset, project, and Agent catalogs to derive `PlanOperationInput`; Renderer never chooses `targetRoot` or `allowedRoot`. Install uses the selected central asset. Update of a project/global selection resolves its `type + group + name` match from the active central catalog, while uninstall/freeze/thaw use only the concrete installed target. `execute` accepts only the stored plan ID, then calls Core. `cancel` aborts only a task owned by the requesting window. On any terminal result, emit it, delete task state, and rescan only the affected source/project/Agent locations.

- [ ] **Step 5: Implement the operation dialog**

Installation flow:

1. choose project/global target;
2. choose enabled Agents;
3. show copy/symlink options permitted by `RepositoryView.allowSymlink`;
4. request plan for each concrete target;
5. show exact creates/replaces/renames/removes and warnings;
6. require a final confirmation;
7. execute sequentially per target, render aggregate progress, allow safe cancel;
8. close only after terminal result acknowledgment and trigger state refresh.

Update/uninstall/freeze/thaw skip irrelevant selectors but still require plan preview and confirmation. Freeze action renames the installed entry only; no source path may appear as a mutation target.

- [ ] **Step 6: Verify every operation flow**

Run:

```bash
pnpm vitest run test/main/operation-service.test.ts test/renderer/operation-dialog.test.tsx
pnpm test
pnpm typecheck
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit managed write operations**

```bash
git add src/main/services/core-service.ts src/main/ipc/register-ipc.ts src/renderer/src/features/operations src/renderer/src/components/AssetDetail.tsx test/main/operation-service.test.ts test/renderer/operation-dialog.test.tsx
git commit -m "feat(desktop): manage reversible asset operations"
```

### Task 15: Add Settings, Themes, Custom Agents, and Error UX

**Files:**
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/features/settings/SettingsView.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/features/settings/ThemeControl.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/features/settings/CustomAgentForm.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/components/ErrorNotice.tsx`
- Modify: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/styles/tokens.css`
- Modify: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/styles/app.css`
- Modify: `/Users/xc/Documents/xc_skill_workbench/src/renderer/src/app/App.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/test/renderer/settings.test.tsx`
- Create: `/Users/xc/Documents/xc_skill_workbench/test/renderer/theme.test.tsx`

**Interfaces:**
- Consumes: preferences, Agent, repository config, and structured errors.
- Produces: light/dark/system preference, custom Agent CRUD, config visibility, and actionable error presentation.

- [ ] **Step 1: Write failing theme and settings tests**

Test that `system` follows `matchMedia('(prefers-color-scheme: dark)')`, reacts to change events, explicit themes ignore later system changes, and the preference persists through API calls. Validate custom Agent form IDs, names, project/global bases, and three relative asset directories; reject absolute relative-directory fields and `..` traversal.

- [ ] **Step 2: Verify focused tests fail**

Run: `pnpm vitest run test/renderer/theme.test.tsx test/renderer/settings.test.tsx`

Expected: FAIL because settings and theme controls are missing.

- [ ] **Step 3: Implement semantic themes**

Define tokens for background, raised surface, border, primary/secondary text, accent, focus ring, success, warning, danger, code surface, and selection. Apply `data-theme="light|dark"` to `document.documentElement`; system mode resolves the current effective theme but persists the literal value `system`. All interactive controls must have visible `:focus-visible` outlines.

- [ ] **Step 4: Implement settings and custom Agents**

Settings displays imported CLI mode, repository path/URL, default branch, and groups. Editing the default branch uses the same explicit confirmation as BranchPicker. Custom Agent save revalidates in Main, uses stable IDs, and prevents editing built-in IDs. Disabling a built-in affects desktop scans only and does not delete files.

- [ ] **Step 5: Implement structured error UX**

Map Core codes to concise Chinese actions. Examples:

- `PERMISSION_DENIED` → show path and “在 Finder 中检查权限”.
- `GIT_FAILED`/`NETWORK_FAILED` → show stale-cache availability and “重试”.
- `BROKEN_LINK` → show resolved target and offer only uninstall/repair flows backed by a plan.
- `ENTRY_CONFLICT` → list both entry paths and disable freeze/thaw.
- `ROLLBACK_FAILED` → persistent danger notice with residual paths and local log location.

Do not display raw environment variables, credential URL userinfo, or stack traces in normal UI.

- [ ] **Step 6: Verify settings, theme, and error behavior**

Run:

```bash
pnpm vitest run test/renderer/theme.test.tsx test/renderer/settings.test.tsx
pnpm test
pnpm typecheck
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit settings and polish**

```bash
git add src/renderer/src/features/settings src/renderer/src/components/ErrorNotice.tsx src/renderer/src/styles src/renderer/src/app/App.tsx test/renderer/settings.test.tsx test/renderer/theme.test.tsx
git commit -m "feat(desktop): add themes settings and error guidance"
```

### Task 16: Add End-to-End Coverage and macOS Packaging

**Files:**
- Create: `/Users/xc/Documents/xc_skill_workbench/playwright.config.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/test/e2e/fixtures.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/test/e2e/app.spec.ts`
- Create: `/Users/xc/Documents/xc_skill_workbench/electron-builder.yml`
- Create: `/Users/xc/Documents/xc_skill_workbench/build/entitlements.mac.plist`
- Modify: `/Users/xc/Documents/xc_skill_workbench/package.json`
- Modify: `/Users/xc/Documents/xc_skill_workbench/README.md`

**Interfaces:**
- Consumes: complete application.
- Produces: repeatable E2E verification, unsigned DMG/ZIP artifacts, and operator documentation.

- [ ] **Step 1: Write the E2E tests before packaging configuration**

Launch Electron with a temporary HOME, temporary userData, temporary central Git repository, and two fixture projects. Cover:

1. first launch imports `~/.xc-skills-config.json`;
2. add project through a test-injected dialog path;
3. central browser lists Skills/Rules/Workflows;
4. switch to `feature/demo` without changing fixture repository checkout;
5. install a Skill copy to a project Agent;
6. freeze it and verify `SKILL.md.xc-disabled` exists while `SKILL.md` does not;
7. restart the app and verify project/theme persistence;
8. thaw, update, and uninstall the single Skill while a sibling Skill remains;
9. remote refresh failure shows stale-cache state.

Use Playwright's Electron launcher and assert both UI and fixture filesystem state.

- [ ] **Step 2: Run E2E and verify the expected initial failure**

Run: `pnpm test:e2e`

Expected: FAIL because Playwright configuration/test hooks and packaging metadata are not complete.

- [ ] **Step 3: Add deterministic test hooks and packaging config**

Test hooks are enabled only when `XC_SKILLS_E2E=1`; they may override HOME, userData, and the native directory chooser result, but must not be present in production renderer APIs.

Create `electron-builder.yml`:

```yaml
appId: com.xc.skills.desktop
productName: XC Skills
directories:
  output: release
files:
  - out/**
  - package.json
mac:
  category: public.app-category.developer-tools
  target:
    - target: dmg
      arch: [arm64, x64]
    - target: zip
      arch: [arm64, x64]
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  identity: null
asar: true
```

Create `build/entitlements.mac.plist` exactly as:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

Do not grant network server, camera, microphone, contacts, or broad file access.

- [ ] **Step 4: Document development, verification, and packaging**

README must include prerequisites, both repository paths, Core build first, `pnpm install`, `pnpm dev`, test commands, shared vs private config locations, branch copy-only rule, freeze filename, unsigned macOS launch warning, and the exact package command. Do not document a publish or signing flow as completed.

- [ ] **Step 5: Run the complete release verification**

CLI repository:

```bash
cd /Users/xc/Desktop/XcSkill/xc-skills
pnpm install --frozen-lockfile
pnpm test
pnpm build
npm pack --dry-run
git diff --check
git status --short
```

Desktop repository:

```bash
cd /Users/xc/Documents/xc_skill_workbench
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm package:mac
git diff --check
git status --short
```

Expected:

- all tests PASS with zero failures;
- both builds exit 0;
- E2E verifies branch safety and per-item install/freeze/thaw/uninstall;
- `release/` contains arm64 and x64 DMG and ZIP artifacts;
- `npm pack --dry-run` contains `dist/core/index.js` and declarations;
- each repository status is clean after its final commit.

- [ ] **Step 6: Inspect packaged applications**

Mount each DMG, launch each architecture artifact on compatible hardware or CI, verify the app opens, imports config, adds a project, scans assets, and quits without a crash. Record architecture, macOS version, and result in the implementation handoff.

- [ ] **Step 7: Commit E2E, packaging, and documentation**

```bash
git add playwright.config.ts test/e2e electron-builder.yml build README.md package.json pnpm-lock.yaml
git commit -m "test(desktop): verify workflows and package macOS app"
```

## Spec Coverage Matrix

- Shared Core and CLI compatibility: Tasks 1–8.
- Skills/Rules/Workflows scanning and details: Tasks 2–3, 11–13.
- Shared config, built-in/custom Agents, and project library: Tasks 4, 10–12, 15.
- Safe local/remote branch selection and stale cache: Tasks 5, 11–12, 16.
- Per-item project/global install, update, and uninstall: Tasks 6–7, 14, 16.
- Per-location Skill freeze/thaw with update preservation: Tasks 7–8, 14, 16.
- Three-pane UI, search, filters, source status, and history: Tasks 12–13.
- Light/dark/system themes and high-density developer styling: Tasks 12 and 15.
- IPC isolation, path authority, Git safety, sanitization, and redacted logs: Tasks 5–7, 9–11, 13–15.
- Unit, integration, CLI regression, renderer, Electron E2E, and macOS packaging: every task's focused tests plus Task 16.
- Non-goals remain excluded: no central asset edit/delete, no desktop sync/publish, no Git credential storage, no project manifest, no Windows/Linux package, no signing/notarization, and no auto-update.

## Final Cross-Repository Review

- [ ] Compare every acceptance criterion in `docs/superpowers/specs/2026-07-16-xc-skills-desktop-design.md` with a passing test or an explicitly recorded packaging check.
- [ ] Confirm the CLI worktree contains no accidental changes to `publish`, `sync`, or `view` beyond import compatibility.
- [ ] Confirm Desktop uninstall plans never target an Agent root and freeze plans never target the central source.
- [ ] Confirm alternate branch tests leave the configured repository branch and working tree unchanged.
- [ ] Confirm no project contains a desktop manifest or userData file.
- [ ] Confirm renderer bundles cannot import `node:fs`, `node:child_process`, or `xc-skills/core` directly.
- [ ] Confirm all Git execution sites call the argument-array adapter.
- [ ] Confirm logs and visible errors redact credential URL userinfo and secrets.
- [ ] Run `git log --oneline` in both repositories and verify each task produced its intended focused commit.
