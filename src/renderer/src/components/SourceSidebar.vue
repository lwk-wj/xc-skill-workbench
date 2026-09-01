<script setup lang="ts">
import { computed } from 'vue'
import { Delete, EditPen, MoreFilled, Plus, RefreshRight } from '@element-plus/icons-vue'
import { ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus'
import { useExplorerStore } from '../stores/explorer'
import brandMark from '../assets/xcskills-mark.png'

const explorer = useExplorerStore()
const emit = defineEmits<{
  settings: []
  'add-third-party': []
  'edit-third-party': [repositoryId: string]
}>()
const primarySources = computed(() => explorer.sources.filter((source) => source.kind !== 'third-party'))
const thirdPartySources = computed(() => explorer.sources.filter((source) => source.kind === 'third-party'))

const runRepositoryAction = (command: string, repositoryId: string): void => {
  if (command === 'refresh') void explorer.refreshThirdPartyRepository(repositoryId)
  if (command === 'edit') emit('edit-third-party', repositoryId)
  if (command === 'remove' && window.confirm(`移除这个第三方仓库？本地已安装的 Skill 不会被删除。`)) {
    void explorer.removeThirdPartyRepository(repositoryId)
  }
}
</script>

<template>
  <aside class="source-sidebar" aria-label="资源来源">
    <div class="brand" aria-label="XcSkills">
      <img :src="brandMark" alt="XcSkills 标志" />
      <span>XcSkills</span>
    </div>
    <nav class="source-navigation" aria-label="来源导航">
      <div v-for="source in primarySources" :key="source.id" class="source-row">
        <button
          class="source-button"
          :class="{ selected: explorer.selectedSource.id === source.id }"
          @click="explorer.selectSource(source)"
        >{{ source.label }}</button>
        <button
          v-if="source.kind === 'project'"
          class="icon-button"
          :aria-label="`移除项目 ${source.label}`"
          @click="explorer.removeProject(source.projectId)"
        >×</button>
      </div>

      <section class="source-section" aria-labelledby="third-party-heading">
        <div class="source-section-heading-row">
          <h2 id="third-party-heading">第三方仓库</h2>
          <ElButton
            class="source-section-add"
            text
            :icon="Plus"
            aria-label="添加第三方仓库"
            @click="emit('add-third-party')"
          />
        </div>
        <p v-if="!thirdPartySources.length" class="source-section-empty">还没有添加仓库</p>
        <div v-for="source in thirdPartySources" :key="source.id" class="source-row third-party-source-row">
          <div class="third-party-source-main">
            <button
              class="source-button"
              :class="{ selected: explorer.selectedSource.id === source.id, stale: source.stale }"
              @click="explorer.selectSource(source)"
            >{{ source.label }}</button>
          </div>
          <ElDropdown
            trigger="click"
            @command="(command: string) => runRepositoryAction(command, source.repositoryId)"
          >
            <ElButton class="repository-menu-button" text :icon="MoreFilled" :aria-label="`${source.label} 仓库操作`" />
            <template #dropdown>
              <ElDropdownMenu>
                <ElDropdownItem command="refresh" :icon="RefreshRight">拉取更新</ElDropdownItem>
                <ElDropdownItem command="edit" :icon="EditPen">编辑仓库</ElDropdownItem>
                <ElDropdownItem command="remove" :icon="Delete" divided>移除仓库</ElDropdownItem>
              </ElDropdownMenu>
            </template>
          </ElDropdown>
        </div>
      </section>
    </nav>
    <div class="sidebar-footer">
      <button class="add-project" aria-label="添加项目" @click="explorer.addProject()">＋ 添加项目</button>
      <button class="settings-button" @click="emit('settings')">⚙ 设置</button>
    </div>
  </aside>
</template>
