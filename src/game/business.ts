/**
 * 经营层内容表：顾客 / 区域 / 装饰
 *
 * 与 chains.ts / spawners.ts / tools.ts 同一性质 —— 这里只放**内容与它们的静态定义**，
 * 不放状态，也不放依赖 GameState 的逻辑（那些在 logic.ts）。
 *
 * ★ 内容来源与两处**有意偏离**设计文档的地方（改动前请先读）：
 *
 *  1. **区域的"解锁收益"重新映射过。**
 *     文档 6.1 的区域表是按 10 条合成链（洗护链/训练链/医疗链/清洁链/货币链…）写的，
 *     本项目现在只有 4 条链（toy / care / food / supply）。所以**区域名与等级门槛照抄**
 *     （那是有意的长线节奏，45 级封顶对应"摄影棚"），但收益改成映射到我们已有的系统上：
 *     体力上限 / 订单金币加成 / 星星加成 / 常驻宠物离线时长 / 开放订单档位 / 每日道具。
 *
 *  2. **订单档位与"顾客偏好"也是映射过的。**
 *     顾客的"偏好链"取自文档第 8 章的角色设定，但落到我们现有的 4 条链上。
 *
 *  这样做的好处：等合成链扩到 8–10 条时，只需要往这里加数据，逻辑一行不用改。
 */

import type { Camp, ChainKey, CustomerKey, DecorKey, OrderTier, RegionKey } from './types'

// ==================== 顾客（文档第 8 章 · 首批 8 只）====================

export interface CustomerDef {
  key: CustomerKey
  name: string
  emoji: string
  /** 贴图资源键（src/assets/sprites/customers/*），emoji 保留为兜底 */
  sprite: string
  camp: Camp
  /** 性格标签：直接调用用户对品种的既有认知，降低理解成本 */
  tag: string
  /** 偏好链：这类顾客的订单更常出现在该链上 */
  likes: ChainKey
  /** 随手一句口头禅（好感度里程碑时弹出来） */
  quote: string
}

