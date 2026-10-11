<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'
import { fmtLeft, defOf } from '../game/logic'

const store = useGameStore()
const { orderCards } = storeToRefs(store)
</script>

<template>
  <div class="modal" @click.self="store.closeOrders()">
    <div class="card">
      <div class="bag-head">
        <span class="bag-title">订单</span>
        <button class="bag-x" @click="store.closeOrders()">✕</button>
      </div>
      <p class="sub">放弃之后，同样的链和等级在 10 分钟内不会再被抽到。</p>
      <div v-for="o in orderCards" :key="o.id" class="ord">
        <div>
          <b>{{ o.customerEmoji }} {{ o.customerName }}</b>
          <span class="tag">{{ o.tierName }}</span>
          <div class="sub">
            {{ defOf(o.chain, o.level)?.name }} Lv{{ o.level }} · {{ o.gold }} 金币 · {{ fmtLeft(o.leftMs) }}
          </div>
        </div>
        <button class="ord-btn" @click="store.abandonOrder(o.id)">放弃</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ord {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  padding: 8px 0;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}
.ord-btn {
  border: 0;
  background: #f4efe6;
  border-radius: 10px;
  padding: 8px 12px;
  cursor: pointer;
}
</style>
