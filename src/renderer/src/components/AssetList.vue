<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu, ElTable, ElTableColumn, ElTag } from 'element-plus'
import type { TableInstance } from 'element-plus'
import type { AssetRecord, SourceSelection } from '../../../shared/ipc.js'
import { assetStatusLabel } from '../lib/asset-status-label'
import {
  batchActionEligibility,
  overflowAssetActions,
  primaryAssetAction,
  type AssetAction,
  type BatchActionKind,
} from '../lib/asset-actions'
import emptyResourcesIllustration from '../assets/empty-resources.svg'
import emptySearchIllustration from '../assets/empty-search.svg'

type StatusLocation = Awaited<ReturnType<NonNullable<Window['xcSkills']>['assets']['statuses']>>[number]

const props = withDefaults(defineProps<{
  assets: AssetRecord[]
  selectedId: string | null
  selectedIds?: string[]
  sourceKind: SourceSelection['kind']
  agentName: (agentId?: string) => string
  managementStatuses?: Record<string, StatusLocation[]>
  loading: boolean
  error: string | null
  query: string
  groupFilter: string
  statusFilter: string
  agentFilter: string
}>(), { managementStatuses: () => ({}), selectedIds: () => [] })

const emit = defineEmits<{
  select: [id: string]
  action: [kind: string, asset: AssetRecord, location?: StatusLocation]
  'update:selectedIds': [ids: string[]]
  'batch-action': [kind: BatchActionKind, assets: AssetRecord[]]
  'clear-filters': []
}>()

const filteredAssets = computed(() => props.assets
  .filter((asset) => asset.name.toLowerCase().includes(props.query.toLowerCase()) || asset.description.toLowerCase().includes(props.query.toLowerCase()))
  .filter((asset) => props.groupFilter === 'all' || asset.group === props.groupFilter)
  .filter((asset) => props.statusFilter === 'all' || asset.entryState === props.statusFilter)
  .filter((asset) => props.agentFilter === 'all' || asset.agentId === props.agentFilter))

const selectedIdSet = computed(() => new Set(props.selectedIds))
const selectedAssets = computed(() => props.assets.filter((asset) => selectedIdSet.value.has(asset.id)))
const filteredIds = computed(() => filteredAssets.value.map((asset) => asset.id))
const table = ref<TableInstance>()
let syncingTableSelection = false

const batchActions = computed<{ kind: BatchActionKind; label: string }[]>(() => (
  props.sourceKind === 'central' || props.sourceKind === 'third-party'
    ? [{ kind: 'install', label: '批量安装' }]
    : [
        { kind: 'update', label: '批量更新' },
        { kind: 'freeze', label: '批量冻结' },
        { kind: 'thaw', label: '批量解冻' },
        { kind: 'uninstall', label: '批量卸载' },
      ]
))

const syncTableSelection = async (): Promise<void> => {
  await nextTick()
  if (!table.value) return
  syncingTableSelection = true
  table.value.clearSelection()
  for (const asset of filteredAssets.value) {
    if (selectedIdSet.value.has(asset.id)) table.value.toggleRowSelection(asset, true)
  }
  syncingTableSelection = false
}

watch([filteredIds, () => props.selectedIds], () => { void syncTableSelection() }, {
  deep: true,
  immediate: true,
  flush: 'post',
})

const updateTableSelection = (rows: AssetRecord[]): void => {
  if (syncingTableSelection) return
  const filteredIdSet = new Set(filteredIds.value)
  const next = props.selectedIds.filter((id) => !filteredIdSet.has(id))
  emit('update:selectedIds', [...next, ...rows.map((asset) => asset.id)])
}

const batchIssues = (action: BatchActionKind): string[] => selectedAssets.value.flatMap((asset) => {
  const eligibility = batchActionEligibility({
    action,
    sourceKind: props.sourceKind,
    asset,
    location: locationFor(asset),
  })
  return eligibility.eligible ? [] : [`${asset.name}：${eligibility.reason}`]
})

const runBatchAction = (action: BatchActionKind): void => {
  if (!selectedAssets.value.length || batchIssues(action).length) return
  emit('batch-action', action, selectedAssets.value)
}

const entryStatusLabel = (status: AssetRecord['entryState']): string => ({
  active: '正常', frozen: '已冻结', conflict: '冲突', invalid: '无效',
})[status]