export const CUSTOMERS: readonly CustomerDef[] = [
  // ---- 猫派 ----
  { key: 'ragdoll', name: '布偶猫', emoji: '🐱', sprite: 'cust-ragdoll', camp: 'cat', tag: '高冷优雅，其实很粘人', likes: 'care', quote: '……别误会，我只是刚好路过。' },
  { key: 'orange', name: '橘猫', emoji: '🐈', sprite: 'cust-orange', camp: 'cat', tag: '贪吃，永远在等饭', likes: 'food', quote: '罐头呢？说好的罐头呢？' },
  { key: 'siamese', name: '暹罗猫', emoji: '😺', sprite: 'cust-siamese', camp: 'cat', tag: '话痨，什么都想管', likes: 'toy', quote: '你听我说，这个逗猫棒得换个角度。' },
  { key: 'british', name: '英短', emoji: '😻', sprite: 'cust-british', camp: 'cat', tag: '慵懒，能躺着不站着', likes: 'care', quote: '今天能不能躺着办业务。' },
  // ---- 狗派 ----
  { key: 'husky', name: '哈士奇', emoji: '🐺', sprite: 'cust-husky', camp: 'dog', tag: '拆家，听不懂人话', likes: 'toy', quote: '汪！……我是说，你好。' },
  { key: 'corgi', name: '柯基', emoji: '🐕', sprite: 'cust-corgi', camp: 'dog', tag: '短腿欢脱，屁股是资产', likes: 'supply', quote: '短腿也能跑很快的！' },
  { key: 'shiba', name: '柴犬', emoji: '🐶', sprite: 'cust-shiba', camp: 'dog', tag: '傻笑，表情包本体', likes: 'food', quote: '嘿嘿。嘿嘿嘿嘿。' },
  { key: 'golden', name: '金毛', emoji: '🦮', sprite: 'cust-golden', camp: 'dog', tag: '暖男，对谁都好', likes: 'supply', quote: '需要帮忙吗？我随时都在。' },
  { key: 'tabby', name: '狸花猫', emoji: '🐈‍⬛', sprite: 'cust-tabby', camp: 'cat', tag: '野性，拆家第一名', likes: 'toy', quote: '抓板是我的。第二块也是。' },
  { key: 'black', name: '黑猫', emoji: '🐈', sprite: 'cust-black', camp: 'cat', tag: '神秘，走路没声音', likes: 'med', quote: '走路没声音是优点。' },
  { key: 'white', name: '白猫', emoji: '🐱', sprite: 'cust-white', camp: 'cat', tag: '优雅，洁癖严重', likes: 'care', quote: '地上有一根毛。不是我的。' },
  { key: 'calico', name: '三花猫', emoji: '😻', sprite: 'cust-calico', camp: 'cat', tag: '幸运，抽奖手气好', likes: 'coin', quote: '抽奖之前先摸我一下。' },
  { key: 'teddy', name: '泰迪', emoji: '🐩', sprite: 'cust-teddy', camp: 'dog', tag: '机灵，会察言观色', likes: 'care', quote: '我听得懂你没说出口的话。' },
  { key: 'lab', name: '拉布拉多', emoji: '🐕', sprite: 'cust-lab', camp: 'dog', tag: '稳重，饭量惊人', likes: 'food', quote: '饭量是信誉。' },
  { key: 'border', name: '边牧', emoji: '🐶', sprite: 'cust-border', camp: 'dog', tag: '聪明，智商碾压店长', likes: 'train', quote: '这个障碍的间距不对。' },
  { key: 'frenchie', name: '法斗', emoji: '🐾', sprite: 'cust-frenchie', camp: 'dog', tag: '憨厚，睡着会打呼', likes: 'comfort', quote: '呼……我先躺下听你说。' },
  { key: 'maine', name: '缅因猫', emoji: '🐱', sprite: 'cust-maine', camp: 'cat', tag: '体型大，门框嫌矮', likes: 'comfort', quote: '门框有点矮。' },
  { key: 'sphynx', name: '无毛猫', emoji: '😺', sprite: 'cust-sphynx', camp: 'cat', tag: '怕冷，毛衣是生存', likes: 'care', quote: '毛衣不是装饰，是生存。' },
  { key: 'samoyed', name: '萨摩耶', emoji: '🐺', sprite: 'cust-samoyed', camp: 'dog', tag: '微笑，白色毛发很多', likes: 'clean', quote: '我笑起来像在下雪。' },
  { key: 'bichon', name: '比熊', emoji: '🐩', sprite: 'cust-bichon', camp: 'dog', tag: '圆，适合当模特', likes: 'care', quote: '圆的比较好抱。' },
  { key: 'alaska', name: '阿拉斯加', emoji: '🐕', sprite: 'cust-alaska', camp: 'dog', tag: '力气大，想念雪', likes: 'train', quote: '雪是我想念的地板。' },
  { key: 'dachshund', name: '腊肠', emoji: '🌭', sprite: 'cust-dachshund', camp: 'dog', tag: '短腿，沙发底是办公室', likes: 'comfort', quote: '沙发底下是我的办公室。' },
  { key: 'pomeranian', name: '博美', emoji: '🐶', sprite: 'cust-pomeranian', camp: 'dog', tag: '不大，声音很大', likes: 'toy', quote: '我不大，声音很大。' },
  { key: 'tianyuan', name: '中华田园犬', emoji: '🐕', sprite: 'cust-tianyuan', camp: 'dog', tag: '什么活都干过', likes: 'food', quote: '什么活我都干过。' },
]

const CUSTOMER_MAP: Record<string, CustomerDef> = {}
for (const c of CUSTOMERS) CUSTOMER_MAP[c.key] = c

/** 取顾客定义。未知 key 返回 null，**绝不抛错**（旧存档里可能有已下线的顾客） */
export function customerDef(k: CustomerKey): CustomerDef | null {
  return CUSTOMER_MAP[k] ?? null
}

export function customersOfCamp(camp: Camp): readonly CustomerDef[] {
  return CUSTOMERS.filter((c) => c.camp === camp)
}

// ==================== 区域（文档 6.1 · 9 个）====================

/**
 * 区域效果。字段全部是**可叠加的数值加成**，由 logic.ts 汇总后统一生效，
 * 这样新增区域只要往 REGIONS 里加一行，不需要去各处改 if。
 */
export interface RegionEffect {
  /** 体力上限 +N */
  staminaMax?: number
  /** 订单金币加成（0.1 = +10%） */
  goldMult?: number
  /** 每单额外 +N 星 */
  starBonus?: number
  /** 常驻宠物离线累积上限提升到 N 小时 */
  petHours?: number
  /** 开放一个订单档位 */
  openTier?: OrderTier
  /** 解锁后开放的合成链（与母体解锁可以并存，重复解锁无效果） */
  openChains?: ChainKey[]
}

