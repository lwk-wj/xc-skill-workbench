<script setup lang="ts">
import { computed } from 'vue'
import {
  ElAlert,
  ElButton,
  ElCheckbox,
  ElCheckboxGroup,
  ElDialog,
  ElOption,
  ElProgress,
  ElRadio,
  ElRadioGroup,
  ElSelect,
} from 'element-plus'
import { useBatchOperationStore, type BatchExecutionStatus } from '../../stores/batch-operation'

const batch = useBatchOperationStore()

const summary = computed(() => `${batch.items.length} 个资源 · ${batch.selectedAgents.length} 个 Agent · ${batch.operationCount} 项操作`)
const affectedPaths = computed(() => [...new Set(batch.planEntries.flatMap((entry) => entry.plan?.steps.map((step) => step.target) ?? []))])
const warnings = computed(() => [...new Set(batch.planEntries.flatMap((entry) => entry.plan?.warnings ?? []))])
const planningErrors = computed(() => batch.planEntries.filter((entry) => entry.planningError))
const activeEntry = computed(() => batch.executionEntries[batch.current] ?? null)
const completedCount = computed(() => batch.executionEntries.filter((entry) => entry.status === 'completed').length)
const migrationIssueSummary = computed(() => {
  const migration = batch.sourceLayoutMigration
  if (!migration) return ''
  const issues = [
    ...migration.unresolved.map((item) => `${item.fromRelativePath}：来源仓库中无法唯一找到资源`),
    ...migration.conflicts.map((item) => `${item.path}：${item.reason}`),
  ]
  return issues.join('；')
})
const executionPercent = computed(() => batch.executionEntries.length
  ? Math.round((completedCount.value / batch.executionEntries.length) * 100)
  : 0)

const resultGroups: Array<{ status: BatchExecutionStatus[]; label: string }> = [
  { status: ['completed'], label: '已完成' },
  { status: ['failed', 'cancelled'], label: '失败' },
  { status: ['not_run'], label: '未执行' },
]
const entriesFor = (statuses: BatchExecutionStatus[]) => batch.executionEntries.filter((entry) => statuses.includes(entry.status))
const warningType = (warning: string): 'error' | 'warning' => warning.startsWith('未托管资源：') ? 'error' : 'warning'
const replan = (): void => { void batch.refreshPlans() }

const beforeClose = (done: () => void): void => {
  if (batch.stage === 'executing') {
    if (window.confirm?.('批量操作仍在执行。是否取消当前操作？')) void batch.cancelActive()
    return
  }
  batch.close()
  done()
}
</script>

