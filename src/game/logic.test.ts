/**
 * 纯逻辑回归。
 *
 * 约定（沿用 P0）：**改完玩法逻辑必须跑一遍**。
 * P0 的三套测试曾一次抓出 4 个真实 bug，其中"未知链抛错 → 整份存档被静默清空"最贵。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  AFFINITY_FULL,
  BAG_BASE_PRICE,
  BAG_INITIAL_CAP,
  BAG_TOTAL,
  EXP_PER_LEVEL,
  PET_ACCUM_MAX_HOURS,
  PET_GOLD_PER_HOUR,
  REGEN_MS,
  ORDER_SLOTS,
  SAVE_VERSION,
  STAMINA_MAX,
  TOTAL,
  WEB_BASE_PRICE,
  WEB_STEP,
} from './config'
import {
  availableTiers,
  bagPrice,
  bagUsed,
  buyOrUpgradeDecor,
  canExpandBag,
  canUnlockRegion,
  countEmpty,
  countFacilities,
  coolingLeft,
  currentBonus,
  dayKey,
  decorLevel,
  decorNextCost,
  defOf,
  ensureFacilities,
  exhaustMode,
  exhaustTarget,
  findBagFree,
  findDisplaceCell,
  dropsDesc,
  findItem,
  freshState,
  fullCharges,
  gainExp,
  isClickable,
  isCooling,
  isFacility,
  isRegionUnlocked,
  itemKey,
  itemsLen,
  makeItem,
  makeOrder,
  maxLv,
  migrateChainDepth,
  moveBagTo,
  nextRegenIn,
  nextRegionToUnlock,
  orderCtxOf,
  orderRewards,
  pickRandomEmpty,
  placeBag,
  reconcileWebs,
  regionBonuses,
  rollDrops,
  rollRange,
  sameKind,
  seedBoard,
  staminaMax,
  suspendCooldown,
  resumeCooldown,
  tickGenerators,
  tickPets,
  tickRegen,
  tickAuto,
  tierLevelRange,
  webPrice,
  isAutoItem,
  type GameState,
} from './logic'
import { CHAIN_DEPTH_V, CHAIN_ORDER } from './chains'
import { customerDef, decorDef, regionDef } from './business'
import {
  backupNow,
  clearSave,
  checksumOf,
  ENVELOPE_VERSION,
  exportSaveText,
  importSaveText,
  listBackups,
  load,
  restoreBackup,
  save,
} from './storage'
import type { BoardItem, Drop } from './types'

/** 固定序列伪随机，让抽样结果可复现 */
function seq(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

describe('defOf / maxLv —— 未知链必须安全降级', () => {
  it('未知链返回 null / 0，绝不抛错', () => {
    // 这条是存档杀手：一旦抛错，load() 的 catch 会吞掉 → 整份存档被静默清空
    expect(defOf('nope' as never, 1)).toBeNull()
    expect(maxLv('nope' as never)).toBe(0)
  })

  it('越界等级返回 null', () => {
    expect(defOf('toy', 0)).toBeNull()
    expect(defOf('toy', 99)).toBeNull()
  })

  it('有母体的链，最高级 = 普通物品数 + 1', () => {
    expect(itemsLen('toy')).toBe(7)
    expect(maxLv('toy')).toBe(8) // 7 个普通物品 + 猫城堡
  })

  it('没有顶端的链（礼包链 / 设施链），末位就是终点', () => {
    expect(maxLv('supply')).toBe(4)
    expect(maxLv('fac')).toBe(5) // 3 个点击型设施 + 2 个自动型设施
    expect(defOf('supply', 5)).toBeNull()
    expect(defOf('fac', 6)).toBeNull()
  })

  it('★ 链深足够，订单四个档位都能落在互不相同的等级上', () => {
    // 这是第三批「内容扩容」的首要目的：加深链路让档位重新有区分度。
    // 链只有 3 级时，稀有与紧急都会退化成 "要 Lv3"，只剩倒计时与倍率的差别。
    const normal = tierLevelRange('toy', 'normal')!
    const advanced = tierLevelRange('toy', 'advanced')!
    const rare = tierLevelRange('toy', 'rare')!
    expect(normal).toEqual({ lo: 1, hi: 3 })
    expect(advanced).toEqual({ lo: 4, hi: 5 })
    expect(rare).toEqual({ lo: 6, hi: 7 })
    // 四个档位的区间两两不重叠
    expect(advanced.lo).toBeGreaterThan(normal.hi)
    expect(rare.lo).toBeGreaterThan(advanced.hi)
  })

  it('顶端只有两种：generator 与 final', () => {
    const gen = defOf('toy', maxLv('toy'))
    expect(gen?.kind).toBe('generator')
    expect(gen?.produces).toBe('care') // 母体产出的是下一条链

    const fin = defOf('food', maxLv('food'))
    expect(fin?.kind).toBe('final')
    expect(fin?.drops).toBeUndefined()
  })

  it('generator 与 producer 的字段结构完全一致（都提到顶层）', () => {
    const gen = defOf('toy', maxLv('toy'))
    const mid = defOf('supply', 1) // 链中段发射器
    expect(mid?.kind).toBe('producer')

    for (const d of [gen, mid]) {
      expect(d).toBeTruthy()
      expect(typeof d!.buffer).toBe('number')
      expect(typeof d!.refillMs).toBe('number')
      expect(Array.isArray(d!.drops)).toBe(true)
      expect(isClickable(d)).toBe(true)
      expect(fullCharges(d!)).toBeGreaterThan(0)
    }
  })

  it('普通物品不是发射器，且不带耐久 / 掉落表', () => {
    const d = defOf('toy', 1)
    expect(d?.kind).toBe('item')
    expect(isClickable(d)).toBe(false)
    expect(d?.drops).toBeUndefined()
  })
})

describe('makeItem —— 只有可点击对象带储备与冷却字段', () => {
  it('母体 / 中段发射器 / 设施带 charges + cdAt，普通物品不带', () => {
    expect(makeItem('toy', maxLv('toy')).charges).toBe(fullCharges(defOf('toy', maxLv('toy'))!))
    expect(makeItem('supply', 1).charges).toBe(8)
    expect(makeItem('toy', 1).charges).toBeUndefined()
    expect(makeItem('toy', 1).cdAt).toBeUndefined()

    // 设施：储备 + cdAt 都要有（cdAt 为 0 表示没在冷却）
    const fac = makeItem('fac', 1)
    expect(fac.charges).toBe(8)
    expect(fac.cdAt).toBe(0)
  })
})

describe('掉落抽取', () => {
  const table: Drop[] = [
    { type: 'item', chain: 'toy', level: 1, w: 88 },
    { type: 'item', chain: 'supply', level: 1, w: 12 },
  ]

  it('rng 落在第一段区间时取第一条', () => {
    expect(rollDrops(table, () => 0)).toEqual(table[0])
    expect(rollDrops(table, () => 0.87)).toEqual(table[0])
  })

  it('rng 落在尾段时取最后一条', () => {
    expect(rollDrops(table, () => 0.95)).toEqual(table[1])
  })

  it('rng 返回 1（边界）时兜底取最后一条，不会返回 undefined', () => {
    expect(rollDrops(table, () => 1)).toEqual(table[1])
  })

  it('rollRange 是闭区间', () => {
    expect(rollRange(15, 40, () => 0)).toBe(15)
    expect(rollRange(15, 40, () => 0.999999)).toBe(40)
  })

  it('dropsDesc 按权重降序、含百分比', () => {
    const desc = dropsDesc(table)
    expect(desc.indexOf('毛线球')).toBeLessThan(desc.indexOf('伴手礼'))
    expect(desc).toContain('88%')
  })
})

describe('棋盘：随机空格', () => {
  it('跳过蛛网', () => {
    const s = freshState()
    // 把整块棋盘塞满
    for (let i = 0; i < TOTAL; i++) s.board[i] = makeItem('toy', 1)
    expect(pickRandomEmpty(s.board, s.web)).toBe(-1)

    s.board[7] = null
    s.web[7] = true
    expect(pickRandomEmpty(s.board, s.web)).toBe(-1)

    s.web[7] = false
    expect(pickRandomEmpty(s.board, s.web)).toBe(7)
  })

  it('★ 主场景没有锁定格：最后一格也是可用的', () => {
    const s = freshState()
    for (let i = 0; i < TOTAL; i++) s.board[i] = makeItem('toy', 1)
    s.board[TOTAL - 1] = null
    // 以前最后一格属于"锁定区"，永远取不到；现在它能被取到
    expect(pickRandomEmpty(s.board, s.web)).toBe(TOTAL - 1)
  })

  it('开局种子 = 2 个设施 + 4 个玩具物品', () => {
    const s = freshState()
    seedBoard(s, seq([0, 0.1, 0.2, 0.3, 0.4, 0.5]))
    const placed = s.board.filter(Boolean)
    expect(placed.length).toBe(6)
    expect(placed.filter((it) => it!.chain === 'fac').length).toBe(2)
    expect(placed.filter((it) => it!.chain === 'toy').length).toBe(4)
    // 设施带储备与冷却字段，玩具物品不带
    const fac = placed.find((it) => it!.chain === 'fac')!
    expect(fac.charges).toBeGreaterThan(0)
    expect(fac.cdAt).toBe(0)
  })
})

describe('体力：自然恢复', () => {
  it('到上限停止累积，且不攒溢出量', () => {
    const s = freshState()
    const now = Date.now()
    s.stamina = 98
    s.regenAt = now - REGEN_MS * 10 // 已经过了 10 个恢复周期

    expect(tickRegen(s, now)).toBe(true)
    expect(s.stamina).toBe(STAMINA_MAX) // 只补到上限，不是 108
    expect(nextRegenIn(s, now)).toBe(0)
  })

  it('未满时按周期数线性恢复', () => {
    const s = freshState()
    const now = Date.now()
    s.stamina = 90
    s.regenAt = now - REGEN_MS * 5

    expect(tickRegen(s, now)).toBe(true)
    expect(s.stamina).toBe(95)
    // 剩余不足一个周期
    expect(nextRegenIn(s, now)).toBeGreaterThan(0)
    expect(nextRegenIn(s, now)).toBeLessThanOrEqual(REGEN_MS)
  })

  it('不足一个周期时不恢复，且不推进锚点', () => {
    const s = freshState()
    const now = Date.now()
    s.stamina = 50
    const anchor = now - REGEN_MS / 2
    s.regenAt = anchor

    expect(tickRegen(s, now)).toBe(false)
    expect(s.stamina).toBe(50)
    expect(s.regenAt).toBe(anchor)
  })
})

describe('每日补贴', () => {
  it('只认当前所处时段', () => {
    const s = freshState()
    const at13 = new Date(2026, 9, 2, 13, 0, 0).getTime()
    const b = currentBonus(s, at13)
    expect(b?.label).toBe('12:00')
    expect(b?.claimed).toBe(false)
  })

  it('凌晨属于前一天 24:00 的时段', () => {
    const s = freshState()
    const at2 = new Date(2026, 9, 2, 2, 0, 0).getTime()
    expect(currentBonus(s, at2)?.label).toBe('24:00')
  })

  it('已领取的时段标记为 claimed，且不会连带作废下一段', () => {
    const s = freshState()
    const at13 = new Date(2026, 9, 2, 13, 0, 0).getTime()
    const b = currentBonus(s, at13)!
    s.bonusClaimed[b.key] = 1

    expect(currentBonus(s, at13)?.claimed).toBe(true)

    const at19 = new Date(2026, 9, 2, 19, 0, 0).getTime()
    expect(currentBonus(s, at19)?.claimed).toBe(false)
    expect(currentBonus(s, at19)?.label).toBe('18:00')
  })
})

describe('蛛网定价', () => {
  it('越拖越贵', () => {
    expect(webPrice(0)).toBe(WEB_BASE_PRICE)
    expect(webPrice(3)).toBe(WEB_BASE_PRICE + WEB_STEP * 3)
  })
})

describe('订单', () => {
  it('只从已解锁的链里抽，且不会超过该链的普通等级上限', () => {
    const s = freshState()
    for (let i = 0; i < 200; i++) {
      const o = makeOrder(orderCtxOf(s))
      expect(o.chain).toBe('toy')
      expect(o.level).toBeGreaterThanOrEqual(1)
      // 只抽「可交付的普通等级」，顶端（母体 / 纯任务物品）绝不进订单
      expect(o.level).toBeLessThanOrEqual(itemsLen('toy'))
      expect(o.gold).toBeGreaterThan(0)
      expect(o.exp).toBeGreaterThan(0)
      expect(o.stars).toBeGreaterThan(0)
      expect(o.affinity).toBeGreaterThan(0)
      expect(o.expireAt).toBeGreaterThan(Date.now() - 1000)
    }
    expect(CHAIN_ORDER).toContain('toy')
  })

  it('奖励随需求等级递增', () => {
    const s = freshState()
    const byLevel = new Map<number, number>()
    for (let i = 0; i < 400; i++) {
      const o = makeOrder(orderCtxOf(s))
      byLevel.set(o.level, o.gold)
    }
    const levels = [...byLevel.keys()].sort((a, b) => a - b)
    for (let i = 1; i < levels.length; i++) {
      expect(byLevel.get(levels[i])!).toBeGreaterThan(byLevel.get(levels[i - 1])!)
    }
  })

  it('1 级玩家只可能拿到普通订单', () => {
    const s = freshState()
    expect(availableTiers(orderCtxOf(s))).toEqual(['normal'])
    for (let i = 0; i < 80; i++) expect(makeOrder(orderCtxOf(s)).tier).toBe('normal')
  })

  it('稀有订单要求「等级够」且「训练场已解锁」——两道门槛缺一不可', () => {
    const s = freshState()
    s.level = 30
    const noRegion = availableTiers(orderCtxOf(s))
    expect(noRegion).toContain('advanced')
    expect(noRegion).not.toContain('rare') // 等级够，但没有区域

    s.regions.training = true
    expect(availableTiers(orderCtxOf(s))).toContain('rare')
  })

  it('档位等级区间会收敛到该链的实际深度（不会抽出不存在的等级）', () => {
    // 三条主链各有 7 个普通等级 + 1 个顶端；礼包链 4 级、设施链 3 级，都没有顶端
    expect(itemsLen('toy')).toBe(7)
    expect(itemsLen('supply')).toBe(4)
    expect(tierLevelRange('toy', 'normal')).toEqual({ lo: 1, hi: 3 })
    expect(tierLevelRange('toy', 'rare')).toEqual({ lo: 6, hi: 7 })
    // 需求区间比链深时退化成链的末位，而不是变成永远抽不出的空集
    expect(tierLevelRange('supply', 'rare')).toEqual({ lo: 4, hi: 4 })
    // 顶端（母体 / 纯任务物品）永远不进订单
    expect(tierLevelRange('toy', 'rare')!.hi).toBeLessThanOrEqual(maxLv('toy') - 1)
    expect(tierLevelRange('toy', 'urgent')!.hi).toBeLessThanOrEqual(maxLv('toy') - 1)
  })

  it('档位倍率越高，同等级奖励越高', () => {
    const a = orderRewards('normal', 2, 0, 1)
    const b = orderRewards('advanced', 2, 0, 1)
    const c = orderRewards('rare', 2, 0, 1)
    expect(b.gold).toBeGreaterThan(a.gold)
    expect(c.gold).toBeGreaterThan(b.gold)
    expect(c.stars).toBeGreaterThan(a.stars)
    expect(c.affinity).toBeGreaterThan(a.affinity)
  })

  it('订单一定带一个真实存在的顾客', () => {
    const s = freshState()
    for (let i = 0; i < 60; i++) {
      expect(customerDef(makeOrder(orderCtxOf(s)).customer)).not.toBeNull()
    }
  })
})

describe('经营层：区域', () => {
  it('开局只有前台大厅，其余都要按顺序解锁', () => {
    const s = freshState()
    expect(isRegionUnlocked(s, 'lobby')).toBe(true)
    for (const k of ['grooming', 'play', 'diner', 'training'] as const) {
      expect(isRegionUnlocked(s, k)).toBe(false)
    }
    // 等级不够 → 不能解锁
    expect(canUnlockRegion(s, 'grooming')).toBe(false)
    s.level = 3
    expect(canUnlockRegion(s, 'grooming')).toBe(true)
    // ★ 顺序约束：即使等级够到 8 级，也不能跳过洗护区直接开玩耍区
    s.level = 8
    expect(canUnlockRegion(s, 'play')).toBe(false)
    s.regions.grooming = true
    expect(canUnlockRegion(s, 'play')).toBe(true)
  })

  it('体力上限随区域提升，且 tickRegen 认这个新上限', () => {
    const s = freshState()
    expect(staminaMax(s)).toBe(STAMINA_MAX)
    s.regions.grooming = true
    s.regions.diner = true
    expect(staminaMax(s)).toBe(STAMINA_MAX + 30)

    // 上限抬高后，体力应当能继续恢复上去（而不是卡在旧上限）
    s.stamina = STAMINA_MAX
    s.regenAt = Date.now() - REGEN_MS * 5
    expect(tickRegen(s, Date.now())).toBe(true)
    expect(s.stamina).toBe(STAMINA_MAX + 5)
  })

  it('加成汇总只统计已解锁的区域', () => {
    const s = freshState()
    expect(regionBonuses(s).goldMult).toBe(0)
    s.regions.play = true
    expect(regionBonuses(s).goldMult).toBeCloseTo(0.1)
    s.regions.pool = true
    expect(regionBonuses(s).goldMult).toBeCloseTo(0.25)
    expect(regionBonuses(s).starBonus).toBe(1)
    s.regions.nap = true
    expect(regionBonuses(s).petHours).toBe(12)
  })

  it('nextRegionToUnlock 给出的是当前唯一可解锁的那个', () => {
    const s = freshState()
    expect(nextRegionToUnlock(s)).toBeNull()
    s.level = 3
    expect(nextRegionToUnlock(s)).toBe('grooming')
    s.regions.grooming = true
    s.level = 8
    expect(nextRegionToUnlock(s)).toBe('play')
  })

  it('每个区域的等级门槛严格递增（区域是长线目标，不能一拥而上）', () => {
    const levels = ['lobby', 'grooming', 'play', 'diner', 'training', 'nap', 'pool', 'clinic', 'studio'].map(
      (k) => regionDef(k as never)!.unlockLevel
    )
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1])
  })
})

