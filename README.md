# XC Skills Desktop

XC Skills Desktop is the Electron explorer for the shared XC Skills catalog.

## Prerequisites

- macOS (development and packaging), Node.js 22.12+, and pnpm 10.24+
- Build the Core/CLI repository first: `/Users/xc/Desktop/XcSkill/xc-skills`
- Desktop repository: `/Users/xc/Documents/xc_skill_workbench`

From the desktop repository, install dependencies and start development:

```bash
cd /Users/xc/Documents/xc_skill_workbench
pnpm install
pnpm dev
```

## Verification

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

E2E tests use isolated temporary HOME, userData, repositories, and dialog paths when
`XC_SKILLS_E2E=1`; these hooks are not exposed through the production renderer API.

## Configuration and repository safety

The shared catalog configuration lives at `~/.xc-skills-config.json` and is imported
from the Core repository. Desktop state (projects, theme, window bounds, and last
source) is private per user and stored below Electron's userData directory. Branch
selection is copy-only: changing a branch reads a branch cache and never changes the
checkout of the configured local repository.

When an item is frozen, its entry is renamed to `SKILL.md.xc-disabled` (and restored
to `SKILL.md` when thawed). Install and update operations are copy-only unless an
explicit symlink method is selected.

## Packaging

Create unsigned macOS DMG and ZIP artifacts with:

```bash
pnpm package:mac
```

Artifacts are written to `release/`. The unsigned build is intended for development
and CI; macOS Gatekeeper may require opening it from Finder with an explicit override.
No signing or publishing flow is configured in this repository.