<template>
  <ElDialog
    :model-value="batch.stage !== 'closed'"
    class="batch-operation-dialog"
    :title="batch.title"
    :aria-label="batch.title"
    width="min(760px, calc(100vw - 48px))"
    append-to-body
    :close-on-click-modal="false"
    :before-close="beforeClose"
  >
    <ElAlert v-if="batch.error" type="error" :closable="false" :title="batch.error" />
    <ElAlert
      v-else-if="batch.migrationBlocked"
      type="error"
      :closable="false"
      title="旧版资源无法自动恢复，当前批量安装已禁止执行。"
      :description="migrationIssueSummary"
    />
    <ElAlert
      v-else-if="batch.sourceLayoutMigration?.moves.length"
      type="warning"
      :closable="false"
      :title="`安装前将自动恢复并升级 ${batch.sourceLayoutMigration.moves.length} 个旧版资源。`"
    />

    <template v-if="batch.stage === 'configure'">
      <div class="batch-operation-summary">
        <strong>统一安装配置</strong>
        <span>{{ summary }}</span>
      </div>
      <div class="operation-targets">
        <div v-if="batch.targetLocked" class="operation-target-lock">
          <span>目标已锁定</span>
          <strong>{{ batch.targetLabel }}</strong>
          <small>{{ batch.scope === 'global' ? '安装会直接写入全局 Agent 目录。' : '安装会直接写入当前项目，不会切换到全局或其他项目。' }}</small>
        </div>
        <template v-else>
          <label>目标范围
            <ElSelect v-model="batch.scope" aria-label="目标范围" @change="replan">
              <ElOption label="全局" value="global" />
              <ElOption label="项目" value="project" />
            </ElSelect>
          </label>
          <label v-if="batch.scope === 'project'">项目
            <ElSelect v-model="batch.projectId" aria-label="目标项目" @change="replan">
              <ElOption v-for="project in batch.projects" :key="project.id" :label="project.name" :value="project.id" />
            </ElSelect>
          </label>
        </template>
        <fieldset>
          <legend>启用的 Agent</legend>
          <ElCheckboxGroup v-model="batch.selectedAgents" aria-label="启用的 Agent" @change="replan">
            <ElCheckbox v-for="agent in batch.enabledAgents" :key="agent.id" :label="agent.id" :value="agent.id">{{ agent.name }}</ElCheckbox>
          </ElCheckboxGroup>
        </fieldset>
      </div>
      <fieldset>
        <legend>安装方式</legend>
        <ElRadioGroup v-model="batch.method" aria-label="安装方式" @change="replan">
          <ElRadio value="symlink">软链接</ElRadio>
          <ElRadio value="copy">复制</ElRadio>
        </ElRadioGroup>
        <p class="operation-method-note">默认使用软链接，统一指向资源存储目录；复制会生成独立快照。</p>
      </fieldset>
      <div class="batch-operation-footer">
        <ElButton type="primary" :loading="batch.planning" :disabled="!batch.planEntries.length" @click="batch.confirmPreview">查看操作预览</ElButton>
      </div>
    </template>

    <template v-else-if="batch.stage === 'preview'">
      <div class="batch-operation-summary">
        <strong>操作预览</strong>
        <span>{{ summary }}</span>
      </div>
      <section v-if="planningErrors.length" class="batch-planning-errors" aria-label="无法执行的项目">
        <h3>存在不符合条件的项目</h3>
        <p>请先处理以下问题，当前批量操作已禁止执行。</p>
        <ul>
          <li v-for="entry in planningErrors" :key="entry.key"><strong>{{ entry.asset.name }} · {{ entry.agentName }}</strong><span>{{ entry.planningError }}</span></li>
        </ul>
      </section>
      <section v-if="affectedPaths.length" class="batch-paths" aria-labelledby="batch-paths-title">
        <h3 id="batch-paths-title">受影响路径</h3>
        <ul><li v-for="path in affectedPaths" :key="path"><code>{{ path }}</code></li></ul>
      </section>
      <ElAlert v-for="warning in warnings" :key="warning" :type="warningType(warning)" :closable="false" :title="warning" />
      <ElAlert
        v-if="batch.canConfirm"
        :type="batch.kind === 'uninstall' ? 'error' : 'warning'"
        :closable="false"
        :title="batch.kind === 'uninstall' ? '卸载会删除所有选中的安装位置，此操作不可逆。' : '操作将按列表顺序执行，首次失败后会停止。'"
      />
      <div class="batch-operation-footer">
        <ElButton v-if="batch.kind === 'install'" @click="batch.stage = 'configure'">返回配置</ElButton>
        <ElButton :type="batch.kind === 'uninstall' ? 'danger' : 'primary'" :disabled="!batch.canConfirm" @click="batch.executeFromPreview">确认执行</ElButton>
      </div>
    </template>

    <template v-else-if="batch.stage === 'executing'">
      <div class="batch-execution-status">
        <span>正在处理 {{ batch.current + 1 }}/{{ batch.executionEntries.length }}</span>
        <strong v-if="activeEntry">{{ activeEntry.asset.name }} · {{ activeEntry.agentName }}</strong>
      </div>
      <ElProgress :percentage="executionPercent" :stroke-width="8" />
      <p class="batch-progress-message">{{ batch.progress?.message ?? '正在执行，请勿关闭应用…' }}</p>
      <div class="batch-operation-footer">
        <ElButton :loading="batch.cancelling" @click="batch.cancelActive">取消操作</ElButton>
      </div>
    </template>

    <template v-else-if="batch.stage === 'done'">
      <div class="batch-operation-summary">
        <strong>批量操作结果</strong>
        <span>已完成 {{ completedCount }}/{{ batch.executionEntries.length }}</span>
      </div>
      <section v-for="group in resultGroups" :key="group.label" class="batch-result-group">
        <h3>{{ group.label }} {{ entriesFor(group.status).length }}</h3>
        <ul v-if="entriesFor(group.status).length">
          <li v-for="entry in entriesFor(group.status)" :key="entry.key">
            <span>{{ entry.asset.name }} · {{ entry.agentName }}</span>
            <small v-if="entry.error">{{ entry.error }}</small>
          </li>
        </ul>
        <p v-else>无</p>
      </section>
      <div class="batch-operation-footer"><ElButton type="primary" @click="batch.close">完成</ElButton></div>
    </template>
  </ElDialog>
</template>