const entryStatusType = (status: AssetRecord['entryState']): 'success' | 'warning' | 'danger' | 'info' => ({
  active: 'success' as const, frozen: 'info' as const, conflict: 'warning' as const, invalid: 'danger' as const,
})[status]

const isRepositorySource = (): boolean => props.sourceKind === 'central' || props.sourceKind === 'third-party'
const locationsFor = (asset: AssetRecord): StatusLocation[] => props.managementStatuses[asset.id] ?? []
const locationFor = (asset: AssetRecord): StatusLocation | null => props.managementStatuses[asset.id]?.[0] ?? null
const installationMethod = (asset: AssetRecord): 'copy' | 'symlink' | 'unmanaged' | null => {
  if (props.sourceKind === 'central' || props.sourceKind === 'third-party') return null
  return locationFor(asset)?.method ?? 'unmanaged'
}
const installationMethodLabel = (asset: AssetRecord): string => ({
  copy: '复制',
  symlink: '软链接',
  unmanaged: '未受管',
})[installationMethod(asset) ?? 'unmanaged']

const repositoryStatusFor = (asset: AssetRecord): StatusLocation['status'] | null => {
  const locations = locationsFor(asset)
  if (!isRepositorySource() || !locations.length) return null
  const priority: Array<StatusLocation['status']['status']> = [
    'broken_link',
    'conflict',
    'invalid',
    'locally_modified',
    'update_available',
    'frozen',
    'current',
    'source_unavailable',
    'unknown',
    'not_installed',
  ]
  return priority
    .map((status) => locations.find((location) => location.status.status === status)?.status)
    .find(Boolean) ?? null
}

const statusForDisplay = (asset: AssetRecord): StatusLocation['status'] | null => (
  repositoryStatusFor(asset) ?? locationFor(asset)?.status ?? null
)

const displayStatus = (asset: AssetRecord): string => {
  const status = statusForDisplay(asset)
  if (!status) return entryStatusLabel(asset.entryState)
  if (isRepositorySource() && status.status === 'current') return '已安装'
  return assetStatusLabel(status)
}
const displayStatusType = (asset: AssetRecord): 'success' | 'warning' | 'danger' | 'info' => {
  const status = statusForDisplay(asset)?.status
  if (status === 'update_available' || status === 'locally_modified' || status === 'frozen') return 'warning'
  if (status === 'broken_link' || status === 'conflict' || status === 'invalid') return 'danger'
  if (status === 'unknown' || status === 'source_unavailable') return 'info'
  return entryStatusType(asset.entryState)
}

const primaryAction = (asset: AssetRecord): AssetAction | null => primaryAssetAction({
  sourceKind: props.sourceKind,
  asset,
  location: locationFor(asset),
})

const overflowActions = (asset: AssetRecord): AssetAction[] => overflowAssetActions({
  sourceKind: props.sourceKind,
  asset,
  location: locationFor(asset),
})

const runAction = (action: AssetAction, asset: AssetRecord): void => {
  const location = locationFor(asset)
  if (props.sourceKind === 'central' || props.sourceKind === 'third-party') emit('action', action.kind, asset)
  else if (location) emit('action', action.kind, asset, location)
}

const tableRowClassName = ({ row }: { row: AssetRecord }): string => (
  row.id === props.selectedId ? 'asset-table-row selected' : 'asset-table-row'
)
const asAsset = (row: unknown): AssetRecord => row as AssetRecord
</script>

