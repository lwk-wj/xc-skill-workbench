import type { SourceSelection } from '../../../shared/ipc.js'

export type AssetType = 'skills' | 'rules' | 'workflows'
export type ExplorerSource = SourceSelection & { id: string; label: string; path?: string }
