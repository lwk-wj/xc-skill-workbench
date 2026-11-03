import { z } from 'zod'

export const ThemePreferenceSchema = z.enum(['light', 'dark', 'system'])
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>

const safeId = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/)
const safeName = z.string().min(1).max(200)
const gitBranch = z.string().trim().min(1).max(255).refine((value) =>
  !value.startsWith('-')
  && !value.startsWith('.')
  && !value.endsWith('.')
  && !value.endsWith('/')
  && !value.endsWith('.lock')
  && !value.includes('..')
  && !value.includes('@{')
  && !value.includes('//')
  && !/[\u0000-\u0020\u007f~^:?*[\\]/u.test(value),
'invalid Git branch')
const gitRemoteUrl = z.string().trim().min(1).refine((value) => {
  if (/^[^/@\s]+@[^/:\s]+:.+$/u.test(value)) return true
  try {
    const url = new URL(value)
    if (!['https:', 'ssh:'].includes(url.protocol) || url.password) return false
    if (url.protocol === 'https:' && url.username) return false
    return Boolean(url.hostname && url.pathname && url.pathname !== '/')
  } catch { return false }
}, 'remote repository must use credential-free HTTPS, SSH, or SCP syntax')
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

const LegacySourceSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('central') }).strict(),
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('project'), projectId: safeId }).strict(),
])
export const SourceSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('central') }).strict(),
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('project'), projectId: safeId }).strict(),
  z.object({ kind: z.literal('third-party'), repositoryId: safeId }).strict(),
])
export type SourceSelection = z.infer<typeof SourceSelectionSchema>

const skillRootRelativePath = z.string().trim().min(1).max(1000).refine((value) => {
  if (value.includes('\0') || value.includes('\\')) return false
  if (value.startsWith('/') || /^[A-Za-z]:\//u.test(value)) return false
  if (value === '.') return true
  const parts = value.split('/')
  return parts.every((part) => part !== '' && part !== '.' && part !== '..')
}, 'Skill root must be a safe repository-relative path')

export const ThirdPartySkillRootSchema = z.object({
  relativePath: skillRootRelativePath,
  group: z.string().trim().max(200).refine((value) =>
    !value.includes('/') && !value.includes('\\') && !/[\u0000-\u001f\u007f]/u.test(value),
  'invalid Skill group'),
}).strict()
export type ThirdPartySkillRoot = z.infer<typeof ThirdPartySkillRootSchema>

const ThirdPartySkillRootsSchema = z.array(ThirdPartySkillRootSchema).max(50).superRefine((roots, ctx) => {
  const seen = new Set<string>()
  roots.forEach((root, index) => {
    if (seen.has(root.relativePath)) {
      ctx.addIssue({ code: 'custom', path: [index, 'relativePath'], message: 'duplicate Skill root path' })
    }
    seen.add(root.relativePath)
  })
})

export const ThirdPartyRepositorySchema = z.object({
  id: safeId,
  name: safeName,
  url: gitRemoteUrl,
  branch: gitBranch,
  layout: z.enum(['catalog', 'single-skill']),
  skillRoots: ThirdPartySkillRootsSchema.default([]),
  createdAt: z.string().datetime(),
  lastFetchedAt: z.string().datetime().nullable(),
}).strict()
export type ThirdPartyRepository = z.infer<typeof ThirdPartyRepositorySchema>

export const ThirdPartyRepositoryInputSchema = z.object({
  url: gitRemoteUrl,
  name: z.string().trim().min(1).max(200).optional(),
  branch: gitBranch.optional(),
  skillRoots: ThirdPartySkillRootsSchema.optional(),
}).strict()
export type ThirdPartyRepositoryInput = z.infer<typeof ThirdPartyRepositoryInputSchema>

export const ThirdPartyRepositoryViewSchema = ThirdPartyRepositorySchema.extend({
  skillCount: z.number().int().nonnegative(),
  stale: z.boolean(),
  cachedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
}).strict()
export type ThirdPartyRepositoryView = z.infer<typeof ThirdPartyRepositoryViewSchema>

export const RelinkInstallationInputSchema = z.object({
  installationId: safeId,
  repositoryId: safeId,
  assetId: safeId,
}).strict()
export type RelinkInstallationInput = z.infer<typeof RelinkInstallationInputSchema>

const InstallationSourceSnapshotSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('central'),
    repositoryId: z.null(),
    repositoryName: safeName,
    repositoryUrl: z.null(),
  }).strict(),
  z.object({
    kind: z.literal('third-party'),
    repositoryId: safeId,
    repositoryName: safeName,
    repositoryUrl: z.string().trim().min(1),
  }).strict(),
])
export const InstallationSourceRecordSchema = z.object({
  id: safeId,
  scope: z.enum(['project', 'global']),
  projectId: safeId.nullable(),
  agentId: safeId,
  targetPath: safeAbsolutePath,
  asset: z.object({ type: z.enum(['skills', 'rules', 'workflows']), group: z.string(), name: safeName }).strict(),
  source: InstallationSourceSnapshotSchema,
  installedCommit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u).nullable(),
  installedHash: z.string().min(1),
  managedAssetId: z.string().regex(/^[0-9a-f]{64}$/u).nullable().optional(),
  method: z.enum(['copy', 'symlink']).optional(),
  frozen: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.scope === 'project' && !value.projectId) {
    ctx.addIssue({ code: 'custom', path: ['projectId'], message: 'projectId required' })
  }
  if (value.scope === 'global' && value.projectId !== null) {
    ctx.addIssue({ code: 'custom', path: ['projectId'], message: 'projectId forbidden' })
  }
})
export type InstallationSourceRecord = z.infer<typeof InstallationSourceRecordSchema>

