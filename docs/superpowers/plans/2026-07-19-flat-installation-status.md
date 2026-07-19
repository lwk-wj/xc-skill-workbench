# Flat Installation Status Implementation Plan

> **For agentic workers:** Execute inline in the current session. Do not use subagent-driven development for this task.

**Goal:** Correctly report the status of centrally grouped skills installed into flat Agent skill directories.

**Architecture:** Add one private central-asset resolver in `CoreService`. It prefers exact group identity, permits a unique `type + name` fallback only for flat installed assets, and returns a diagnostic for missing or ambiguous matches. Use the Agent root plus asset name for status locations so status checks mirror `planOperation` target paths.

**Tech Stack:** TypeScript, Vitest, Electron main-process services, `xc-skills/core`

## Global Constraints

- Preserve flat Agent installation paths such as `.codex/skills/call-api`.
- Never guess when multiple central groups contain the same type and name.
- Do not change renderer UI or mutate existing user installations.
- Execute inline; do not use SDD or subagents.

---

### Task 1: Align central matching and status paths

**Files:**
- Modify: `test/main/core-service.test.ts`
- Modify: `src/main/services/core-service.ts`

**Interfaces:**
- Consumes: `CoreService.scan`, `CoreService.statuses`, `CoreService.plan`
- Produces: private `findCentralAsset(installed, centralAssets)` resolver used by status and update flows

- [ ] **Step 1: Write failing regression tests**

Add tests that model a central `backend/skills/call-api` asset and a project `.codex/skills/call-api` asset whose scanned group is empty. Assert that `statuses()` calls `evaluateAssetStatus` with the grouped central record and the flat installed path. Add a central-source assertion that expected locations end with `skills/call-api`, not `skills/backend/call-api`, and an ambiguity assertion for duplicate central names.

- [ ] **Step 2: Verify the tests fail for the diagnosed reason**

Run:

```bash
pnpm test -- test/main/core-service.test.ts
```

Expected: the flat installed asset reports `unknown`, and central status paths include the group directory.

- [ ] **Step 3: Implement the minimal resolver and path correction**

In `CoreService`, add a resolver equivalent to:

```ts
private findCentralAsset(installed: AssetRecord, centralAssets: AssetRecord[]): { asset?: AssetRecord; reason: string } {
  const exact = centralAssets.find((candidate) => candidate.type === installed.type && candidate.group === installed.group && candidate.name === installed.name)
  if (exact) return { asset: exact, reason: '' }
  if (installed.group) return { reason: '中央分支不存在同名资产' }
  const candidates = centralAssets.filter((candidate) => candidate.type === installed.type && candidate.name === installed.name)
  if (candidates.length === 1) return { asset: candidates[0], reason: '' }
  return { reason: candidates.length > 1 ? '中央仓库存在多个同名资产，无法确定来源分组' : '中央分支不存在同名资产' }
}
```

Use it in `statuses()` and project-source update lookup. Construct central status locations with `join(agentRoot, central.name)`.

- [ ] **Step 4: Verify focused tests pass**

Run:

```bash
pnpm test -- test/main/core-service.test.ts
```

Expected: all CoreService tests pass.

- [ ] **Step 5: Verify the repository**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: zero test failures, zero type errors, and successful production build.

- [ ] **Step 6: Commit the fix**

```bash
git add src/main/services/core-service.ts test/main/core-service.test.ts docs/superpowers/plans/2026-07-19-flat-installation-status.md
git commit -m "fix: recognize flat skill installations"
```
