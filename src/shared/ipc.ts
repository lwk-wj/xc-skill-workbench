import { z } from 'zod'

export const ThemePreferenceSchema = z.enum(['light', 'dark', 'system'])
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>

const safeId = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/)
const safeName = z.string().min(1).max(200)
const safeAbsolutePath = z.string().min(1).refine((value) => {
  if (value.includes('\0')) return false
  const normalized = value.replaceAll('\\', '/')
  if (normalized.split('/').some((part) => part === '..')) return false
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
}, 'path must be absolute and traversal-free')

export const CustomAgentDirectorySchema = z.object({
  id: safeId,
  name: safeName,
  projectBaseDir: safeAbsolutePath,
  globalBaseDir: safeAbsolutePath,
  assetDirs: z.object({ skills: safeAbsolutePath, rules: safeAbsolutePath, workflows: safeAbsolutePath }),
  builtIn: z.boolean(),
  enabled: z.boolean(),
})
export const AgentDefinitionSchema = CustomAgentDirectorySchema
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>

export const ProjectRecordSchema = z.object({ id: safeId, name: safeName, path: safeAbsolutePath })
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>

export const SourceSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('central') }),
  z.object({ kind: z.literal('global') }),
  z.object({ kind: z.literal('project'), projectId: safeId }),
])
export type SourceSelection = z.infer<typeof SourceSelectionSchema>

export const WindowBoundsSchema = z.object({
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().int().min(320).max(10000),
  height: z.number().int().min(240).max(10000),
})
export type WindowBounds = z.infer<typeof WindowBoundsSchema>

export const DesktopStateSchema = z.object({
  version: z.literal(1),
  projects: z.array(ProjectRecordSchema),
  customAgents: z.array(AgentDefinitionSchema),
  agentEnabled: z.record(safeId, z.boolean()).default({}),
  theme: ThemePreferenceSchema,
  lastSource: SourceSelectionSchema,
  windowBounds: WindowBoundsSchema.nullable(),
})
export type DesktopState = z.infer<typeof DesktopStateSchema>

export const AssetSelectionSchema = z.object({ source: SourceSelectionSchema, assetId: safeId })
export type AssetSelection = z.infer<typeof AssetSelectionSchema>

export type RepositorySource = {
  root: string
  branch: string
  kind: 'local-worktree' | 'branch-cache'
  allowSymlink: boolean
  stale: boolean
  cachedAt: string | null
}
export const RepositoryViewSchema = z.object({
  branch: z.string(),
  kind: z.enum(['local-worktree', 'branch-cache']),
  allowSymlink: z.boolean(),
  stale: z.boolean(),
  cachedAt: z.string().nullable(),
})
export type RepositoryView = Omit<RepositorySource, 'root'>

export const RepositoryBranchSchema = z.object({ name: z.string().min(1), current: z.boolean(), default: z.boolean(), remote: z.boolean() })
export type RepositoryBranch = z.infer<typeof RepositoryBranchSchema>
export const XcSkillsConfigSchema = z.object({
  mode: z.enum(['local', 'remote']).optional(),
  repoPath: z.string().optional(),
  remoteUrl: z.string().optional(),
  defaultBranch: z.string().optional(),
  defaultGroups: z.array(z.string()).optional(),
}).passthrough()
export type XcSkillsConfig = z.infer<typeof XcSkillsConfigSchema>
const NormalizedRepositoryGroupsSchema = z.array(z.string()).transform((groups) =>
  [...new Set(groups.map((group) => group.trim()).filter(Boolean))]
)
export const RepositoryConfigInputSchema = z.object({
  mode: z.enum(['local', 'remote']),
  repoPath: z.string().trim(),
  remoteUrl: z.string().trim(),
  defaultBranch: z.string().trim().min(1, 'default branch required').max(255),
  defaultGroups: NormalizedRepositoryGroupsSchema,
}).strict().superRefine((value, ctx) => {
  if (value.mode === 'local' && !value.repoPath) {
    ctx.addIssue({ code: 'custom', path: ['repoPath'], message: 'local repository path required' })
  }
  if (value.mode === 'remote' && !value.remoteUrl) {
    ctx.addIssue({ code: 'custom', path: ['remoteUrl'], message: 'remote repository URL required' })
  }
})
export type RepositoryConfigInput = z.infer<typeof RepositoryConfigInputSchema>
export const RepositoryConfigUpdateResultSchema = z.object({
  config: XcSkillsConfigSchema,
  repository: RepositoryViewSchema,
})
export type RepositoryConfigUpdateResult = z.infer<typeof RepositoryConfigUpdateResultSchema>