export const WindowBoundsSchema = z.object({
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().int().min(320).max(10000),
  height: z.number().int().min(240).max(10000),
})
export type WindowBounds = z.infer<typeof WindowBoundsSchema>

export const DesktopStateV1Schema = z.object({
  version: z.literal(1),
  projects: z.array(ProjectRecordSchema),
  customAgents: z.array(AgentDefinitionSchema),
  agentEnabled: z.record(safeId, z.boolean()).default({}),
  theme: ThemePreferenceSchema,
  lastSource: LegacySourceSelectionSchema,
  windowBounds: WindowBoundsSchema.nullable(),
})
export type DesktopStateV1 = z.infer<typeof DesktopStateV1Schema>

export const DesktopStateV2Schema = z.object({
  version: z.literal(2),
  projects: z.array(ProjectRecordSchema),
  customAgents: z.array(AgentDefinitionSchema),
  agentEnabled: z.record(safeId, z.boolean()).default({}),
  theme: ThemePreferenceSchema,
  lastSource: SourceSelectionSchema,
  windowBounds: WindowBoundsSchema.nullable(),
  thirdPartyRepositories: z.array(ThirdPartyRepositorySchema),
  installationSources: z.array(InstallationSourceRecordSchema),
})
export type DesktopStateV2 = z.infer<typeof DesktopStateV2Schema>
export const DesktopStateSchema = z.object({
  version: z.literal(3),
  projects: z.array(ProjectRecordSchema),
  customAgents: z.array(AgentDefinitionSchema),
  agentEnabled: z.record(safeId, z.boolean()).default({}),
  theme: ThemePreferenceSchema,
  lastSource: SourceSelectionSchema,
  windowBounds: WindowBoundsSchema.nullable(),
  thirdPartyRepositories: z.array(ThirdPartyRepositorySchema),
  legacyInstallationSources: z.array(InstallationSourceRecordSchema),
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
  assetStorePath: safeAbsolutePath.optional(),
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
  assetStorePath: safeAbsolutePath.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.mode === 'local' && !value.repoPath) {
    ctx.addIssue({ code: 'custom', path: ['repoPath'], message: 'local repository path required' })
  }
  if (value.mode === 'remote' && !value.remoteUrl) {
    ctx.addIssue({ code: 'custom', path: ['remoteUrl'], message: 'remote repository URL required' })
  }
})
export type RepositoryConfigInput = z.infer<typeof RepositoryConfigInputSchema>
export const AssetStoreMigrationPreviewSchema = z.object({
  token: safeId,
  fromPath: safeAbsolutePath,
  toPath: safeAbsolutePath,
  entityCount: z.number().int().nonnegative(),
  symlinkTargets: z.array(safeAbsolutePath),
  copyTargets: z.array(safeAbsolutePath),
  conflicts: z.array(z.object({ path: safeAbsolutePath, reason: z.string().min(1) }).strict()),
  expiresAt: z.string().datetime(),
}).strict()
export type AssetStoreMigrationPreview = z.infer<typeof AssetStoreMigrationPreviewSchema>
export const LegacyInstallationMigrationPreviewSchema = z.object({
  token: safeId,
  candidates: z.array(z.object({
    recordId: safeId,
    targetPath: safeAbsolutePath,
    sourceLabel: z.string().min(1),
    method: z.enum(['copy', 'symlink']),
  }).strict()),
  conflicts: z.array(z.object({ recordId: safeId, targetPath: safeAbsolutePath, reason: z.string().min(1) }).strict()),
  expiresAt: z.string().datetime(),
}).strict()
export type LegacyInstallationMigrationPreview = z.infer<typeof LegacyInstallationMigrationPreviewSchema>
export const SourceLayoutMigrationPreviewSchema = z.object({
  token: safeId,
  moves: z.array(z.object({
    entityId: safeId,
    fromRelativePath: skillRootRelativePath,
    toRelativePath: skillRootRelativePath,
    sourceRelativePath: skillRootRelativePath,
  }).strict()),
  unresolved: z.array(z.object({
    entityId: safeId,
    fromRelativePath: skillRootRelativePath,
    reason: z.enum(['source-unavailable', 'not-found', 'ambiguous']),
    candidateAssetIds: z.array(safeId),
  }).strict()),
  symlinkCount: z.number().int().nonnegative(),
  copyCount: z.number().int().nonnegative(),
  conflicts: z.array(z.object({ path: safeAbsolutePath, reason: z.string().min(1) }).strict()),
  expiresAt: z.string().datetime(),
}).strict()
export type SourceLayoutMigrationPreview = z.infer<typeof SourceLayoutMigrationPreviewSchema>
export const ManagedEntityRepairPreviewSchema = z.object({
  installationId: safeId,
  entityId: safeId,
  candidates: z.array(z.object({
    candidateToken: safeId,
    repositoryLabel: safeName,
    sourceRelativePath: skillRootRelativePath,
  }).strict()),
  expiresAt: z.string().datetime(),
}).strict()
export type ManagedEntityRepairPreview = z.infer<typeof ManagedEntityRepairPreviewSchema>
export const ManagedEntityRepairResultSchema = z.object({
  installationId: safeId,
  entityId: safeId,
  fromRelativePath: skillRootRelativePath,
  toRelativePath: skillRootRelativePath,
  rebuiltSymlinkCount: z.number().int().nonnegative(),
}).strict()
export type ManagedEntityRepairResult = z.infer<typeof ManagedEntityRepairResultSchema>
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
  sourceRelativePath: skillRootRelativePath,
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
export const AssetStatusRecordSchema = z.object({ status: z.enum(['not_installed', 'current', 'update_available', 'locally_modified', 'frozen', 'broken_link', 'conflict', 'invalid', 'unknown', 'source_unavailable']), updateAvailable: z.boolean(), locallyModified: z.boolean(), sourceHash: z.string().nullable(), installedHash: z.string().nullable(), sourceVersion: z.string().nullable(), installedVersion: z.string().nullable(), resolvedTarget: z.string().nullable(), reason: z.string() })
export type AssetStatusRecord = z.infer<typeof AssetStatusRecordSchema>
export type AssetStatusLocation = {
  projectId: string | null
  agentId: string
  path: string
  method: InstallMethod | null
  installationId?: string | null
  status: AssetStatusRecord
}

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
  replaceExistingSource: z.boolean().optional(),
}).strict()
export type OperationRequest = z.infer<typeof OperationRequestSchema>
export const SourceConflictPartySchema = z.object({
  kind: z.enum(['central', 'third-party', 'untracked']),
  repositoryId: safeId.nullable(),
  label: z.string().min(1),
}).strict()
export const SourceConflictSchema = z.object({
  targetPath: safeAbsolutePath,
  existing: SourceConflictPartySchema,
  requested: SourceConflictPartySchema,
}).strict()
export type SourceConflict = z.infer<typeof SourceConflictSchema>
export const OperationStepSchema = z.object({ kind: z.enum(['ensure_dir', 'copy', 'symlink', 'backup', 'remove', 'rename']), source: z.string().optional(), target: safeAbsolutePath })
export const OperationPlanSchema = z.object({ id: safeId, kind: OperationKindSchema, asset: AssetRecordSchema.pick({ id: true, name: true, type: true, path: true }), sourceBranch: z.string(), sourceHash: z.string(), targetRoot: safeAbsolutePath, targetPath: safeAbsolutePath, method: InstallMethodSchema.nullable(), steps: z.array(OperationStepSchema), warnings: z.array(z.string()), requiresOverwriteConfirmation: z.boolean() })
export type OperationPlan = z.infer<typeof OperationPlanSchema>
export const OperationResultSchema = z.object({ planId: safeId, status: z.enum(['completed', 'cancelled', 'rolled_back', 'needs_attention']), affectedPaths: z.array(z.string()), residualPaths: z.array(z.string()) })
export type OperationResult = z.infer<typeof OperationResultSchema>
export const OperationProgressSchema = z.object({ planId: safeId, completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), message: z.string() })
export type OperationProgress = z.infer<typeof OperationProgressSchema>