describe('经营层：装饰', () => {
  it('买装饰只花星星，且价格逐级上涨', () => {
    const s = freshState()
    s.stars = 1000
    const c0 = decorNextCost(s, 'plant')
    expect(c0).toBe(decorDef('plant')!.cost)
    expect(buyOrUpgradeDecor(s, 'plant')).toBe(true)
    expect(decorLevel(s, 'plant')).toBe(1)
    expect(s.stars).toBe(1000 - c0)
    expect(decorNextCost(s, 'plant')).toBeGreaterThan(c0)
  })

  it('星星不够就买不了，且不会扣钱', () => {
    const s = freshState()
    s.stars = 1
    expect(buyOrUpgradeDecor(s, 'fountain')).toBe(false)
    expect(s.stars).toBe(1)
    expect(decorLevel(s, 'fountain')).toBe(0)
  })

  it('满级后返回 -1，不能继续升', () => {
    const s = freshState()
    s.stars = 10 ** 9
    const d = decorDef('plant')!
    for (let i = 0; i < d.maxLevel; i++) expect(buyOrUpgradeDecor(s, 'plant')).toBe(true)
    expect(decorLevel(s, 'plant')).toBe(d.maxLevel)
    expect(decorNextCost(s, 'plant')).toBe(-1)
    const before = s.stars
    expect(buyOrUpgradeDecor(s, 'plant')).toBe(false)
    expect(s.stars).toBe(before)
  })

  it('未知装饰安全返回 -2，绝不抛错', () => {
    const s = freshState()
    expect(decorNextCost(s, 'nope')).toBe(-2)
    expect(buyOrUpgradeDecor(s, 'nope')).toBe(false)
  })
})

