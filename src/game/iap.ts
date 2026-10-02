/**
 * 模拟充值 / 付费内容（M2 剩余，设计文档 10 章）。
 *
 * ★ 架构红线（文档 10 章的"破解架构原则"）：模拟充值是**独立旁路模块**，
 *   只负责往钻石余额加钱；所有商品逻辑（商城 / 道具 / 材料箱）完全不知道它的存在。
 *   将来切回商业版或去掉破解功能时零改造。
 *
 * 金币**永远不可充值**（文档 9 章红线）——本模块输出的所有奖励里没有金币档位这一说，
 * 抽奖机的金币是"玩法产出"性质的奖励，不是充值换金币。
 */

import {
  FUND_MAX_CLAIMS,
  FUND_PER_CLAIM,
  LUCKY_DECOR_TO_GEM,
  LUCKY_PITY,
  LUCKY_SINGLE,
  LUCKY_SKIN_TO_GEM,
  LUCKY_TEN,
  VIP_DAYS,
  VIP_DAILY_GEM,
  VIP_DAILY_STAMINA,
  VIP_PRICE,
} from './config'
import { TOOL_ORDER } from './tools'
import type { ChainKey, ToolKey } from './types'

// ==================== 类型 ====================

export interface IapTier {
  key: string
  /** 展示价（¥） */
  price: number
  /** 基础钻石 */
  gems: number
  /** 推荐角标（'' = 无） */
  tag: string
}

export interface PayResult {
  /** 实际到账的钻石（含首充双倍） */
  gems: number
  /** 本次是否触发了首充双倍 */
  doubled: boolean
}

export type Rarity = 'common' | 'rare'

export interface LuckyPrize {
  kind: 'gold' | 'tool' | 'skin' | 'decor'
  /** gold 的数量 / tool 的数量 / skin·decor 转换成的钻石数量 */
  amount: number
  tool?: ToolKey
  rarity: Rarity
  /** 造型 / 装饰当前是"视为重复自动转换"（M3 接入真实造型后此标记会消失） */
  converted: boolean
}

// ==================== 充值档位（文档 10.1，沿用原版）====================

export const IAP_TIERS: readonly IapTier[] = [
  { key: 'tier6', price: 6, gems: 60, tag: '' },
  { key: 'tier30', price: 30, gems: 300, tag: '对应会员卡' },
  { key: 'tier68', price: 68, gems: 680, tag: '' },
  { key: 'tier128', price: 128, gems: 1280, tag: '热销' },
  { key: 'tier328', price: 328, gems: 3280, tag: '' },
  { key: 'tier648', price: 648, gems: 6480, tag: '最高档 · 附赠限定造型' },
]

export function iapTier(key: string): IapTier | null {
  return IAP_TIERS.find((t) => t.key === key) ?? null
}

/**
 * 模拟支付一个档位。**只算账，不动存档** —— 到账、首充标记由 store 落地，
 * 这样 UI 可以先播放支付动画、再决定什么时候把钱写进状态。
 */
export function payTier(tier: IapTier, firstRecharge: boolean): PayResult {
  const doubled = !firstRecharge
  return { gems: doubled ? tier.gems * 2 : tier.gems, doubled }
}

// ==================== 会员卡（文档 10.3）====================

/** 会员卡价格与每日福利都来自 config。购买 / 续期：到期时间往后叠加 30 天 */
export function vipNewUntil(curUntil: number, now: number): number {
  const base = Math.max(curUntil, now)
  return base + VIP_DAYS * 24 * 60 * 60 * 1000
}

export const VIP_BENEFIT = { gem: VIP_DAILY_GEM, stamina: VIP_DAILY_STAMINA, price: VIP_PRICE }

export function vipPrice(): number {
  return VIP_PRICE
}

// ==================== 成长基金（文档 10.3）====================

/** 当前等级下累计"已到账但未领取"的返还次数：min(floor(level/5), 10) */
export function fundClaimsReady(level: number, claimed: number): number {
  const reached = Math.min(Math.floor(level / 5), FUND_MAX_CLAIMS)
  return Math.max(0, reached - claimed)
}

export const FUND_META = {
  price: 888,
  perClaim: FUND_PER_CLAIM,
  maxClaims: FUND_MAX_CLAIMS,
}

// ==================== 礼包（文档 10.3 / 10.4）====================