const publishGroup = z.string().trim().max(200).refine((value) =>
  !value.includes('/') && !value.includes('\\') && !/[\u0000-\u001f\u007f]/u.test(value),
'invalid publish group')
export const PublishRequestSchema = z.object({
  asset: AssetSelectionSchema,
  targetGroup: publishGroup,
}).strict().superRefine((value, ctx) => {
  if (value.asset.source.kind !== 'project' && value.asset.source.kind !== 'global') {
    ctx.addIssue({ code: 'custom', path: ['asset', 'source'], message: 'only installed resources can be published' })
  }
})
export type PublishRequest = z.infer<typeof PublishRequestSchema>
export const PublishPreviewSchema = z.object({
  token: safeId,
  assetName: safeName,
  assetType: z.enum(['skills', 'rules', 'workflows']),
  sourcePath: safeAbsolutePath,
  targetRelativePath: skillRootRelativePath,
  branch: gitBranch,
  remoteUrl: z.string().trim().min(1),
  change: z.enum(['create', 'replace']),
  warnings: z.array(z.string()),
  expiresAt: z.string().datetime(),
}).strict()
export type PublishPreview = z.infer<typeof PublishPreviewSchema>
export const PublishResultSchema = z.object({
  status: z.enum(['published', 'unchanged']),
  commit: z.string().regex(/^[0-9a-f]{40}$/u).nullable(),
  branch: gitBranch,
  targetRelativePath: skillRootRelativePath,
}).strict()
export type PublishResult = z.infer<typeof PublishResultSchema>