export interface RegionDef {
  key: RegionKey
  name: string
  emoji: string
  /** 贴图资源键（src/assets/sprites/regions/*） */
  sprite: string
  /** 解锁所需玩家等级 */
  unlockLevel: number
  /** 设计文档原本给这个区域写的收益（保留展示，说明我们没改区域设定） */
  docBenefit: string
  /** 落到本项目实际生效的收益文案（UI 上显示这一条） */
  benefit: string
  effect: RegionEffect
}

export const REGIONS: readonly RegionDef[] = [
  {
    key: 'lobby',
    name: '前台大厅',
    emoji: '🏠',
    sprite: 'region-lobby',
    unlockLevel: 1,
    docBenefit: '教程、初始棋盘',
    benefit: '乐园入口 · 开局即拥有',
    effect: {},
  },
  {
    key: 'grooming',
    name: '洗护区',
    emoji: '🛁',
    sprite: 'region-grooming',
    unlockLevel: 3,
    docBenefit: '开放洗护类订单',
    benefit: '体力上限 +10',
    effect: { staminaMax: 10 },
  },
  {
    key: 'play',
    name: '玩耍区',
    emoji: '🪀',
    sprite: 'region-play',
    unlockLevel: 8,
    docBenefit: '开放玩具类订单 + 自动型发射器',
    benefit: '订单金币 +10%',
    effect: { goldMult: 0.1 },
  },
  {
    key: 'diner',
    name: '餐厅',
    emoji: '🍽️',
    sprite: 'region-diner',
    unlockLevel: 14,
    docBenefit: '开放零食类订单 + 体力上限提升',
    benefit: '体力上限 +20',
    effect: { staminaMax: 20 },
  },
  {
    key: 'training',
    name: '训练场',
    emoji: '🏋️',
    sprite: 'region-training',
    unlockLevel: 20,
    docBenefit: '开放训练订单 + 稀有订单',
    benefit: '开放「稀有订单」（5.5× 奖励）',
    effect: { openTier: 'rare' },
  },
  {
    key: 'nap',
    name: '午睡区',
    emoji: '🛏️',
    sprite: 'region-nap',
    unlockLevel: 26,
    docBenefit: '开放舒适类订单 + 离线收益上限提升',
    benefit: '常驻宠物离线累积 8h → 12h',
    effect: { petHours: 12 },
  },
  {
    key: 'pool',
    name: '泳池区',
    emoji: '🏊',
    sprite: 'region-pool',
    unlockLevel: 32,
    docBenefit: '开放高倍率订单 + 金币产出加成',
    benefit: '订单金币再 +15%、每单 +1 ⭐',
    effect: { goldMult: 0.15, starBonus: 1 },
  },
  {
    key: 'clinic',
    name: '诊疗室',
    emoji: '🩺',
    sprite: 'region-clinic',
    unlockLevel: 38,
    docBenefit: '开放医疗订单 + 道具掉落',
    benefit: '每天赠送 1 张升级卡',
    effect: {},
  },
  {
    key: 'studio',
    name: '摄影棚',
    emoji: '📸',
    sprite: 'region-studio',
    unlockLevel: 45,
    docBenefit: '拍照功能，生成可保存的乐园明信片',
    benefit: '可以导出一张乐园明信片',
    effect: {},
  },
]

const REGION_MAP: Record<string, RegionDef> = {}
for (const r of REGIONS) REGION_MAP[r.key] = r

export function regionDef(k: RegionKey): RegionDef | null {
  return REGION_MAP[k] ?? null
}

/** 区域顺序 = REGIONS 顺序（按等级升序），必须**依次解锁**，不能跳着开 */
export const REGION_ORDER: readonly RegionKey[] = REGIONS.map((r) => r.key)

export function regionIndex(k: RegionKey): number {
  return REGION_ORDER.indexOf(k)
}

