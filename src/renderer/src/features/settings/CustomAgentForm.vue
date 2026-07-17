<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElButton, ElForm, ElFormItem, ElInput, ElSwitch } from 'element-plus'
import type { AgentDefinition } from '../../../../shared/ipc.js'

type FormState = {
  id: string
  name: string
  projectBaseDir: string
  globalBaseDir: string
  skills: string
  rules: string
  workflows: string
  enabled: boolean
}

const props = defineProps<{ agent?: AgentDefinition }>()
const emit = defineEmits<{ save: [agent: AgentDefinition]; cancel: [] }>()
const error = ref<string | null>(null)
const form = reactive<FormState>({ id: '', name: '', projectBaseDir: '', globalBaseDir: '', skills: 'skills', rules: 'rules', workflows: 'workflows', enabled: true })

const relativeFrom = (base?: string, value?: string): string | null => {
  if (!base || !value) return null
  const prefix = `${base.replace(/[\\/]$/, '')}/`
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

const reset = (agent?: AgentDefinition): void => {
  Object.assign(form, {
    id: agent?.id ?? '', name: agent?.name ?? '', projectBaseDir: agent?.projectBaseDir ?? '', globalBaseDir: agent?.globalBaseDir ?? '',
    skills: relativeFrom(agent?.globalBaseDir, agent?.assetDirs.skills) ?? 'skills',
    rules: relativeFrom(agent?.globalBaseDir, agent?.assetDirs.rules) ?? 'rules',
    workflows: relativeFrom(agent?.globalBaseDir, agent?.assetDirs.workflows) ?? 'workflows',
    enabled: agent?.enabled ?? true,
  })
  error.value = null
}

watch(() => props.agent, reset, { immediate: true })

const isAbsolute = (value: string): boolean => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
const relativeDirectoryError = (value: string): string | null => {
  const normalized = value.trim().replaceAll('\\', '/')
  if (!normalized) return '目录不能为空'
  if (isAbsolute(normalized)) return '必须填写相对目录'
  if (normalized.split('/').some((part) => part === '..')) return '目录不能包含 ..'
  if (normalized.includes('\0')) return '目录包含无效字符'
  return null
}
const resolveDirectory = (base: string, value: string): string => `${base.replace(/[\\/]$/, '')}/${value.trim().replaceAll('\\', '/').replace(/^\/+/, '')}`

const errors = computed(() => {
  const messages: string[] = []
  if (!/^[A-Za-z0-9._:-]+$/.test(form.id.trim())) messages.push('Agent ID 只能包含字母、数字、点、下划线、冒号或短横线')
  if (!form.name.trim()) messages.push('显示名称不能为空')
  if (!isAbsolute(form.projectBaseDir.trim())) messages.push('项目基础目录必须是绝对路径')
  if (!isAbsolute(form.globalBaseDir.trim())) messages.push('全局基础目录必须是绝对路径')
  for (const [label, value] of [['Skills', form.skills], ['Rules', form.rules], ['Workflows', form.workflows]] as const) {
    const message = relativeDirectoryError(value)
    if (message) messages.push(`${label} 相对目录${message}`)
  }
  return messages
})

const submit = (): void => {
  if (errors.value.length) { error.value = errors.value[0] ?? '请检查表单'; return }
  error.value = null
  emit('save', {
    id: form.id.trim(), name: form.name.trim(), projectBaseDir: form.projectBaseDir.trim(), globalBaseDir: form.globalBaseDir.trim(),
    assetDirs: {
      skills: resolveDirectory(form.globalBaseDir, form.skills),
      rules: resolveDirectory(form.globalBaseDir, form.rules),
      workflows: resolveDirectory(form.globalBaseDir, form.workflows),
    },
    builtIn: props.agent?.builtIn ?? false,
    enabled: form.enabled,
  })
}
</script>

<template>
  <ElForm class="custom-agent-form" label-position="top" @submit.prevent="submit">
    <h3>{{ agent ? '编辑 Agent' : '添加自定义 Agent' }}</h3>
    <div v-if="error" role="alert" class="form-error">{{ error }}</div>
    <ElFormItem><span class="form-label" aria-hidden="true">Agent ID</span><ElInput v-model="form.id" aria-label="Agent ID" :readonly="Boolean(agent?.builtIn)" /></ElFormItem>
    <ElFormItem><span class="form-label" aria-hidden="true">显示名称</span><ElInput v-model="form.name" aria-label="显示名称" /></ElFormItem>
    <ElFormItem><span class="form-label" aria-hidden="true">项目基础目录</span><ElInput v-model="form.projectBaseDir" aria-label="项目基础目录" placeholder="/Users/me/project/.agent" /></ElFormItem>
    <ElFormItem><span class="form-label" aria-hidden="true">全局基础目录</span><ElInput v-model="form.globalBaseDir" aria-label="全局基础目录" placeholder="/Users/me/.agent" /></ElFormItem>
    <fieldset>
      <legend>资源相对目录</legend>
      <ElFormItem><span class="form-label" aria-hidden="true">Skills 相对目录</span><ElInput v-model="form.skills" aria-label="Skills 相对目录" /></ElFormItem>
      <ElFormItem><span class="form-label" aria-hidden="true">Rules 相对目录</span><ElInput v-model="form.rules" aria-label="Rules 相对目录" /></ElFormItem>
      <ElFormItem><span class="form-label" aria-hidden="true">Workflows 相对目录</span><ElInput v-model="form.workflows" aria-label="Workflows 相对目录" /></ElFormItem>
    </fieldset>
    <ElFormItem><span class="form-label" aria-hidden="true">启用 Agent</span><ElSwitch v-model="form.enabled" aria-label="启用 Agent" /></ElFormItem>
    <div class="form-actions">
      <ElButton type="primary" native-type="submit">保存 Agent</ElButton>
      <ElButton @click="emit('cancel')">取消</ElButton>
    </div>
  </ElForm>
</template>
