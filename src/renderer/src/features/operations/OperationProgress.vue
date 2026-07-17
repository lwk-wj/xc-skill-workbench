<script setup lang="ts">
import { computed } from 'vue'
import { ElAlert, ElButton, ElProgress } from 'element-plus'
import type { OperationProgress, OperationResult } from '../../../../shared/ipc.js'

const props = withDefaults(defineProps<{
  progress: OperationProgress | null
  result?: OperationResult | null
  cancelling?: boolean
}>(), { result: null, cancelling: false })
const emit = defineEmits<{ cancel: [] }>()

const total = computed(() => props.progress?.total ?? 0)
const completed = computed(() => Math.min(props.progress?.completed ?? 0, total.value || Number.MAX_SAFE_INTEGER))
const percent = computed(() => total.value > 0 ? Math.round((completed.value / total.value) * 100) : props.result ? 100 : 0)
const statusLabel = computed(() => props.result?.status === 'completed' ? '操作完成'
  : props.result?.status === 'cancelled' ? '操作已取消'
    : props.result?.status === 'rolled_back' ? '操作已回滚'
      : props.result?.status === 'needs_attention' ? '操作需要处理' : '正在执行…')
</script>

<template>
  <section class="operation-progress" aria-label="操作进度">
    <h3>{{ statusLabel }}</h3>
    <ElProgress :percentage="percent" :aria-label="'操作进度'" />
    <span>{{ progress?.message ?? (result ? result.status : '准备中') }}</span>
    <small v-if="progress">{{ completed }}/{{ total }}</small>
    <ElAlert v-if="result?.residualPaths.length" type="error" :closable="false">
      需要处理的路径：<code v-for="path in result.residualPaths" :key="path">{{ path }}</code>
    </ElAlert>
    <ElButton v-if="!result" :disabled="cancelling" @click="emit('cancel')">{{ cancelling ? '正在取消…' : '取消操作' }}</ElButton>
  </section>
</template>
