/**
 * 乐园地图。
 *
 * 一张竖图切成 12 块地，价格手写在 20–48 星（前台为 0）。
 * 建筑是配置：要么打开一条链，要么只换样子。没有生产倒计时。
 * 猫 / 狗是主题皮，进度认地块 id 和链 id。
 */

import type { ChainKey } from './types'
import { hasSprite } from '../ui/sprites'

export type ThemeId = 'cat' | 'dog'
export type ZoneId = 'gate' | 'lawn' | 'edge'

export const STAR_MIN = 20
export const STAR_MAX = 48

export interface PlotDef {
  id: string
  zone: ZoneId
  /** 买地的星星。0 只有前台 */
  cost: number
  /** 升到 2 级的星星，仍在 20–48 */
  upCost: number
  /** 建筑标识，贴图和主题名字都认它 */
  building: string
  /** 盖好 1 级时打开的链。没有就是纯样子 */
  chain?: ChainKey
  /**
   * 斜向草坪上的格子。同一排（col+row 相同）在画面上是横着的一排。
   * 数字小的一排在远处，已经盖好的房间在那边；近处是还没买的草地。
   */
  col: number
  row: number
}

export interface ThemeSkin {
  name: string
  emoji: string
}

/**
 * 跟截图一样的斜向草坪。
 * 一排 4 块，共 3 排。远处那排先盖（房间），近处是还空着的草地。
 * 石路是地块之间的边，不是单独画的一条弯道。
 */
export const TILE_W = 180
export const TILE_H = 90

export const PLOTS: readonly PlotDef[] = [
  { id: 'lobby', zone: 'gate', cost: 0, upCost: 24, building: 'lobby', col: 2, row: 3 },
  { id: 'groom', zone: 'gate', cost: 24, upCost: 28, building: 'groom', chain: 'care', col: 3, row: 2 },
  { id: 'diner', zone: 'gate', cost: 32, upCost: 32, building: 'diner', chain: 'food', col: 4, row: 1 },
  { id: 'train', zone: 'gate', cost: 40, upCost: 36, building: 'train', chain: 'train', col: 5, row: 0 },
  { id: 'comfort', zone: 'lawn', cost: 28, upCost: 24, building: 'comfort', chain: 'comfort', col: 2, row: 4 },
  { id: 'med', zone: 'lawn', cost: 40, upCost: 40, building: 'med', chain: 'med', col: 3, row: 3 },
  { id: 'clean', zone: 'lawn', cost: 24, upCost: 28, building: 'clean', chain: 'clean', col: 4, row: 2 },
  { id: 'coin', zone: 'lawn', cost: 48, upCost: 48, building: 'coin', chain: 'coin', col: 5, row: 1 },
  { id: 'garden', zone: 'lawn', cost: 32, upCost: 20, building: 'garden', col: 2, row: 5 },
  { id: 'bench', zone: 'lawn', cost: 36, upCost: 24, building: 'bench', col: 3, row: 4 },
  { id: 'sign', zone: 'edge', cost: 20, upCost: 20, building: 'sign', col: 4, row: 3 },
  { id: 'lamp', zone: 'edge', cost: 24, upCost: 24, building: 'lamp', col: 5, row: 2 },
]

export type GroundKind = 'grass' | 'road'

export interface GroundCell {
  col: number
  row: number
  kind: GroundKind
  plot: PlotDef | null
  x: number
  y: number
}

export function plotAt(col: number, row: number): PlotDef | null {
  return PLOTS.find((p) => p.col === col && p.row === row) ?? null
}

/**
 * 锚点是菱形中心（isometric-grid-math）。
 * screenX = (col - row) * (W/2) + originX
 * screenY = (col + row) * (H/2) + originY
 * W = 2H。
 */
export function gridToScreen(
  col: number,
  row: number,
  originX = 0,
  originY = 0
): { x: number; y: number } {
  return {
    x: (col - row) * (TILE_W / 2) + originX,
    y: (col + row) * (TILE_H / 2) + originY,
  }
}

/** 屏幕点 → 格子。先减原点，再按上面的公式求逆，最后四舍五入。 */
export function screenToGrid(
  screenX: number,
  screenY: number,
  originX = 0,
  originY = 0
): { col: number; row: number } {
  const x = screenX - originX
  const y = screenY - originY
  const hw = TILE_W / 2
  const hh = TILE_H / 2
  const col = (x / hw + y / hh) / 2
  const row = (y / hh - x / hw) / 2
  return { col: Math.round(col), row: Math.round(row) }
}

export function groundCells(): { cells: GroundCell[]; width: number; height: number } {
  const cells: GroundCell[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let row = -2; row <= 12; row++) {
    for (let col = -2; col <= 12; col++) {
      const depth = col + row
      const plot = plotAt(col, row)
      const kind: GroundKind = depth >= 9 ? 'road' : 'grass'
      const p = gridToScreen(col, row)
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
      cells.push({ col, row, kind, plot, x: p.x, y: p.y })
    }
  }
  const pad = 8
  for (const c of cells) {
    c.x -= minX - pad
    c.y -= minY - pad
  }
  cells.sort((a, b) => a.col + a.row - (b.col + b.row) || a.col - b.col)
  return {
    cells,
    width: maxX - minX + TILE_W + pad * 2,
    height: maxY - minY + TILE_H + pad * 2,
  }
}

