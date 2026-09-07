<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElOption, ElSelect } from 'element-plus'
import type {
  AssetRecord,
  AssetStatusLocation,
  ManagedEntityRepairPreview,
  ThirdPartyRepositoryView,
} from '../../../../shared/ipc.js'

type RelinkCandidate = { repository: ThirdPartyRepositoryView; asset: AssetRecord }

const visible = defineModel<boolean>({ required: true })
const props = defineProps<{ asset: AssetRecord | null; location: AssetStatusLocation | null }>()
const emit = defineEmits<{ relinked: [] }>()
const candidates = ref<RelinkCandidate[]>([])
const repairPreview = ref<ManagedEntityRepairPreview | null>(null)
const selected = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
let loadToken = 0

const candidateKey = (candidate: RelinkCandidate): string => `${candidate.repository.id}|${candidate.asset.id}`
const chosen = computed(() => candidates.value.find((candidate) => candidateKey(candidate) === selected.value) ?? null)
const repairCandidate = computed(() => repairPreview.value?.candidates.find((candidate) => candidate.candidateToken === selected.value) ?? null)
const managedRepairMode = computed(() => repairPreview.value !== null)

const load = async (): Promise<void> => {
  const token = ++loadToken
  candidates.value = []
  repairPreview.value = null
  selected.value = ''
  error.value = null
  if (!visible.value || !props.asset) return
  loading.value = true
  try {
    const previewRepair = window.xcSkills.repositories?.previewManagedEntityRepair
    if (props.location?.installationId && previewRepair) {
      try {
        const preview = await previewRepair(props.location.installationId)
        if (token !== loadToken) return
        repairPreview.value = preview
        selected.value = preview.candidates[0]?.candidateToken ?? ''
        return
      } catch {
        // Legacy installation records still use the original third-party relink flow.
      }
    }
    const repositories = await window.xcSkills.thirdPartyRepositories.list()
    const assets = await Promise.all(repositories.map(async (repository) => ({
      repository,
      assets: await window.xcSkills.assets.scan({ kind: 'third-party', repositoryId: repository.id }),
    })))
    if (token !== loadToken) return
    candidates.value = assets.flatMap(({ repository, assets: repositoryAssets }) => repositoryAssets
      .filter((asset) => asset.type === 'skills' && asset.name === props.asset?.name)
      .map((asset) => ({ repository, asset })))
    selected.value = candidates.value[0] ? candidateKey(candidates.value[0]) : ''
  } catch (cause) {
    if (token === loadToken) error.value = cause instanceof Error ? cause.message : '无法查找可关联的来源'
  } finally {
    if (token === loadToken) loading.value = false
  }
}

watch([visible, () => props.asset?.id, () => props.location?.installationId], () => { void load() }, { immediate: true })

const submit = async (): Promise<void> => {
  if (!props.location?.installationId || saving.value) return
  if (!repairCandidate.value && !chosen.value) return
  saving.value = true
  error.value = null
  try {
    if (repairCandidate.value) {
      await window.xcSkills.repositories.executeManagedEntityRepair(repairCandidate.value.candidateToken)
    } else if (chosen.value) {
      await window.xcSkills.thirdPartyRepositories.relinkInstallation({
        installationId: props.location.installationId,
        repositoryId: chosen.value.repository.id,
        assetId: chosen.value.asset.id,
      })
    }
    visible.value = false
    emit('relinked')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '重新关联失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ElDialog
    v-model="visible"
    class="relink-source-dialog"
    title="重新关联来源"
    aria-label="重新关联来源"
    width="min(540px, calc(100vw - 48px))"
    append-to-body
    :close-on-click-modal="false"
  >
    <ElAlert v-if="error" type="error" :closable="false" :title="error" />
    <div class="relink-source-intro">
      <strong>{{ asset?.name }}</strong>
      <p v-if="managedRepairMode">确认资源在原仓库中的准确位置；完成后会整理实体目录并重建有效软链接。</p>
      <p v-else>选择一个包含同名 Skill 的已注册仓库。重新关联只恢复来源记录，不会改写当前文件。</p>
      <code v-if="location">{{ location.path }}</code>
    </div>
    <div v-if="loading" role="status" class="repository-candidate-state">正在检查仓库…</div>
    <div v-else-if="managedRepairMode && !repairPreview?.candidates.length" class="repository-candidate-state">
      <strong>没有找到可确认的仓库路径</strong>
      <span>请先恢复或刷新原始仓库。</span>
    </div>
    <div v-else-if="!managedRepairMode && !candidates.length" class="repository-candidate-state">
      <strong>没有找到同名 Skill</strong>
      <span>请先添加包含 {{ asset?.name }} 的第三方仓库。</span>
    </div>
    <label v-else class="repository-candidate-select">新的来源
      <ElSelect v-model="selected" aria-label="新的来源">
        <template v-if="managedRepairMode">
          <ElOption
            v-for="candidate in repairPreview?.candidates ?? []"
            :key="candidate.candidateToken"
            :value="candidate.candidateToken"
            :label="`${candidate.repositoryLabel} · ${candidate.sourceRelativePath}`"
          />
        </template>
        <template v-else>
        <ElOption
          v-for="candidate in candidates"
          :key="candidateKey(candidate)"
          :value="candidateKey(candidate)"
          :label="`${candidate.repository.name} · ${candidate.repository.branch}`"
        />
        </template>
      </ElSelect>
    </label>
    <template #footer>
      <ElButton @click="visible = false">取消</ElButton>
      <ElButton type="primary" :loading="saving" :disabled="loading || (!chosen && !repairCandidate)" @click="submit">确认关联</ElButton>
    </template>
  </ElDialog>
</template>
