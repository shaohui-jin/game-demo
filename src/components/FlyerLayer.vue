<script setup lang="ts">
/** 飞行中的物品层。位置每帧由 rAF 写入 f.transform；同屏飞行体通常 ≤3 个，开销可忽略 */
import { useFx } from '../composables/useFx'
import SpriteIcon from '../ui/SpriteIcon.vue'

const { flyers } = useFx()
</script>

<template>
  <div
    v-for="f in flyers"
    :key="f.id"
    class="flyer"
    :style="{
      width: f.size + 'px',
      height: f.size + 'px',
      fontSize: Math.round(f.size * 0.42) + 'px',
      background: f.bg,
      color: f.fg,
      transform: f.transform,
    }"
  >
    <SpriteIcon :name="f.sprite" :fallback="f.emoji" />
  </div>
</template>
