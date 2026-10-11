<script setup lang="ts">
/**
 * 乐园画布。按已装的斜视角 skill：
 * - 2:1，锚点是菱形中心（isometric-grid-math）
 * - 先按 col+row 从远到近画地面，再画牌子和房子（canvas2d-isometric-renderer）
 * - 房子占地 1×1，脚落在格子中心（isometric-building-sprites）
 * - 黄牌是单独物件，同样锚在格子中心（isometric-object-sprites）
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'
import {
  TILE_H,
  TILE_W,
  PLOTS,
  gridToScreen,
  nextPlot,
  plotAt,
  screenToGrid,
  skinOf,
  type PlotDef,
} from '../game/yard'
import { fmtLeft } from '../game/logic'

const store = useGameStore()
const { g, now, todayFest } = storeToRefs(store)
const theme = computed(() => g.value?.live.theme ?? 'cat')
const comingId = computed(() => nextPlot(g.value?.live.plotLv ?? {})?.id ?? '')

const canvasRef = ref<HTMLCanvasElement | null>(null)
const wrapRef = ref<HTMLElement | null>(null)
const grabbing = ref(false)

const cam = { x: 0, y: 0 }
let camReady = false
let grassImg: HTMLCanvasElement | null = null
let signImg: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let dragging = false
let moved = false
let lastX = 0
let lastY = 0
let viewScale = 1

function level(id: string): number {
  return g.value?.live.plotLv[id] ?? 0
}

function resize(): void {
  const canvas = canvasRef.value
  const wrap = wrapRef.value
  if (!canvas || !wrap) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = wrap.clientWidth
  const h = wrap.clientHeight
  canvas.width = Math.max(1, Math.floor(w * dpr))
  canvas.height = Math.max(1, Math.floor(h * dpr))
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
  ctx = canvas.getContext('2d')
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  viewScale = (h * 0.78) / (TILE_H * 3)
  if (!camReady && w > 0 && h > 0) {
    camReady = true
    const mid = gridToScreen(3.5, 3)
    cam.x = w / 2 - mid.x * viewScale
    cam.y = h * 0.58 - mid.y * viewScale
    clampCam(w, h)
  }
  draw()
}

function worldPoint(col: number, row: number): { x: number; y: number } {
  const p = gridToScreen(col, row)
  return toDraw(p.x, p.y)
}

function toDraw(x: number, y: number): { x: number; y: number } {
  return { x: x + cam.x / viewScale, y: y + cam.y / viewScale }
}

function drawDiamond(x: number, y: number, shrink: number): void {
  if (!ctx) return
  const hw = (TILE_W / 2) * shrink
  const hh = (TILE_H / 2) * shrink
  ctx.beginPath()
  ctx.moveTo(x, y - hh)
  ctx.lineTo(x + hw, y)
  ctx.lineTo(x, y + hh)
  ctx.lineTo(x - hw, y)
  ctx.closePath()
}

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas || !ctx) return
  const viewW = canvas.clientWidth
  const viewH = canvas.clientHeight
  const dpr = canvas.width / viewW
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.fillStyle = '#8ed56c'
  ctx.fillRect(0, 0, viewW, viewH)

  ctx.setTransform(dpr * viewScale, 0, 0, dpr * viewScale, 0, 0)
  const cells: { col: number; row: number; depth: number }[] = []
  for (let row = -1; row <= 9; row++) {
    for (let col = 0; col <= 7; col++) cells.push({ col, row, depth: col + row })
  }
  cells.sort((a, b) => a.depth - b.depth || a.col - b.col)
  for (const cell of cells) {
    const p = worldPoint(cell.col, cell.row)
    if (cell.depth >= 8) drawRoad(p.x, p.y)
    else drawGrass(p.x, p.y)
  }
  const plots = [...PLOTS].sort((a, b) => a.col + a.row - (b.col + b.row) || a.col - b.col)
  for (const plot of plots) {
    const p = worldPoint(plot.col, plot.row)
    const lv = level(plot.id)
    if (lv < 1) drawSign(p.x, p.y, plot)
    else drawBuilding(p.x, p.y, plot, lv)
  }
}

function clampCam(viewW: number, viewH: number): void {
  const s = viewScale
  const sceneLeft = -280
  const sceneRight = 640
  const sceneTop = 80
  const sceneBot = 480
  const minX = viewW * 0.2 - sceneRight * s
  const maxX = viewW * 0.8 - sceneLeft * s
  const minY = viewH * 0.15 - sceneBot * s
  const maxY = viewH * 0.85 - sceneTop * s
  cam.x = Math.min(maxX, Math.max(minX, cam.x))
  cam.y = Math.min(maxY, Math.max(minY, cam.y))
}

function drawRoad(x: number, y: number): void {
  if (!ctx) return
  drawDiamond(x, y, 1)
  ctx.fillStyle = '#6d7680'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(x - 26, y)
  ctx.lineTo(x - 8, y)
  ctx.moveTo(x + 10, y)
  ctx.lineTo(x + 28, y)
  ctx.stroke()
}

function drawGrass(x: number, y: number): void {
  if (!ctx) return
  if (!grassImg) {
    drawDiamond(x, y, 1)
    ctx.fillStyle = '#8ed56c'
    ctx.fill()
    return
  }
  const dw = TILE_W * (grassImg.width / 992) * 1.02
  const dh = TILE_H * (grassImg.height / 630) * 1.02
  ctx.drawImage(grassImg, x - dw / 2, y - dh / 2, dw, dh)
}

function drawSign(x: number, y: number, plot: PlotDef): void {
  if (!ctx) return
  if (signImg) {
    const sh = TILE_H * 0.92
    const sw = sh * (signImg.width / signImg.height)
    const foot = 784 / signImg.height
    ctx.drawImage(signImg, x - sw / 2, y - sh * foot + 6, sw, sh)
  }
  if (comingId.value !== plot.id) return
  const bw = 46 / viewScale
  const bh = 18 / viewScale
  const by = y - TILE_H * 0.62
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(x - bw / 2, by, bw, bh, bh / 2)
  ctx.fill()
  ctx.fillStyle = '#5c4316'
  ctx.font = `700 ${Math.max(11, 13 / viewScale)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`⭐${plot.cost}`, x, by + bh / 2)
  ctx.textBaseline = 'alphabetic'
}

function drawBuilding(x: number, y: number, plot: PlotDef, lv: number): void {
  if (!ctx) return
  const skin = skinOf(plot.building, theme.value)
  ctx.font = `${Math.max(16, 22 / viewScale)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(skin.emoji, x, y - 8)
  ctx.font = `700 ${Math.max(10, 12 / viewScale)}px sans-serif`
  ctx.fillStyle = '#3d2914'
  ctx.textBaseline = 'top'
  const label = lv > 1 ? `${skin.name} ${lv}` : skin.name
  ctx.fillText(label, x, y + 10)
  ctx.textBaseline = 'alphabetic'
}

function pointerPos(ev: PointerEvent): { x: number; y: number } {
  const canvas = canvasRef.value!
  const r = canvas.getBoundingClientRect()
  return { x: ev.clientX - r.left, y: ev.clientY - r.top }
}

function onDown(ev: PointerEvent): void {
  dragging = true
  moved = false
  grabbing.value = true
  lastX = ev.clientX
  lastY = ev.clientY
  try {
    canvasRef.value?.setPointerCapture(ev.pointerId)
  } catch {
    /* 合成事件没有指针捕获 */
  }
}

