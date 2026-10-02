/**
 * 表现层：粒子 / 光环 / 飘字 / Toast / 抛物线飞行 / 屏幕震动 / 触觉反馈。
 *
 * 这是一个**模块级单例**（不是 Pinia store）：表现层与玩法状态互相独立，
 * 放到 store 里会让存档序列化变得麻烦。任何组件 / store 都可以直接 `useFx()` 拿到同一个实例。
 *
 * P0 原型里的两条表现层经验，必须原样保留：
 *   ① 产出的飞行方向 / 弧高 / 时长 / 旋转**四者都要随机**，否则连续产出会有机械节奏感；
 *   ② 所有源位置 rect **必须在改动 state 之前取好**，因为元素一旦被重建 rect 会归零。
 *      在 Vue 里这条由「先取 rect 再改 store」的调用顺序保证。
 */

import { reactive, ref, computed } from 'vue'

export interface Rect {
  left: number
  top: number
  width: number
  height: number
  right: number
  bottom: number
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  life: number
  decay: number
  c: string
}

interface Ring {
  x: number
  y: number
  r: number
  maxR: number
  w: number
  life: number
  c: string
}

interface FloatText {
  id: number
  x: number
  y: number
  text: string
  color: string
}

interface Flyer {
  id: number
  x: number
  y: number
  size: number
  emoji: string
  /** 贴图资源键 —— 渲染层优先，emoji 只作兜底 */
  sprite: string
  bg: string
  fg: string
  transform: string
  done: () => void
}

// ---------- 单例状态 ----------
let uid = 0

const toastText = ref('')
const toastOn = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | null = null

const floatTexts = reactive<FloatText[]>([])
const flyers = reactive<Flyer[]>([])

/** 正在飞行途中的目标格：格子里先放一个 opacity:0 的占位物品 */
const pendingCells = reactive(new Set<number>())

let cellRectGetter: (i: number) => Rect | null = () => null
let boardRectGetter: () => Rect | null = () => null

// ---------- Canvas 特效层 ----------
let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
const parts: Particle[] = []
const rings: Ring[] = []
let vw = 0
let vh = 0
let rafId = 0

function resizeFx(): void {
  if (!canvas || !ctx) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  vw = window.innerWidth
  vh = window.innerHeight
  canvas.width = Math.round(vw * dpr)
  canvas.height = Math.round(vh * dpr)
  canvas.style.width = vw + 'px'
  canvas.style.height = vh + 'px'
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function stepFx(): void {
  if (ctx) {
    ctx.clearRect(0, 0, vw, vh)

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]
      p.vy += 0.13
      p.vx *= 0.985
      p.vy *= 0.985
      p.x += p.vx
      p.y += p.vy
      p.life -= p.decay
      if (p.life <= 0) {
        parts.splice(i, 1)
        continue
      }
      ctx.globalAlpha = Math.max(0, p.life)
      ctx.fillStyle = p.c
      ctx.beginPath()
      ctx.arc(p.x, p.y, Math.max(0.4, p.r * p.life), 0, 6.2832)
      ctx.fill()
    }

    for (let j = rings.length - 1; j >= 0; j--) {
      const g = rings[j]
      g.r += (g.maxR - g.r) * 0.22
      g.life -= 0.055
      if (g.life <= 0) {
        rings.splice(j, 1)
        continue
      }
      ctx.globalAlpha = Math.max(0, g.life * 0.75)
      ctx.strokeStyle = g.c
      ctx.lineWidth = g.w * g.life
      ctx.beginPath()
      ctx.arc(g.x, g.y, g.r, 0, 6.2832)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
  rafId = requestAnimationFrame(stepFx)
}

function attachCanvas(el: HTMLCanvasElement): void {
  canvas = el
  // 无 canvas 实现的环境（jsdom 单测、极少数精简 WebView）静默降级：
  // 所有粒子 / 光环调用都会被 ctx 判空挡掉，玩法完全不受影响。
  try {
    ctx = el.getContext('2d')
  } catch {
    ctx = null
  }
  if (!ctx) return
  resizeFx()
  window.addEventListener('resize', resizeFx)
  window.addEventListener('orientationchange', onOrientation)
  if (!rafId) rafId = requestAnimationFrame(stepFx)
}

function detachCanvas(): void {
  window.removeEventListener('resize', resizeFx)
  window.removeEventListener('orientationchange', onOrientation)
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  canvas = null
  ctx = null
}

function onOrientation(): void {
  setTimeout(resizeFx, 120)
}

// ---------- 对外 API ----------

function burst(x: number, y: number, color: string, count = 16, power = 1): void {
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.5
    const sp = (1.4 + Math.random() * 3.2) * power
    parts.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 0.8,
      r: 1.6 + Math.random() * 3.4,
      life: 1,
      decay: 0.014 + Math.random() * 0.018,
      c: color,
    })
  }
}

