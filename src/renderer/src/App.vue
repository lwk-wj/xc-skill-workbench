<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElDrawer } from 'element-plus'
import AssetDetail from './components/AssetDetail.vue'
import SourceSidebar from './components/SourceSidebar.vue'
import ResourceExplorer from './components/ResourceExplorer.vue'
import OperationDialog from './features/operations/OperationDialog.vue'
import SettingsDialog from './features/settings/SettingsDialog.vue'
import ThirdPartyRepositoryDialog from './features/repositories/ThirdPartyRepositoryDialog.vue'
import RelinkSourceDialog from './features/repositories/RelinkSourceDialog.vue'
import { useExplorerStore } from './stores/explorer'
import { useOperationStore } from './stores/operation'
import { usePreferencesStore } from './stores/preferences'
import { plainSource } from './app/types'
import type { AssetRecord, AssetStatusLocation, OperationKind, SourceSelection, ThirdPartyRepositoryView } from '../../shared/ipc.js'

const explorer = useExplorerStore()
const operation = useOperationStore()
const preferences = usePreferencesStore()
const settingsOpen = ref(false)
const detailOpen = ref(false)
const repositoryDialogOpen = ref(false)
const editingRepository = ref<ThirdPartyRepositoryView | null>(null)
const relinkDialogOpen = ref(false)
const relinkAsset = ref<AssetRecord | null>(null)
const relinkLocation = ref<AssetStatusLocation | null>(null)
const assetKindMark = computed(() => ({ skills: 'SK', rules: 'RU', workflows: 'WF' })[explorer.selectedAsset?.type ?? 'skills'])
const assetKindLabel = computed(() => ({ skills: 'Skill', rules: 'Rule', workflows: 'Workflow' })[explorer.selectedAsset?.type ?? 'skills'])
const assetMetadata = computed(() => {
  if (!explorer.selectedAsset) return ''
  const version = explorer.selectedAsset.version ? `v${explorer.selectedAsset.version.replace(/^v/, '')}` : '无版本'
  return [explorer.selectedAsset.group?.trim(), assetKindLabel.value, version].filter(Boolean).join(' · ')
})

watch(() => explorer.selectedAsset, (asset) => {
  if (!asset) detailOpen.value = false
})

type DetailLocation = Awaited<ReturnType<NonNullable<Window['xcSkills']>['assets']['statuses']>>[number]
const operationKinds = new Set<OperationKind>(['install', 'update', 'uninstall', 'freeze', 'thaw'])
const currentSource = (): SourceSelection => plainSource(explorer.selectedSource)
const openOperation = async (requestedKind: string, asset: AssetRecord, location?: DetailLocation): Promise<void> => {
  if (requestedKind === 'relink-source' && location) {
    relinkAsset.value = asset
    relinkLocation.value = location
    relinkDialogOpen.value = true
    return
  }
  if (requestedKind === 'diagnose') return
  const normalized = requestedKind === 'update-with-warning' ? 'update' : requestedKind
  if (!operationKinds.has(normalized as OperationKind)) return
  let allowSymlink: boolean | undefined
  if (normalized === 'install' || normalized === 'update') {
    // All repositories import into the stable local entity store first, so the
    // Agent-facing link never points at an ephemeral repository checkout.
    allowSymlink = true
  }
  await operation.open({
    kind: normalized as OperationKind,
    asset,
    source: currentSource(),
    projects: explorer.projects,
    agents: explorer.agents,
    location: location ? { projectId: location.projectId, agentId: location.agentId, path: location.path } : undefined,
    allowSymlink,
    onRescan: () => { void explorer.refreshCurrentSource() },
  })
}

const openRelinkSource = (location: AssetStatusLocation): void => {
  if (!explorer.selectedAsset) return
  relinkAsset.value = explorer.selectedAsset
  relinkLocation.value = location
  relinkDialogOpen.value = true
}

const addThirdPartyRepository = (): void => {
  editingRepository.value = null
  repositoryDialogOpen.value = true
}

const editThirdPartyRepository = (repositoryId: string): void => {
  editingRepository.value = explorer.thirdPartyRepositories.find((entry) => entry.id === repositoryId) ?? null
  repositoryDialogOpen.value = true
}

onMounted(() => {
  void preferences.initializeTheme()
  void explorer.initialize()
})
</script>

<template>
  <main class="app-shell" data-testid="app-shell">
    <SourceSidebar
      @settings="settingsOpen = true"
      @add-third-party="addThirdPartyRepository"
      @edit-third-party="editThirdPartyRepository"
    />
    <ResourceExplorer
      @asset-selected="detailOpen = true"
      @asset-action="openOperation"
    />
    <ElDrawer
      v-model="detailOpen"
      class="asset-detail-drawer"
      direction="rtl"
      size="min(760px, 64vw)"
      destroy-on-close
    >
      <template #header="{ titleId, titleClass }">
        <div class="asset-detail-drawer-heading">
          <div class="asset-detail-title-lockup">
            <span class="asset-kind-mark" aria-hidden="true">{{ assetKindMark }}</span>
            <div class="asset-detail-header">
              <h2 :id="titleId" :class="titleClass">{{ explorer.selectedAsset?.name ?? '资源详情' }}</h2>
              <small v-if="explorer.selectedAsset">{{ assetMetadata }}</small>
            </div>
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
        @relink-source="openRelinkSource"
      />
    </ElDrawer>
    <OperationDialog />
    <ThirdPartyRepositoryDialog
      v-model="repositoryDialogOpen"
      :repository="editingRepository"
      @saved="explorer.syncThirdPartyRepository"
    />
    <RelinkSourceDialog
      v-model="relinkDialogOpen"
      :asset="relinkAsset"
      :location="relinkLocation"
      @relinked="explorer.refreshCurrentSource"
    />
    <SettingsDialog
      v-model="settingsOpen"
      @agents-changed="explorer.refreshAgents()"
      @repository-changed="explorer.refreshRepository()"
    />
  </main>
</template>
