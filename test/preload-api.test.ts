import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Channels, type DesktopApi } from '../src/shared/ipc.js'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    off: electron.off,
  },
}))

await import('../src/preload/index.js')

const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as DesktopApi

describe('preload repository API', () => {
  beforeEach(() => {
    electron.invoke.mockReset()
  })

  it('forwards local directory selection through its dedicated channel', async () => {
    electron.invoke.mockResolvedValue('/tmp/catalog')

    await api.repositories.chooseLocalPath()

    expect(electron.invoke).toHaveBeenCalledWith(Channels.repositoriesChooseLocalPath)
  })

  it('forwards repository updates through its dedicated channel', async () => {
    const input = {
      mode: 'remote' as const,
      repoPath: '/tmp/catalog',
      remoteUrl: 'https://example.com/catalog.git',
      defaultBranch: 'main',
      defaultGroups: ['backend'],
    }
    electron.invoke.mockResolvedValue({
      config: input,
      repository: {
        branch: 'main',
        kind: 'branch-cache',
        allowSymlink: false,
        stale: false,
        cachedAt: null,
      },
    })

    await api.repositories.updateConfig(input)

    expect(electron.invoke).toHaveBeenCalledWith(Channels.repositoriesUpdateConfig, input)
  })

  it('reads the current repository capabilities without refreshing it', async () => {
    electron.invoke.mockResolvedValue({
      branch: 'main', kind: 'branch-cache', allowSymlink: false, stale: false, cachedAt: null,
    })

    await api.repositories.current()

    expect(electron.invoke).toHaveBeenCalledWith(Channels.repositoriesCurrent)
  })
})
