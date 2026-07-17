<script setup lang="ts">
import { ElDropdown, ElDropdownItem, ElDropdownMenu, ElInput, ElOption, ElSelect } from 'element-plus'
import { useExplorerStore } from '../stores/explorer'
import AssetList from './AssetList.vue'
import ErrorNotice from './ErrorNotice.vue'
import type { AssetType } from '../app/types'

const explorer = useExplorerStore()
const tabs: Array<{ value: AssetType; label: string }> = [
  { value: 'skills', label: 'Skills' },
  { value: 'rules', label: 'Rules' },
  { value: 'workflows', label: 'Workflows' },
]

const chooseBranch = (branch: string): void => { void explorer.selectBranch(branch) }
</script>

<template>
  <section class="explorer-pane" aria-label="资源浏览器">
    <header class="explorer-header">
      <div class="title-row">
        <div><h1>{{ explorer.selectedSource.label }}</h1><p class="subtitle">浏览与管理资源</p></div>
        <ElDropdown v-if="explorer.selectedSource.kind === 'central'" trigger="click" @command="chooseBranch">
          <button class="branch-button" aria-label="选择分支">分支：<span class="branch-value">{{ explorer.selectedBranch ?? 'main' }}</span><span class="select-chevron" aria-hidden="true">⌄</span></button>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem v-for="branch in explorer.branches" :key="branch.name" :command="branch.name">
                {{ branch.name }}{{ branch.default ? ' · 默认' : '' }}
              </ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>
      </div>
      <div v-if="explorer.stale" class="stale-banner">缓存数据 · {{ explorer.cachedAt ?? '时间未知' }}</div>
      <div class="toolbar">
        <div class="tabs" role="tablist" aria-label="资源类型">
          <button v-for="tab in tabs" :key="tab.value" role="tab" :aria-selected="explorer.assetType === tab.value" @click="explorer.assetType = tab.value">{{ tab.label }}</button>
        </div>
        <label class="search"><span class="sr-only">搜索资源</span><ElInput v-model="explorer.query" aria-label="搜索资源" placeholder="搜索资源" /></label>
      </div>
      <div class="filters">
        <label class="filter-control"><span class="filter-label">分组</span><ElSelect v-model="explorer.groupFilter" aria-label="分组筛选">
          <ElOption v-for="group in explorer.groups" :key="group" :label="group === 'all' ? '全部分组' : group" :value="group" />
        </ElSelect></label>
        <label class="filter-control"><span class="filter-label">状态</span><ElSelect v-model="explorer.statusFilter" aria-label="状态筛选">
          <ElOption label="全部状态" value="all" /><ElOption label="正常" value="active" /><ElOption label="已冻结" value="frozen" /><ElOption label="冲突" value="conflict" /><ElOption label="无效" value="invalid" />
        </ElSelect></label>
        <label v-if="explorer.selectedSource.kind !== 'central'" class="filter-control"><span class="filter-label">Agent</span><ElSelect v-model="explorer.agentFilter" aria-label="Agent筛选">
          <ElOption label="全部 Agent" value="all" /><ElOption v-for="agent in explorer.agents" :key="agent.id" :label="agent.name" :value="agent.id" />
        </ElSelect></label>
      </div>
    </header>
    <ErrorNotice v-if="explorer.error" :error="explorer.error" :on-retry="explorer.refreshCurrentSource" />
    <AssetList
      :assets="explorer.visibleAssets"
      :selected-id="explorer.selectedAssetId"
      :source-kind="explorer.selectedSource.kind"
      :agent-name="explorer.agentName"
      :loading="explorer.loading"
      :error="explorer.error"
      :query="explorer.query"
      :group-filter="explorer.groupFilter"
      :status-filter="explorer.statusFilter"
      :agent-filter="explorer.agentFilter"
      @select="explorer.selectedAssetId = $event"
    />
  </section>
</template>
