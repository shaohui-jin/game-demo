import { describe, expect, it } from 'vitest'
import {
  PLOTS,
  STAR_MAX,
  STAR_MIN,
  freshPlotLv,
  nextPlot,
  normalizePlotLv,
  raisePlotsForChains,
  gridToScreen,
  screenToGrid,
  spriteCandidates,
} from './yard'

describe('乐园地块', () => {
  it('一共 12 块，价格手写在 20–48，前台免费', () => {
    expect(PLOTS).toHaveLength(12)
    expect(PLOTS[0].cost).toBe(0)
    for (const p of PLOTS) {
      if (p.cost !== 0) {
        expect(p.cost).toBeGreaterThanOrEqual(STAR_MIN)
        expect(p.cost).toBeLessThanOrEqual(STAR_MAX)
      }
      expect(p.upCost).toBeGreaterThanOrEqual(STAR_MIN)
      expect(p.upCost).toBeLessThanOrEqual(STAR_MAX)
    }
  })

  it('必须按顺序买，跳级会被收掉', () => {
    const lv = freshPlotLv()
    expect(nextPlot(lv)?.id).toBe('groom')
    lv.diner = 1
    const fixed = normalizePlotLv(lv)
    expect(fixed.diner).toBe(0)
    expect(fixed.lobby).toBe(1)
  })

  it('旧档已经打开的链，对应地块算盖好', () => {
    const lv = freshPlotLv()
    const unlocked = { care: true, food: false }
    expect(raisePlotsForChains(lv, unlocked)).toBe(true)
    expect(lv.groom).toBe(1)
    expect(lv.diner).toBe(0)
  })

  it('十二块地按截图分成三排，远处一排、近处一排', () => {
    const depths = PLOTS.map((p) => p.col + p.row)
    expect([...new Set(depths)].sort((a, b) => a - b)).toEqual([5, 6, 7])
    for (const d of [5, 6, 7]) expect(depths.filter((n) => n === d)).toHaveLength(4)
  })

  it('格子和屏幕来回换算落在同一格', () => {
    for (const p of PLOTS) {
      const s = gridToScreen(p.col, p.row, 40, 80)
      const back = screenToGrid(s.x, s.y, 40, 80)
      expect(back).toEqual({ col: p.col, row: p.row })
    }
  })

  it('贴图先找主题再找默认', () => {
    expect(spriteCandidates('dog', 'groom', 2)[0]).toBe('dog-bldg-groom-2')
    expect(spriteCandidates('dog', 'groom', 2)).toContain('bldg-groom-2')
    expect(spriteCandidates('cat', 'groom', 1).at(-1)).toBe('bldg-groom')
  })
})
