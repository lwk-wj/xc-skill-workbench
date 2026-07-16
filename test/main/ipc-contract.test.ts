import { describe, expect, it } from 'vitest'
import {
  CustomAgentDirectorySchema,
  OperationRequestSchema,
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
})
