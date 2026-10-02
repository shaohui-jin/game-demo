<script setup lang="ts">
/**
 * 全屏粒子 / 光环层。
 * 按 devicePixelRatio 缩放（上限 2，避免高倍屏上过渡绘制拖垮帧率），pointer-events: none。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useFx } from '../composables/useFx'

const fx = useFx()
const el = ref<HTMLCanvasElement | null>(null)

onMounted(() => {
  if (el.value) fx.attachCanvas(el.value)
})
onBeforeUnmount(() => fx.detachCanvas())
</script>

<template>
  <canvas ref="el" id="fx"></canvas>
</template>
