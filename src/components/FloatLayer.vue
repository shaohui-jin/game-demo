<script setup lang="ts">
/** 飘字层：+金币 / Lv3 / 母体 · 猫城堡 … */
import { useFx } from '../composables/useFx'

const { floatTexts } = useFx()
</script>

<template>
  <div
    v-for="t in floatTexts"
    :key="t.id"
    class="float"
    :style="{ left: t.x + 'px', top: t.y + 'px', color: t.color }"
  >
    {{ t.text }}
  </div>
</template>
