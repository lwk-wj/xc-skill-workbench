<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElTabPane, ElTabs } from 'element-plus'
import type { AssetDetail as AssetDetailRecord, AssetRecord, AssetSelection, AssetStatusRecord, InstallMethod, SourceSelection } from '../../../shared/ipc.js'
import { handleSafeMarkdownClick, renderSafeMarkdown } from '../lib/markdown'
import { plainSource } from '../app/types'
import AssetFileTree from './AssetFileTree.vue'

const MAX_TEXT_BYTES = 1024 * 1024
type StatusLocation = Awaited<ReturnType<NonNullable<Window['xcSkills']>['assets']['statuses']>>[number]
type DetailLoader = (selection: AssetSelection) => Promise<AssetDetailRecord>
type StatusLoader = (selection: AssetSelection) => Promise<StatusLocation[]>

const defaultLoadDetail: DetailLoader = (selection) => window.xcSkills.assets.detail(selection)
const defaultLoadStatuses: StatusLoader = (selection) => window.xcSkills.assets.statuses(selection)

const props = withDefaults(defineProps<{
  asset: AssetRecord
  source?: SourceSelection
  loadDetail?: DetailLoader
  loadStatuses?: StatusLoader
}>(), {
  source: () => ({ kind: 'central' }),
})

const emit = defineEmits<{ action: [kind: string, location: StatusLocation] }>()
const detail = ref<AssetDetailRecord | null>(null)
const statuses = ref<StatusLocation[]>([])
const tab = ref('preview')
const error = ref<string | null>(null)
let requestToken = 0

const statusLabels: Record<AssetStatusRecord['status'], string> = {
  not_installed: '未安装', current: '最新', update_available: '可更新', locally_modified: '本地有修改',
  frozen: '已冻结', broken_link: '链接失效', conflict: '冲突', invalid: '无效', unknown: '未知',
}

const groupedStatuses = computed(() => [...statuses.value].sort((a, b) => {
  if (a.projectId === null && b.projectId !== null) return -1
  if (a.projectId !== null && b.projectId === null) return 1
  return `${a.projectId ?? ''}/${a.agentId}/${a.path}`.localeCompare(`${b.projectId ?? ''}/${b.agentId}/${b.path}`)
}))

const textWithinLimit = (value: string | null): value is string => Boolean(value && new TextEncoder().encode(value).byteLength <= MAX_TEXT_BYTES)
const renderedMarkdown = computed(() => textWithinLimit(detail.value?.markdown ?? null) ? renderSafeMarkdown(detail.value?.markdown) : '')
const showTextLimit = computed(() => Boolean(detail.value?.markdown && !textWithinLimit(detail.value.markdown)))
const metadataOnly = computed(() => Boolean(detail.value && !detail.value.markdown && detail.value.files.some((file) => file.kind === 'binary' || file.size > MAX_TEXT_BYTES)))
const renderedEvolution = computed(() => textWithinLimit(detail.value?.evolution ?? null) ? renderSafeMarkdown(detail.value?.evolution) : '')

const locationName = (location: StatusLocation): string => location.projectId ?? 'Global'
const methodName = (method: InstallMethod | null): string => method ?? '—'
const safeMarkdownClick = (event: MouseEvent): void => handleSafeMarkdownClick(event)

const actionsFor = (location: StatusLocation): Array<{ label: string; kind: string }> => {
  const status = location.status.status
  if (status === 'not_installed') return [{ label: '安装到…', kind: 'install' }]
  if (status === 'update_available') return [{ label: '更新', kind: 'update' }]
  if (status === 'locally_modified') return [{ label: '查看影响并更新', kind: 'update-with-warning' }]
  if (status === 'current') return [
    { label: '卸载', kind: 'uninstall' },
    ...(props.asset.type === 'skills' ? [{ label: '冻结', kind: 'freeze' }] : []),
  ]
  if (status === 'frozen') return props.asset.type === 'skills'
    ? [{ label: '解冻', kind: 'thaw' }, { label: '卸载', kind: 'uninstall' }, { label: '更新', kind: 'update' }]
    : [{ label: '查看诊断', kind: 'diagnose' }]
  if (status === 'broken_link' || status === 'conflict' || status === 'invalid') return [{ label: '查看诊断', kind: 'diagnose' }]
  return []
}

