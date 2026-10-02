/**
 * 棋盘拖拽 —— 支持两种落点：**棋盘格**与**背包格**（背包是摆在棋盘上的"道具"）。
 *
 * P0 原型验证过的三条技术要点，这里原样保留：
 *   ① 用 Pointer Events，**不用** HTML5 Drag & Drop（移动端支持差）；
 *   ② 拖拽元素 `pointer-events: none` + `document.elementFromPoint` 判落点；
 *   ③ 棋盘 `touch-action: none` 防拖拽时页面滚动（在 style.css 的 .board 上）。
 *
 * `pointermove` 必须 `{ passive: false }` 注册，否则 preventDefault 无效、移动端会跟着滚屏。
 *
 * 实现细节：位移**直接写 DOM style**，不走响应式。
 * 否则每帧 pointermove 都会触发整块棋盘的 vnode diff，在低端机上会掉帧。
 *
 * ★ 本轮扩展（2026-10-02 交互修正）：
 *   - 背包从"底部抽屉"变成"棋盘右下角的可拖拽道具"：拖拽落点 zone 变为
 *     `board`（普通格）/ `bag-cell`（棋盘上的背包格）两种；
 *   - 占用格新增「挤出 / 换位」规则（displace 提示）；
 *   - 拿起手势升级：放大 + 固定小角度倾斜（**固定**角度，不做随机——
 *     随机旋转只属于纯展示元素，带文字的物品一歪就像出错）。
 */

import { onBeforeUnmount, onMounted, ref } from 'vue'

export type DropZone = 'board' | 'bag-cell'
export type DropHint = 'ok' | 'merge' | 'websac' | 'displace' | 'bagstore' | null

export interface DropTarget {
  zone: DropZone
  index: number
}

export interface UseDragOptions {
  /** 棋盘根元素 */
  boardEl: () => HTMLElement | null
  /** 轻点（未移动）某格 */
  onTap: (index: number) => void
  /**
   * 长按（未移动且按住超过阈值）某格。
   * 用长按而不是点击来"选中物品"，是因为**点击必须留给产出** ——
   * 产出是最高频操作，不能被选中态抢走。长按是拖拽之外的备用入口。
   */
  onLongPress?: (index: number) => void
  /** 从 from 拖到 to 并松手 */
  onDrop: (from: number, to: DropTarget) => void
  /** 某格是否禁止拖起 */
  disabled?: (index: number) => boolean
  /** 拖动过程中，目标该显示什么提示 */
  hintFor: (from: number, to: DropTarget) => DropHint
  /** 按下 / 松手时的手感回调 */
  onStart?: () => void
  onCommit?: () => void
}

const MOVE_THRESHOLD = 4
/** 拿起手势：放大 + 固定小角度倾斜 +（CSS 侧）落影加深 —— 物品"被捏起来"的手感 */
const DRAG_LIFT = 'scale(1.12) rotate(-2.5deg)'
/** 长按判定阈值（毫秒）。低于这个时长的抬手都算轻点 */
const LONG_PRESS_MS = 450