describe('经营层：常驻宠物离线产出', () => {
  const H = 3600000

  it('没有宠物时不产出，且 petAt 跟着走', () => {
    const s = freshState()
    const r = tickPets(s, Date.now() + 5 * H)
    expect(r.gold).toBe(0)
    expect(s.gold).toBe(0)
  })

  it('每只宠物每小时产出固定金币', () => {
    const s = freshState()
    s.pets = ['ragdoll']
    s.petAt = Date.now() - 3 * H
    const r = tickPets(s, Date.now())
    expect(r.hours).toBe(3)
    expect(r.gold).toBe(3 * PET_GOLD_PER_HOUR)
    expect(s.gold).toBe(3 * PET_GOLD_PER_HOUR)
  })

  it('离线超过累积上限时，只结算上限内的部分', () => {
    const s = freshState()
    s.pets = ['ragdoll', 'corgi']
    s.petAt = Date.now() - 100 * H
    const r = tickPets(s, Date.now())
    expect(r.hours).toBe(PET_ACCUM_MAX_HOURS)
    expect(r.gold).toBe(2 * PET_ACCUM_MAX_HOURS * PET_GOLD_PER_HOUR)
  })

  it('★ 超出上限后 petAt 必须推到 now，否则同一段时间会被反复结算', () => {
    const s = freshState()
    s.pets = ['ragdoll']
    s.petAt = Date.now() - 100 * H
    tickPets(s, Date.now())
    const goldAfterFirst = s.gold
    // 一秒后再结算：不该再产出
    const again = tickPets(s, Date.now() + 1000)
    expect(again.gold).toBe(0)
    expect(s.gold).toBe(goldAfterFirst)
  })

  it('未达上限时保留不足 1 小时的零头（不吞玩家时间）', () => {
    const s = freshState()
    s.pets = ['ragdoll']
    const t0 = Date.now()
    s.petAt = t0
    expect(tickPets(s, t0 + 0.5 * H).gold).toBe(0)
    // 再等 0.6 小时，累计满 1 小时，应当结算 1 小时
    const r = tickPets(s, t0 + 1.1 * H)
    expect(r.hours).toBe(1)
    expect(r.gold).toBe(PET_GOLD_PER_HOUR)
  })

  it('午睡区把离线累积上限抬到 12 小时', () => {
    const s = freshState()
    s.pets = ['ragdoll']
    s.regions.nap = true
    s.petAt = Date.now() - 100 * H
    expect(tickPets(s, Date.now()).hours).toBe(12)
  })
})