function onMove(ev: PointerEvent): void {
  if (!dragging) return
  const dx = ev.clientX - lastX
  const dy = ev.clientY - lastY
  if (Math.abs(dx) + Math.abs(dy) > 4) moved = true
  lastX = ev.clientX
  lastY = ev.clientY
  cam.x += dx
  cam.y += dy
  const canvas = canvasRef.value
  if (canvas) clampCam(canvas.clientWidth, canvas.clientHeight)
  draw()
}

function onUp(ev: PointerEvent): void {
  if (!dragging) return
  dragging = false
  grabbing.value = false
  if (moved) return
  const pos = pointerPos(ev)
  const hit = screenToGrid((pos.x - cam.x) / viewScale, (pos.y - cam.y) / viewScale)
  const plot = plotAt(hit.col, hit.row)
  if (!plot) return
  const lv = level(plot.id)
  if (lv < 1) store.buyPlot(plot.id)
  else if (lv < 2) store.upgradePlot(plot.id)
  else store.enterBoard()
}

function festLeft(): string {
  const fest = todayFest.value
  if (!fest) return ''
  if (g.value?.live.festFocus) return '时间旅行中'
  const end = new Date(now.value)
  end.setMonth(fest.month - 1, fest.day + fest.span - 1)
  end.setHours(23, 59, 59, 999)
  return fmtLeft(Math.max(0, end.getTime() - now.value))
}

