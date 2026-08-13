# Ad-hoc Signed macOS Test Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not use subagents for this task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a structurally valid ad-hoc signed arm64 DMG and ZIP for trusted macOS testing.

**Architecture:** Configure electron-builder to invoke macOS ad-hoc signing for the complete Electron bundle. Build only arm64 test artifacts and validate both the unpacked app and the app copied into the DMG.

**Tech Stack:** Electron 43, electron-builder 26, macOS codesign, hdiutil

## Global Constraints

- This remains a non-notarized test build.
- Do not require or fabricate Apple Developer credentials.
- Do not generate or claim Intel compatibility in this task.

---

### Task 1: Configure and verify ad-hoc signing

**Files:**
- Modify: `electron-builder.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: electron-builder macOS signing configuration.
- Produces: arm64 DMG and ZIP with a recursively valid ad-hoc signature.

- [ ] **Step 1: Confirm the existing package fails strict signature verification**

Run:

```bash
codesign --verify --deep --strict --verbose=4 "release/mac-arm64/XC Skills.app"
```

Expected: FAIL with `code has no resources but signature indicates they must be present`.

- [ ] **Step 2: Enable ad-hoc signing and make the package architecture explicit**

Set `mac.identity` to `"-"` and change `package:mac` to:

```json
"package:mac": "pnpm build && electron-builder --mac dmg zip --arm64"
```

- [ ] **Step 3: Build the package**

Run:

```bash
pnpm package:mac
```

Expected: arm64 DMG and ZIP are created without a signing error.

- [ ] **Step 4: Verify unpacked and DMG-contained applications**

Run strict recursive `codesign` verification against `release/mac-arm64/XC Skills.app`, mount the DMG with `hdiutil`, and repeat verification against the mounted app.

Expected: both commands exit successfully and report `valid on disk` plus `satisfies its Designated Requirement`.

- [ ] **Step 5: Record hashes and commit configuration**

Run `shasum -a 256` for both artifacts, then commit `electron-builder.yml`, `package.json`, and these design documents.

