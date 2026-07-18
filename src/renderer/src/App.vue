<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElDrawer } from 'element-plus'
import AssetDetail from './components/AssetDetail.vue'
import SourceSidebar from './components/SourceSidebar.vue'
import ResourceExplorer from './components/ResourceExplorer.vue'
import OperationDialog from './features/operations/OperationDialog.vue'
import SettingsDialog from './features/settings/SettingsDialog.vue'
import { useExplorerStore } from './stores/explorer'
import { useOperationStore } from './stores/operation'
import { usePreferencesStore } from './stores/preferences'
import { plainSource } from './app/types'
import type { OperationKind, SourceSelection } from '../../shared/ipc.js'

const explorer = useExplorerStore()
const operation = useOperationStore()
const preferences = usePreferencesStore()
const settingsOpen = ref(false)
const detailOpen = ref(false)
const assetKindMark = computed(() => ({ skills: 'SK', rules: 'RU', workflows: 'WF' })[explorer.selectedAsset?.type ?? 'skills'])
const assetKindLabel = computed(() => ({ skills: 'Skill', rules: 'Rule', workflows: 'Workflow' })[explorer.selectedAsset?.type ?? 'skills'])

watch(() => explorer.selectedAsset, (asset) => {
  if (!asset) detailOpen.value = false
})

type DetailLocation = Awaited<ReturnType<NonNullable<Window['xcSkills']>['assets']['statuses']>>[number]
const operationKinds = new Set<OperationKind>(['install', 'update', 'uninstall', 'freeze', 'thaw'])
const currentSource = (): SourceSelection => plainSource(explorer.selectedSource)
const openOperation = (requestedKind: string, location: DetailLocation): void => {
  if (!explorer.selectedAsset || requestedKind === 'diagnose') return
  const normalized = requestedKind === 'update-with-warning' ? 'update' : requestedKind
  if (!operationKinds.has(normalized as OperationKind)) return
  void operation.open({
    kind: normalized as OperationKind,
    asset: explorer.selectedAsset,
    source: currentSource(),
    projects: explorer.projects,
    agents: explorer.agents,
    location: { projectId: location.projectId, agentId: location.agentId, path: location.path },
    onRescan: () => { void explorer.refreshCurrentSource() },
  })
}

onMounted(() => {
  void preferences.initializeTheme()
  void explorer.initialize()
})
</script>

<template>
  <main class="app-shell" data-testid="app-shell">
    <SourceSidebar @settings="settingsOpen = true" />
    <ResourceExplorer @asset-selected="detailOpen = true" />
    <ElDrawer
      v-model="detailOpen"
      class="asset-detail-drawer"
      direction="rtl"
      size="min(760px, 64vw)"
      destroy-on-close
    >
      <template #header="{ titleId, titleClass }">
        <div class="asset-detail-title-lockup">
          <span class="asset-kind-mark" aria-hidden="true">{{ assetKindMark }}</span>
          <div class="asset-detail-header">
            <h2 :id="titleId" :class="titleClass">{{ explorer.selectedAsset?.name ?? '资源详情' }}</h2>
            <small v-if="explorer.selectedAsset">{{ explorer.selectedAsset.group }} · {{ assetKindLabel }} · {{ explorer.selectedAsset.version ? `v${explorer.selectedAsset.version.replace(/^v/, '')}` : '无版本' }}</small>
          </div>
        </div>
      </template>
      <AssetDetail
        v-if="explorer.selectedAsset"
        :asset="explorer.selectedAsset"
        :source="explorer.selectedSource"
        :projects="explorer.projects"
        :agents="explorer.agents"
        :show-header="false"
        @action="openOperation"
      />
    </ElDrawer>
    <OperationDialog />
    <SettingsDialog v-model="settingsOpen" @agents-changed="explorer.refreshAgents()" />
  </main>
</template>