export const ExternalUrlSchema = z.string().url().refine((value) => {
  try { return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol) } catch { return false }
}, 'only http, https, and mailto URLs are allowed')

export interface DesktopApi {
  projects: { list(): Promise<ProjectRecord[]>; chooseAndAdd(): Promise<ProjectRecord | null>; remove(id: string): Promise<void> }
  agents: { list(): Promise<AgentDefinition[]>; setEnabled(id: string, enabled: boolean): Promise<AgentDefinition[]>; saveCustom(agent: AgentDefinition): Promise<AgentDefinition[]>; removeCustom(id: string): Promise<AgentDefinition[]> }
  repositories: {
    getConfig(): Promise<XcSkillsConfig>
    current(): Promise<RepositoryView>
    chooseLocalPath(): Promise<string | null>
    chooseAssetStorePath(): Promise<string | null>
    previewAssetStoreMigration(path: string): Promise<AssetStoreMigrationPreview>
    executeAssetStoreMigration(token: string): Promise<XcSkillsConfig>
    previewLegacyInstallationMigration(): Promise<LegacyInstallationMigrationPreview>
    executeLegacyInstallationMigration(token: string): Promise<LegacyInstallationMigrationPreview>
    previewSourceLayoutMigration(): Promise<SourceLayoutMigrationPreview>
    executeSourceLayoutMigration(token: string): Promise<SourceLayoutMigrationPreview>
    previewManagedEntityRepair(installationId: string): Promise<ManagedEntityRepairPreview>
    executeManagedEntityRepair(candidateToken: string): Promise<ManagedEntityRepairResult>
    updateConfig(input: RepositoryConfigInput): Promise<RepositoryConfigUpdateResult>
    listBranches(): Promise<RepositoryBranch[]>
    selectBranch(branch: string): Promise<RepositoryView>
    setDefaultBranch(branch: string): Promise<XcSkillsConfig>
    refresh(): Promise<RepositoryView>
  }
  thirdPartyRepositories: {
    list(): Promise<ThirdPartyRepositoryView[]>
    add(input: ThirdPartyRepositoryInput): Promise<ThirdPartyRepositoryView>
    update(id: string, input: ThirdPartyRepositoryInput): Promise<ThirdPartyRepositoryView>
    remove(id: string): Promise<void>
    refresh(id: string): Promise<ThirdPartyRepositoryView>
    relinkInstallation(input: RelinkInstallationInput): Promise<void>
  }
  assets: { scan(source: SourceSelection): Promise<AssetRecord[]>; detail(asset: AssetSelection): Promise<AssetDetail>; statuses(asset: AssetSelection): Promise<AssetStatusLocation[]> }
  publishing: { preview(input: PublishRequest): Promise<PublishPreview>; execute(token: string): Promise<PublishResult> }
  operations: { inspectSourceConflict(input: OperationRequest): Promise<SourceConflict | null>; plan(input: OperationRequest): Promise<OperationPlan>; execute(planId: string): Promise<OperationResult>; cancel(planId: string): Promise<void>; onProgress(listener: (progress: OperationProgress) => void): () => void }
  preferences: { getTheme(): Promise<ThemePreference>; setTheme(theme: ThemePreference): Promise<void>; getLastSource(): Promise<SourceSelection> }
  system: { openExternal(url: string): Promise<void> }
}