describe('经营层：好感度与每日卡', () => {
  it('好感满格值是一个明确的常量（转化阈值只有一个来源）', () => {
    expect(AFFINITY_FULL).toBeGreaterThan(0)
    expect(Number.isInteger(AFFINITY_FULL)).toBe(true)
  })

  it('dayKey 按本地日期变化，用于「每日一次」去重', () => {
    const a = dayKey(new Date(2026, 9, 2, 23, 59).getTime())
    const b = dayKey(new Date(2026, 9, 3, 0, 1).getTime())
    expect(a).toBe('2026-10-2')
    expect(b).toBe('2026-10-3')
    expect(a).not.toBe(b)
  })
})

describe('储备 / 冷却 / 耗尽行为（本轮设计修正的核心）', () => {
  it('设施是冷却型：储备耗尽后进冷却，永不消失', () => {
    const d = defOf('fac', 1)!
    expect(exhaustMode(d)).toBe('cooldown')
    expect(d.buffer).toBe(8)
    expect(d.refillMs).toBe(60_000)
    expect(exhaustTarget(d)).toBeNull()
  })

  it('猫城堡是转化型：放完变成伴手礼（接入礼包链）', () => {
    const d = defOf('toy', maxLv('toy'))!
    expect(d.kind).toBe('generator')
    expect(exhaustMode(d)).toBe('convert')
    expect(exhaustTarget(d)).toEqual({ kind: 'convert', to: 'supply', level: 1 })
  })

  it('豪华礼盒（链尾）是转化型：开完变成一个玩具架', () => {
    const d = defOf('supply', maxLv('supply'))!
    expect(d.name).toBe('豪华礼盒')
    expect(exhaustMode(d)).toBe('convert')
    expect(exhaustTarget(d)).toEqual({ kind: 'convert', to: 'fac', level: 1 })
  })

  it('链中段的 Lv3 是消失型（一次性物资包）', () => {
    for (const k of ['toy', 'care', 'food'] as const) {
      const d = defOf(k, 3)!
      expect(d.kind).toBe('producer')
      expect(exhaustMode(d)).toBe('vanish')
      expect(exhaustTarget(d)).toBeNull()
    }
  })

  it('美容台是冷却型（永久食物线）', () => {
    const d = defOf('care', maxLv('care'))!
    expect(exhaustMode(d)).toBe('cooldown')
    expect(d.refillMs).toBe(120_000)
  })

  it('tickGenerators: 到点才补满，没到点不动', () => {
    const s = freshState()
    const now = Date.now()
    s.board.fill(null)
    const fac = makeItem('fac', 1)
    fac.charges = 0
    fac.cdAt = now + 60_000
    s.board[0] = fac

    // 还没到点
    expect(tickGenerators(s, now + 1000)).toEqual([])
    expect(fac.charges).toBe(0)
    expect(isCooling(fac, now + 1000)).toBe(true)

    // 到点了
    expect(tickGenerators(s, now + 60_001)).toEqual([0])
    expect(fac.charges).toBe(8)
    expect(fac.cdAt).toBe(0)
    expect(isCooling(fac, now + 60_001)).toBe(false)
  })

  it('tickGenerators 不碰不冷却的类型（储备耗尽就是耗尽了）', () => {
    const s = freshState()
    s.board.fill(null)
    const bell = makeItem('toy', 3)
    bell.charges = 0
    s.board[0] = bell
    expect(tickGenerators(s, Date.now() + 10 ** 7)).toEqual([])
    expect(bell.charges).toBe(0)
  })

  it('★ 背包冻结必须连冷却一起冻结，否则搬一次背包就白拿补满', () => {
    const now = Date.now()
    const fac = makeItem('fac', 1)
    fac.charges = 0
    fac.cdAt = now + 60_000

    // 存进背包：冷却被挂起成"剩余 60s"，绝对时间戳清零
    suspendCooldown(fac, now)
    expect(fac.cdAt).toBe(0)
    expect(fac.cdLeft).toBe(60_000)

    // 在背包里放了 10 分钟（挂起的冷却不会自己走完）
    expect(coolingLeft(fac, now + 600_000)).toBe(60_000)

    // 取出：换算回新的时间戳，还剩 60s
    resumeCooldown(fac, now + 600_000)
    expect(fac.cdLeft).toBe(0)
    expect(coolingLeft(fac, now + 600_000)).toBe(60_000)
    expect(isCooling(fac, now + 600_000)).toBe(true)
  })

  it('冷却型对象总数 / 设施计数', () => {
    const s = freshState()
    s.board.fill(null)
    expect(countFacilities(s)).toBe(0)
    s.board[0] = makeItem('fac', 1)
    s.board[1] = makeItem('fac', 2)
    s.board[2] = makeItem('toy', 1)
    expect(countFacilities(s)).toBe(2)
    expect(isFacility(s.board[2])).toBe(false)
  })

  it('ensureFacilities: 只有设施一个都不剩时才补，且背包里的也算数', () => {
    const s = freshState()
    s.board.fill(null)
    // 棋盘空了 → 补回两个
    expect(ensureFacilities(s)).toBe(true)
    expect(countFacilities(s)).toBe(2)

    // 已经有设施了 → 不再补
    expect(ensureFacilities(s)).toBe(false)
    expect(countFacilities(s)).toBe(2)

    // 只剩背包里有一个 → 也算"还有产出能力"，不补
    s.board.fill(null)
    s.bag[5] = { k: 'item', it: makeItem('fac', 1) }
    expect(countFacilities(s)).toBe(1)
    expect(ensureFacilities(s)).toBe(false)
  })

  it('★ 残缺 state（没有 bag / board 字段）不能让设施计数抛错', () => {
    // 这条是真实踩到的 bug：countFacilities 会被 normalize() 在**背包归一化之前**调用，
    // 那时老存档的 s.bag 还不存在。直接 for...of 会抛 TypeError，
    // 异常冒到 load() 外面 → 整份存档加载失败（本项目最贵的一类故障）。
    const s: any = freshState()
    s.board.fill(null)
    delete s.bag
    expect(() => countFacilities(s)).not.toThrow()
    expect(countFacilities(s)).toBe(0)
    expect(() => ensureFacilities(s)).not.toThrow()
    expect(countFacilities(s)).toBe(2)

    const s2: any = freshState()
    delete s2.board
    delete s2.bag
    expect(() => countFacilities(s2)).not.toThrow()
  })
})

