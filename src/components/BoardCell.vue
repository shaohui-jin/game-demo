<script setup lang="ts">
/**
 * 单个棋盘格。
 * 纯展示组件：所有状态由 GameBoard 透传，自己不碰 store。
 *
 * 视觉约定（P0 已验证，别改）：
 *   - 可点击对象 `.gen` 用实线内描边；链中段发射器 `.mid` 用虚线内描边；
 *   - `ready` 时脉冲、`dry` 时去饱和；顶级纯任务物品 `.fin` 用内侧白描边；
 *   - **新增**：设施链（玩具架 / 玩具箱）`.fac` 用更粗的暖色描边，一眼区分"产出的源头"。
 *
 * 冷却：储备耗尽且 refillMs > 0 时，格子盖上 `.cdmask` 并显示倒计时。
 * 倒计时文案由 GameBoard 传进来（`cdLeft` 毫秒），这里只负责画。
 *
 * 注意：**刻意不通过 Vue 绑定 transform**。拖拽位移由 useDrag 直接写 style，
 * 若这里也绑 transform，Vue 的 style patch 会把它擦掉。
 *
 * 造型：由 SpriteIcon 渲染（资源键 → 贴图，缺图自动降级 emoji）。
 * **不给物品加旋转** —— 棋盘是要一眼扫读的，倾斜会显著拖慢识别；
 * 贴纸的身份靠模切白边 + 硬落影撑就够了。
 * （唯一例外：拖拽拿起瞬间的固定小角度倾斜 —— 那是手势反馈，写在 useDrag 的
 *   transform 里，松手即消失，不属于静态造型。）
 *
 * 背包格（`bag`）：整格渲染 `.bagbox`，并挂 `data-bag-cell` 属性 ——
 * 拖拽落点判定**先查它**再查 `data-i`（见 useDrag.targetFromPoint）。
 */
import { computed } from 'vue'
import SpriteIcon from '../ui/SpriteIcon.vue'
import type { BoardItem, ResolvedDef } from '../game/types'

const props = defineProps<{
  index: number
  item: BoardItem | null
  def: ResolvedDef | null
  /** 该格是"背包道具"（摆在棋盘上的收纳箱，可点开/可拖动/可收物品） */
  bag: boolean
  webbed: boolean
  webPrice: number
  /** 拖拽落点提示 */
  hint: 'ok' | 'merge' | 'websac' | 'displace' | 'bagstore' | null
  /** 物品正在飞行途中，格子先留空 */
  pending: boolean
  badge: boolean
  pop: boolean
  glow: boolean
  landed: boolean
  /** 蛛网正在播放清除动画 */
  clearing: boolean
  dragging: boolean
  /** 长按选中的物品（可存入背包） */
  selected: boolean
  /** 有道具处于"待使用"状态：整个棋盘提示"可以点这里" */
  toolTarget: boolean
  /** 冷却剩余毫秒，> 0 表示储备耗尽、正在补充 */
  cdLeft: number
}>()

const clickable = computed(() => props.def?.kind === 'generator' || props.def?.kind === 'producer')
const cooling = computed(() => clickable.value && props.cdLeft > 0)

/** 冷却倒计时文案：mm:ss */
const cdText = computed(() => {
  const s = Math.ceil(props.cdLeft / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec < 10 ? '0' : ''}${sec}`
})

/** 冷却进度（0→100），用于圆环收束 */
const cdPct = computed(() => {
  const full = (props.def?.refillMs ?? 0) || 1
  return Math.max(0, Math.min(100, (1 - props.cdLeft / full) * 100))
})

const cellClass = computed(() => ({
  bagcell: props.bag,
  webbed: props.webbed && !props.item && !props.bag,
  ok: props.hint === 'ok',
  merge: props.hint === 'merge',
  websac: props.hint === 'websac',
  // 占用格的挤出/换位提示：松手会把原物品挤开
  displace: props.hint === 'displace',
  // 拖到背包格：给个"可以存进去"的提示
  bagstore: props.hint === 'bagstore',
  // 道具待用：有物品的空格轻微高亮，提示"可点"
  'tool-zone': props.toolTarget && !!props.item,
}))

const itemClass = computed(() => ({
  gen: clickable.value,
  auto: props.def?.kind === 'auto',
  fac: props.item?.chain === 'fac',
  mid: props.def?.kind === 'producer',
  fin: props.def?.kind === 'final',
  ready: clickable.value && (props.item?.charges ?? 0) > 0,
  dry: clickable.value && (props.item?.charges ?? 0) <= 0,
  cooling: cooling.value,
  pending: props.pending,
  dragging: props.dragging,
  pop: props.pop,
  glow: props.glow,
  landed: props.landed,
  sel: props.selected,
}))

const itemStyle = computed(() => ({
  background: props.def?.bg,
  color: props.def?.fg,
}))
</script>

<template>
  <div
    class="cell"
    :class="cellClass"
    :data-i="index"
    :data-bag-cell="bag ? index : undefined"
  >
    <!-- 背包道具：整格被它占着 —— 点开弹窗、可拖动换位、物品拖上来 = 存入 -->
    <div v-if="bag" class="item bagbox">
      <SpriteIcon name="ico-bag" fallback="🎒" />
      <span class="bagtag">背包</span>
    </div>

    <div v-else-if="item && def" class="item" :class="itemClass" :style="itemStyle">
      <SpriteIcon :name="def.sprite" :fallback="def.emoji" />
      <span v-if="clickable && !cooling" class="use">{{ item.charges }}</span>
      <!-- 自动型：没有储备数字（它不会耗尽），改成一个"自己会跑"的标记 -->
      <span v-if="def.kind === 'auto'" class="auto-mark">⟳</span>
      <span class="lv">{{ item.level }}</span>
      <!-- 冷却中：盖一层遮罩 + 倒计时，明确告诉玩家"它在补充，不是在坏" -->
      <span
        v-if="cooling"
        class="cdmask"
        :style="{ '--p': cdPct + '%' }"
        :title="`储备补充中，还需 ${cdText}`"
      >
        <span class="cdt">{{ cdText }}</span>
      </span>
    </div>

    <!-- 蛛网只可能出现在空格上；clearing 期间继续渲染，让消散动画播完 -->
    <div v-if="(webbed || clearing) && !item && !bag" class="web" :class="{ clear: clearing }">
      <SpriteIcon name="ico-web" fallback="🕸️" /><span class="wp">{{ webPrice }}</span>
    </div>

    <div v-if="badge" class="badge">✓</div>
  </div>
</template>