function knockWhite(src: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.naturalWidth
  c.height = src.naturalHeight
  const x = c.getContext('2d')!
  x.drawImage(src, 0, 0)
  const img = x.getImageData(0, 0, c.width, c.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const max = Math.max(d[i], d[i + 1], d[i + 2])
    const min = Math.min(d[i], d[i + 1], d[i + 2])
    if (min > 232 && max - min < 22) d[i + 3] = 0
  }
  x.putImageData(img, 0, 0)
  return c
}

function loadArt(url: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(knockWhite(img))
    img.onerror = reject
    img.src = url
  })
}

onMounted(() => {
  resize()
  window.addEventListener('resize', resize)
  Promise.all([loadArt('/yard/tile-grass.jpg'), loadArt('/yard/prop-sign.jpg')]).then(([grass, sign]) => {
    grassImg = grass
    signImg = sign
    draw()
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
})

watch([g, theme, comingId], () => draw(), { deep: true })
</script>

<template>
  <div class="yard">
    <header class="yard-bar">
      <button class="yard-ico" @click="store.openSettings()">存档</button>
      <span class="yard-stars">⭐ {{ g?.stars ?? 0 }}</span>
      <button class="yard-ico" @click="store.setTheme(theme === 'cat' ? 'dog' : 'cat')">
        {{ theme === 'cat' ? '猫' : '狗' }}
      </button>
    </header>
    <div ref="wrapRef" class="yard-scroll" :class="{ grabbing }">
      <canvas
        ref="canvasRef"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
      />
    </div>
    <footer class="yard-foot">
      <button class="enter" @click="store.enterBoard()">进入棋盘</button>
      <button class="yard-ico" @click="store.openPark('codex')">图鉴</button>
      <button class="yard-ico" @click="store.openPark('fest')">活动</button>
      <span v-if="todayFest" class="fest">{{ todayFest.emoji }} {{ festLeft() }}</span>
    </footer>
  </div>
</template>

<style scoped>
.yard {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #7dce6a;
  z-index: 5;
}
.yard-bar,
.yard-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fffdf8;
}
.yard-stars {
  flex: 1;
  text-align: center;
  font-weight: 800;
}
.yard-ico,
.enter {
  border: 0;
  border-radius: 999px;
  background: #faeeda;
  padding: 8px 12px;
  font-weight: 700;
  cursor: pointer;
}
.enter {
  flex: 1;
  background: #ef9f27;
  color: #3a2508;
}
.fest {
  font-size: 12px;
  font-weight: 800;
}
.yard-scroll {
  flex: 1;
  min-height: 0;
  position: relative;
  background: #7dce6a;
  touch-action: none;
  cursor: grab;
}
.yard-scroll.grabbing,
.yard-scroll.grabbing canvas {
  cursor: grabbing;
}
canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
