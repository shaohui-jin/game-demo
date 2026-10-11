<script setup lang="ts">
/**
 * 底部信息栏：存档 / 提示（含物品详情）/ 存入背包 / 背包 / 商店。
 *
 * 「存入」只在长按选中了棋盘物品时出现 —— 平时不占位置，也不干扰产出操作。
 * 原来的「↩ 返回」是个假按钮（点了只弹 toast），改成「存档」入口 ——
 * 单机版的进度就是全部资产，这个入口必须一级可达。
 */
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'
import SpriteIcon from '../ui/SpriteIcon.vue'

const store = useGameStore()
const { hintHTML, selectedItem, selectedBoard, pendingTool } = storeToRefs(store)

function storeAway(): void {
  if (selectedBoard.value < 0) return
  store.moveToBag(selectedBoard.value)
}
</script>

<template>
  <div class="infobar">
    <div class="back" title="返回乐园" @click="store.leaveBoard()">
      <SpriteIcon name="ico-back" fallback="↩" />
    </div>
    <!-- eslint-disable-next-line vue/no-v-html — 内容由 store 内部生成，不含外部输入 -->
    <div class="hint" v-html="hintHTML"></div>

    <div v-if="selectedItem" class="shop act" @click="storeAway()">
      <span class="em"><SpriteIcon name="ico-in" fallback="📥" /></span><span class="tx">存入</span>
    </div>
    <div v-else-if="pendingTool" class="shop act" @click="store.cancelToolUse()">
      <span class="em"><SpriteIcon name="ico-close" fallback="✕" /></span><span class="tx">取消</span>
    </div>

    <div class="shop" :class="{ act: store.bagUsedN > 0 }" @click="store.openBag()">
      <span class="em"><SpriteIcon name="ico-bag" fallback="🎒" /></span><span class="tx">背包</span>
    </div>
    <div class="shop" @click="store.openShop()">
      <span class="em"><SpriteIcon name="ico-shop" fallback="🏪" /></span><span class="tx">商店</span>
    </div>
    <div class="shop gem" @click="store.openRecharge()">
      <span class="em">💎</span><span class="tx">充值</span>
    </div>
  </div>
</template>
