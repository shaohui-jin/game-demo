import { describe, expect, it } from 'vitest'
import { maxLv } from './logic'
import {
  decodeLayout,
  encodeLayout,
  festActive,
  freshLive,
  grantSkin,
  isBanned,
  placeDecor,
  readyBonds,
  setBan,
  weatherOn,
} from './content'

describe('长线内容', () => {
  it('新链都有 8 级', () => {
    for (const k of ['comfort', 'train', 'med', 'clean', 'coin'] as const) {
      expect(maxLv(k)).toBe(8)
    }
  })

  it('放弃订单会禁掉同一链同一等级', () => {
    const live = freshLive(1_000)
    setBan(live, 'toy', 2, 1_000)
    expect(isBanned(live, 'toy', 2, 1_000 + 1000)).toBe(true)
    expect(isBanned(live, 'toy', 3, 1_000 + 1000)).toBe(false)
    expect(isBanned(live, 'toy', 2, live.banUntil + 1)).toBe(false)
  })

  it('时间旅行可以强制进入某个节日', () => {
    expect(festActive(Date.parse('2026-03-01'), '')).toBeNull()
    expect(festActive(Date.parse('2026-03-01'), 'xmas')?.name).toBe('圣诞')
  })

  it('造型第一次获得，重复则折算', () => {
    const live = freshLive()
    expect(grantSkin(live, 'scarf-red')).toBe('new')
    expect(grantSkin(live, 'scarf-red')).toBe('dup')
  })

  it('同一格不能摆两件装饰', () => {
    const live = freshLive()
    expect(placeDecor(live, 'plant', 0, 0)).toBe(true)
    expect(placeDecor(live, 'rug', 0, 0)).toBe(false)
    expect(placeDecor(live, 'plant', 1, 0)).toBe(false)
  })

  it('猫狗派到同一区域才算羁绊', () => {
    const live = freshLive()
    live.post.ragdoll = 'nap'
    live.post.golden = 'nap'
    expect(readyBonds(live, ['ragdoll', 'golden']).map((b) => b.id)).toEqual(['nap'])
    live.post.golden = 'play'
    expect(readyBonds(live, ['ragdoll', 'golden'])).toHaveLength(0)
  })

  it('布局分享码可以来回', () => {
    const live = freshLive()
    placeDecor(live, 'plant', 1, 2)
    const back = decodeLayout(encodeLayout(live))
    expect(back?.schemes[0]).toEqual([{ decor: 'plant', x: 1, y: 2, rot: 0 }])
  })

  it('天气由日期决定，同一天稳定', () => {
    expect(weatherOn('2026-1-1')).toBe(weatherOn('2026-1-1'))
    expect(['clear', 'rain']).toContain(weatherOn('2026-6-6'))
  })
})
