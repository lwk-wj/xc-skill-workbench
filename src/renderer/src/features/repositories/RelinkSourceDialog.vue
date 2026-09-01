<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElOption, ElSelect } from 'element-plus'
import type { AssetRecord, AssetStatusLocation, ThirdPartyRepositoryView } from '../../../../shared/ipc.js'

type RelinkCandidate = { repository: ThirdPartyRepositoryView; asset: AssetRecord }

const visible = defineModel<boolean>({ required: true })
const props = defineProps<{ asset: AssetRecord | null; location: AssetStatusLocation | null }>()
const emit = defineEmits<{ relinked: [] }>()
const candidates = ref<RelinkCandidate[]>([])
const selected = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
let loadToken = 0

const candidateKey = (candidate: RelinkCandidate): string => `${candidate.repository.id}|${candidate.asset.id}`
const chosen = computed(() => candidates.value.find((candidate) => candidateKey(candidate) === selected.value) ?? null)

const load = async (): Promise<void> => {
  const token = ++loadToken
  candidates.value = []
  selected.value = ''
  error.value = null
  if (!visible.value || !props.asset) return
  loading.value = true
  try {
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
  if (!chosen.value || !props.location?.installationId || saving.value) return
  saving.value = true
  error.value = null
  try {
    await window.xcSkills.thirdPartyRepositories.relinkInstallation({
      installationId: props.location.installationId,
      repositoryId: chosen.value.repository.id,
      assetId: chosen.value.asset.id,
    })
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
      <p>选择一个包含同名 Skill 的已注册仓库。重新关联只恢复来源记录，不会改写当前文件。</p>
      <code v-if="location">{{ location.path }}</code>
    </div>
    <div v-if="loading" role="status" class="repository-candidate-state">正在检查仓库…</div>
    <div v-else-if="!candidates.length" class="repository-candidate-state">
      <strong>没有找到同名 Skill</strong>
      <span>请先添加包含 {{ asset?.name }} 的第三方仓库。</span>
    </div>
    <label v-else class="repository-candidate-select">新的来源
      <ElSelect v-model="selected" aria-label="新的来源">
        <ElOption
          v-for="candidate in candidates"
          :key="candidateKey(candidate)"
          :value="candidateKey(candidate)"
          :label="`${candidate.repository.name} · ${candidate.repository.branch}`"
        />
      </ElSelect>
    </label>
    <template #footer>
      <ElButton @click="visible = false">取消</ElButton>
      <ElButton type="primary" :loading="saving" :disabled="loading || !chosen" @click="submit">确认关联</ElButton>
    </template>
  </ElDialog>
</template>