/**
 * 礼包给的东西是**声明式**的：本模块只定义"买了给什么 + 限购口径"，
 * 实际发放（体力 / 道具进背包 / 材料箱落棋盘）由 store 执行 ——
 * 因为那些操作需要访问背包 / 棋盘 / 特效层。
 *
 * 限购口径分三种：
 *   once      一生一次（新手礼包）
 *   perRegion 每次解锁区域限一次（key 里带区域后缀，由 store 生成）
 *   per10Lv   每 10 级限一次（key 里带档位后缀，由 store 生成）
 *   unlimited 不限购（商城补给包，定价约单买 9 折）
 */
export type GiftLimit = 'once' | 'perRegion' | 'per10Lv' | 'unlimited'

/** 礼包内容物（声明式，store 负责落地） */
export type GiftGive =
  | { kind: 'stamina'; amount: number }
  | { kind: 'tool'; tool: ToolKey; count: number }
  | { kind: 'crate'; pool: ChainKey[]; level: number; count: number }

export interface GiftDef {
  key: string
  name: string
  emoji: string
  desc: string
  /** 钻石价 */
  price: number
  limit: GiftLimit
  /** 等级礼包的档位后缀需要知道"当前属于哪个 10 级段"（1,2,3...） */
  gives: GiftGive[]
  /** 解锁等级（0 = 不限） */
  needLevel: number
}

export const GIFTS: readonly GiftDef[] = [
  // ---- 阶段性礼包（超值 · 限量，约单买 5–7 折）----
  {
    key: 'starter',
    name: '新手礼包',
    emoji: '🌸',
    desc: '100 体力 + 剪刀 ×3 + 基础材料箱 ×5（含限定装饰「开业花篮」，装饰摆放上线后补发）',
    price: 60,
    limit: 'once',
    needLevel: 0,
    gives: [
      { kind: 'stamina', amount: 100 },
      { kind: 'tool', tool: 'scissors', count: 3 },
      { kind: 'crate', pool: ['toy', 'care', 'food'], level: 1, count: 5 },
    ],
  },
  {
    key: 'region',
    name: '区域解锁礼包',
    emoji: '🏞️',
    desc: '加速沙漏 ×10 + 基础材料箱 ×3（每次解锁新区域可买一次）',
    price: 200,
    limit: 'perRegion',
    needLevel: 0,
    gives: [
      { kind: 'tool', tool: 'hourglass', count: 10 },
      { kind: 'crate', pool: ['toy', 'care', 'food'], level: 1, count: 3 },
    ],
  },
  {
    key: 'level',
    name: '等级礼包',
    emoji: '🎖️',
    desc: '200 体力 + 充能器 ×5（每 10 级可买一次）',
    price: 150,
    limit: 'per10Lv',
    needLevel: 10,
    gives: [
      { kind: 'stamina', amount: 200 },
      { kind: 'tool', tool: 'charger', count: 5 },
    ],
  },
  // ---- 商城礼包（常驻 · 不限量 · 约单买 9 折）----
  {
    key: 'daily',
    name: '日常补给包',
    emoji: '🧰',
    desc: '200 体力 + 剪刀 ×5 + 加速沙漏 ×10（约单买 9 折）',
    price: 90,
    limit: 'unlimited',
    needLevel: 0,
    gives: [
      { kind: 'stamina', amount: 200 },
      { kind: 'tool', tool: 'scissors', count: 5 },
      { kind: 'tool', tool: 'hourglass', count: 10 },
    ],
  },
  {
    key: 'advanced',
    name: '进阶补给包',
    emoji: '🧳',
    desc: '600 体力 + 充能器 ×10 + 进阶材料箱 ×5（约单买 9 折）',
    price: 260,
    limit: 'unlimited',
    needLevel: 6,
    gives: [
      { kind: 'stamina', amount: 600 },
      { kind: 'tool', tool: 'charger', count: 10 },
      { kind: 'crate', pool: ['toy', 'care', 'food'], level: 2, count: 5 },
    ],
  },
  {
    key: 'deluxe',
    name: '豪华补给包',
    emoji: '🛍️',
    desc: '1500 体力 + 充能器 ×30 + 稀有材料箱 ×5（约单买 9 折）',
    price: 720,
    limit: 'unlimited',
    needLevel: 14,
    gives: [
      { kind: 'stamina', amount: 1500 },
      { kind: 'tool', tool: 'charger', count: 30 },
      { kind: 'crate', pool: ['toy', 'care', 'food'], level: 4, count: 5 },
    ],
  },
]

