<script setup lang="ts">
import type { AssetDetail } from '../../../shared/ipc.js'

defineProps<{ files: AssetDetail['files'] }>()
</script>

<template>
  <p v-if="!files.length" class="detail-muted">没有文件</p>
  <ul v-else class="asset-file-tree" aria-label="文件树">
    <li v-for="file in files" :key="file.relativePath" class="asset-file-row">
      <span>{{ file.relativePath }}</span>
      <small>{{ file.kind === 'binary' ? '二进制' : '文本' }} · {{ file.size.toLocaleString() }} B</small>
    </li>
  </ul>
</template>