function ring(x: number, y: number, color: string, maxR = 46, width = 3): void {
  rings.push({ x, y, r: 4, maxR, w: width, life: 1, c: color })
}

function toast(msg: string, ms = 1600): void {
  toastText.value = msg
  toastOn.value = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastOn.value = false
  }, ms)
}

function floatText(x: number, y: number, text: string, color = '#1D9E75'): void {
  const item: FloatText = { id: ++uid, x, y, text, color }
  floatTexts.push(item)
  setTimeout(() => {
    const idx = floatTexts.findIndex((f) => f.id === item.id)
    if (idx >= 0) floatTexts.splice(idx, 1)
  }, 880)
}

/** 屏幕震动。px 为振幅像素，0 或省略则用默认值 */
function shake(px?: number): void {
  const app = document.getElementById('app')
  if (!app) return
  app.style.setProperty('--shk', (px || 1.2) + 'px')
  app.classList.remove('shake')
  void app.offsetWidth // 强制重排，让动画能重复触发
  app.classList.add('shake')
  setTimeout(() => app.classList.remove('shake'), 220)
}

function haptic(ms = 12): void {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(ms)
    } catch {
      /* 忽略：部分浏览器禁止非用户手势下震动 */
    }
  }
}

function centerOf(el: Element | null): { x: number; y: number } | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function rectOf(el: Element | null): Rect | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
}

function centerOfRect(r: Rect): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/** GameBoard 挂载时注册，让 store 能拿到某一格的屏幕位置 */
function setCellRectGetter(fn: (i: number) => Rect | null): void {
  cellRectGetter = fn
}
function setBoardRectGetter(fn: () => Rect | null): void {
  boardRectGetter = fn
}
function getCellRect(i: number): Rect | null {
  return cellRectGetter(i)
}
function getBoardRect(): Rect | null {
  return boardRectGetter()
}

/**
 * 抛物线飞行。
 * 水平线性 / 垂直正弦弧 / 随机时长 300–410ms / 随机弧高 46–98px / 随机旋转方向与角度。
 * 四个随机量缺一不可，否则连续产出会显得机械。
 */
function flyTo(
  fromRect: Rect | null,
  toIdx: number,
  look: { emoji: string; sprite?: string; bg: string; fg: string }
): Promise<void> {
  return new Promise((resolve) => {
    const toRect = getCellRect(toIdx)
    if (!toRect) {
      resolve()
      return
    }
    const fr = fromRect || {
      left: toRect.left,
      top: toRect.top - 60,
      width: toRect.width,
      height: toRect.height,
      right: toRect.right,
      bottom: toRect.bottom,
    }

    const size = Math.max(20, toRect.width - 4)
    const from = centerOfRect(fr)
    const to = centerOfRect(toRect)

    const dur = 300 + Math.random() * 110
    const arc = 46 + Math.random() * 52
    const spin = (Math.random() > 0.5 ? 1 : -1) * (140 + Math.random() * 140)

    const flyer: Flyer = {
      id: ++uid,
      x: 0,
      y: 0,
      size,
      emoji: look.emoji,
      sprite: look.sprite ?? '',
      bg: look.bg,
      fg: look.fg,
      transform: '',
      done: () => {},
    }
    flyers.push(flyer)

    const t0 = performance.now()
    const frame = (now: number): void => {
      let t = (now - t0) / dur
      if (t > 1) t = 1
      const x = from.x + (to.x - from.x) * t
      const y = from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * arc
      const rot = spin * t
      const sc = 1 + Math.sin(Math.PI * t) * 0.16
      flyer.transform = `translate(${x - size / 2}px, ${y - size / 2}px) rotate(${rot}deg) scale(${sc})`
      if (t < 1) {
        requestAnimationFrame(frame)
      } else {
        const idx = flyers.findIndex((f) => f.id === flyer.id)
        if (idx >= 0) flyers.splice(idx, 1)
        resolve()
      }
    }
    requestAnimationFrame(frame)
  })
}

export function useFx() {
  return {
    // state
    toastText,
    toastOn,
    floatTexts,
    flyers,
    pendingCells,
    toastVisible: computed(() => toastOn.value),
    // canvas
    attachCanvas,
    detachCanvas,
    burst,
    ring,
    // feedback
    toast,
    floatText,
    shake,
    haptic,
    centerOf,
    rectOf,
    centerOfRect,
    // positioning
    setCellRectGetter,
    setBoardRectGetter,
    getCellRect,
    getBoardRect,
    // motion
    flyTo,
  }
}
