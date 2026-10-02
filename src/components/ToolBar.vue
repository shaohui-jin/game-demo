<script setup lang="ts">
/**
 * 功能栏：经营 / 订单 / 完成（一键交付）。
 *
 * 第一批改动：
 *   - 原来的「加速器」是纯占位（点了只弹 toast，还要假装显示一个 18m52s），
 *     直接换成**经营**入口 —— 与其摆一个假按钮，不如把本批真正做出来的系统放到一级入口。
 *   - 「订单」补上**最近到期那个订单**的档位与倒计时，
 *     让"订单会过期"在玩家不打开订单面板时也能看得见。
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'
import SpriteIcon from '../ui/SpriteIcon.vue'
import { fmtLeft } from '../game/logic'

const store = useGameStore()
const { orders, readyOrders, orderCards, stars, nextRegion, regionList } = storeToRefs(store)

const soon = computed(() => {
  const list = orderCards.value.slice().sort((a, b) => a.leftMs - b.leftMs)
  const o = list[0]
  return o ? `${o.tierName} ${fmtLeft(o.leftMs)}` : '暂无订单'
})

/** 有区域可建设时给经营入口挂红点 —— 这是"下一步该干什么"最有效的指引 */
const canBuild = computed(
  () => !!nextRegion.value && regionList.value.some((r) => r.key === nextRegion.value && r.canUnlock)
)
</script>

<template>
  <div class="tools">
    <div class="tool" :class="{ hot: canBuild }" @click="store.openBusiness('region')">
      <span class="em"><SpriteIcon name="ico-manage" fallback="🏗️" /></span>
      <span class="tx">
        <span class="t1">经营<span v-if="canBuild" class="hotdot"></span></span>
        <span class="t2">★{{ stars }} · {{ canBuild ? '可建设' : '装饰/区域/顾客' }}</span>
      </span>
    </div>

    <div class="tool" @click="store.showOrders()">
      <span class="em"><SpriteIcon name="ico-order" fallback="📋" /></span>
      <span class="tx">
        <span class="t1">订单</span>
        <span class="t2">{{ readyOrders }}/{{ orders.length }} 待交付 · {{ soon }}</span>
      </span>
    </div>

    <div class="tool go" :class="{ ready: readyOrders > 0 }" @click="store.deliverAll()">
      <span class="t1">完成</span>
    </div>
  </div>
</template>
