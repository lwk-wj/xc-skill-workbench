<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElInput } from 'element-plus'
import type { ThirdPartyRepositoryInput, ThirdPartyRepositoryView } from '../../../../shared/ipc.js'

const visible = defineModel<boolean>({ required: true })
const props = withDefaults(defineProps<{ repository?: ThirdPartyRepositoryView | null }>(), { repository: null })
const emit = defineEmits<{ saved: [repository: ThirdPartyRepositoryView] }>()

const url = ref('')
const name = ref('')
const branch = ref('')
const saving = ref(false)
const error = ref<string | null>(null)
const result = ref<ThirdPartyRepositoryView | null>(null)
const editing = computed(() => Boolean(props.repository))

const reset = (): void => {
  url.value = props.repository?.url ?? ''
  name.value = props.repository?.name ?? ''
  branch.value = props.repository?.branch ?? ''
  saving.value = false
  error.value = null
  result.value = null
}

watch([visible, () => props.repository], ([nextVisible]) => { if (nextVisible) reset() }, { immediate: true })

const submit = async (): Promise<void> => {
  if (saving.value || !url.value.trim()) return
  const input: ThirdPartyRepositoryInput = {
    url: url.value.trim(),
    ...(name.value.trim() ? { name: name.value.trim() } : {}),
    ...(branch.value.trim() ? { branch: branch.value.trim() } : {}),
  }
  saving.value = true
  error.value = null
  try {
    const repository = props.repository
      ? await window.xcSkills.thirdPartyRepositories.update(props.repository.id, input)
      : await window.xcSkills.thirdPartyRepositories.add(input)
    result.value = repository
    emit('saved', repository)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法验证仓库'
  } finally {
    saving.value = false
  }
}

const close = (): void => { visible.value = false }
</script>

<template>
  <ElDialog
    v-model="visible"
    class="third-party-repository-dialog"
    :title="editing ? '编辑第三方仓库' : '添加第三方仓库'"
    :aria-label="editing ? '编辑第三方仓库' : '添加第三方仓库'"
    width="min(560px, calc(100vw - 48px))"
    append-to-body
    :close-on-click-modal="false"
  >
    <ElAlert v-if="error" role="alert" type="error" :closable="false" :title="error" />

    <div v-if="result" class="repository-validation-result" aria-live="polite">
      <span class="repository-validation-mark" aria-hidden="true">✓</span>
      <div>
        <strong>{{ result.name }}</strong>
        <p>仓库验证完成，可以从侧栏浏览和安装其中的 Skills。</p>
        <div class="repository-validation-meta">
          <span>{{ result.layout === 'catalog' ? '标准目录' : '单 Skill 仓库' }}</span>
          <span>{{ result.skillCount }} 个 Skills</span>
          <span>{{ result.branch }}</span>
        </div>
      </div>
    </div>

    <form v-else class="repository-form" @submit.prevent="submit">
      <label>Git URL
        <ElInput v-model="url" aria-label="Git URL" placeholder="https://github.com/team/skills.git" autocomplete="off" />
        <small>支持可由当前 Git 凭据访问的 HTTPS 或 SSH 仓库。</small>
      </label>
      <label>显示名称 <span>可选</span>
        <ElInput v-model="name" aria-label="显示名称" placeholder="留空时根据仓库名称生成" autocomplete="off" />
      </label>
      <label>分支 <span>可选</span>
        <ElInput v-model="branch" aria-label="分支" placeholder="留空时自动识别默认分支" autocomplete="off" />
      </label>
    </form>

    <template #footer>
      <ElButton v-if="!result" @click="close">取消</ElButton>
      <ElButton
        v-if="!result"
        type="primary"
        :loading="saving"
        :disabled="saving || !url.trim()"
        @click="submit"
      >{{ editing ? '验证并保存' : '验证并添加' }}</ElButton>
      <ElButton v-else type="primary" @click="close">完成</ElButton>
    </template>
  </ElDialog>
</template>