export const AssetRecordSchema = z.object({
  id: safeId,
  type: z.enum(['skills', 'rules', 'workflows']),
  name: safeName,
  group: z.string(),
  path: safeAbsolutePath,
  entryPath: safeAbsolutePath,
  entryState: z.enum(['active', 'frozen', 'conflict', 'invalid']),
  description: z.string(),
  version: z.string().nullable(),
  agentId: safeId.optional(),
})
export type AssetRecord = z.infer<typeof AssetRecordSchema>
export const AssetDetailSchema = AssetRecordSchema.extend({ markdown: z.string().nullable(), evolution: z.string().nullable(), files: z.array(z.object({ relativePath: z.string(), size: z.number().int().nonnegative(), kind: z.enum(['text', 'binary']) })) })
export type AssetDetail = z.infer<typeof AssetDetailSchema>
export const AssetStatusRecordSchema = z.object({ status: z.enum(['not_installed', 'current', 'update_available', 'locally_modified', 'frozen', 'broken_link', 'conflict', 'invalid', 'unknown']), updateAvailable: z.boolean(), locallyModified: z.boolean(), sourceHash: z.string().nullable(), installedHash: z.string().nullable(), sourceVersion: z.string().nullable(), installedVersion: z.string().nullable(), resolvedTarget: z.string().nullable(), reason: z.string() })
export type AssetStatusRecord = z.infer<typeof AssetStatusRecordSchema>

export const OperationTargetSchema = z.object({
  scope: z.enum(['project', 'global']),
  projectId: safeId.optional(),
  agentId: safeId,
}).superRefine((value, ctx) => {
  if (value.scope === 'project' && !value.projectId) ctx.addIssue({ code: 'custom', path: ['projectId'], message: 'projectId required' })
  if (value.scope === 'global' && value.projectId) ctx.addIssue({ code: 'custom', path: ['projectId'], message: 'projectId forbidden' })
})
export type OperationTarget = z.infer<typeof OperationTargetSchema>
export const OperationKindSchema = z.enum(['install', 'update', 'uninstall', 'freeze', 'thaw'])
export type OperationKind = z.infer<typeof OperationKindSchema>
export const InstallMethodSchema = z.enum(['copy', 'symlink'])
export type InstallMethod = z.infer<typeof InstallMethodSchema>
export const OperationRequestSchema = z.object({
  kind: OperationKindSchema,
  asset: AssetSelectionSchema,
  target: OperationTargetSchema,
  method: InstallMethodSchema.nullable(),
  overwriteModified: z.boolean().optional(),
})
export type OperationRequest = z.infer<typeof OperationRequestSchema>
export const OperationStepSchema = z.object({ kind: z.enum(['ensure_dir', 'copy', 'symlink', 'backup', 'remove', 'rename']), source: z.string().optional(), target: safeAbsolutePath })
export const OperationPlanSchema = z.object({ id: safeId, kind: OperationKindSchema, asset: AssetRecordSchema.pick({ id: true, name: true, type: true, path: true }), sourceBranch: z.string(), sourceHash: z.string(), targetRoot: safeAbsolutePath, targetPath: safeAbsolutePath, method: InstallMethodSchema.nullable(), steps: z.array(OperationStepSchema), warnings: z.array(z.string()), requiresOverwriteConfirmation: z.boolean() })
export type OperationPlan = z.infer<typeof OperationPlanSchema>
export const OperationResultSchema = z.object({ planId: safeId, status: z.enum(['completed', 'cancelled', 'rolled_back', 'needs_attention']), affectedPaths: z.array(z.string()), residualPaths: z.array(z.string()) })
export type OperationResult = z.infer<typeof OperationResultSchema>
export const OperationProgressSchema = z.object({ planId: safeId, completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), message: z.string() })
export type OperationProgress = z.infer<typeof OperationProgressSchema>

