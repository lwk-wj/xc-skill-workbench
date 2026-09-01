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

  it('forwards third-party repository management through dedicated channels', async () => {
    const input = { url: 'https://example.com/team/skills.git', name: 'Team Skills' }
    electron.invoke.mockResolvedValue([])

    await api.thirdPartyRepositories.list()
    await api.thirdPartyRepositories.add(input)
    await api.thirdPartyRepositories.update('repo-1', input)
    await api.thirdPartyRepositories.refresh('repo-1')
    await api.thirdPartyRepositories.relinkInstallation({ installationId: 'install-1', repositoryId: 'repo-1', assetId: 'asset-1' })
    await api.thirdPartyRepositories.remove('repo-1')

    expect(electron.invoke.mock.calls).toEqual([
      [Channels.thirdPartyRepositoriesList],
      [Channels.thirdPartyRepositoriesAdd, input],
      [Channels.thirdPartyRepositoriesUpdate, { id: 'repo-1', input }],
      [Channels.thirdPartyRepositoriesRefresh, 'repo-1'],
      [Channels.thirdPartyRepositoriesRelinkInstallation, { installationId: 'install-1', repositoryId: 'repo-1', assetId: 'asset-1' }],
      [Channels.thirdPartyRepositoriesRemove, 'repo-1'],
    ])
  })

  it('forwards source-conflict inspection without exposing a target path input', async () => {
    const input = {
      kind: 'install' as const,
      asset: { source: { kind: 'third-party' as const, repositoryId: 'repo-1' }, assetId: 'asset-1' },
      target: { scope: 'global' as const, agentId: 'codex' },
      method: 'copy' as const,
    }
    electron.invoke.mockResolvedValue(null)

    await api.operations.inspectSourceConflict(input)

    expect(electron.invoke).toHaveBeenCalledWith(Channels.operationsInspectSourceConflict, input)
  })
})
