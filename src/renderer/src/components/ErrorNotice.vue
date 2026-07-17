<script setup lang="ts">
import { computed } from 'vue'
import { ElAlert, ElButton } from 'element-plus'

export type StructuredError = {
  code?: string
  message?: string
  path?: string
  paths?: string[]
  resolvedTarget?: string | null
  logPath?: string
  staleAvailable?: boolean
}

const props = defineProps<{
  error: StructuredError | Error | string | null | undefined
  onRetry?: () => void
  onAction?: () => void
}>()

const details = computed<StructuredError>(() => {
  if (!props.error) return {}
  if (typeof props.error === 'string') return { code: 'UNKNOWN', message: props.error }
  if (props.error instanceof Error) return { code: 'UNKNOWN', message: props.error.message }
  return props.error
})

const presentation = computed(() => {
  const code = details.value.code ?? 'UNKNOWN'
  if (code === 'PERMISSION_DENIED') return { title: '没有访问权限', guidance: '请在 Finder 中检查权限后重试。' }
  if (code === 'GIT_FAILED' || code === 'NETWORK_FAILED') return {
    title: '无法同步仓库',
    guidance: details.value.staleAvailable === false ? '网络恢复后重试。' : '可继续使用最近一次成功的缓存。',
    actionLabel: '重试',
  }
  if (code === 'BROKEN_LINK') return { title: '发现断裂软链接', guidance: '请选择卸载或修复计划来处理该入口。', actionLabel: '查看修复计划' }
  if (code === 'ENTRY_CONFLICT') return { title: '入口路径冲突', guidance: '请先解决冲突；冻结和解冻暂不可用。' }
  if (code === 'ROLLBACK_FAILED') return { title: '回滚未完成', guidance: '请保留以下残留路径并联系维护者处理。' }
  return { title: '操作失败', guidance: '请稍后重试，详细诊断已写入本地日志。' }
})

const safePath = (value: string): string => value.replaceAll(/(token|password|secret|authorization)=[^\s&]+/gi, '$1=…')
const paths = computed(() => [...(details.value.paths ?? []), ...(details.value.path ? [details.value.path] : [])])
const handleAction = (): void => {
  if (presentation.value.actionLabel === '重试' || (!presentation.value.actionLabel && props.onRetry)) props.onRetry?.()
  else props.onAction?.()
}
</script>

<template>
  <ElAlert
    v-if="error"
    class="error-notice"
    type="error"
    :title="presentation.title"
    :closable="false"
    show-icon
  >
    <p>{{ presentation.guidance }}</p>
    <p v-if="details.resolvedTarget" class="error-paths">目标：<code>{{ safePath(details.resolvedTarget) }}</code></p>
    <ul v-if="paths.length" class="error-paths">
      <li v-for="path in paths" :key="path"><code>{{ safePath(path) }}</code></li>
    </ul>
    <p v-if="details.logPath" class="error-log">日志：<code>{{ safePath(details.logPath) }}</code></p>
    <ElButton v-if="presentation.actionLabel || onRetry" size="small" @click="handleAction">{{ presentation.actionLabel ?? '重试' }}</ElButton>
  </ElAlert>
</template>
