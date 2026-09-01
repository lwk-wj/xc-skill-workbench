<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElTabPane, ElTabs } from 'element-plus'
import type { AgentDefinition, AssetDetail as AssetDetailRecord, AssetRecord, AssetSelection, ProjectRecord, SourceSelection } from '../../../shared/ipc.js'
import { handleSafeMarkdownClick, renderSafeMarkdown } from '../lib/markdown'
import { plainSource } from '../app/types'
import AssetFileTree from './AssetFileTree.vue'
import AssetInstallationStatus from './AssetInstallationStatus.vue'

const MAX_TEXT_BYTES = 1024 * 1024
type StatusLocation = Awaited<ReturnType<NonNullable<Window['xcSkills']>['assets']['statuses']>>[number]
type DetailLoader = (selection: AssetSelection) => Promise<AssetDetailRecord>
type StatusLoader = (selection: AssetSelection) => Promise<StatusLocation[]>

const defaultLoadDetail: DetailLoader = (selection) => window.xcSkills.assets.detail(selection)
const defaultLoadStatuses: StatusLoader = (selection) => window.xcSkills.assets.statuses(selection)

const props = withDefaults(defineProps<{
  asset: AssetRecord
  source?: SourceSelection
  projects?: ProjectRecord[]
  agents?: AgentDefinition[]
  loadDetail?: DetailLoader
  loadStatuses?: StatusLoader
  showHeader?: boolean
}>(), {
  source: () => ({ kind: 'central' }),
  projects: () => [],
  agents: () => [],
  showHeader: true,
})
const emit = defineEmits<{ 'relink-source': [location: StatusLocation] }>()

const detail = ref<AssetDetailRecord | null>(null)
const statuses = ref<StatusLocation[]>([])
const tab = ref('preview')
const error = ref<string | null>(null)
let requestToken = 0

const textWithinLimit = (value: string | null): value is string => Boolean(value && new TextEncoder().encode(value).byteLength <= MAX_TEXT_BYTES)
const renderedMarkdown = computed(() => textWithinLimit(detail.value?.markdown ?? null) ? renderSafeMarkdown(detail.value?.markdown) : '')
const showTextLimit = computed(() => Boolean(detail.value?.markdown && !textWithinLimit(detail.value.markdown)))
const metadataOnly = computed(() => Boolean(detail.value && !detail.value.markdown && detail.value.files.some((file) => file.kind === 'binary' || file.size > MAX_TEXT_BYTES)))
const renderedEvolution = computed(() => textWithinLimit(detail.value?.evolution ?? null) ? renderSafeMarkdown(detail.value?.evolution) : '')
const entryFileName = computed(() => props.asset.entryPath.split('/').at(-1) ?? props.asset.entryPath)

const safeMarkdownClick = (event: MouseEvent): void => handleSafeMarkdownClick(event)

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
    <header v-if="showHeader" class="asset-detail-header">
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
            <div v-else class="source-panel">
              <header class="source-panel-header"><code>{{ entryFileName }}</code></header>
              <pre class="markdown-source">{{ detail.markdown || '暂无源码' }}</pre>
            </div>
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
        <ElTabPane name="installations">
          <template #label>
            <span class="installation-tab-label">安装状态 <small>{{ statuses.length }}</small></span>
          </template>
          <AssetInstallationStatus
            :asset="asset"
            :statuses="statuses"
            :projects="projects"
            :agents="agents"
            @relink-source="(location) => emit('relink-source', location)"
          />
        </ElTabPane>
      </ElTabs>
    </template>
  </section>
</template>
