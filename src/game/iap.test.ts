/**
 * 模拟充值 / 付费内容（M2 剩余）纯逻辑回归。
 *
 * 这些函数刻意做成"只算账、不改存档"——所以测试只需要喂参数，
 * 不需要挂 App（整机集成在 stores/game.test.ts 里覆盖）。
 */

import { describe, expect, it } from 'vitest'
import {
  FUND_MAX_CLAIMS,
  LUCKY_PITY,
  VIP_DAYS,
} from './config'
import {
  GIFTS,
  IAP_TIERS,
  fundClaimsReady,
  giftCountKey,
  giftDef,
  iapTier,
  payTier,
  spinOnce,
  vipNewUntil,
} from './iap'
import { isVip, staminaMax, freshState } from './logic'
import { TOOL_ORDER } from './tools'

const DAY = 24 * 60 * 60 * 1000

/** 固定序列伪随机（与 logic.test.ts 的 seq 同思路） */
function seq(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

describe('充值档位（文档 10.1）', () => {
  it('六个档位齐全，价格与钻石数一一对应', () => {
    expect(IAP_TIERS.map((t) => t.price)).toEqual([6, 30, 68, 128, 328, 648])
    expect(IAP_TIERS.map((t) => t.gems)).toEqual([60, 300, 680, 1280, 3280, 6480])
    expect(iapTier('tier648')?.price).toBe(648)
    expect(iapTier('nope')).toBeNull()
  })

  it('首充双倍只给第一次；之后按原价', () => {
    const t = iapTier('tier6')!
    expect(payTier(t, false).gems).toBe(120) // 还没充过 → 双倍
    expect(payTier(t, false).doubled).toBe(true)
    expect(payTier(t, true).gems).toBe(60) // 已经充过 → 原价
    expect(payTier(t, true).doubled).toBe(false)
  })
})

describe('会员卡', () => {
  it('未开卡 / 已过期：从现在起算 30 天', () => {
    const now = 1_800_000_000_000
    expect(vipNewUntil(0, now)).toBe(now + VIP_DAYS * DAY)
    expect(vipNewUntil(now - DAY, now)).toBe(now + VIP_DAYS * DAY)
  })

  it('未到期续期：在剩余天数上叠加，不吃亏', () => {
    const now = 1_800_000_000_000
    const until = now + 10 * DAY
    expect(vipNewUntil(until, now)).toBe(until + VIP_DAYS * DAY)
  })

  it('会员体力上限 +50，且走 staminaMax 统一出口（铁律 4）', () => {
    const s = freshState()
    const base = staminaMax(s)
    s.vipUntil = Date.now() + 1000
    expect(isVip(s)).toBe(true)
    expect(staminaMax(s)).toBe(base + 50)
  })

  it('过期后立刻失效', () => {
    const s = freshState()
    s.vipUntil = Date.now() - 1
    expect(isVip(s)).toBe(false)
  })
})

describe('成长基金', () => {
  it('每 5 级到账一份，封顶 10 份', () => {
    expect(fundClaimsReady(4, 0)).toBe(0)
    expect(fundClaimsReady(5, 0)).toBe(1)
    expect(fundClaimsReady(12, 0)).toBe(2)
    expect(fundClaimsReady(50, 0)).toBe(FUND_MAX_CLAIMS)
    expect(fundClaimsReady(80, 0)).toBe(FUND_MAX_CLAIMS) // 超过 Lv50 也不多发
  })

  it('已领的不重复给；超领（不该发生）也安全返回 0', () => {
    expect(fundClaimsReady(20, 2)).toBe(2)
    expect(fundClaimsReady(20, 4)).toBe(0)
    expect(fundClaimsReady(20, 99)).toBe(0)
  })
})

describe('礼包限购键（giftCountKey）', () => {
  it('once：一生一次，键就是 key 本身', () => {
    expect(giftCountKey('starter', 1, 0)).toBe('starter')
    expect(giftCountKey('starter', 40, 5)).toBe('starter')
  })

  it('perRegion：以"已解锁区域数"为档（解锁不会倒退，所以不会重复买）', () => {
    expect(giftCountKey('region', 1, 1)).toBe('region:1')
    expect(giftCountKey('region', 8, 3)).toBe('region:3')
  })

  it('per10Lv：Lv1–10 → 档 1，Lv11–20 → 档 2，Lv50 → 档 5', () => {
    expect(giftCountKey('level', 1, 0)).toBe('level:1')
    expect(giftCountKey('level', 10, 0)).toBe('level:1')
    expect(giftCountKey('level', 11, 0)).toBe('level:2')
    expect(giftCountKey('level', 50, 0)).toBe('level:5')
  })

  it('unlimited：键原样（不限购但也记录购买历史）', () => {
    expect(giftCountKey('daily', 3, 2)).toBe('daily')
  })

  it('礼包定义表完整：未知 key 查询安全返回 null', () => {
    expect(GIFTS.length).toBeGreaterThanOrEqual(6)
    expect(giftDef('nope')).toBeNull()
    expect(giftDef('starter')?.limit).toBe('once')
  })
})

describe('抽奖机', () => {
  it('权重映射：rng 直接决定档位（3/12/35/50）', () => {
    // rng=0.01 → skin；0.05 → decor；0.2 → tool；0.9 → gold
    const a = spinOnce(0, seq([0.01, 0.5]))
    expect(a.prize.kind).toBe('skin')
    const b = spinOnce(0, seq([0.05, 0.5]))
    expect(b.prize.kind).toBe('decor')
    const c = spinOnce(0, seq([0.2, 0.2, 0.5]))
    expect(c.prize.kind).toBe('tool')
    const d = spinOnce(0, seq([0.9]))
    expect(d.prize.kind).toBe('gold')
  })

  it('保底：pity 达到窗口-1 时，即使摇到普通档也强制稀有', () => {
    // rng=0.9 本应出 gold，但 pity=9 → 强制稀有
    const r = spinOnce(LUCKY_PITY - 1, seq([0.9, 0.05]))
    expect(r.prize.rarity).toBe('rare')
    expect(r.pity).toBe(0)
  })

  it('普通奖励 pity +1；稀有奖励清零', () => {
    const common = spinOnce(3, seq([0.9, 0.5]))
    expect(common.prize.rarity).toBe('common')
    expect(common.pity).toBe(4)
    const rare = spinOnce(3, seq([0.01]))
    expect(rare.prize.rarity).toBe('rare')
    expect(rare.pity).toBe(0)
  })

  it('金币奖励在 200–1000 且十位取整；道具数量 1–2 且在道具表内', () => {
    const g1 = spinOnce(0, seq([0.9, 0.0])) // amount=200
    expect(g1.prize.amount).toBe(200)
    const g2 = spinOnce(0, seq([0.9, 0.99])) // 200+80*10=1000 → 越界封顶？
    expect(g2.prize.amount).toBeLessThanOrEqual(1000)
    expect(g2.prize.amount).toBeGreaterThanOrEqual(200)
    expect(g2.prize.amount % 10).toBe(0)

    const t1 = spinOnce(0, seq([0.2, 0.0, 0.0]))
    expect(TOOL_ORDER).toContain(t1.prize.tool!)
    expect(t1.prize.amount).toBeGreaterThanOrEqual(1)
    expect(t1.prize.amount).toBeLessThanOrEqual(2)
  })

  it('造型 / 装饰当前按"重复获得"折算成钻石（M3 前的过渡口径）', () => {
    const s = spinOnce(0, seq([0.01]))
    expect(s.prize.kind).toBe('skin')
    expect(s.prize.converted).toBe(true)
    expect(s.prize.amount).toBeGreaterThan(0)
    const d = spinOnce(0, seq([0.05]))
    expect(d.prize.kind).toBe('decor')
    expect(d.prize.converted).toBe(true)
  })

  it('十连里最多触发一次保底（触发后计数清零）', () => {
    // 全程摇到普通档（rng=0.9），pity=9 开始：第 1 抽强制稀有，其余普通
    let pity = LUCKY_PITY - 1
    let rareCount = 0
    for (let i = 0; i < 10; i++) {
      const r = spinOnce(pity, seq([0.9, 0.5]))
      pity = r.pity
      if (r.prize.rarity === 'rare') rareCount++
    }
    expect(rareCount).toBe(1)
    expect(pity).toBe(LUCKY_PITY - 1) // 9 普通后又回到窗口边缘
  })
})
