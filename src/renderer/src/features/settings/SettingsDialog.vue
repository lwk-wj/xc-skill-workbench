<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElButton, ElDialog, ElOption, ElSelect, ElSwitch } from 'element-plus'
import type { AgentDefinition, ThemePreference, XcSkillsConfig } from '../../../../shared/ipc.js'
import ErrorNotice from '../../components/ErrorNotice.vue'
import { usePreferencesStore } from '../../stores/preferences'
import CustomAgentForm from './CustomAgentForm.vue'
import RepositoryConfigForm from './RepositoryConfigForm.vue'

const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ agentsChanged: []; repositoryChanged: [] }>()
const preferences = usePreferencesStore()
const config = ref<XcSkillsConfig>({})
const agents = ref<AgentDefinition[]>([])
const showAgentForm = ref(false)
const error = ref<unknown>(null)
let loadToken = 0

const load = async (): Promise<void> => {
  const token = ++loadToken
  error.value = null
  try {
    const [nextConfig, nextAgents] = await Promise.all([
      window.xcSkills.repositories.getConfig(),
      window.xcSkills.agents.list(),
      preferences.initializeTheme(),
    ])
    if (token !== loadToken) return
    config.value = nextConfig
    agents.value = nextAgents
  } catch (cause) {
    if (token === loadToken) error.value = cause
  }
}

watch(visible, (next) => { if (next) void load() }, { immediate: true })

const changeTheme = async (next: ThemePreference): Promise<void> => {
  try { await preferences.setTheme(next) } catch (cause) { error.value = cause }
}

const saveAgent = async (agent: AgentDefinition): Promise<void> => {
  try {
    agents.value = await window.xcSkills.agents.saveCustom(agent)
    showAgentForm.value = false
    error.value = null
    emit('agentsChanged')
  } catch (cause) { error.value = cause }
}

const toggleAgent = async (agent: AgentDefinition): Promise<void> => {
  try {
    agents.value = await window.xcSkills.agents.saveCustom({ ...agent, enabled: !agent.enabled })
    emit('agentsChanged')
  } catch (cause) { error.value = cause }
}

const removeAgent = async (agent: AgentDefinition): Promise<void> => {
  if (agent.builtIn || (window.confirm && !window.confirm(`移除 Agent ${agent.name}？`))) return
  try {
    agents.value = await window.xcSkills.agents.removeCustom(agent.id)
    emit('agentsChanged')
  } catch (cause) { error.value = cause }
}

const handleRepositorySaved = (next: XcSkillsConfig): void => {
  config.value = next
  emit('repositoryChanged')
}
</script>

<template>
  <ElDialog v-model="visible" class="settings-dialog" modal-class="settings-modal-overlay" title="设置" width="min(780px, calc(100vw - 48px))" aria-label="设置" append-to-body>
    <ErrorNotice v-if="error" :error="error as Error" />
    <div class="settings-content">
      <section class="settings-section">
        <h3>外观</h3>
        <label class="theme-control">主题
          <ElSelect :model-value="preferences.preference" aria-label="主题" @change="changeTheme">
            <ElOption label="跟随系统" value="system" />
            <ElOption label="浅色" value="light" />
            <ElOption label="深色" value="dark" />
          </ElSelect>
        </label>
      </section>
      <section class="settings-section">
        <h3>CLI 仓库</h3>
        <RepositoryConfigForm :config="config" @saved="handleRepositorySaved" />
      </section>
      <section class="settings-section">
        <div class="section-heading"><h3>Agents</h3><ElButton @click="showAgentForm = true">添加自定义 Agent</ElButton></div>
        <div class="agent-list">
          <div v-for="agent in agents" :key="agent.id" class="agent-row" :class="{ disabled: !agent.enabled }">
            <div><strong>{{ agent.name }}</strong><small>{{ agent.id }}{{ agent.builtIn ? ' · 内置' : ' · 自定义' }}</small></div>
            <div class="agent-actions">
              <ElSwitch :model-value="agent.enabled" :aria-label="`启用 ${agent.name}`" @change="toggleAgent(agent)" />
              <ElButton v-if="!agent.builtIn" :aria-label="`移除 ${agent.name}`" @click="removeAgent(agent)">移除</ElButton>
            </div>
          </div>
        </div>
        <CustomAgentForm v-if="showAgentForm" @save="saveAgent" @cancel="showAgentForm = false" />
      </section>
    </div>
    <template #footer><ElButton type="primary" @click="visible = false">完成</ElButton></template>
  </ElDialog>
</template>
