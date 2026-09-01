<script setup lang="ts">
import { ElAlert, ElButton, ElCheckbox, ElCheckboxGroup, ElDialog, ElOption, ElRadio, ElRadioGroup, ElSelect } from 'element-plus'
import { useOperationStore } from '../../stores/operation'
import OperationProgress from './OperationProgress.vue'

const operation = useOperationStore()

const refreshPlans = (): void => { void operation.refreshPlans() }
</script>

<template>
  <ElDialog
    :model-value="operation.stage !== 'closed'"
    class="operation-dialog"
    :title="operation.title"
    aria-label="资源操作"
    width="min(620px, calc(100vw - 48px))"
    append-to-body
    :close-on-click-modal="false"
    @close="operation.close"
  >
    <ElAlert v-if="operation.error" type="error" :closable="false" :title="operation.error" />
    <template v-if="operation.stage === 'preview' || operation.stage === 'confirm'">
      <div v-if="operation.kind === 'install' && !operation.location" class="operation-targets">
        <label>目标范围
          <ElSelect v-model="operation.scope" aria-label="目标范围" @change="refreshPlans">
            <ElOption label="全局" value="global" /><ElOption label="项目" value="project" />
          </ElSelect>
        </label>
        <label v-if="operation.scope === 'project'">项目
          <ElSelect v-model="operation.projectId" aria-label="目标项目" @change="refreshPlans">
            <ElOption v-for="project in operation.projects" :key="project.id" :label="project.name" :value="project.id" />
          </ElSelect>
        </label>
        <fieldset>
          <legend>启用的 Agent</legend>
          <ElCheckboxGroup v-model="operation.selectedAgents" aria-label="启用的 Agent" @change="refreshPlans">
            <ElCheckbox v-for="agent in operation.enabledAgents" :key="agent.id" :label="agent.id" :value="agent.id">{{ agent.name }}</ElCheckbox>
          </ElCheckboxGroup>
        </fieldset>
      </div>
      <p v-if="operation.source.kind === 'third-party' && (operation.kind === 'install' || operation.kind === 'update')" class="operation-method-note third-party-copy-note">第三方仓库 Skill 使用复制方式安装。</p>
      <fieldset v-else-if="operation.kind === 'install' || operation.kind === 'update'">
        <legend>安装方式</legend>
        <ElRadioGroup v-model="operation.method" aria-label="安装方式" @change="refreshPlans">
          <ElRadio value="copy">复制</ElRadio>
          <ElRadio value="symlink" :disabled="!operation.allowSymlink">软链接</ElRadio>
        </ElRadioGroup>
        <p v-if="!operation.allowSymlink" class="operation-method-note">当前仓库使用远程缓存，仅支持复制安装。切换为本地仓库后可使用软链接。</p>
      </fieldset>
      <section v-if="operation.sourceConflict" class="source-conflict-card" aria-label="来源冲突">
        <div class="source-conflict-heading">
          <strong>目标位置已有其他来源的 Skill</strong>
          <span>需要明确确认后才能替换来源</span>
        </div>
        <dl>
          <div><dt>当前来源</dt><dd>{{ operation.sourceConflict.existing.label }}</dd></div>
          <div><dt>新来源</dt><dd>{{ operation.sourceConflict.requested.label }}</dd></div>
          <div><dt>目标路径</dt><dd><code>{{ operation.sourceConflict.targetPath }}</code></dd></div>
        </dl>
        <ElButton
          v-if="!operation.replaceExistingSource"
          type="primary"
          plain
          @click="operation.confirmSourceReplacement"
        >使用新来源替换</ElButton>
        <span v-else class="source-replacement-confirmed">已确认替换来源</span>
      </section>
      <p>目标：{{ operation.targetLabel }} · {{ operation.asset?.name }}</p>
      <section v-if="operation.affectedPaths.length" aria-label="受影响路径">
        <h3>受影响路径</h3>
        <ul><li v-for="path in operation.affectedPaths" :key="path"><code>{{ path }}</code></li></ul>
      </section>
      <ElAlert v-for="warning in operation.warnings" :key="warning" type="warning" :closable="false" :title="warning" />
      <ElAlert v-if="operation.hasOverwrite" type="warning" :closable="false" title="本地有修改，确认后将覆盖。" />
      <p v-if="operation.kind === 'uninstall' && operation.location">仅删除选中的资源：<code>{{ operation.location.path }}</code></p>
      <ElButton v-if="operation.stage === 'preview'" type="primary" :disabled="!operation.selectedAgents.length || !operation.plans.length" @click="operation.confirm">确认并继续</ElButton>
      <template v-else>
        <ElAlert type="warning" :closable="false" title="此操作不可逆，请确认执行。" />
        <ElButton type="primary" @click="operation.executeAll">确认执行</ElButton>
      </template>
    </template>
    <OperationProgress
      v-else-if="operation.stage === 'executing'"
      :progress="operation.progress ?? { planId: operation.plans[operation.current]?.id ?? 'operation', completed: 0, total: operation.allSteps.length || operation.plans.length, message: `执行 ${operation.current + 1}/${operation.plans.length}` }"
      :cancelling="operation.cancelling"
      @cancel="operation.cancelActive"
    />
    <template v-else-if="operation.stage === 'done'">
      <OperationProgress :progress="operation.progress" :result="operation.result" />
      <ElButton v-if="!operation.error" type="primary" @click="operation.close">完成</ElButton>
    </template>
  </ElDialog>
</template>