<template>
  <div v-if="loading" class="asset-state" role="status">正在加载资源…</div>
  <div v-else-if="error" class="asset-state error">加载资源失败，请查看上方提示。</div>
  <section v-else-if="!assets.length" class="asset-empty-state" aria-labelledby="empty-source-title">
    <img :src="emptyResourcesIllustration" alt="" aria-hidden="true" />
    <h2 id="empty-source-title">这里还没有资源</h2>
    <p>当前来源的这个分类暂时为空，可以切换分类或刷新后再查看。</p>
  </section>
  <section v-else-if="!filteredAssets.length" class="asset-empty-state" aria-labelledby="empty-search-title">
    <img :src="emptySearchIllustration" alt="" aria-hidden="true" />
    <h2 id="empty-search-title">没有找到匹配资源</h2>
    <p>换个关键词试试，或者清除当前的搜索和筛选条件。</p>
    <ElButton type="primary" plain @click="emit('clear-filters')">清除筛选</ElButton>
  </section>
  <div v-else class="asset-results">
    <div class="asset-selection-toolbar" role="toolbar" aria-label="资源批量操作">
      <span class="asset-selection-count">已选择 {{ selectedAssets.length }} 项</span>
      <div class="asset-batch-actions">
        <div v-for="batchAction in batchActions" :key="batchAction.kind" class="asset-batch-action">
          <ElButton
            :type="batchAction.kind === 'uninstall' ? 'danger' : 'primary'"
            :plain="batchAction.kind !== 'uninstall'"
            size="small"
            :disabled="!selectedAssets.length || batchIssues(batchAction.kind).length > 0"
            @click="runBatchAction(batchAction.kind)"
          >{{ batchAction.label }}</ElButton>
        </div>
        <ElButton text size="small" :disabled="!selectedAssets.length" @click="emit('update:selectedIds', [])">清空选择</ElButton>
      </div>
    </div>

    <ElTable
      ref="table"
      class="asset-table"
      :data="filteredAssets"
      row-key="id"
      height="100%"
      :row-class-name="tableRowClassName"
      @selection-change="updateTableSelection"
      @select-all="updateTableSelection"
    >
      <ElTableColumn type="selection" width="54" align="center" reserve-selection />
      <ElTableColumn label="资源" min-width="420">
        <template #default="{ row }">
          <template v-for="asset in [asAsset(row)]" :key="asset.id">
          <button class="asset-row-main" :aria-label="`查看 ${asset.name}`" @click.stop="emit('select', asset.id)">
            <span class="asset-copy">
              <span class="asset-name-line">
                <strong>{{ asset.name }}</strong>
              </span>
              <span
                v-if="(sourceKind !== 'central' && asset.agentId) || installationMethod(asset)"
                class="asset-tag-line"
              >
                <ElTag v-if="sourceKind !== 'central' && asset.agentId" class="platform-tag" effect="plain" size="small">
                  {{ agentName(asset.agentId) }}
                </ElTag>
                <ElTag
                  v-if="installationMethod(asset)"
                  class="installation-method-tag"
                  :class="`is-${installationMethod(asset)}`"
                  effect="plain"
                  size="small"
                >{{ installationMethodLabel(asset) }}</ElTag>
              </span>
              <small v-if="asset.group || asset.description" class="asset-meta-line">
                <span v-if="asset.group">{{ asset.group }}</span>
                <span v-if="asset.group && asset.description" aria-hidden="true"> · </span>
                <span v-if="asset.description">{{ asset.description }}</span>
              </small>
            </span>
          </button>
          </template>
        </template>
      </ElTableColumn>
      <ElTableColumn label="状态" width="116" align="right">
        <template #default="{ row }">
          <template v-for="asset in [asAsset(row)]" :key="asset.id">
          <ElTag class="status-tag" :type="displayStatusType(asset)" effect="plain" size="small">{{ displayStatus(asset) }}</ElTag>
          </template>
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="154" align="right">
        <template #default="{ row }">
          <template v-for="asset in [asAsset(row)]" :key="asset.id">
          <div class="asset-row-management" @click.stop>
            <ElButton
              v-if="primaryAction(asset)"
              class="asset-primary-action"
              :type="primaryAction(asset)!.kind === 'uninstall' ? 'danger' : 'primary'"
              plain
              size="small"
              :aria-label="`${primaryAction(asset)!.label} ${asset.name}`"
              @click="runAction(primaryAction(asset)!, asset)"
            >{{ primaryAction(asset)!.label }}</ElButton>
            <ElDropdown v-if="overflowActions(asset).length" trigger="click" @command="(kind: string) => runAction(overflowActions(asset).find((item) => item.kind === kind)!, asset)">
              <ElButton class="asset-overflow-action" text size="small" :aria-label="`更多操作 ${asset.name}`">···</ElButton>
              <template #dropdown>
                <ElDropdownMenu>
                  <ElDropdownItem v-for="action in overflowActions(asset)" :key="action.kind" :command="action.kind" :class="{ 'is-danger': action.kind === 'uninstall' }">{{ action.label }}</ElDropdownItem>
                </ElDropdownMenu>
              </template>
            </ElDropdown>
          </div>
          </template>
        </template>
      </ElTableColumn>
    </ElTable>
  </div>
</template>
