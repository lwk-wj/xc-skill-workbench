<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElButton, ElRadioButton, ElRadioGroup } from 'element-plus'
import type { AgentDefinition, AssetRecord, InstallMethod, ProjectRecord } from '../../../shared/ipc.js'
import { assetStatusLabel } from '../lib/asset-status-label'

type StatusLocation = Awaited<ReturnType<NonNullable<Window['xcSkills']>['assets']['statuses']>>[number]
type ScopeFilter = 'all' | 'global' | 'project'

const props = withDefaults(defineProps<{
  asset: AssetRecord
  statuses: StatusLocation[]
  projects?: ProjectRecord[]
  agents?: AgentDefinition[]
}>(), {
  projects: () => [],
  agents: () => [],
})
const emit = defineEmits<{ 'relink-source': [location: StatusLocation] }>()

const scopeFilter = ref<ScopeFilter>('all')

const installedCount = computed(() => props.statuses.filter((location) => location.status.status !== 'not_installed').length)
const filteredStatuses = computed(() => props.statuses.filter((location) => {
  if (scopeFilter.value === 'global') return location.projectId === null
  if (scopeFilter.value === 'project') return location.projectId !== null
  return true
}))

const projectName = (projectId: string): string => props.projects.find((project) => project.id === projectId)?.name ?? projectId
const agentName = (agentId: string): string => props.agents.find((agent) => agent.id === agentId)?.name ?? agentId
const agentMark = (agentId: string): string => agentName(agentId).split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
const methodName = (method: InstallMethod | null): string => method ?? '—'

const groups = computed(() => {
  const grouped = new Map<string, StatusLocation[]>()
  for (const location of filteredStatuses.value) {
    const key = location.projectId ?? 'global'
    grouped.set(key, [...(grouped.get(key) ?? []), location])
  }
  return [...grouped.entries()].map(([key, locations]) => ({
    key,
    label: key === 'global' ? 'Global · 全局' : `${projectName(key)} · 项目`,
    locations: [...locations].sort((a, b) => `${agentName(a.agentId)}/${a.path}`.localeCompare(`${agentName(b.agentId)}/${b.path}`)),
  })).sort((a, b) => {
    if (a.key === 'global') return -1
    if (b.key === 'global') return 1
    return a.label.localeCompare(b.label)
  })
})

</script>

<template>
  <section class="installation-view" aria-label="安装状态">
    <header class="installation-view-header">
      <div>
        <h3>安装状态</h3>
        <p>查看各平台的安装位置</p>
      </div>
      <div class="installation-summary">
        <span>{{ installedCount }} 已安装</span>
        <span>{{ statuses.length }} 个位置</span>
      </div>
    </header>

    <ElRadioGroup v-model="scopeFilter" class="installation-scope-filter" aria-label="安装范围筛选" size="small">
      <ElRadioButton value="all">全部</ElRadioButton>
      <ElRadioButton value="global">全局</ElRadioButton>
      <ElRadioButton value="project">项目</ElRadioButton>
    </ElRadioGroup>

    <div v-if="!groups.length" class="installation-empty">
      <strong>{{ statuses.length ? '当前范围没有安装位置' : '暂无安装位置' }}</strong>
      <button v-if="statuses.length" type="button" @click="scopeFilter = 'all'">查看全部位置</button>
    </div>

    <section v-for="group in groups" :key="group.key" class="installation-group">
      <h4>{{ group.label }}</h4>
      <article
        v-for="location in group.locations"
        :key="`${location.agentId}:${location.path}`"
        class="status-location"
      >
        <span class="status-platform-mark" aria-hidden="true">{{ agentMark(location.agentId) }}</span>
        <div class="status-location-copy">
          <strong>{{ agentName(location.agentId) }}</strong>
          <code :title="location.path">{{ location.path }}</code>
          <small>{{ methodName(location.method) }}</small>
        </div>
        <div class="status-location-state">
          <span class="status-badge" :data-status="location.status.status">{{ assetStatusLabel(location.status) }}</span>
          <ElButton
            v-if="location.status.status === 'source_unavailable' && location.installationId"
            type="primary"
            plain
            size="small"
            @click="emit('relink-source', location)"
          >重新关联来源</ElButton>
        </div>
      </article>
    </section>
  </section>
</template>
