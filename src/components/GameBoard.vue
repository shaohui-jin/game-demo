<script setup lang="ts">
/**
 * 7×9 棋盘（63 格，**全部可用**）。
 *
 * 棋盘宽度按视口反推（见 style.css 的 `.board`），保证 7×9 完整落在首屏。
 *
 * ★ 已删除「锁定区」（2026-10-02 第二轮设计修正）：
 *   主场景不再有锁定格，"花金币解锁格子"只属于背包。
 *   格子压力改由「设施常驻占格 + 蛛网」提供。
 *
 * ★ 2026-10-02 交互修正：
 *   - **背包是摆在棋盘上的道具**（默认右下角）：点它开背包弹窗、
 *     拖它换位置、把物品拖到它头上 = 存入背包；
 *   - 拖到**被占用且不可合成**的格子 → 挤出 / 换位规则（见 logic.findDisplaceCell）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import BoardCell from './BoardCell.vue'
import { useGameStore } from '../stores/game'
import { useDrag, type DropHint, type DropTarget } from '../composables/useDrag'
import { useFx } from '../composables/useFx'
import { isClickable, maxLv, sameKind } from '../game/logic'
import { TOTAL } from '../game/config'

const store = useGameStore()
const fx = useFx()
const {
  board,
  web,
  orderNeed,
  price,
  popCells,
  glowCells,
  landedCells,
  clearingCells,
  pendingCells,
  selectedBoard,
  pendingTool,
  cdLeftByCell,
} = storeToRefs(store)

/** 背包所占棋盘格（-1 = 背包暂不在棋盘上，走底部信息栏入口） */
const bagAt = computed(() => (store.g ? (store.g.bagAt ?? -1) : -1))

const boardEl = ref<HTMLElement | null>(null)
const cellEls = new Map<number, HTMLElement>()

/**
 * 收集格子 DOM。
 * ⚠️ `:ref` 作用在**子组件**上时拿到的是组件实例（`.$el` 才是根元素），
 * 不是 DOM 节点 —— 直接当 HTMLElement 用会在 getBoundingClientRect 处炸掉。
 */
function setCellEl(i: number, el: unknown): void {
  if (!el) {
    cellEls.delete(i)
    return
  }
  const dom =
    typeof el === 'object' && el !== null && '$el' in el
      ? (el as { $el: unknown }).$el
      : (el as EventTarget)
  if (dom instanceof HTMLElement) cellEls.set(i, dom)
  else cellEls.delete(i)
}

onMounted(() => {
  // 注册位置查询给 store / 特效层用：飞行、粒子、飘字都靠它换算屏幕坐标
  fx.setCellRectGetter((i) => {
    const el = cellEls.get(i)
    return el ? fx.rectOf(el) : null
  })
  fx.setBoardRectGetter(() => (boardEl.value ? fx.rectOf(boardEl.value) : null))
})
onBeforeUnmount(() => {
  fx.setCellRectGetter(() => null)
  fx.setBoardRectGetter(() => null)
})

// ==================== 拖拽 ====================
const { dragFrom, hintIndex, hintKind, onPointerDown: dragDown } = useDrag({
  boardEl: () => boardEl.value,
  onStart: () => fx.haptic(5),
  onTap,
  onLongPress,
  onDrop,
  hintFor,
})

function onPointerDown(e: Event, i: number): void {
  // 背包格：拖的是背包造型本体（可以换位置）；普通格：拖的是 .item
  const target =
    cellEls.get(i)?.querySelector<HTMLElement>('.bagbox') ??
    cellEls.get(i)?.querySelector<HTMLElement>('.item') ??
    null
  dragDown(e, i, target)
}