export const ExternalUrlSchema = z.string().url().refine((value) => {
  try { return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol) } catch { return false }
}, 'only http, https, and mailto URLs are allowed')

export interface DesktopApi {
  projects: { list(): Promise<ProjectRecord[]>; chooseAndAdd(): Promise<ProjectRecord | null>; remove(id: string): Promise<void> }
  agents: { list(): Promise<AgentDefinition[]>; setEnabled(id: string, enabled: boolean): Promise<AgentDefinition[]>; saveCustom(agent: AgentDefinition): Promise<AgentDefinition[]>; removeCustom(id: string): Promise<AgentDefinition[]> }
  repositories: {
    getConfig(): Promise<XcSkillsConfig>
    chooseLocalPath(): Promise<string | null>
    updateConfig(input: RepositoryConfigInput): Promise<RepositoryConfigUpdateResult>
    listBranches(): Promise<RepositoryBranch[]>
    selectBranch(branch: string): Promise<RepositoryView>
    setDefaultBranch(branch: string): Promise<XcSkillsConfig>
    refresh(): Promise<RepositoryView>
  }
  assets: { scan(source: SourceSelection): Promise<AssetRecord[]>; detail(asset: AssetSelection): Promise<AssetDetail>; statuses(asset: AssetSelection): Promise<Array<{ projectId: string | null; agentId: string; path: string; method: InstallMethod | null; status: AssetStatusRecord }>> }
  operations: { plan(input: OperationRequest): Promise<OperationPlan>; execute(planId: string): Promise<OperationResult>; cancel(planId: string): Promise<void>; onProgress(listener: (progress: OperationProgress) => void): () => void }
  preferences: { getTheme(): Promise<ThemePreference>; setTheme(theme: ThemePreference): Promise<void>; getLastSource(): Promise<SourceSelection> }
  system: { openExternal(url: string): Promise<void> }
}

export const Channels = {
  projectsList: 'projects:list', projectsChooseAndAdd: 'projects:chooseAndAdd', projectsRemove: 'projects:remove',
  agentsList: 'agents:list', agentsSetEnabled: 'agents:setEnabled', agentsSaveCustom: 'agents:saveCustom', agentsRemoveCustom: 'agents:removeCustom',
  repositoriesGetConfig: 'repositories:getConfig', repositoriesChooseLocalPath: 'repositories:chooseLocalPath', repositoriesUpdateConfig: 'repositories:updateConfig', repositoriesListBranches: 'repositories:listBranches', repositoriesSelectBranch: 'repositories:selectBranch', repositoriesSetDefaultBranch: 'repositories:setDefaultBranch', repositoriesRefresh: 'repositories:refresh',
  assetsScan: 'assets:scan', assetsDetail: 'assets:detail', assetsStatuses: 'assets:statuses',
  operationsPlan: 'operations:plan', operationsExecute: 'operations:execute', operationsCancel: 'operations:cancel', operationsProgress: 'operations:progress',
  preferencesGetTheme: 'preferences:getTheme', preferencesSetTheme: 'preferences:setTheme', preferencesGetLastSource: 'preferences:getLastSource', systemOpenExternal: 'system:openExternal',
} as const
/** Stable alias for Main/Preload consumers that prefer an explicit channel namespace. */
export const IPC_CHANNELS = Channels

export const DesktopStateDefaults: DesktopState = { version: 1, projects: [], customAgents: [], agentEnabled: {}, theme: 'system', lastSource: { kind: 'central' }, windowBounds: null }
