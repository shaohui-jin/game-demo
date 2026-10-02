<script setup lang="ts">
/**
 * 背包弹窗（**居中悬浮**，2026-10-02 交互修正）。
 *
 * ★ 交互定案（与需求一一对应）：
 *   - 背包本体是摆在棋盘右下角的"道具"（见 GameBoard 的 bagAt 格）：
 *     主场景物品**拖到背包格**松手 = 存入 —— 这条走棋盘拖拽，不经过本弹窗；
 *   - 点背包格 = 本弹窗**悬浮**在页面中间 —— 之前的底部抽屉会把主场景
 *     往上挤压，棋盘跟着变形，是错的；现在棋盘纹丝不动；
 *   - **点击背包里的物品 = 直接放回主场景**（随机空位 + 飞行动画），
 *     不再有"选中 → 再点棋盘"的两步操作。
 *
 * 背包仍是**纯收纳箱**：放进去的一切冻结（不产出、不走冷却、不消耗储备）。
 * 冷却是"挂起"而不是"继续走"——见 logic.ts 的 suspendCooldown()。
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'
import SpriteIcon from '../ui/SpriteIcon.vue'
import { BAG_COLS, BAG_TOTAL } from '../game/config'
import { defOf, coolingLeft, isCooling } from '../game/logic'
import { toolDef } from '../game/tools'
import type { BoardItem, ResolvedDef, ToolKey } from '../game/types'
import type { ToolDef } from '../game/tools'

const store = useGameStore()
const { g, bag, bagCap, bagUsedN, bagPriceNow, canExpand, now } = storeToRefs(store)

interface Cell {
  i: number
  locked: boolean
  /** 第一个未解锁格兼作「扩容」按钮 */
  expand: boolean
  item: BoardItem | null
  def: ResolvedDef | null
  tool: ToolKey | null
  count: number
  /** 该物品在背包里处于挂起冷却 */
  suspended: boolean
  suspendedText: string
}

const cells = computed<Cell[]>(() => {
  const out: Cell[] = []
  for (let i = 0; i < BAG_TOTAL; i++) {
    const locked = i >= bagCap.value
    const slot = bag.value[i]
    const item = slot && slot.k === 'item' ? slot.it : null
    const tool = slot && slot.k === 'tool' ? slot.st.tool : null
    const count = slot && slot.k === 'tool' ? slot.st.count : 0
    let suspended = false
    let suspendedText = ''
    if (item) {
      suspended = isCooling(item, now.value) || (item.cdLeft ?? 0) > 0
      if (suspended) suspendedText = fmtCd(coolingLeft(item, now.value))
    }
    out.push({
      i,
      locked,
      expand: locked && i === bagCap.value,
      item,
      def: item ? defOf(item.chain, item.level) : null,
      tool,
      count,
      suspended,
      suspendedText,
    })
  }
  return out
})

function fmtCd(ms: number): string {
  const s = Math.ceil(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec < 10 ? '0' : ''}${sec}`
}

function tdef(key: ToolKey): ToolDef {
  return toolDef(key)
}

function onCellClick(c: Cell): void {
  if (c.expand) {
    store.expandBag()
    return
  }
  if (c.locked) return
  if (c.tool) {
    // 特殊道具：不需要目标的直接生效，需要目标的进入待用态（下一步点棋盘物品）
    store.beginToolUse(c.tool)
    return
  }
  // 点击物品 = **直接放回主场景**（随机空位 + 飞行动画；棋盘满会 toast 拒绝）
  if (c.item) store.takeFromBag(c.i)
}
</script>

<template>
  <div class="modal" @click.self="store.closeBag()">
    <div class="card bag-card">
      <div class="bag-head">
        <span class="bag-title">背包</span>
        <span class="bag-cap">已用 <b>{{ bagUsedN }}</b>/{{ bagCap }}</span>
        <span class="bag-hint">点物品直接放回主场景</span>
        <button class="bag-x" @click="store.closeBag()">✕</button>
      </div>

      <div class="bag-grid" :style="{ gridTemplateColumns: `repeat(${BAG_COLS}, 1fr)` }">
        <div
          v-for="c in cells"
          :key="c.i"
          class="cell bag-cell"
          :class="{
            locked: c.locked && !c.expand,
            expand: c.expand,
          }"
          @click="onCellClick(c)"
        >
          <!-- 扩容格：标价格，缺钱置灰 -->
          <template v-if="c.expand">
            <span class="expand-ico">＋</span>
            <span class="expand-price" :class="{ no: (g?.gold ?? 0) < bagPriceNow }">
              <SpriteIcon name="ico-gold" fallback="🪙" />{{ bagPriceNow }}
            </span>
          </template>

          <template v-else-if="c.locked">
            <span class="lock"></span>
          </template>

          <!-- 普通物品（含设施，设施同样可以收进背包） -->
          <template v-else-if="c.item && c.def">
            <div
              class="item"
              :class="{ fac: c.item.chain === 'fac', cooling: c.suspended }"
              :style="{ background: c.def.bg, color: c.def.fg }"
            >
              <SpriteIcon :name="c.def.sprite" :fallback="c.def.emoji" />
              <span v-if="c.item.charges != null && !c.suspended" class="use">{{ c.item.charges }}</span>
              <span class="lv">{{ c.item.level }}</span>
              <span v-if="c.suspended" class="frozen">{{ c.suspendedText }}</span>
            </div>
          </template>

          <!-- 特殊道具：虚线描边 + 角标 + 堆叠数量 -->
          <template v-else-if="c.tool">
            <div
              class="item tool-item"
              :style="{ background: tdef(c.tool).bg, color: tdef(c.tool).fg }"
              :title="tdef(c.tool).desc"
            >
              <SpriteIcon :name="tdef(c.tool).sprite" :fallback="tdef(c.tool).emoji" />
              <span class="tool-mark"></span>
              <span class="stack">x{{ c.count }}</span>
            </div>
          </template>
        </div>
      </div>

      <div class="bag-foot">
        背包里的东西<b>全部冻结</b>：不产出、<b>冷却也暂停</b>（挂起而不是继续走），取出后接着算。<b>虚线框</b>是特殊道具，可堆叠。
      </div>

      <div class="bag-actions">
        <button
          class="close"
          :disabled="!canExpand || (g?.gold ?? 0) < bagPriceNow"
          @click="store.expandBag()"
        >
          <template v-if="canExpand">
            <SpriteIcon name="ico-gold" fallback="🪙" />扩容一格 · {{ bagPriceNow }}
          </template>
          <template v-else>已扩到上限</template>
        </button>
        <button class="close ghost" @click="store.closeBag()">关闭</button>
      </div>
    </div>
  </div>
</template>
