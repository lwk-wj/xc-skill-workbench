<script setup lang="ts">
import { computed } from 'vue'
import { ElTag } from 'element-plus'
import type { AssetRecord, SourceSelection } from '../../../shared/ipc.js'

const props = defineProps<{
  assets: AssetRecord[]
  selectedId: string | null
  sourceKind: SourceSelection['kind']
  agentName: (agentId?: string) => string
  loading: boolean
  error: string | null
  query: string
  groupFilter: string
  statusFilter: string
  agentFilter: string
}>()

defineEmits<{ select: [id: string] }>()

const filteredAssets = computed(() => props.assets
  .filter((asset) => asset.name.toLowerCase().includes(props.query.toLowerCase()) || asset.description.toLowerCase().includes(props.query.toLowerCase()))
  .filter((asset) => props.groupFilter === 'all' || asset.group === props.groupFilter)
  .filter((asset) => props.statusFilter === 'all' || asset.entryState === props.statusFilter)
  .filter((asset) => props.agentFilter === 'all' || asset.agentId === props.agentFilter))

const statusLabel = (status: AssetRecord['entryState']): string => ({
  active: '正常', frozen: '已冻结', conflict: '冲突', invalid: '无效',
})[status]

const statusType = (status: AssetRecord['entryState']): 'success' | 'warning' | 'danger' | 'info' => ({
  active: 'success' as const, frozen: 'info' as const, conflict: 'warning' as const, invalid: 'danger' as const,
})[status]
</script>

<template>
  <div v-if="loading" class="asset-state" role="status">正在加载资源…</div>
  <div v-else-if="error" class="asset-state error">加载资源失败，请查看上方提示。</div>
  <div v-else-if="!filteredAssets.length" class="asset-state">没有匹配的资源</div>
  <div v-else class="asset-list" role="list" aria-label="资源列表">
    <button
      v-for="asset in filteredAssets"
      :key="asset.id"
      role="listitem"
      class="asset-row"
      :class="{ selected: asset.id === selectedId }"
      @click="$emit('select', asset.id)"
    >
      <span class="asset-copy">
        <span class="asset-title-line">
          <ElTag v-if="sourceKind !== 'central' && asset.agentId" class="platform-tag" effect="plain" size="small">
            {{ agentName(asset.agentId) }}
          </ElTag>
          <strong>{{ asset.name }}</strong>
        </span>
        <small>{{ asset.group }} · {{ asset.description }}</small>
      </span>
      <ElTag class="status-tag" :type="statusType(asset.entryState)" effect="dark" size="small">{{ statusLabel(asset.entryState) }}</ElTag>
    </button>
  </div>
</template>