export const Channels = {
  projectsList: 'projects:list', projectsChooseAndAdd: 'projects:chooseAndAdd', projectsRemove: 'projects:remove',
  agentsList: 'agents:list', agentsSetEnabled: 'agents:setEnabled', agentsSaveCustom: 'agents:saveCustom', agentsRemoveCustom: 'agents:removeCustom',
  repositoriesGetConfig: 'repositories:getConfig', repositoriesCurrent: 'repositories:current', repositoriesChooseLocalPath: 'repositories:chooseLocalPath', repositoriesChooseAssetStorePath: 'repositories:chooseAssetStorePath', repositoriesPreviewAssetStoreMigration: 'repositories:previewAssetStoreMigration', repositoriesExecuteAssetStoreMigration: 'repositories:executeAssetStoreMigration', repositoriesPreviewLegacyInstallationMigration: 'repositories:previewLegacyInstallationMigration', repositoriesExecuteLegacyInstallationMigration: 'repositories:executeLegacyInstallationMigration', repositoriesPreviewSourceLayoutMigration: 'repositories:previewSourceLayoutMigration', repositoriesExecuteSourceLayoutMigration: 'repositories:executeSourceLayoutMigration', repositoriesPreviewManagedEntityRepair: 'repositories:previewManagedEntityRepair', repositoriesExecuteManagedEntityRepair: 'repositories:executeManagedEntityRepair', repositoriesUpdateConfig: 'repositories:updateConfig', repositoriesListBranches: 'repositories:listBranches', repositoriesSelectBranch: 'repositories:selectBranch', repositoriesSetDefaultBranch: 'repositories:setDefaultBranch', repositoriesRefresh: 'repositories:refresh',
  thirdPartyRepositoriesList: 'third-party-repositories:list', thirdPartyRepositoriesAdd: 'third-party-repositories:add', thirdPartyRepositoriesUpdate: 'third-party-repositories:update', thirdPartyRepositoriesRemove: 'third-party-repositories:remove', thirdPartyRepositoriesRefresh: 'third-party-repositories:refresh',
  thirdPartyRepositoriesRelinkInstallation: 'third-party-repositories:relinkInstallation',
  assetsScan: 'assets:scan', assetsDetail: 'assets:detail', assetsStatuses: 'assets:statuses',
  publishingPreview: 'publishing:preview', publishingExecute: 'publishing:execute',
  operationsInspectSourceConflict: 'operations:inspectSourceConflict', operationsPlan: 'operations:plan', operationsExecute: 'operations:execute', operationsCancel: 'operations:cancel', operationsProgress: 'operations:progress',
  preferencesGetTheme: 'preferences:getTheme', preferencesSetTheme: 'preferences:setTheme', preferencesGetLastSource: 'preferences:getLastSource', systemOpenExternal: 'system:openExternal',
} as const
/** Stable alias for Main/Preload consumers that prefer an explicit channel namespace. */
export const IPC_CHANNELS = Channels

export const DesktopStateDefaults: DesktopState = {
  version: 3,
  projects: [],
  customAgents: [],
  agentEnabled: {},
  theme: 'system',
  lastSource: { kind: 'central' },
  windowBounds: null,
  thirdPartyRepositories: [],
  legacyInstallationSources: [],
}