const GIFTS_MAP: Record<string, GiftDef> = {}
for (const gd of GIFTS) GIFTS_MAP[gd.key] = gd

/** 取礼包定义。未知 key 返回 null，**绝不抛错**（旧存档可能有已下架礼包） */
export function giftDef(key: string): GiftDef | null {
  return GIFTS_MAP[key] ?? null
}

/**
 * 一次性礼包在存档里的计数键（区别于商品 key，带口径后缀）：
 *   once      → `starter`
 *   perRegion → `region:<区域解锁次数>`（用 regionCount，解锁过的区域不会倒退）
 *   per10Lv   → `level:<档位>`（1 = Lv1–10，2 = Lv11–20…）
 *   unlimited → `daily` 等原样（不参与限购，但也记录购买历史）
 */
export function giftCountKey(key: string, level: number, regionCount: number): string {
  const d = giftDef(key)
  if (!d) return key
  if (d.limit === 'once') return key
  if (d.limit === 'perRegion') return `${key}:${regionCount}`
  if (d.limit === 'per10Lv') return `${key}:${Math.max(1, Math.ceil(level / 10))}`
  return key
}

// ==================== 抽奖机（文档 10.3）====================

/**
 * 奖池权重（文档：限定造型 3% / 稀有装饰 12% / 道具 35% / 金币 50%）。
 *
 * ★ 造型与装饰系统在 M3 才落地 —— 当前抽到即**视为重复**，按文档 10.4
 *   "重复获得自动转换为钻石"直接折现（造型 120 钻 / 装饰 40 钻）。
 *   等真实系统上线后，这两档改成发真实物品，接口不变。
 */
const LUCKY_WEIGHTS: Array<{ kind: LuckyPrize['kind']; w: number; rarity: Rarity }> = [
  { kind: 'skin', w: 3, rarity: 'rare' },
  { kind: 'decor', w: 12, rarity: 'rare' },
  { kind: 'tool', w: 35, rarity: 'common' },
  { kind: 'gold', w: 50, rarity: 'common' },
]

function pickKind(rng: () => number): { kind: LuckyPrize['kind']; rarity: Rarity } {
  const total = LUCKY_WEIGHTS.reduce((a, b) => a + b.w, 0)
  let r = rng() * total
  for (const x of LUCKY_WEIGHTS) {
    r -= x.w
    if (r < 0) return { kind: x.kind, rarity: x.rarity }
  }
  return { kind: 'gold', rarity: 'common' }
}

/**
 * 抽一次。**保底规则**：距上次"稀有及以上"累计 10 抽（luckyPity 达到 9 时本次强制稀有）。
 *
 * 返回奖励 + 新的保底计数（由调用方写回存档，本函数不改 state —— 可单测）。
 */
export function spinOnce(
  luckyPity: number,
  rng: () => number = Math.random
): { prize: LuckyPrize; pity: number } {
  const forced = luckyPity >= LUCKY_PITY - 1
  let pick = pickKind(rng)
  if (forced && pick.rarity !== 'rare') {
    // 强制稀有：在两档稀有里按原比例二选一
    pick = rng() * 15 < 3 ? { kind: 'skin', rarity: 'rare' } : { kind: 'decor', rarity: 'rare' }
  }

  let prize: LuckyPrize
  if (pick.kind === 'gold') {
    // 金币档：200–1000，取整到十位
    const amount = 200 + Math.floor(rng() * 81) * 10
    prize = { kind: 'gold', amount, rarity: 'common', converted: false }
  } else if (pick.kind === 'tool') {
    const tool = TOOL_ORDER[Math.floor(rng() * TOOL_ORDER.length)]
    const count = 1 + Math.floor(rng() * 2) // 1–2 个
    prize = { kind: 'tool', amount: count, tool, rarity: 'common', converted: false }
  } else if (pick.kind === 'skin') {
    prize = { kind: 'skin', amount: LUCKY_SKIN_TO_GEM, rarity: 'rare', converted: true }
  } else {
    prize = { kind: 'decor', amount: LUCKY_DECOR_TO_GEM, rarity: 'rare', converted: true }
  }

  // 保底计数：出稀有清零；普通 +1（普通奖励不会把它推过窗口，因为强制逻辑在前面）
  const pity = prize.rarity === 'rare' ? 0 : luckyPity + 1
  return { prize, pity }
}

export const LUCKY_META = { single: LUCKY_SINGLE, ten: LUCKY_TEN, pity: LUCKY_PITY }
