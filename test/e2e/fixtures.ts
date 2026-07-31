import { test as base, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const execFile = promisify(execFileCallback)

export type E2EContext = {
  app: ElectronApplication
  page: Page
  root: string
  repo: string
  alternateRepo: string
  project: string
  config: string
}

export const test = base.extend<{ e2e: E2EContext }>({
  e2e: async ({}, use) => {
    const root = await mkdtemp(join(tmpdir(), 'xc-skills-e2e-'))
    const project = join(root, 'project')
    const repo = join(root, 'central')
    const alternateRepo = join(root, 'alternate-central')
    const userData = join(root, 'user-data')
    const home = join(root, 'home')
    const config = join(home, '.xc-skills-config.json')
    await mkdir(join(project, '.github'), { recursive: true })
    await mkdir(join(project, '.claude', 'skills', 'call-api'), { recursive: true })
    await mkdir(join(repo, 'skills', 'demo'), { recursive: true })
    await mkdir(join(repo, 'skills', 'sibling'), { recursive: true })
    await mkdir(join(alternateRepo, 'skills', 'replacement'), { recursive: true })
    await mkdir(join(home, '.codex', 'skills', 'call-api'), { recursive: true })
    await mkdir(home, { recursive: true })
    await mkdir(userData, { recursive: true })
    await writeFile(join(repo, 'skills', 'demo', 'SKILL.md'), '# Demo skill\n\nFixture skill for E2E verification.\n')
    await writeFile(join(repo, 'skills', 'sibling', 'SKILL.md'), '# Sibling skill\n')
    await writeFile(join(alternateRepo, 'skills', 'replacement', 'SKILL.md'), '# Replacement skill\n\nLoaded after saving repository settings.\n')
    await writeFile(join(home, '.codex', 'skills', 'call-api', 'SKILL.md'), '# call-api\n\nCodex global fixture.\n')
    await writeFile(join(project, '.claude', 'skills', 'call-api', 'SKILL.md'), '# call-api\n\nClaude project fixture.\n')
    await execFile('git', ['init', '-b', 'main'], { cwd: repo })
    await execFile('git', ['config', 'user.email', 'e2e@example.invalid'], { cwd: repo })
    await execFile('git', ['config', 'user.name', 'XC Skills E2E'], { cwd: repo })
    await execFile('git', ['add', '.'], { cwd: repo })
    await execFile('git', ['commit', '-m', 'fixture'], { cwd: repo })
    await execFile('git', ['branch', 'feature/demo'], { cwd: repo })
    await execFile('git', ['init', '-b', 'main'], { cwd: alternateRepo })
    await execFile('git', ['config', 'user.email', 'e2e@example.invalid'], { cwd: alternateRepo })
    await execFile('git', ['config', 'user.name', 'XC Skills E2E'], { cwd: alternateRepo })
    await execFile('git', ['add', '.'], { cwd: alternateRepo })
    await execFile('git', ['commit', '-m', 'replacement fixture'], { cwd: alternateRepo })
    await writeFile(config, JSON.stringify({ mode: 'local', repoPath: repo, defaultBranch: 'main' }, null, 2))
    const app = await electron.launch({
      args: [resolve('out/main/index.js')],
      env: {
        ...process.env,
        HOME: home,
        XC_SKILLS_E2E: '1',
        XC_SKILLS_USER_DATA: userData,
        XC_SKILLS_CONFIG_PATH: config,
        XC_SKILLS_DIALOG_PATH: project,
      },
    })
    const page = await app.firstWindow()
    await page.waitForSelector('[data-testid="app-shell"]')
    try {
      await use({ app, page, root, repo, alternateRepo, project, config })
    } finally {
      const electronProcess = app.process()
      const closed = app.close().then(() => true).catch(() => false)
      const graceful = await Promise.race([
        closed,
        new Promise<false>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 5_000)),
      ])
      if (!graceful) {
        const exited = new Promise<void>((resolveExit) => electronProcess.once('exit', () => resolveExit()))
        electronProcess.kill('SIGKILL')
        await Promise.race([exited, new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 5_000))])
      }
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  },
})

export { expect } from '@playwright/test'
