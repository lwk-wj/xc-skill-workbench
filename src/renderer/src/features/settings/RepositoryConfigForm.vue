<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessageBox,
  ElOption,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
} from 'element-plus'
import type {
  RepositoryConfigInput,
  XcSkillsConfig,
  LegacyInstallationMigrationPreview,
} from '../../../../shared/ipc.js'
import ErrorNotice from '../../components/ErrorNotice.vue'

const props = defineProps<{ config: XcSkillsConfig }>()
const emit = defineEmits<{ saved: [config: XcSkillsConfig] }>()

const normalizeGroups = (groups: string[]): string[] =>
  [...new Set(groups.map((group) => group.trim()).filter(Boolean))]

const toEditableConfig = (config: XcSkillsConfig): RepositoryConfigInput => ({
  mode: config.mode ?? (config.remoteUrl ? 'remote' : 'local'),
  repoPath: config.repoPath?.trim() ?? '',
  remoteUrl: config.remoteUrl?.trim() ?? '',
  defaultBranch: config.defaultBranch?.trim() || 'main',
  defaultGroups: normalizeGroups(config.defaultGroups ?? []),
  assetStorePath: config.assetStorePath?.trim() ?? '',
})

const normalize = (value: RepositoryConfigInput): RepositoryConfigInput => ({
  mode: value.mode,
  repoPath: value.repoPath.trim(),
  remoteUrl: value.remoteUrl.trim(),
  defaultBranch: value.defaultBranch.trim(),
  defaultGroups: normalizeGroups(value.defaultGroups),
  ...(value.assetStorePath?.trim() ? { assetStorePath: value.assetStorePath.trim() } : {}),
})

const serialize = (value: RepositoryConfigInput): string => JSON.stringify(normalize(value))
const baseline = ref(toEditableConfig(props.config))
const form = reactive<RepositoryConfigInput>({ ...baseline.value })
const saving = ref(false)
const error = ref<unknown>(null)
const saved = ref(false)
const legacyMigration = ref<LegacyInstallationMigrationPreview | null>(null)
const migratingLegacy = ref(false)
const legacyMigrationError = ref<unknown>(null)

const loadLegacyMigration = async (): Promise<void> => {
  const preview = window.xcSkills.repositories.previewLegacyInstallationMigration
  if (!preview) return
  try {
    legacyMigration.value = await preview()
  } catch (cause) {
    legacyMigrationError.value = cause
  }
}

const migrateLegacyInstallations = async (): Promise<void> => {
  const preview = legacyMigration.value
  if (!preview?.candidates.length) return
  migratingLegacy.value = true
  legacyMigrationError.value = null
  try {
    await ElMessageBox.confirm(
      `将 ${preview.candidates.length} 个旧安装导入统一资源目录；失败时会恢复原文件和安装记录。`,
      '迁移旧版安装',
      { confirmButtonText: '确认迁移', cancelButtonText: '暂不迁移', type: 'warning' },
    )
    legacyMigration.value = await window.xcSkills.repositories.executeLegacyInstallationMigration(preview.token)
  } catch (cause) {
    legacyMigrationError.value = cause
  } finally {
    migratingLegacy.value = false
  }
}

onMounted(() => { void loadLegacyMigration() })

watch(() => props.config, (next) => {
  const editable = toEditableConfig(next)
  if (serialize(editable) === serialize(baseline.value)) return
  baseline.value = editable
  Object.assign(form, editable)
  error.value = null
  saved.value = false
}, { deep: true })

const dirty = computed(() => serialize(form) !== serialize(baseline.value))
const knownGroups = computed(() => normalizeGroups([
  ...baseline.value.defaultGroups,
  ...form.defaultGroups,
]))

const validationMessage = (): string | null => {
  const candidate = normalize(form)
  if (!candidate.defaultBranch) return '默认分支不能为空'
  if (candidate.mode === 'local' && !candidate.repoPath) return '请选择本地仓库路径'
  if (candidate.mode === 'remote' && !candidate.remoteUrl) return '请填写远程仓库 URL'
  return null
}

const chooseAssetStorePath = async (): Promise<void> => {
  error.value = null
  saved.value = false
  try {
    const path = await window.xcSkills.repositories.chooseAssetStorePath()
    if (path) form.assetStorePath = path
  } catch (cause) {
    error.value = cause
  }
}

const chooseLocalPath = async (): Promise<void> => {
  error.value = null
  saved.value = false
  try {
    const path = await window.xcSkills.repositories.chooseLocalPath()
    if (path) form.repoPath = path
  } catch (cause) {
    error.value = cause
  }
}