describe('链深度迁移（3 级链存档 → 8 级链）', () => {
  it('旧顶端搬到新顶端：toy/care/food Lv4 → Lv8，supply Lv2 → Lv4', () => {
    // 为什么必须迁移：加深链路后同一个 Lv4 换了身份
    expect(defOf('toy', 4)!.name).toBe('猫抓板') // 新表里 Lv4 是普通物品
    expect(defOf('toy', 8)!.kind).toBe('generator') // 顶端现在在 Lv8

    const s: any = freshState()
    delete s.depthV // 模拟旧版本存档（没有这个标记）
    s.board.fill(null)
    s.board[0] = { chain: 'toy', level: 4, charges: 3 }
    s.board[1] = { chain: 'food', level: 4 }
    s.board[2] = { chain: 'supply', level: 2, charges: 5 }
    s.board[3] = makeItem('toy', 3) // Lv3 含义没变，不该被动

    expect(migrateChainDepth(s)).toBe(true)
    expect(s.board[0]).toMatchObject({ chain: 'toy', level: 8 })
    expect(defOf('toy', 8)!.name).toBe('猫城堡')
    expect(s.board[0]!.charges).toBe(3) // 剩余储备跟着搬，不白送
    expect(s.board[1]).toMatchObject({ chain: 'food', level: 8 })
    expect(s.board[2]).toMatchObject({ chain: 'supply', level: 4 })
    expect(s.board[2]!.charges).toBe(5)
    expect(s.board[3]).toMatchObject({ chain: 'toy', level: 3 })
    expect(s.depthV).toBe(CHAIN_DEPTH_V)
  })

  it('设施链不参与迁移（Lv1/Lv2 含义没变，Lv3 是纯新增）', () => {
    const s: any = freshState()
    delete s.depthV
    s.board.fill(null)
    s.board[0] = makeItem('fac', 1)
    s.board[1] = makeItem('fac', 2)
    migrateChainDepth(s)
    expect(s.board[0]).toMatchObject({ chain: 'fac', level: 1 })
    expect(s.board[1]).toMatchObject({ chain: 'fac', level: 2 })
  })

  it('幂等：跑第二次不再改动', () => {
    const s: any = freshState()
    delete s.depthV
    s.board.fill(null)
    s.board[0] = makeItem('toy', 4)
    expect(migrateChainDepth(s)).toBe(true)
    const snapshot = JSON.stringify(s.board[0])
    expect(migrateChainDepth(s)).toBe(false)
    expect(JSON.stringify(s.board[0])).toBe(snapshot)
  })

  it('背包里的物品也要一起搬', () => {
    const s: any = freshState()
    delete s.depthV
    s.board.fill(null)
    s.bag[6] = { k: 'item', it: makeItem('care', 4) }
    migrateChainDepth(s)
    expect(s.bag[6]).toMatchObject({ k: 'item', it: { chain: 'care', level: 8 } })
  })

  it('读档时自动迁移：老存档的猫城堡不会静默变成猫抓板', () => {
    const s: any = freshState()
    delete s.depthV
    s.board.fill(null)
    s.board[0] = { chain: 'toy', level: 4 }
    save(s)

    const res = load()!
    expect(res.dirty).toBe(true)
    expect(res.state.board[0]).toMatchObject({ chain: 'toy', level: 8 })
  })
})

describe('经验与升级', () => {
  it('按 level * EXP_PER_LEVEL 逐级扣减', () => {
    const s = freshState()
    s.level = 1
    s.exp = 0
    expect(gainExp(s, EXP_PER_LEVEL)).toBe(true)
    expect(s.level).toBe(2)
    expect(s.exp).toBe(0)
  })

  it('一次给足够多的经验可以连升多级', () => {
    const s = freshState()
    s.level = 1
    s.exp = 0
    expect(gainExp(s, EXP_PER_LEVEL * 1 + EXP_PER_LEVEL * 2 + 5)).toBe(true)
    expect(s.level).toBe(3)
    expect(s.exp).toBe(5)
  })
})

describe('棋盘工具函数', () => {
  it('sameKind 只比链与等级，不比耐久', () => {
    const partial: BoardItem = { chain: 'supply', level: 1, charges: 1 }
    expect(sameKind(makeItem('supply', 1), partial)).toBe(true)
    expect(sameKind(makeItem('toy', 1), makeItem('toy', 2))).toBe(false)
    expect(sameKind(null, makeItem('toy', 1))).toBe(false)
  })

  it('itemKey 把耐久算进去，耐久变化能触发元素重建', () => {
    const a: BoardItem = { chain: 'supply', level: 1, charges: 8 }
    const b: BoardItem = { chain: 'supply', level: 1, charges: 7 }
    expect(itemKey(a)).not.toBe(itemKey(b))
    expect(itemKey(null)).toBe('')
  })

  it('findItem 找得到 / 找不到', () => {
    const s = freshState()
    s.board[0] = makeItem('toy', 2)
    expect(findItem(s, 'toy', 2)).toBe(0)
    expect(findItem(s, 'toy', 3)).toBe(-1)
  })
})

