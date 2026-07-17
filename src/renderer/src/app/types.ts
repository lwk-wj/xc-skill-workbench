import type { SourceSelection } from '../../../shared/ipc.js'

export type AssetType = 'skills' | 'rules' | 'workflows'
export type ExplorerSource = SourceSelection & { id: string; label: string; path?: string }

/** Strip Vue/Pinia proxies and explorer-only fields before crossing Electron IPC. */
export const plainSource = (source: SourceSelection): SourceSelection => source.kind === 'project'
  ? { kind: 'project', projectId: source.projectId }
  : { kind: source.kind }
