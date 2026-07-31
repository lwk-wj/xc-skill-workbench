import { describe, expect, it } from 'vitest'
import {
  Channels,
  CustomAgentDirectorySchema,
  OperationRequestSchema,
  RepositoryConfigInputSchema,
  ThemePreferenceSchema,
  ExternalUrlSchema,
} from '../../src/shared/ipc.js'
import { AppStore } from '../../src/main/services/app-store.js'
import { registerIpc } from '../../src/main/ipc/register-ipc.js'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('IPC contracts', () => {
  it('rejects traversal in custom Agent directories', () => {
    expect(() => CustomAgentDirectorySchema.parse({ id: 'custom', name: 'Custom', projectBaseDir: '/tmp/../secret', globalBaseDir: '/tmp/custom', assetDirs: { skills: '/tmp/custom/skills', rules: '/tmp/custom/rules', workflows: '/tmp/custom/workflows' }, builtIn: false, enabled: true })).toThrow()
  })

  it('rejects unknown Agent IDs before invoking the operation handler', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-ipc-'))
    const store = new AppStore(join(root, 'state.json'))
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
    registerIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, appStore: store, builtInAgentIds: ['known'], services: { plan: async () => { throw new Error('must not run') } } })
    const request = OperationRequestSchema.parse({
      kind: 'install',
      asset: { source: { kind: 'central' }, assetId: 'asset-1' },
      target: { scope: 'global', agentId: 'unknown-agent' },
      method: 'copy',
    })
    await expect(handlers.get('operations:plan')?.({}, request)).rejects.toThrow(/unknown Agent/)
  })

  it('rejects non-http external URLs and invalid themes', () => {
    expect(() => ExternalUrlSchema.parse('file:///etc/passwd')).toThrow()
    expect(() => ThemePreferenceSchema.parse('solarized')).toThrow()
  })

  it('normalizes editable repository configuration without dropping inactive sources', () => {
    expect(RepositoryConfigInputSchema.parse({
      mode: 'local',
      repoPath: '/tmp/catalog',
      remoteUrl: 'https://example.com/catalog.git',
      defaultBranch: ' main ',
      defaultGroups: [' backend ', 'backend', '', ' common '],
    })).toEqual({
      mode: 'local',
      repoPath: '/tmp/catalog',
      remoteUrl: 'https://example.com/catalog.git',
      defaultBranch: 'main',
      defaultGroups: ['backend', 'common'],
    })

    expect(RepositoryConfigInputSchema.parse({
      mode: 'remote',
      repoPath: '/tmp/catalog',
      remoteUrl: ' https://example.com/catalog.git ',
      defaultBranch: 'release',
      defaultGroups: [],
    })).toEqual({
      mode: 'remote',
      repoPath: '/tmp/catalog',
      remoteUrl: 'https://example.com/catalog.git',
      defaultBranch: 'release',
      defaultGroups: [],
    })
  })

  it('rejects a missing active repository source and blank default branch', () => {
    expect(() => RepositoryConfigInputSchema.parse({
      mode: 'local',
      repoPath: '',
      remoteUrl: 'https://example.com/catalog.git',
      defaultBranch: 'main',
      defaultGroups: [],
    })).toThrow(/local repository path required/)

    expect(() => RepositoryConfigInputSchema.parse({
      mode: 'remote',
      repoPath: '/tmp/catalog',
      remoteUrl: '',
      defaultBranch: 'main',
      defaultGroups: [],
    })).toThrow(/remote repository URL required/)

    expect(() => RepositoryConfigInputSchema.parse({
      mode: 'remote',
      repoPath: '/tmp/catalog',
      remoteUrl: 'https://example.com/catalog.git',
      defaultBranch: ' ',
      defaultGroups: [],
    })).toThrow(/default branch required/)
  })

  it('uses dedicated channels for repository configuration actions', () => {
    expect(Channels.repositoriesChooseLocalPath).toBe('repositories:chooseLocalPath')
    expect(Channels.repositoriesUpdateConfig).toBe('repositories:updateConfig')
  })
})