/**
 * 全新的区域解锁表：只有前台大厅开着。
 *
 * ★ 必须用这个函数而不是 `{ lobby: true }`：
 *   `Record<RegionKey, boolean>` 要求**所有**键都存在，少写一个键在运行期就是 undefined，
 *   而 `undefined` 在 `isRegionUnlocked()` 里会被当成"未解锁"倒也没错，
 *   但存档里缺键会让"区域链是否完整"这件事变得难以判断。这里显式写全。
 */
export function freshRegions(): Record<RegionKey, boolean> {
  const r = {} as Record<RegionKey, boolean>
  for (const k of REGION_ORDER) r[k] = k === 'lobby'
  return r
}

// ==================== 装饰（文档 6.2）====================

/**
 * ★ 关键设计（照抄文档 6.2，不要"顺手优化"）：
 *   装饰**不产生任何数值收益**。它的价值是把玩家的审美投入转化为沉没成本 ——
 *   这一点原版做得比同类产品好，文档明确写了"必须保留"。
 *   所以这里**故意不给装饰加"订单加成"之类的字段**。星星与主经济隔离。
 */
export interface DecorDef {
  key: DecorKey
  name: string
  emoji: string
  /** 贴图资源键（src/assets/sprites/decors/*） */
  sprite: string
  /** 系列（用于分组展示） */
  set: string
  /** Lv1 的价格（星星） */
  cost: number
  /** 每升一级的涨价倍率 */
  step: number
  /** 最高等级 */
  maxLevel: number
}

export const DECORS: readonly DecorDef[] = [
  // 猫系列
  { key: 'catTree', name: '猫爬架', emoji: '🗼', sprite: 'decor-cat-tree', set: '猫派', cost: 30, step: 1.6, maxLevel: 5 },
  { key: 'catBed', name: '猫吊床', emoji: '🪺', sprite: 'decor-cat-bed', set: '猫派', cost: 40, step: 1.6, maxLevel: 5 },
  { key: 'catHouse', name: '猫宫殿', emoji: '🏯', sprite: 'decor-cat-house', set: '猫派', cost: 60, step: 1.7, maxLevel: 5 },
  // 狗系列
  { key: 'dogBed', name: '狗窝', emoji: '🛖', sprite: 'decor-dog-bed', set: '狗派', cost: 30, step: 1.6, maxLevel: 5 },
  { key: 'frisbee', name: '飞盘架', emoji: '🥏', sprite: 'decor-frisbee', set: '狗派', cost: 40, step: 1.6, maxLevel: 5 },
  { key: 'agility', name: '敏捷赛道', emoji: '🚧', sprite: 'decor-agility', set: '狗派', cost: 60, step: 1.7, maxLevel: 5 },
  // 通用
  { key: 'plant', name: '绿植', emoji: '🪴', sprite: 'decor-plant', set: '通用', cost: 20, step: 1.5, maxLevel: 5 },
  { key: 'rug', name: '地毯', emoji: '🟫', sprite: 'decor-rug', set: '通用', cost: 35, step: 1.5, maxLevel: 5 },
  { key: 'lamp', name: '落地灯', emoji: '💡', sprite: 'decor-lamp', set: '通用', cost: 45, step: 1.5, maxLevel: 5 },
  { key: 'sign', name: '门口招牌', emoji: '🪧', sprite: 'decor-sign', set: '通用', cost: 55, step: 1.6, maxLevel: 5 },
  { key: 'fountain', name: '中央喷泉', emoji: '⛲', sprite: 'decor-fountain', set: '通用', cost: 90, step: 1.7, maxLevel: 5 },
]

const DECOR_MAP: Record<string, DecorDef> = {}
for (const d of DECORS) DECOR_MAP[d.key] = d

export function decorDef(k: DecorKey): DecorDef | null {
  return DECOR_MAP[k] ?? null
}

/** 装饰系列的展示顺序 */
export const DECOR_SETS: readonly string[] = ['通用', '猫派', '狗派']

/**
 * 把装饰从 level 升到 level+1 的价格。
 * 已满级返回 0（调用方负责判断"已满级"并给文案）。
 */
export function decorPrice(d: DecorDef, level: number): number {
  if (level >= d.maxLevel) return 0
  return Math.round(d.cost * Math.pow(d.step, level))
}

/** 装饰总等级，用于"乐园繁荣度"这类展示（无数值作用） */
export function decorTotalLevel(decor: Record<DecorKey, number>): number {
  let n = 0
  for (const k of Object.keys(decor)) n += decor[k] ?? 0
  return n
}