describe('存档：迁移与容错', () => {
  beforeEach(() => clearSave())

  it('往返一致', () => {
    const s = freshState()
    s.gold = 123
    // 新代码产出的存档里一定还有设施（设施不可销毁、也不可被吃到 0），
    // 所以夹具必须先摆上设施 —— 否则会被"补回开局设施"的兜底逻辑改写成 dirty
    s.board[0] = makeItem('fac', 1)
    s.board[3] = makeItem('supply', 1)
    save(s)

    const res = load()
    expect(res).not.toBeNull()
    expect(res!.state.gold).toBe(123)
    expect(res!.state.board[3]).toMatchObject({ chain: 'supply', level: 1, charges: 8 })
    expect(res!.state.board[3]!.cdAt).toBe(0) // 没在冷却
    expect(res!.dirty).toBe(false)
  })

  it('孤儿物品只清它自己，绝不连累整份存档', () => {
    const s = freshState()
    s.gold = 999
    s.board[0] = makeItem('fac', 1) // 留一个设施，避免触发兜底补设施
    s.board[4] = { chain: 'ghost' as never, level: 1 }
    s.board[5] = makeItem('toy', 99) // 越界等级
    s.board[6] = makeItem('toy', 1)
    save(s)

    const res = load()
    expect(res).not.toBeNull()
    expect(res!.state.gold).toBe(999) // 存档整体保住了
    expect(res!.state.board[4]).toBeNull()
    expect(res!.state.board[5]).toBeNull()
    expect(res!.state.board[6]).toEqual({ chain: 'toy', level: 1 })
    expect(res!.state.board[0]).toMatchObject({ chain: 'fac', level: 1 }) // 设施毫发无损
    expect(res!.dirty).toBe(true)
  })

  it('发射器缺耐久时补齐，普通物品多了耐久时清掉', () => {
    const s = freshState()
    s.board[0] = { chain: 'supply', level: 1 } // 缺 charges
    s.board[1] = { chain: 'toy', level: 1, charges: 5 } // 不该有 charges
    save(s)

    const res = load()!
    expect(res.state.board[0]!.charges).toBe(8)
    expect(res.state.board[1]!.charges).toBeUndefined()
  })

  it('结构与棋盘长度不符时拒绝加载，而不是清空重开', () => {
    localStorage.setItem('pawpark_save', JSON.stringify({ v: 1, board: [null] }))
    expect(load()).toBeNull()
  })

  it('把 P0 老存档（{c,l,u} / {c,l}）平滑迁到新结构', () => {
    const legacy: any = freshState()
    legacy.v = 3
    legacy.gold = 77
    // P0 的字段名与结构
    legacy.board = new Array(TOTAL).fill(null)
    legacy.board[5] = { c: 'supply', l: 2, u: 4 }
    legacy.orders = [{ id: 'abc', c: 'toy', l: 2, gold: 60, exp: 30 }]
    localStorage.setItem('pawpark_p0_save', JSON.stringify(legacy))

    const res = load()
    expect(res).not.toBeNull()
    expect(res!.dirty).toBe(true) // 需要立刻回写到新 key
    expect(res!.state.gold).toBe(77)
    expect(res!.state.board[5]).toMatchObject({ chain: 'supply', level: 2, charges: 4 })
    // ★ 第一批给订单加了 档位 / 顾客 / 倒计时 / 星星 / 好感，结构变化太大，
    //   老订单**不再逐字段补默认值，直接丢弃重抽**。所以这里断言"重抽出来的订单是合法的"，
    //   而不是"老订单被原样保留"。
    expect(res!.state.orders).toHaveLength(ORDER_SLOTS)
    const o = res!.state.orders[0]
    expect(o.chain).toBe('toy') // 老存档只解锁了 toy（礼包链不进订单轮换）
    expect(customerDef(o.customer)).not.toBeNull()
    expect(o.tier).toBe('normal') // 1 级玩家只能拿普通订单
    expect(o.expireAt).toBeGreaterThan(0)
  })

  it('设施全收进背包时，读档不会重复补发设施', () => {
    const s = freshState()
    // 玩家把两个设施都收进背包、棋盘清空
    s.board.fill(null)
    s.bag[0] = { k: 'item', it: makeItem('fac', 1) }
    s.bag[1] = { k: 'item', it: makeItem('fac', 2) }
    save(s)

    const res = load()!
    // 背包里已经有 2 个设施 → 不该再往棋盘上补
    expect(res.state.board.filter(Boolean).length).toBe(0)
    expect(res.state.bag[0]).not.toBeNull()
    expect(res.state.bag[1]).not.toBeNull()
  })

  it('老存档（棋盘与背包都没有设施）读档时补回开局设施', () => {
    const s: any = freshState()
    s.board = new Array(TOTAL).fill(null) // 模拟旧版：玩具架/玩具箱不在棋盘上
    save(s)

    const res = load()!
    const facs = res.state.board.filter((it) => it && it.chain === 'fac')
    expect(facs.length).toBe(2)
  })

  it('冷却状态要能跨存档存活（刷新页面不能白拿补满）', () => {
    const s = freshState()
    s.board.fill(null)
    const fac = makeItem('fac', 1)
    fac.charges = 0
    fac.cdAt = Date.now() + 60_000
    s.board[0] = fac
    save(s)

    const res = load()!
    const back = res.state.board[0]!
    expect(back.charges).toBe(0) // ★ 不能被当成"数据缺失"补满
    expect(back.cdAt).toBeGreaterThan(Date.now())
  })

  it('旧存档缺经营层字段时补默认值，且不升 SAVE_VERSION（老进度不丢）', () => {
    const s: any = freshState()
    delete s.stars
    delete s.affinity
    delete s.pets
    delete s.petAt
    delete s.regions
    delete s.decor
    delete s.cardDay
    save(s)

    const res = load()!
    expect(res.state.stars).toBe(0)
    expect(res.state.affinity).toEqual({})
    expect(res.state.pets).toEqual([])
    expect(typeof res.state.petAt).toBe('number')
    // 前台大厅必须被强制打开，否则整条区域链会断在这里
    expect(isRegionUnlocked(res.state, 'lobby')).toBe(true)
    expect(isRegionUnlocked(res.state, 'pool')).toBe(false)
    expect(res.state.decor).toEqual({})
    expect(res.state.cardDay).toBe('')
    expect(res.state.v).toBe(SAVE_VERSION)
  })

  it('旧存档里的未知顾客好感 / 未知区域 / 越级装饰只清它们自己', () => {
    const s: any = freshState()
    s.affinity = { ragdoll: 80, ghost: 50 }
    s.regions = { lobby: true, nowhere: true }
    s.decor = { plant: 3, nope: 2, fountain: 99 }
    save(s)

    const res = load()!
    expect(res.state.affinity).toEqual({ ragdoll: 80 })
    expect((res.state.regions as Record<string, boolean>).nowhere).toBeUndefined()
    expect(res.state.regions.lobby).toBe(true)
    expect(res.state.decor.plant).toBe(3)
    expect(res.state.decor.nope).toBeUndefined()
    // 越级的装饰等级被压回上限，而不是被删掉
    expect(res.state.decor.fountain).toBe(decorDef('fountain')!.maxLevel)
  })

  it('蛛网与物品冲突时以物品为准', () => {
    const s = freshState()
    s.board[4] = makeItem('toy', 1)
    s.web[4] = true
    save(s)

    const res = load()!
    expect(res.state.web[4]).toBe(false)
    expect(res.state.board[4]).not.toBeNull()
  })

  it('旧存档没有 bag 字段时补默认值，而不是拒绝加载', () => {
    const s: any = freshState()
    delete s.bag
    delete s.bagCap
    delete s.bagExpanded
    save(s)

    const res = load()
    expect(res).not.toBeNull()
    expect(res!.state.bag.length).toBe(BAG_TOTAL)
    expect(res!.state.bagCap).toBe(BAG_INITIAL_CAP)
    expect(res!.state.bagExpanded).toBe(0)
    expect(res!.dirty).toBe(true)
  })

  it('背包里的孤儿物品与非法道具只清它自己', () => {
    const s = freshState()
    s.gold = 888
    s.bag[0] = { k: 'item', it: { chain: 'ghost' as never, level: 1 } }
    s.bag[1] = { k: 'item', it: makeItem('toy', 99) }
    s.bag[2] = { k: 'tool', st: { tool: 'nope' as never, count: 1 } }
    s.bag[3] = { k: 'tool', st: { tool: 'scissors', count: 0 } }
    s.bag[4] = { k: 'item', it: makeItem('supply', 1) }
    save(s)

    const res = load()!
    expect(res.state.gold).toBe(888)
    expect(res.state.bag[0]).toBeNull()
    expect(res.state.bag[1]).toBeNull()
    expect(res.state.bag[2]).toBeNull()
    expect(res.state.bag[3]).toBeNull()
    expect(res.state.bag[4]).toMatchObject({ k: 'item', it: { chain: 'supply', level: 1, charges: 8 } })
  })

  it('容量被改小也不会出现"看不见但占着位"的幽灵物品', () => {
    const s = freshState()
    s.bagCap = 1
    s.bag[7] = { k: 'item', it: makeItem('toy', 1) }
    save(s)

    const res = load()!
    expect(res.state.bagCap).toBeGreaterThanOrEqual(8)
    expect(res.state.bag[7]).not.toBeNull()
  })
})