export const THEME_SKINS: Record<string, Record<ThemeId, ThemeSkin>> = {
  lobby: { cat: { name: '前台', emoji: '🏠' }, dog: { name: '前台', emoji: '🏠' } },
  groom: { cat: { name: '洗护间', emoji: '🛁' }, dog: { name: '美容台', emoji: '✂️' } },
  diner: { cat: { name: '餐厅', emoji: '🍽️' }, dog: { name: '饭堂', emoji: '🦴' } },
  train: { cat: { name: '训练角', emoji: '🎾' }, dog: { name: '训犬场', emoji: '🦮' } },
  comfort: { cat: { name: '午睡窝', emoji: '🛏️' }, dog: { name: '狗垫', emoji: '🟫' } },
  med: { cat: { name: '诊疗室', emoji: '🩺' }, dog: { name: '医务室', emoji: '💊' } },
  clean: { cat: { name: '清洁站', emoji: '🧹' }, dog: { name: '冲洗台', emoji: '🚿' } },
  coin: { cat: { name: '金库', emoji: '🏦' }, dog: { name: '存钱罐', emoji: '🪙' } },
  garden: { cat: { name: '花圃', emoji: '🌸' }, dog: { name: '草坪玩具', emoji: '🌿' } },
  bench: { cat: { name: '长椅', emoji: '🪑' }, dog: { name: '骨头凳', emoji: '🪑' } },
  sign: { cat: { name: '招牌', emoji: '🪧' }, dog: { name: '门牌', emoji: '🪧' } },
  lamp: { cat: { name: '路灯', emoji: '💡' }, dog: { name: '灯柱', emoji: '💡' } },
}

export function plotDef(id: string): PlotDef | null {
  return PLOTS.find((p) => p.id === id) ?? null
}

export function skinOf(building: string, theme: ThemeId): ThemeSkin {
  const row = THEME_SKINS[building]
  return row?.[theme] ?? row?.cat ?? { name: building, emoji: '📦' }
}

export function freshPlotLv(): Record<string, number> {
  const lv: Record<string, number> = {}
  for (const p of PLOTS) lv[p.id] = p.id === 'lobby' ? 1 : 0
  return lv
}

/** 缺级、跳级都收干净。前台至少 1 级。等级最高 2。 */
export function normalizePlotLv(raw: unknown): Record<string, number> {
  const lv = freshPlotLv()
  if (raw && typeof raw === 'object') {
    for (const p of PLOTS) {
      const n = (raw as Record<string, unknown>)[p.id]
      if (typeof n === 'number' && n >= 1) lv[p.id] = Math.min(2, Math.floor(n))
    }
  }
  let locked = false
  for (const p of PLOTS) {
    if (p.id === 'lobby') {
      lv.lobby = Math.max(1, lv.lobby ?? 1)
      continue
    }
    if (locked || (lv[p.id] ?? 0) < 1) {
      if ((lv[p.id] ?? 0) < 1) locked = true
      if (locked && (lv[p.id] ?? 0) < 1) lv[p.id] = 0
      if ((lv[p.id] ?? 0) < 1) locked = true
    }
  }
  // 前面若被标成 0，后面已盖的也要收掉
  locked = false
  for (const p of PLOTS) {
    if (locked) lv[p.id] = p.id === 'lobby' ? 1 : 0
    else if ((lv[p.id] ?? 0) < 1) locked = true
  }
  lv.lobby = Math.max(1, lv.lobby ?? 1)
  return lv
}

/**
 * 旧档已经打开的链，对应地块视为盖好，避免再付一次星星。
 * 若后面的地已经盖了，中间空档补成 1 级。
 */
export function raisePlotsForChains(
  lv: Record<string, number>,
  unlocked: Record<string, boolean>
): boolean {
  let dirty = false
  for (const p of PLOTS) {
    if (p.chain && unlocked[p.chain] && (lv[p.id] ?? 0) < 1) {
      lv[p.id] = 1
      dirty = true
    }
  }
  let maxI = -1
  PLOTS.forEach((p, i) => {
    if ((lv[p.id] ?? 0) >= 1) maxI = i
  })
  for (let i = 0; i <= maxI; i++) {
    if ((lv[PLOTS[i].id] ?? 0) < 1) {
      lv[PLOTS[i].id] = 1
      dirty = true
    }
  }
  return dirty
}

export function nextPlot(lv: Record<string, number>): PlotDef | null {
  return PLOTS.find((p) => (lv[p.id] ?? 0) < 1) ?? null
}

/** 贴图键从具体到兜底。组件拿第一个真正有文件的，否则用表情。 */
export function spriteCandidates(theme: ThemeId, building: string, level: number): string[] {
  const lv = Math.max(1, level)
  const keys = [`${theme}-bldg-${building}-${lv}`, `bldg-${building}-${lv}`]
  if (lv > 1) keys.push(`${theme}-bldg-${building}-1`, `bldg-${building}-1`)
  keys.push(`${theme}-bldg-${building}`, `bldg-${building}`)
  return keys
}

export function buildingSprite(theme: ThemeId, building: string, level: number): string | null {
  for (const key of spriteCandidates(theme, building, level)) {
    if (hasSprite(key)) return key
  }
  return null
}