export function useDrag(opts: UseDragOptions) {
  /** 正在拖起的格子下标，-1 表示没有 */
  const dragFrom = ref(-1)

  /** 棋盘落点提示：格子下标 + 提示类型 */
  const hintIndex = ref(-1)
  const hintKind = ref<DropHint>(null)

  let el: HTMLElement | null = null
  let sx = 0
  let sy = 0
  let moved = false
  let downAt = 0
  /** 长按已经触发过就不再补发轻点，避免"长按选中"后又被当成一次点击 */
  let longPressed = false
  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * 拖动过程中最近一次**有效**落点。
   * 松手优先用它，避免松手瞬间 elementFromPoint 抖动把落点判丢。
   */
  let pendingTarget: DropTarget | null = null

  /**
   * 落点判定：背包格优先于普通格。
   * 用 `closest('[data-bag-cell]')` / `closest('[data-i]')` 而不是 `.cell`，
   * 这样格子内部结构随便改，判定逻辑不用改。
   */
  function targetFromPoint(x: number, y: number): DropTarget | null {
    const node = document.elementFromPoint(x, y)
    if (!node || !node.closest) return null

    const bagCell = node.closest('[data-bag-cell]') as HTMLElement | null
    if (bagCell) {
      const idx = Number(bagCell.dataset.bagCell)
      return Number.isNaN(idx) ? null : { zone: 'bag-cell', index: idx }
    }

    const cell = node.closest('[data-i]') as HTMLElement | null
    if (!cell) return null
    const idx = Number(cell.dataset.i)
    return Number.isNaN(idx) ? null : { zone: 'board', index: idx }
  }

  function clearHint(): void {
    hintIndex.value = -1
    hintKind.value = null
    pendingTarget = null
  }

  function releaseElement(): void {
    if (el) el.style.transform = ''
    el = null
  }

  // 事件挂在 window 而不是棋盘上：拖到棋盘外再松手也要能正确收尾
  function onMove(e: PointerEvent): void {
    if (dragFrom.value < 0) return
    e.preventDefault()

    const dx = e.clientX - sx
    const dy = e.clientY - sy
    if (!moved && (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD)) {
      moved = true
      stopLongPressTimer() // 一旦开始移动就不是长按了
    }

    if (el) el.style.transform = `translate(${dx}px, ${dy}px) ${DRAG_LIFT}`

    clearHint()
    if (!moved) return

    const t = targetFromPoint(e.clientX, e.clientY)
    if (!t) return
    if (t.zone === 'board') {
      if (t.index === dragFrom.value || opts.disabled?.(t.index)) return
    }
    const hint = opts.hintFor(dragFrom.value, t)
    if (!hint) return // 不可落（如拖到占用格但规则不允许）→ 不高亮也不接收
    pendingTarget = t
    hintIndex.value = t.index
    hintKind.value = hint
  }

  function onUp(e: PointerEvent): void {
    stopLongPressTimer()
    const from = dragFrom.value
    if (from < 0) return

    dragFrom.value = -1
    const target = pendingTarget
    clearHint()
    releaseElement()

    if (!moved) {
      // 按住够久 = 长按（选中）；否则 = 轻点
      if (!longPressed && Date.now() - downAt >= LONG_PRESS_MS && opts.onLongPress) {
        opts.onLongPress(from)
      } else if (!longPressed) {
        opts.onTap(from)
      }
      return
    }

    // 优先用拖动过程中已经判定出来的落点（hintFor 已通过才会记进来）
    if (target) {
      opts.onDrop(from, target)
      return
    }

    const t = targetFromPoint(e.clientX, e.clientY)
    if (!t) {
      opts.onCommit?.()
      return
    }
    if (t.zone === 'board' && (t.index === from || opts.disabled?.(t.index))) {
      opts.onCommit?.()
      return
    }
    if (!opts.hintFor(from, t)) {
      opts.onCommit?.()
      return
    }
    opts.onDrop(from, t)
  }

  function onCancel(): void {
    stopLongPressTimer()
    if (dragFrom.value < 0) return
    dragFrom.value = -1
    clearHint()
    releaseElement()
    opts.onCommit?.()
  }

  /** 由棋盘格在 pointerdown 时调用，把元素一并交进来供直接操作 */
  function onPointerDown(e: Event, index: number, target: HTMLElement | null): void {
    const pe = e as PointerEvent
    if (pe.pointerType === 'mouse' && pe.button !== 0) return
    if (opts.disabled?.(index)) return

    pe.preventDefault()
    sx = pe.clientX
    sy = pe.clientY
    moved = false
    downAt = Date.now()
    longPressed = false
    dragFrom.value = index
    el = target
    // 拿起瞬间就给"被捏起来"的反馈：放大 + 固定小角度倾斜（手势动画，非静态倾斜）
    if (el) el.style.transform = DRAG_LIFT
    opts.onStart?.()

    // 长按不移动时也给出反馈：轻微震动 + 松手前就能判定
    if (opts.onLongPress) {
      longPressTimer = setTimeout(() => {
        if (dragFrom.value < 0 || moved || longPressed) return
        longPressed = true
        if (el) el.style.transform = ''
        opts.onLongPress!(index)
      }, LONG_PRESS_MS)
    }
  }

  function stopLongPressTimer(): void {
    if (longPressTimer) clearTimeout(longPressTimer)
    longPressTimer = null
  }

  onMounted(() => {
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    stopLongPressTimer()
    releaseElement()
  })

  return { dragFrom, hintIndex, hintKind, onPointerDown }
}
