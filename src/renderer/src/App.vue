<script setup lang="ts">
import { onMounted, ref } from 'vue'
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
    <ResourceExplorer />
    <aside class="detail-pane" aria-label="资源详情">
      <AssetDetail
        v-if="explorer.selectedAsset"
        :asset="explorer.selectedAsset"
        :source="explorer.selectedSource"
        @action="openOperation"
      />
      <div v-if="!explorer.selectedAsset" class="detail-empty">选择资源查看详情</div>
    </aside>
    <OperationDialog />
    <SettingsDialog v-model="settingsOpen" @agents-changed="explorer.refreshAgents()" />
  </main>
</template>
