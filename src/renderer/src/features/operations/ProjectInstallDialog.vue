<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElInput,
  ElOption,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus'
import type { TableInstance } from 'element-plus'
import { plainSource, type AssetType, type ExplorerSource } from '../../app/types'
import type { AssetRecord, SourceSelection } from '../../../../shared/ipc.js'

const props = defineProps<{
  modelValue: boolean
  sources: ExplorerSource[]
  assetType: AssetType
  targetScope: 'global' | 'project'
  targetName: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  install: [payload: { source: SourceSelection; assets: AssetRecord[] }]
}>()

const sourceId = ref('')
const assetType = ref<AssetType>('skills')
const query = ref('')
const groupFilter = ref('all')
const assets = ref<AssetRecord[]>([])
const selectedRows = ref<AssetRecord[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const table = ref<TableInstance>()

const repositorySources = computed(() => props.sources.filter((source) => source.kind === 'central' || source.kind === 'third-party'))
const targetTitle = computed(() => props.targetScope === 'global' ? '全局' : '项目')
const targetAction = computed(() => props.targetScope === 'global' ? '安装到全局' : '安装到当前项目')
const selectedSource = computed(() => repositorySources.value.find((source) => source.id === sourceId.value) ?? repositorySources.value[0] ?? null)
const availableTypes = computed<Array<{ value: AssetType; label: string }>>(() => (
  selectedSource.value?.kind === 'third-party'
    ? [{ value: 'skills', label: 'Skills' }]
    : [
        { value: 'skills', label: 'Skills' },
        { value: 'rules', label: 'Rules' },
        { value: 'workflows', label: 'Workflows' },
      ]
))
const typedAssets = computed(() => assets.value.filter((asset) => asset.type === assetType.value))
const groups = computed(() => ['all', ...new Set(typedAssets.value.map((asset) => asset.group.trim()).filter(Boolean))])
const visibleAssets = computed(() => typedAssets.value
  .filter((asset) => groupFilter.value === 'all' || asset.group === groupFilter.value)
  .filter((asset) => {
    const keyword = query.value.trim().toLowerCase()
    return !keyword
      || asset.name.toLowerCase().includes(keyword)
      || asset.description.toLowerCase().includes(keyword)
      || asset.group.toLowerCase().includes(keyword)
  }))

const close = (): void => emit('update:modelValue', false)

const syncSelection = async (): Promise<void> => {
  await nextTick()
  if (!table.value) return
  table.value.clearSelection()
  const selectedIds = new Set(selectedRows.value.map((asset) => asset.id))
  for (const asset of visibleAssets.value) {
    if (selectedIds.has(asset.id)) table.value.toggleRowSelection(asset, true)
  }
}

const loadAssets = async (): Promise<void> => {
  const source = selectedSource.value
  if (!source) {
    assets.value = []
    selectedRows.value = []
    return
  }
  loading.value = true
  error.value = null
  selectedRows.value = []
  try {
    assets.value = await window.xcSkills.assets.scan(plainSource(source))
  } catch (cause) {
    assets.value = []
    error.value = cause instanceof Error ? cause.message : '加载仓库资源失败'
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (open) => {
  if (!open) return
  sourceId.value = selectedSource.value?.id ?? repositorySources.value[0]?.id ?? ''
  assetType.value = selectedSource.value?.kind === 'third-party' ? 'skills' : props.assetType
  query.value = ''
  groupFilter.value = 'all'
  void loadAssets()
}, { immediate: true })

watch(sourceId, () => {
  if (!props.modelValue) return
  if (selectedSource.value?.kind === 'third-party') assetType.value = 'skills'
  groupFilter.value = 'all'
  void loadAssets()
})

watch(assetType, () => {
  groupFilter.value = 'all'
  selectedRows.value = []
})

watch(visibleAssets, () => { void syncSelection() }, { flush: 'post' })

const updateSelection = (rows: AssetRecord[]): void => {
  const visibleIds = new Set(visibleAssets.value.map((asset) => asset.id))
  selectedRows.value = [
    ...selectedRows.value.filter((asset) => !visibleIds.has(asset.id)),
    ...rows,
  ]
}

const confirmInstall = (): void => {
  const source = selectedSource.value
  if (!source || !selectedRows.value.length) return
  emit('install', { source: plainSource(source), assets: selectedRows.value })
  close()
}
</script>

<template>
  <ElDialog
    :model-value="modelValue"
    class="project-install-dialog"
    :title="`安装新资源到${targetTitle}`"
    width="min(920px, calc(100vw - 48px))"
    append-to-body
    :close-on-click-modal="false"
    @close="close"
  >
    <div class="project-install-target">
      <span>安装目标</span>
      <strong>{{ targetName || (targetScope === 'global' ? '全局' : '当前项目') }}</strong>
      <small>选择仓库里的资源后，将直接进入{{ targetScope === 'global' ? '全局' : '当前项目' }}安装确认。</small>
    </div>

    <div class="project-install-controls">
      <label>
        <span>资源来源</span>
        <ElSelect v-model="sourceId" aria-label="资源来源">
          <ElOption v-for="source in repositorySources" :key="source.id" :label="source.label" :value="source.id" />
        </ElSelect>
      </label>
      <label>
        <span>分组</span>
        <ElSelect v-model="groupFilter" aria-label="安装资源分组筛选">
          <ElOption v-for="group in groups" :key="group" :label="group === 'all' ? '全部分组' : group" :value="group" />
        </ElSelect>
      </label>
      <label class="project-install-search">
        <span>搜索</span>
        <ElInput v-model="query" aria-label="安装资源搜索" placeholder="搜索名称、说明或分组" />
      </label>
    </div>

    <div class="project-install-type-tabs" role="tablist" aria-label="安装资源类型">
      <button
        v-for="type in availableTypes"
        :key="type.value"
        type="button"
        role="tab"
        :aria-selected="assetType === type.value"
        @click="assetType = type.value"
      >
        {{ type.label }}
      </button>
    </div>

    <ElAlert v-if="error" type="error" :closable="false" :title="error" />
    <div v-else-if="loading" class="project-install-empty">正在加载可安装资源…</div>
    <div v-else-if="!visibleAssets.length" class="project-install-empty">当前条件下没有可安装资源。</div>
    <ElTable
      v-else
      ref="table"
      class="asset-table project-install-table"
      :data="visibleAssets"
      row-key="id"
      height="360"
      @selection-change="updateSelection"
      @select-all="updateSelection"
    >
      <ElTableColumn type="selection" width="54" align="center" reserve-selection />
      <ElTableColumn label="资源" min-width="360">
        <template #default="{ row }">
          <div class="project-install-resource">
            <strong>{{ row.name }}</strong>
            <small>{{ row.description || '暂无说明' }}</small>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="分组" width="140">
        <template #default="{ row }">
          <ElTag v-if="row.group" effect="plain" size="small">{{ row.group }}</ElTag>
          <span v-else class="muted">未分组</span>
        </template>
      </ElTableColumn>
    </ElTable>

    <template #footer>
      <div class="project-install-footer">
        <span>已选择 {{ selectedRows.length }} 项</span>
        <div>
          <ElButton @click="close">取消</ElButton>
          <ElButton type="primary" :disabled="!selectedRows.length" @click="confirmInstall">{{ targetAction }}</ElButton>
        </div>
      </div>
    </template>
  </ElDialog>
</template>
