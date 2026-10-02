<script setup lang="ts">
import { useFx } from '../composables/useFx'

const { toastText, toastOn } = useFx()
</script>

<template>
  <div class="toast" :class="{ on: toastOn }">{{ toastText }}</div>
</template>
