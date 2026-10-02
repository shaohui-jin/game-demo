import type { ChainKey, ToolKey } from './types'

/**
 * 商城商品表。
 *
 * 定价与限购的口径**全部来自设计文档第 9 章**，这里只做两处裁定（见各条注释）：
 *
 *  ★ 红线（文档 15 章中风险）：**不提供任何"钻石兑换金币"的商品**。
 *    金币是纯玩法产出的货币，一旦能用钻石买，经营的数值挑战就归零了。
 *    所以钻石区卖的是「消除等不起的摩擦」的东西（体力、道具、设施），绝不卖金币。
 *
 *  ★ 限购（文档 9.2）：**金币商品一律不限购**（取消限购没有平衡风险，
 *    因为金币仍受玩法产出约束）；**钻石商品必须限购**（它是充值货币，不限购等于花钱通关）。
 *
 * 刷新：文档 1.3 写「商城 6:00 / 12:00 / 18:00 / 24:00 刷新货物」——
 * 实现上把它作为**限购计数器的重置点**（`shopSlotKey()`）。
 */

export type Currency = 'gold' | 'gem'

/** 购买后给什么。**每种都写清楚"东西会到哪里去"**，UI 要把这一点讲明白 */
export type GoodsGive =
  /** 特殊道具（进背包） */
  | { kind: 'tool'; tool: ToolKey; count: number }
  /** 体力（可突破上限） */
  | { kind: 'stamina'; amount: number }
  /** 棋盘物品（需要空位；count 个各自随机选一条链） */
  | { kind: 'crate'; pool: ChainKey[]; level: number; count: number }
  /** 设施（直接放进棋盘） */
  | { kind: 'fac'; level: number }

export interface GoodsDef {
  key: string
  name: string
  emoji: string
  sprite: string
  /** 一句话说明：买到的是什么、会到哪里去 */
  desc: string
  currency: Currency
  price: number
  /**
   * 每日限购次数（按"刷新时段"计数，跨过一个时段就清零）。
   * 金币商品 = null（不限购）；钻石商品必须有值。
   */
  dailyLimit: number | null
  /** 购买时棋盘上需要有 >= N 个空位（材料箱 / 设施类） */
  needsBoardSpace: number
  /** 解锁等级（0 = 不限） */
  needLevel: number
  /** 分区：金币区 / 钻石区 */
  tab: Currency
  give: GoodsGive
}

