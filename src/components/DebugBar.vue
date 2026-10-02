<script setup lang="ts">
/**
 * 调试行：快速验证母体 / 蛛网 / CD / 经营层。正式版会整条移除。
 *
 * 经营层这两个按钮是必需的，不是可有可无：
 *   - **星星**只在订单结算时产出（普通订单一单 3 ⭐），想验证装饰链不可能靠手点攒够；
 *   - **订单倒计时**普通档是 8 小时，不把 expireAt 打到 0 就根本等不到"到期重抽"这条路径。
 * 换句话说，这两条主路径在没有调试按钮时**无法被验证**。
 */
import { useGameStore } from '../stores/game'

const store = useGameStore()

function confirmReset(): void {
  if (!confirm('确定重置存档吗？当前进度会全部清空。')) return
  store.reset()
}
</script>

<template>
  <div class="dbg">
    <button @click="store.openTree()">📖 链树</button>
    <button @click="confirmReset">重置存档</button>
    <button @click="store.fillStamina()">补满体力</button>
    <button @click="store.debugGive()">素材×4 + 蛛网</button>
    <button @click="store.debugDrain()">设施进入冷却</button>
    <button @click="store.debugGiveStars()">星星 +300</button>
    <button @click="store.debugExpireOrders()">订单到期</button>
    <span class="sp">调试：母体 / 蛛网 / 冷却 / 经营层</span>
  </div>
</template>