function onTap(i: number): void {
  const g = store.g
  if (!g) return

  // 点背包格 = 打开背包弹窗（居中悬浮，不挤压棋盘）
  if (i === bagAt.value) {
    store.openBag()
    return
  }

  // 道具待用中：轻点棋盘物品 = 对该物品使用道具
  if (pendingTool.value) {
    store.applyToolAt(i)
    return
  }

  // 轻点蛛网：花金币清除（方式一）
  if (web.value[i] && board.value[i] === null) {
    store.tapWeb(i)
    return
  }
  const it = board.value[i]
  if (!it) {
    store.clearSelection()
    return
  }
  const d = store.defAt(i)
  // 轻点可点击对象（设施 / 母体 / 链中段）：释放一次储备
  // ★ 产出是最高频操作，所以"选中物品"必须让给长按，不能抢轻点
  if (isClickable(d)) store.produce(i)
  else store.showHintFor(i)
}

/** 长按：选中物品，底部提示栏出现「存入」入口（拖拽之外的备用入口） */
function onLongPress(i: number): void {
  if (pendingTool.value) return
  store.selectBoardItem(i)
}

/**
 * 落点分两种 zone：
 *   - `bag-cell` → 存入背包（棋盘上的背包格；背包有空位才收）
 *   - `board`    → 移动 / 合成 / 牺牲给蛛网 / **挤出换位**；拖的是背包本体时 = 挪背包
 */
function onDrop(from: number, to: DropTarget): void {
  if (to.zone === 'bag-cell') {
    store.moveToBag(from)
    return
  }

  // 拖的是背包本体：只能落到非蛛网空格（moveBag 内部再校验一次）
  if (from === bagAt.value) {
    store.moveBag(to.index)
    return
  }

  const a = board.value[from]
  if (!a) return

  const b = board.value[to.index]
  // 拖到蛛网上：牺牲物品换空格（方式二）。设施会被 store 拒绝
  if (web.value[to.index] && b === null) {
    store.sacrificeToWeb(to.index, from)
    return
  }
  if (b === null) {
    store.moveItem(from, to.index)
    return
  }
  if (sameKind(a, b)) {
    store.merge(from, to.index)
    return
  }
  // 占用且不可合成：挤出（周围空位 → 外一圈 → 换位）
  store.displaceDrop(from, to.index)
}

function hintFor(from: number, to: DropTarget): DropHint {
  if (to.zone === 'bag-cell') {
    // 物品 → 背包：有空位才提示可放；背包本体拖回自己头上不算落点
    if (from === bagAt.value) return null
    return store.bagHasSpace ? 'bagstore' : null
  }

  // 拖背包本体：只能挪到非蛛网空格
  if (from === bagAt.value) {
    const b = board.value[to.index]
    return !b && !web.value[to.index] ? 'ok' : null
  }

  const a = board.value[from]
  const b = board.value[to.index]
  if (web.value[to.index] && b === null) return 'websac'
  if (b === null) return 'ok'
  if (sameKind(a, b) && a && a.level < maxLv(a.chain)) return 'merge'
  // 占用且不可合成：挤出 / 换位 —— 明确告诉玩家"松手会把它挤开"
  return a && b ? 'displace' : null
}

// ==================== 渲染 ====================
function itemAt(i: number) {
  return board.value[i] ?? null
}
function badgeAt(i: number): boolean {
  const it = board.value[i]
  return !!it && orderNeed.value.has(`${it.chain}:${it.level}`)
}
function hintAt(i: number): DropHint {
  return hintIndex.value === i ? hintKind.value : null
}

const cells = computed(() => Array.from({ length: TOTAL }, (_, i) => i))
</script>

<template>
  <div class="board" ref="boardEl">
    <BoardCell
      v-for="i in cells"
      :key="i"
      :ref="(el) => setCellEl(i, el)"
      :index="i"
      :item="itemAt(i)"
      :def="store.defAt(i)"
      :bag="i === bagAt"
      :webbed="web[i]"
      :web-price="price"
      :hint="hintAt(i)"
      :pending="pendingCells.has(i)"
      :badge="badgeAt(i)"
      :pop="popCells.has(i)"
      :glow="glowCells.has(i)"
      :landed="landedCells.has(i)"
      :clearing="clearingCells.has(i)"
      :dragging="dragFrom === i"
      :selected="selectedBoard === i"
      :tool-target="!!pendingTool"
      :cd-left="cdLeftByCell[i] ?? 0"
      @pointerdown="onPointerDown($event, i)"
    />
  </div>
</template>