export const GOODS: readonly GoodsDef[] = [
  // ==================== 金币区（不限购，文档 9.2 的金币回收池）====================
  {
    key: 'crateBasic',
    name: '基础材料箱',
    emoji: '📦',
    sprite: 'shop-crate-basic',
    desc: '随机 3 个 Lv1 材料，直接放进棋盘',
    currency: 'gold',
    price: 500,
    dailyLimit: null,
    needsBoardSpace: 3,
    needLevel: 0,
    tab: 'gold',
    give: { kind: 'crate', pool: ['toy', 'care', 'food'], level: 1, count: 3 },
  },
  {
    key: 'crateAdvanced',
    name: '进阶材料箱',
    emoji: '🗃️',
    sprite: 'shop-crate-advanced',
    desc: '随机 3 个 Lv2 材料，直接放进棋盘',
    currency: 'gold',
    price: 2000,
    dailyLimit: null,
    needsBoardSpace: 3,
    needLevel: 6,
    tab: 'gold',
    give: { kind: 'crate', pool: ['toy', 'care', 'food'], level: 2, count: 3 },
  },
  {
    key: 'crateRare',
    name: '稀有材料箱',
    emoji: '🎁',
    sprite: 'shop-crate-rare',
    desc: '随机 2 个 Lv4 材料，直接放进棋盘（高价值目标）',
    currency: 'gold',
    price: 8000,
    dailyLimit: null,
    needsBoardSpace: 2,
    needLevel: 14,
    tab: 'gold',
    give: { kind: 'crate', pool: ['toy', 'care', 'food'], level: 4, count: 2 },
  },
  {
    key: 'hourglass',
    name: '加速沙漏',
    emoji: '⏳',
    sprite: 'tool-hourglass',
    desc: '立刻结束棋盘上所有设施的冷却（进背包）',
    currency: 'gold',
    price: 300,
    dailyLimit: null,
    needsBoardSpace: 0,
    needLevel: 0,
    tab: 'gold',
    give: { kind: 'tool', tool: 'hourglass', count: 1 },
  },
  {
    key: 'scissors',
    name: '剪刀',
    emoji: '✂️',
    sprite: 'tool-scissors',
    desc: '把一个 Lv2+ 物品拆成两个低一级的（进背包）',
    currency: 'gold',
    price: 1200,
    dailyLimit: null,
    needsBoardSpace: 0,
    needLevel: 0,
    tab: 'gold',
    give: { kind: 'tool', tool: 'scissors', count: 1 },
  },

  // ==================== 钻石区（每日限购，消除"等不起"的摩擦）====================
  {
    key: 'stamina',
    name: '体力补充',
    emoji: '⚡',
    sprite: 'shop-stamina',
    desc: '立刻恢复 100 点体力（可超过上限）',
    currency: 'gem',
    price: 30,
    dailyLimit: 3,
    needsBoardSpace: 0,
    needLevel: 0,
    tab: 'gem',
    give: { kind: 'stamina', amount: 100 },
  },
  {
    key: 'charger',
    name: '充能器',
    emoji: '🔋',
    sprite: 'tool-charger',
    desc: '补满一个发射器的储备并结束冷却（进背包）',
    currency: 'gem',
    price: 20,
    dailyLimit: 3,
    needsBoardSpace: 0,
    needLevel: 0,
    tab: 'gem',
    give: { kind: 'tool', tool: 'charger', count: 1 },
  },
  {
    key: 'orb',
    name: '能量球',
    emoji: '⚡',
    sprite: 'tool-orb',
    desc: '立刻恢复 50 点体力（进背包）',
    currency: 'gem',
    price: 25,
    dailyLimit: 3,
    needsBoardSpace: 0,
    needLevel: 0,
    tab: 'gem',
    give: { kind: 'tool', tool: 'orb', count: 1 },
  },
  {
    key: 'facility',
    name: '玩具架',
    emoji: '🧺',
    sprite: 'spawn-rack',
    desc: '直接往棋盘放一个产出源头（钻石区唯一卖"产能"的商品）',
    currency: 'gem',
    price: 200,
    dailyLimit: 1,
    needsBoardSpace: 1,
    needLevel: 8,
    tab: 'gem',
    give: { kind: 'fac', level: 1 },
  },
]

const GOODS_MAP: Record<string, GoodsDef> = {}
for (const g of GOODS) GOODS_MAP[g.key] = g

/** 取商品定义。未知 key 返回 null，**绝不抛错**（旧存档里可能有已下架的商品） */
export function goodsDef(key: string): GoodsDef | null {
  return GOODS_MAP[key] ?? null
}

/**
 * 商城的刷新时段键（形如 `2026-10-2@12`）。
 *
 * 文档 1.3 写「商城 6:00 / 12:00 / 18:00 / 24:00 刷新货物」—— 实现上把它作为
 * **限购计数器的重置点**：跨过一个时段，钻石商品的"今日已购"就清零。
 * 键里带日期，所以跨天也自然重置。
 */
export function shopSlotKey(now: number = Date.now()): string {
  const d = new Date(now)
  const day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  const h = d.getHours()
  // 找到"当前所处的那个时段"（与体力补贴 currentBonus 的思路一致）
  let slot = 6
  for (const x of [6, 12, 18]) if (h >= x) slot = x
  if (h < 6) slot = 0 // 0–6 点属于"昨天 24:00"那一段
  return `${day}@${slot}`
}