const submit = async (): Promise<void> => {
  const message = validationMessage()
  if (message) {
    error.value = new Error(message)
    saved.value = false
    return
  }
  saving.value = true
  error.value = null
  saved.value = false
  try {
    const candidate = normalize(form)
    if (candidate.assetStorePath && candidate.assetStorePath !== baseline.value.assetStorePath) {
      const preview = await window.xcSkills.repositories.previewAssetStoreMigration(candidate.assetStorePath ?? '')
      if (preview.conflicts.length > 0) {
        throw new Error(preview.conflicts.map((item) => `${item.path}：${item.reason}`).join('\n'))
      }
      await ElMessageBox.confirm(
        `将迁移 ${preview.entityCount} 个实体，并重建 ${preview.symlinkTargets.length} 个软链接；${preview.copyTargets.length} 个复制安装保持不变。`,
        '确认迁移资源目录',
        { confirmButtonText: '迁移并保存', cancelButtonText: '取消', type: 'warning' },
      )
      await window.xcSkills.repositories.executeAssetStoreMigration(preview.token)
    }
    const result = await window.xcSkills.repositories.updateConfig(candidate)
    const next = toEditableConfig(result.config)
    baseline.value = next
    Object.assign(form, next)
    saved.value = true
    emit('saved', result.config)
  } catch (cause) {
    error.value = cause
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ElForm class="repository-config-form" label-position="top" @submit.prevent="submit">
    <section v-if="legacyMigration?.candidates.length || legacyMigration?.conflicts.length" class="legacy-migration-card" aria-label="旧版安装迁移">
      <div>
        <strong>旧版安装等待迁移</strong>
        <p>
          {{ legacyMigration.candidates.length }} 项可自动迁移
          <template v-if="legacyMigration.conflicts.length">，{{ legacyMigration.conflicts.length }} 项需要手动处理</template>
        </p>
      </div>
      <ElButton
        v-if="legacyMigration.candidates.length"
        type="primary"
        plain
        :loading="migratingLegacy"
        @click="migrateLegacyInstallations"
      >迁移到统一资源目录</ElButton>
      <ul v-if="legacyMigration.conflicts.length">
        <li v-for="item in legacyMigration.conflicts" :key="item.recordId"><code>{{ item.targetPath }}</code>：{{ item.reason }}</li>
      </ul>
    </section>
    <ErrorNotice v-if="legacyMigrationError" :error="legacyMigrationError as Error" />

    <div class="repository-config-heading">
      <div class="repository-config-mark" aria-hidden="true">↗</div>
      <div>
        <h4>资源来源</h4>
        <p>配置中央仓库位置；保存前会先验证仓库内容。</p>
      </div>
    </div>

    <ElFormItem class="repository-mode-field">
      <span class="form-label" aria-hidden="true">仓库模式</span>
      <ElRadioGroup v-model="form.mode" aria-label="仓库模式">
        <ElRadioButton value="local">本地</ElRadioButton>
        <ElRadioButton value="remote">远程</ElRadioButton>
      </ElRadioGroup>
    </ElFormItem>

    <ElFormItem v-if="form.mode === 'local'">
      <span class="form-label" aria-hidden="true">本地仓库路径</span>
      <ElInput
        v-model="form.repoPath"
        aria-label="本地仓库路径"
        placeholder="/Users/me/xc-skills"
      >
        <template #append>
          <ElButton aria-label="选择文件夹" @click="chooseLocalPath">选择文件夹</ElButton>
        </template>
      </ElInput>
      <small class="repository-field-help">选择包含 Skills、Rules 和 Workflows 的仓库目录。</small>
    </ElFormItem>

    <ElFormItem v-else>
      <span class="form-label" aria-hidden="true">远程仓库 URL</span>
      <ElInput
        v-model="form.remoteUrl"
        aria-label="远程仓库 URL"
        placeholder="https://example.com/xc-skills.git"
      />
      <small class="repository-field-help">支持当前 Git 凭据可访问的 HTTPS 或 SSH 地址。</small>
    </ElFormItem>

    <div class="repository-config-grid">
      <ElFormItem>
        <span class="form-label" aria-hidden="true">默认分支</span>
        <ElInput v-model="form.defaultBranch" aria-label="默认分支" placeholder="main" />
      </ElFormItem>
      <ElFormItem>
        <span class="form-label" aria-hidden="true">默认分组</span>
        <ElSelect
          v-model="form.defaultGroups"
          aria-label="默认分组"
          multiple
          filterable
          allow-create
          default-first-option
          placeholder="全部分组"
        >
          <ElOption v-for="group in knownGroups" :key="group" :label="group" :value="group" />
        </ElSelect>
      </ElFormItem>
    </div>

    <ElFormItem class="asset-store-field">
      <span class="form-label" aria-hidden="true">资源存储目录</span>
      <ElInput
        v-model="form.assetStorePath"
        aria-label="资源存储目录"
        placeholder="/Users/me/.xc-skills/store"
      >
        <template #append>
          <ElButton aria-label="选择资源存储目录" @click="chooseAssetStorePath">选择文件夹</ElButton>
        </template>
      </ElInput>
      <small class="repository-field-help">Skills、Rules 和 Workflows 的统一实体目录；Agent 安装将链接或复制自这里。</small>
    </ElFormItem>

    <ErrorNotice v-if="error" :error="error as Error" />
    <ElAlert
      v-else-if="saved"
      class="repository-save-success"
      type="success"
      title="配置已保存，中央仓库已刷新"
      :closable="false"
      show-icon
    />

    <div class="repository-config-actions">
      <span :class="{ visible: dirty }">{{ dirty ? '有未保存的更改' : '配置已同步' }}</span>
      <ElButton
        type="primary"
        native-type="submit"
        :loading="saving"
        :disabled="!dirty || saving"
      >
        保存并刷新
      </ElButton>
    </div>
  </ElForm>
</template>