describe('背包：容量与扩容', () => {
  it('扩容价逐格递增', () => {
    expect(bagPrice(0)).toBe(BAG_BASE_PRICE)
    expect(bagPrice(1)).toBeGreaterThan(bagPrice(0))
    expect(bagPrice(5)).toBeGreaterThan(bagPrice(4))
  })

  it('新开局：容量 = 初始值，背包是满长度数组', () => {
    const s = freshState()
    expect(s.bag.length).toBe(BAG_TOTAL)
    expect(s.bagCap).toBe(BAG_INITIAL_CAP)
    expect(s.bagExpanded).toBe(0)
    expect(bagUsed(s)).toBe(0)
  })

  it('随机空格只在已解锁范围内挑，锁着的格子不算空', () => {
    const s = freshState()
    for (let i = 0; i < BAG_INITIAL_CAP; i++) {
      s.bag[i] = { k: 'tool', st: { tool: 'scissors', count: 1 } }
    }
    expect(findBagFree(s)).toBe(-1) // 已解锁的全满
    s.bagCap = BAG_INITIAL_CAP + 1
    expect(findBagFree(s)).toBe(BAG_INITIAL_CAP) // 扩容后才可用新格
  })

  it('满容量时不能再扩容', () => {
    const s = freshState()
    s.bagCap = BAG_TOTAL
    expect(canExpandBag(s)).toBe(false)
  })

  it('countEmpty 不算蛛网（也不算背包格）', () => {
    const s = freshState()
    const all = countEmpty(s)
    // 主场景整块可用、没有锁定格；唯一不算的是背包格（bagAt=62，2026-10-02 起）
    expect(all).toBe(TOTAL - 1)
    s.board[0] = makeItem('toy', 1)
    expect(countEmpty(s)).toBe(all - 1)
    s.board[0] = null
    s.web[1] = true
    expect(countEmpty(s)).toBe(all - 1)
  })
})

// ==================== 第四批：自动型发射器 + 存档契约 ====================

describe('自动型发射器（M1 收尾）', () => {
  const MS = 30_000

  it('fac 链的 Lv4/Lv5 是自动型：不耗体力、按间隔自己跑', () => {
    const d = defOf('fac', 4)!
    expect(d.kind).toBe('auto')
    expect(d.autoMs).toBe(MS)
    expect(isAutoItem(makeItem('fac', 4))).toBe(true)
    // 自动型不是可点击对象 —— 不能抢走"点击 = 产出"这个最高频交互
    expect(isClickable(d)).toBe(false)
    // 也没有储备字段（它不会耗尽）
    expect(makeItem('fac', 4).charges).toBeUndefined()
  })

  it('到点自动产出，不消耗体力', () => {
    const s = freshState()
    s.board.fill(null)
    s.board[0] = makeItem('fac', 4)
    const now = Date.now()
    const r = tickAuto(s, now + MS)
    expect(r.cells.length).toBeGreaterThan(0)
    expect(s.board.filter((x) => x && x.chain === 'toy').length).toBe(1)
  })

  it('不到点不产出；lastAutoAt 从现在起算（第一份要等一个完整周期）', () => {
    const s = freshState()
    s.board.fill(null)
    const t0 = Date.now()
    s.board[0] = makeItem('fac', 4)
    expect(tickAuto(s, t0 + MS - 1).cells.length).toBe(0)
    expect(tickAuto(s, t0 + MS).cells.length).toBeGreaterThan(0)
  })

  it('★ 离线累积有上限，超出部分作废且不重复结算', () => {
    const s = freshState()
    s.board.fill(null)
    const t0 = Date.now()
    s.board[0] = makeItem('fac', 4)
    it_lastAutoAt(s, 0, t0)

    const r = tickAuto(s, t0 + 100 * MS) // 离线 100 个周期
    expect(r.cells.length).toBeGreaterThan(0)
    // 最多只产 8 个（上限），而不是 100 个
    expect(s.board.filter((x) => x && x.chain === 'toy').length).toBeLessThanOrEqual(8)
    const gold = s.gold
    // 再结算一次：上限之外的时段已作废，不会重复发
    const again = tickAuto(s, t0 + 100 * MS + 1000)
    expect(again.cells.filter((c) => c === 0).length).toBe(0)
    expect(s.gold).toBe(gold)
  })

  it('★ 棋盘满时先不结算（不吞次数），腾出空位后一次性放出', () => {
    const s = freshState()
    s.board.fill(null)
    const t0 = Date.now()
    s.board[0] = makeItem('fac', 4)
    it_lastAutoAt(s, 0, t0)
    // 满盘
    for (let i = 1; i < TOTAL; i++) s.board[i] = makeItem('toy', 1)

    expect(tickAuto(s, t0 + MS).cells.length).toBe(0)
    expect(s.board.filter((x) => x && x.chain === 'toy' && x.level === 1).length).toBe(TOTAL - 1)

    // 腾出空位后再结算：攒下的次数还在
    s.board[5] = null
    const r = tickAuto(s, t0 + MS + 1000)
    expect(r.cells.length).toBeGreaterThan(0)
    expect(s.board[5]).not.toBeNull()
  })

  it('★ 棋盘满时不结算：自动型本体原地不动，次数也不作废', () => {
    const s = freshState()
    s.board.fill(null)
    const t0 = Date.now()
    const it = makeItem('fac', 4)
    it.lastAutoAt = t0
    s.board[0] = it
    for (let i = 1; i < TOTAL; i++) s.board[i] = makeItem('toy', 1)

    const r = tickAuto(s, t0 + MS)
    expect(r.cells.length).toBe(0)
    // 本体还在（没有被"挤掉"）
    expect(s.board[0]).toMatchObject({ chain: 'fac', level: 4 })
  })

  function it_lastAutoAt(s: GameState, i: number, at: number): void {
    const it = s.board[i]
    if (it) it.lastAutoAt = at
  }
})

describe('存档信封（SaveEnvelope）与备份（M5）', () => {
  it('save 写的是带校验和的信封，load 能读回', () => {
    const s = freshState()
    s.gold = 321
    save(s)

    const raw = JSON.parse(localStorage.getItem('pawpark_save')!)
    expect(raw.schemaVersion).toBe(ENVELOPE_VERSION)
    expect(typeof raw.deviceId).toBe('string')
    expect(typeof raw.checksum).toBe('string')
    expect(raw.payload.gold).toBe(321)

    const res = load()!
    expect(res.state.gold).toBe(321)
  })

  it('payload 被改坏时校验失败，load 退到备份而不是用坏数据', () => {
    const s = freshState()
    s.gold = 111
    save(s)
    backupNow(s)

    // 把 payload 的金币改成 999（不重新算 checksum）→ 模拟"数据被改坏"
    const env = JSON.parse(localStorage.getItem('pawpark_save')!)
    env.payload.gold = 999
    localStorage.setItem('pawpark_save', JSON.stringify(env))

    const res = load()!
    expect(res.fromBackup).toBeDefined() // 从备份恢复
    expect(res.state.gold).toBe(111) // 用的是备份里的数，不是坏数据
  })

  it('备份轮转：最多 3 份，写的永远是最旧的槽位', () => {
    const s = freshState()
    s.board.fill(null)
    s.board[0] = makeItem('fac', 1)

    const slots: number[] = []
    for (let i = 0; i < 5; i++) {
      s.board[0] = makeItem('toy', 1)
      slots.push(backupNow(s))
    }
    // 5 次备份只落在 3 个槽位上（轮转）
    expect(new Set(slots).size).toBe(3)
    expect(listBackups().filter((b) => b.savedAt > 0).length).toBe(3)
  })

  it('restoreBackup 把备份写回主存档', () => {
    const s = freshState()
    s.gold = 555
    save(s)
    const slot = backupNow(s)
    s.gold = 0
    save(s)

    expect(restoreBackup(slot).ok).toBe(true)
    const res = load()!
    expect(res.state.gold).toBe(555)
  })

  it('导出/导入往返一致；坏文本报错且不动现有存档', () => {
    const s = freshState()
    s.gold = 777
    save(s)
    const text = exportSaveText()!
    expect(text).toContain('"payload"')

    // 改点东西再导回来
    const env = JSON.parse(text)
    env.payload.gold = 1
    s.gold = 1
    save(s)

    expect(importSaveText(text).ok).toBe(true)
    expect(load()!.state.gold).toBe(777)

    // 坏文本：不动现有存档
    const before = load()!.state.gold
    const r = importSaveText('这不是JSON')
    expect(r.ok).toBe(false)
    expect(load()!.state.gold).toBe(before)
  })
})