const load = async (): Promise<void> => {
  const token = ++requestToken
  detail.value = null
  statuses.value = []
  error.value = null
  tab.value = 'preview'
  const selection: AssetSelection = { source: plainSource(props.source), assetId: props.asset.id }
  try {
    const [nextDetail, nextStatuses] = await Promise.all([
      (props.loadDetail ?? defaultLoadDetail)(selection),
      (props.loadStatuses ?? defaultLoadStatuses)(selection),
    ])
    if (token !== requestToken) return
    detail.value = nextDetail
    statuses.value = nextStatuses
  } catch (cause) {
    if (token !== requestToken) return
    error.value = cause instanceof Error ? cause.message : '加载详情失败'
  }
}

watch(
  () => [props.asset.id, props.source.kind, props.source.kind === 'project' ? props.source.projectId : '', props.loadDetail, props.loadStatuses],
  () => { void load() },
  { immediate: true },
)
</script>

<template>
  <section class="asset-detail" aria-label="资源详情">
    <header class="asset-detail-header">
      <h2>{{ asset.name }}</h2>
      <small>{{ asset.group }} · {{ asset.version ?? '无版本' }}</small>
    </header>
    <div v-if="error" role="alert" class="detail-error">{{ error }}</div>
    <div v-else-if="!detail" role="status">正在加载详情…</div>
    <template v-else>
      <ElTabs v-model="tab" class="detail-tabs" aria-label="详情视图">
        <ElTabPane label="预览" name="preview">
          <div class="detail-content">
            <p v-if="showTextLimit || metadataOnly" class="detail-muted">{{ metadataOnly ? '文件为二进制或过大，仅显示文件元数据。' : '文件过大，仅显示文件元数据。' }}</p>
            <div v-else data-testid="markdown-preview" @click="safeMarkdownClick" v-html="renderedMarkdown" />
          </div>
        </ElTabPane>
        <ElTabPane label="源码" name="source">
          <div class="detail-content">
            <p v-if="showTextLimit || metadataOnly" class="detail-muted">{{ metadataOnly ? '文件为二进制或过大，无法显示源码。' : '文件过大，无法显示源码。' }}</p>
            <pre v-else class="markdown-source">{{ detail.markdown || '暂无源码' }}</pre>
          </div>
        </ElTabPane>
        <ElTabPane label="文件" name="files">
          <div class="detail-content"><AssetFileTree :files="detail.files" /></div>
        </ElTabPane>
        <ElTabPane v-if="asset.type === 'skills'" label="演进历史" name="evolution">
          <div class="detail-content">
            <div v-if="renderedEvolution" data-testid="evolution-content" @click="safeMarkdownClick" v-html="renderedEvolution" />
            <p v-else class="detail-muted">{{ detail.evolution ? '文件过大，无法显示演进历史。' : '暂无演进历史' }}</p>
          </div>
        </ElTabPane>
      </ElTabs>

      <section class="asset-statuses" aria-label="安装状态">
        <h3>安装状态</h3>
        <p v-if="!groupedStatuses.length" class="detail-muted">暂无安装位置</p>
        <article v-for="(location, index) in groupedStatuses" :key="`${location.projectId ?? 'global'}:${location.agentId}:${location.path}:${index}`" class="status-location">
          <div class="status-location-copy">
            <strong>{{ locationName(location) }}</strong>
            <span>Agent: {{ location.agentId || '—' }}</span>
            <code>{{ location.path }}</code>
            <span>{{ statusLabels[location.status.status] }}</span>
            <span>{{ methodName(location.method) }}</span>
          </div>
          <div class="status-actions">
            <ElButton
              v-for="action in actionsFor(location)"
              :key="action.kind"
              size="small"
              :aria-label="`${action.label} ${asset.name}`"
              :data-operation-kind="action.kind"
              @click="emit('action', action.kind, location)"
            >{{ action.label }}</ElButton>
          </div>
        </article>
      </section>
    </template>
  </section>
</template>
