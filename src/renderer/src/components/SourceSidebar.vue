<script setup lang="ts">
import { useExplorerStore } from '../stores/explorer'

const explorer = useExplorerStore()
</script>

<template>
  <aside class="source-sidebar" aria-label="资源来源">
    <div class="brand">XC Skills</div>
    <nav aria-label="来源导航">
      <div v-for="source in explorer.sources" :key="source.id" class="source-row">
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
    </nav>
    <div class="sidebar-footer">
      <button class="add-project" aria-label="添加项目" @click="explorer.addProject()">＋ 添加项目</button>
      <button class="settings-button" @click="$emit('settings')">⚙ 设置</button>
    </div>
  </aside>
</template>
