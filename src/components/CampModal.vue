<script setup lang="ts">
import { useGameStore } from '../stores/game'

const store = useGameStore()
</script>

<template>
  <div class="modal">
    <div class="card camp-card">
      <h3>你来当店长</h3>
      <p class="sub">选一边。订单还是两边都会来，只是你这边的客人更常对上你的口味。</p>
      <div class="camp-row">
        <button class="camp-btn cat" @click="store.chooseCamp('cat')">猫派</button>
        <button class="camp-btn dog" @click="store.chooseCamp('dog')">狗派</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.camp-card {
  width: min(420px, 92vw);
}
.camp-row {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
.camp-btn {
  flex: 1;
  border: 0;
  border-radius: 14px;
  padding: 16px 8px;
  font-weight: 800;
  font-size: 18px;
  cursor: pointer;
}
.camp-btn.cat {
  background: #ffe3ee;
  color: #72243e;
}
.camp-btn.dog {
  background: #ffe7c2;
  color: #4a2a06;
}
</style>
