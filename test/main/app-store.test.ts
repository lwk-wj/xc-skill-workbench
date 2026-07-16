import { mkdtemp, mkdir, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppStore } from '../../src/main/services/app-store.js'

describe('AppStore', () => {
  it('adds a project and persists a validated versioned state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-store-'))
    const project = join(root, 'Admin')
    await mkdir(project)
    const store = new AppStore(join(root, 'state.json'))

    await store.addProject({ id: 'project-1', name: 'Admin', path: project })
    await store.setTheme('dark')

    await expect(store.read()).resolves.toMatchObject({
      version: 1,
      theme: 'dark',
      projects: [{ id: 'project-1', name: 'Admin', path: await realpath(project) }],
    })
    expect(JSON.parse(await readFile(join(root, 'state.json'), 'utf8')).version).toBe(1)
  })

  it('rejects duplicate canonical project paths and paths containing state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-store-'))
    const project = join(root, 'repo')
    await mkdir(project)
    const store = new AppStore(join(project, 'state.json'))
    await expect(store.addProject({ id: 'one', name: 'One', path: project })).rejects.toThrow()
  })
})
