<script setup lang="ts">
/**
 * 贴图单元 —— 全项目所有"图标/物品造型"的唯一渲染出口。
 *
 * 三级降级（顺序固定，不要改）：
 *   ① 资源键命中 → 渲染 <img>（当前是矢量造型稿，切到 webp 后是位图贴图）
 *   ② 贴图加载失败（文件缺失 / 网络失败）→ 降级到文字兜底
 *   ③ 资源键为空或查不到 → 直接文字兜底
 *
 * 为什么一定要有兜底：贴图是外部资源，缺失属于必然会发生的情况
 * （新加了一个链但美术还没出图、打包漏文件、CDN 挂了）。
 * 没有兜底就会在棋盘上开一个天窗，比看到一个 emoji 难看得多。
 */
import { computed, ref, watch } from 'vue'
import { spriteOf } from './sprites'

const props = defineProps<{
  /** 资源键，如 'toy-1' / 'gen-fort' / 'ico-gold' */
  name?: string | null
  /** 贴图缺失时的文字兜底（通常传 def.emoji） */
  fallback?: string
  /** 无障碍文本；装饰性贴图留空即可 */
  alt?: string
}>()

const failed = ref(false)
const url = computed(() => spriteOf(props.name) ?? '')

// 资源键变了要重置失败标记，否则换物品后一直是兜底态
watch(url, () => {
  failed.value = false
})

const showImg = computed(() => url.value !== '' && !failed.value)
</script>

<template>
  <img
    v-if="showImg"
    class="spr"
    :src="url"
    :alt="alt ?? ''"
    draggable="false"
    @error="failed = true"
  />
  <span v-else class="spr spr-txt">{{ fallback ?? '' }}</span>
</template>