// ==================== 挤出 / 换位（2026-10-02 交互修正）====================

describe('findDisplaceCell —— 拖到占用格的挤出规则', () => {
  /** 全空棋盘（bagAt = -1：背包不在盘上） */
  function blank(): { board: (BoardItem | null)[]; web: boolean[] } {
    return { board: new Array(TOTAL).fill(null), web: new Array(TOTAL).fill(false) }
  }

  it('环1：周围 8 格有空位时挤到其中之一', () => {
    const { board, web } = blank()
    // 目标 40（r5,c5）。填满 8 邻域中除 34 以外的所有格 → 唯一环1空位是 34
    for (const i of [33, 35, 39, 41, 46, 47, 48]) board[i] = makeItem('toy', 1)
    expect(findDisplaceCell(board, web, 40)).toBe(34)
  })

  it('环1全满 → 挤到再外一圈（环2）', () => {
    const { board, web } = blank()
    // 填满 40 的整个 5×5 邻域（除 40 自身与环2 的 25）
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (dr === 0 && dc === 0) continue
        const i = (5 + dr) * 7 + (5 + dc)
        if (i === 25) continue // 唯一环2空位（r3,c4）
        board[i] = makeItem('toy', 1)
      }
    }
    expect(findDisplaceCell(board, web, 40)).toBe(25)
  })

  it('全盘无空位 → swap（两个物品换位）', () => {
    const { board, web } = blank()
    for (let i = 0; i < TOTAL; i++) board[i] = makeItem('toy', 1)
    expect(findDisplaceCell(board, web, 40)).toBe('swap')
  })

  it('蛛网格不算空位', () => {
    const { board, web } = blank()
    for (const i of [33, 35, 39, 41, 46, 47, 48]) board[i] = makeItem('toy', 1)
    web[34] = true // 唯一的环1空位被蛛网盖住
    // 环2 全空 → 挤到环2（不是 swap）
    const t = findDisplaceCell(board, web, 40)
    expect(t).not.toBe(34)
    expect(t).not.toBe('swap')
  })

  it('背包格不算空位', () => {
    const { board, web } = blank()
    for (const i of [33, 35, 39, 41, 46, 47, 48]) board[i] = makeItem('toy', 1)
    const t = findDisplaceCell(board, web, 40, 34) // 34 是背包格
    expect(t).not.toBe(34)
  })

  it('角落目标不越界（环被棋盘边缘裁掉）', () => {
    const { board, web } = blank()
    board[1] = makeItem('toy', 1)
    board[7] = makeItem('toy', 1)
    // 目标 0（左上角）：环1 只有 1、7、8 三格，留 8 → 必须选中 8
    expect(findDisplaceCell(board, web, 0)).toBe(8)
  })
})

// ==================== 背包上棋盘（bagAt，2026-10-02 交互修正）====================

describe('背包是一件摆在棋盘上的道具', () => {
  it('freshState 的背包在右下角，seedBoard 不会占用它', () => {
    const s = freshState()
    expect(s.bagAt).toBe(TOTAL - 1)
    seedBoard(s)
    expect(s.board[TOTAL - 1]).toBeNull()
  })

  it('pickRandomEmpty / countEmpty 都排除背包格', () => {
    const s = freshState()
    s.board.fill(null)
    s.web.fill(false)
    // 除背包格外的所有格都被蛛网盖住 → 唯一"空位"就是背包格，必须返回 -1
    for (let i = 0; i < TOTAL; i++) if (i !== s.bagAt) s.web[i] = true
    expect(pickRandomEmpty(s.board, s.web, Math.random, s.bagAt)).toBe(-1)
    expect(countEmpty(s)).toBe(0)
  })

  it('placeBag：目标格被物品占着 → 挤走原物品，背包落位', () => {
    const s = freshState()
    s.bagAt = -1
    s.board.fill(null)
    s.board[TOTAL - 1] = makeItem('toy', 3) // 占住右下角
    const placed = placeBag(s, TOTAL - 1)
    expect(placed).toBe(TOTAL - 1)
    expect(s.board[TOTAL - 1]).toBeNull() // 背包落位
    const items = s.board.filter(Boolean)
    expect(items).toHaveLength(1) // 原物品被挤到了别处，没消失
  })

  it('placeBag：全盘无空位 → -1（背包暂不上盘，走信息栏入口）', () => {
    const s = freshState()
    s.bagAt = -1
    s.board.fill(null)
    for (let i = 0; i < TOTAL; i++) s.board[i] = makeItem('toy', 1)
    expect(placeBag(s, TOTAL - 1)).toBe(-1)
    expect(s.bagAt).toBe(-1)
  })

  it('placeBag：背包已在棋盘上时绝不挪位', () => {
    const s = freshState()
    expect(placeBag(s, 5)).toBe(TOTAL - 1) // prefer=5 被无视
  })

  it('moveBagTo：只能落到非蛛网空格；拖回原地 = 无事发生', () => {
    const s = freshState()
    s.board.fill(null)
    s.web.fill(false)
    expect(moveBagTo(s, 30)).toBe(true)
    expect(s.bagAt).toBe(30)
    s.board[12] = makeItem('toy', 1)
    expect(moveBagTo(s, 12)).toBe(false) // 占用格拒绝
    s.web[13] = true
    expect(moveBagTo(s, 13)).toBe(false) // 蛛网格拒绝
    expect(moveBagTo(s, 30)).toBe(true) // 原地
    expect(moveBagTo(s, -3)).toBe(false) // 越界
  })

  it('reconcileWebs：蛛网不许盖背包格', () => {
    const s = freshState()
    s.web[s.bagAt] = true
    expect(reconcileWebs(s)).toBe(true)
    expect(s.web[s.bagAt]).toBe(false)
  })

  it('旧存档没有 bagAt 字段 → 归一化补齐，被占的右下角物品被挤走', () => {
    const s = freshState()
    s.board[TOTAL - 1] = makeItem('toy', 2)
    save(s)
    // 手工抹掉 bagAt 字段模拟旧档（save 会把它存进去）
    const raw = JSON.parse(localStorage.getItem('pawpark_save')!)
    delete raw.payload.bagAt
    // ★ 抹字段后必须重算 checksum：load 先验信封再做归一化，失配会被当成损坏档
    raw.checksum = checksumOf(JSON.stringify(raw.payload))
    localStorage.setItem('pawpark_save', JSON.stringify(raw))

    const res = load()!
    expect(res.state.bagAt).toBe(TOTAL - 1)
    expect(res.state.board[TOTAL - 1]).toBeNull()
    // 原物品没丢：还在棋盘或背包里
    const onBoard = res.state.board.filter(Boolean).length
    expect(onBoard).toBeGreaterThanOrEqual(1)
    expect(res.dirty).toBe(true)
  })
})
