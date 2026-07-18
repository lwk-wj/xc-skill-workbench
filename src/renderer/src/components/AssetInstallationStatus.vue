<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElButton, ElRadioButton, ElRadioGroup } from 'element-plus'
import type { AgentDefinition, AssetRecord, AssetStatusRecord, InstallMethod, ProjectRecord } from '../../../shared/ipc.js'

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

const emit = defineEmits<{ action: [kind: string, location: StatusLocation] }>()
const scopeFilter = ref<ScopeFilter>('all')

const statusLabels: Record<AssetStatusRecord['status'], string> = {
  not_installed: '未安装', current: '最新', update_available: '可更新', locally_modified: '本地有修改',
  frozen: '已冻结', broken_link: '链接失效', conflict: '冲突', invalid: '无效', unknown: '未知',
}

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
</script>

<template>
  <section class="installation-view" aria-label="安装状态">
    <header class="installation-view-header">
      <div>
        <h3>安装状态</h3>
        <p>查看和管理各平台的安装位置</p>
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
          <span class="status-badge" :data-status="location.status.status">{{ statusLabels[location.status.status] }}</span>
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
        </div>
      </article>
    </section>
  </section>
</template>
