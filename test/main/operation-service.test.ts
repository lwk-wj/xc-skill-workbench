import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../src/main/services/app-store.js'
import { registerIpc } from '../../src/main/ipc/register-ipc.js'
import { Channels, OperationPlanSchema, OperationRequestSchema } from '../../src/shared/ipc.js'

const plan = OperationPlanSchema.parse({
  id: 'plan-op-1', kind: 'install', asset: { id: 'skill-one', name: 'Skill One', type: 'skills', path: '/central/Skill One' },
  sourceBranch: 'main', sourceHash: 'hash', targetRoot: '/global/skills', targetPath: '/global/skills/Skill One', method: 'copy', steps: [], warnings: [], requiresOverwriteConfirmation: false,
})
const request = OperationRequestSchema.parse({ kind: 'install', asset: { source: { kind: 'central' }, assetId: 'skill-one' }, target: { scope: 'global', agentId: 'codex' }, method: 'copy' })

function harness() {
  const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>()
  const store = new AppStore('/tmp/xc-skills-operation-state.json')
  const execute = vi.fn(async (_id: string, options?: { signal?: AbortSignal }) => {
    options?.signal?.throwIfAborted()
    return { planId: plan.id, status: 'completed' as const, affectedPaths: [plan.targetPath], residualPaths: [] }
  })
  const cancel = vi.fn(async () => undefined)
  registerIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, appStore: store, builtInAgentIds: ['codex'], services: { plan: vi.fn(async () => plan), execute, cancel } })
  return { handlers, execute, cancel }
}

describe('operation orchestration', () => {
  it('stores plan ownership and executes by plan id, then expires it', async () => {
    const { handlers, execute } = harness()
    const event = { sender: { id: 7 } }
    await handlers.get(Channels.operationsPlan)?.(event, request)
    const result = await handlers.get(Channels.operationsExecute)?.(event, plan.id)
    expect(result).toMatchObject({ planId: plan.id, status: 'completed' })
    expect(execute).toHaveBeenCalledWith(plan.id, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    await expect(handlers.get(Channels.operationsExecute)?.(event, plan.id)).rejects.toThrow(/unknown or expired/)
  })

  it('only lets the owning window cancel and emits terminal progress', async () => {
    const { handlers, cancel } = harness()
    const event = { sender: { id: 11 } }
    await handlers.get(Channels.operationsPlan)?.(event, request)
    await expect(handlers.get(Channels.operationsCancel)?.({ sender: { id: 12 } }, plan.id)).rejects.toThrow(/owner/)
    await handlers.get(Channels.operationsCancel)?.(event, plan.id)
    expect(cancel).toHaveBeenCalledWith(plan.id, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })
})
