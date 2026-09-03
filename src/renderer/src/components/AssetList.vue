<script setup lang="ts">
import { computed } from 'vue'
import { ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu, ElTag } from 'element-plus'
import type { AssetRecord, SourceSelection } from '../../../shared/ipc.js'
import { assetStatusLabel } from '../lib/asset-status-label'
import { overflowAssetActions, primaryAssetAction, type AssetAction } from '../lib/asset-actions'
import emptyResourcesIllustration from '../assets/empty-resources.svg'
import emptySearchIllustration from '../assets/empty-search.svg'

type StatusLocation = Awaited<ReturnType<NonNullable<Window['xcSkills']>['assets']['statuses']>>[number]

const props = withDefaults(defineProps<{
  assets: AssetRecord[]
  selectedId: string | null
  sourceKind: SourceSelection['kind']
  agentName: (agentId?: string) => string
  managementStatuses?: Record<string, StatusLocation[]>
  loading: boolean
  error: string | null
  query: string
  groupFilter: string
  statusFilter: string
  agentFilter: string
}>(), { managementStatuses: () => ({}) })

const emit = defineEmits<{
  select: [id: string]
  action: [kind: string, asset: AssetRecord, location?: StatusLocation]
  'clear-filters': []
}>()

const filteredAssets = computed(() => props.assets
  .filter((asset) => asset.name.toLowerCase().includes(props.query.toLowerCase()) || asset.description.toLowerCase().includes(props.query.toLowerCase()))
  .filter((asset) => props.groupFilter === 'all' || asset.group === props.groupFilter)
  .filter((asset) => props.statusFilter === 'all' || asset.entryState === props.statusFilter)
  .filter((asset) => props.agentFilter === 'all' || asset.agentId === props.agentFilter))

const entryStatusLabel = (status: AssetRecord['entryState']): string => ({
  active: '正常', frozen: '已冻结', conflict: '冲突', invalid: '无效',
})[status]

const entryStatusType = (status: AssetRecord['entryState']): 'success' | 'warning' | 'danger' | 'info' => ({
  active: 'success' as const, frozen: 'info' as const, conflict: 'warning' as const, invalid: 'danger' as const,
})[status]

const locationFor = (asset: AssetRecord): StatusLocation | null => props.managementStatuses[asset.id]?.[0] ?? null
const displayStatus = (asset: AssetRecord): string => {
  const status = locationFor(asset)?.status
  return status ? assetStatusLabel(status) : entryStatusLabel(asset.entryState)
}
const displayStatusType = (asset: AssetRecord): 'success' | 'warning' | 'danger' | 'info' => {
  const status = locationFor(asset)?.status.status
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
  <div v-else class="asset-list" role="list" aria-label="资源列表">
    <article
      v-for="asset in filteredAssets"
      :key="asset.id"
      role="listitem"
      class="asset-row"
      :class="{ selected: asset.id === selectedId }"
      @click="emit('select', asset.id)"
    >
      <button class="asset-row-main" :aria-label="`查看 ${asset.name}`" @click.stop="emit('select', asset.id)">
        <span class="asset-copy">
          <span class="asset-title-line">
            <ElTag v-if="sourceKind !== 'central' && asset.agentId" class="platform-tag" effect="plain" size="small">
              {{ agentName(asset.agentId) }}
            </ElTag>
            <strong>{{ asset.name }}</strong>
          </span>
          <small>{{ asset.group }} · {{ asset.description }}</small>
        </span>
      </button>

      <div class="asset-row-management" @click.stop>
        <ElTag class="status-tag" :type="displayStatusType(asset)" effect="plain" size="small">{{ displayStatus(asset) }}</ElTag>
        <ElButton
          v-if="primaryAction(asset)"
          class="asset-primary-action"
          type="primary"
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
    </article>
  </div>
</template>
