<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AssetDetail from './components/AssetDetail.vue'
import SourceSidebar from './components/SourceSidebar.vue'
import ResourceExplorer from './components/ResourceExplorer.vue'
import SettingsDialog from './features/settings/SettingsDialog.vue'
import { useExplorerStore } from './stores/explorer'
import { usePreferencesStore } from './stores/preferences'

const explorer = useExplorerStore()
const preferences = usePreferencesStore()
const settingsOpen = ref(false)

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
      />
      <div v-if="!explorer.selectedAsset" class="detail-empty">选择资源查看详情</div>
    </aside>
    <SettingsDialog v-model="settingsOpen" @agents-changed="explorer.refreshAgents()" />
  </main>
</template>
