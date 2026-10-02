/**
 * 游戏平衡常量
 *
 * 集中放这里的目的：数值调优是高频操作，散落在逻辑里会很难改。
 * 所有会影响手感与节奏的数字都必须在此处定义。
 */

import type { OrderTier, RegionKey } from './types'

// ==================== 棋盘 ====================

export const COLS = 7
export const ROWS = 9
/**
 * 棋盘总格数 = 可用格数。
 *
 * ★ 变更（2026-10-02 第二轮设计修正）：**主场景不存在"锁定格"**。
 *   原来棋盘只解锁前 5 行、下面 4 行带锁 —— 这是照搬错了。
 *   "花金币解锁格子"只属于**背包**这一个系统；主场景是固定且**整块可用**的。
 *
 *   那"格子压力"从哪来？靠两件事，都不需要锁定格：
 *     ① 设施在棋盘上**常驻占格**（玩具架 / 玩具箱 / 合成出来的母体）；
 *     ② 蛛网会临时占格，且只会落在空格上。
 *   这和对标产品一致：它的主场景也没有锁定格，压力来自"东西太多放不下"。
 */
export const TOTAL = COLS * ROWS

// ==================== 体力 ====================

/** 自然恢复上限；领取补贴可突破 */
export const STAMINA_MAX = 100
/** 每 2 分钟恢复 1 点（连续恢复，不是定点回满） */
export const REGEN_MS = 2 * 60 * 1000
/** 每日补贴时段（24 表示当日 24:00，即次日 0 点） */
export const BONUS_HOURS = [12, 18, 24] as const
/** 每次补贴体力 */
export const BONUS_AMOUNT = 50
/** 点击一次恒定消耗 1 点 */
export const CLICK_COST = 1

// ==================== 背包（纯收纳箱）====================

/**
 * 背包是棋盘之外的「异次元口袋」：**纯存储、不参与合成、放进去的一切冻结**。
 *
 * ★ 与棋盘的关键分工（已决策 2026-10-02）：
 *   - **棋盘格数固定**，不做金币扩容；
 *   - **金币扩容消费全部落在背包上**（背包是唯一的格子类金币回收池）。
 *
 * 背包内的物品：不能点击产出、不走 CD、不消耗耐久；道具只能在此存放与取用。
 */
export const BAG_COLS = 5
export const BAG_ROWS = 5
export const BAG_TOTAL = BAG_COLS * BAG_ROWS
/** 初始解锁格数（前 N 格按行优先顺序可用） */
export const BAG_INITIAL_CAP = 10
/** 第 1 格扩容价（金币）。金币不可充值，所以这个数字直接决定背包的成长节奏 */
export const BAG_BASE_PRICE = 500
/** 每扩容一格，下一格涨价的倍率 */
export const BAG_PRICE_STEP = 1.18

// ==================== 蛛网障碍 ====================

/** 每 N 次产出生成一张蛛网 */
export const WEB_EVERY = 14
/** 场上蛛网上限（防止棋盘被锁死） */
export const WEB_MAX = 5
/** 第一张蛛网的金币清除价 */
export const WEB_BASE_PRICE = 20
/** 每清除一张，下次涨价 */
export const WEB_STEP = 15

// ==================== 成长 ====================

export const EXP_PER_LEVEL = 100

// ==================== 订单 ====================

/** 订单基础金币（Lv1） */
export const ORDER_BASE_GOLD = 30
/** 订单基础经验（Lv1） */
export const ORDER_BASE_EXP = 15
/** 每升一级订单奖励的指数底数 */
export const ORDER_GROWTH = 1.9
/**
 * 按链的"派系"给的奖励倍率。索引 = CHAIN_ORDER 下标。
 * 越靠后的链越难发育，因此奖励更高，制造"优先发育哪条链"的取舍。
 */
export const ORDER_CHAIN_MULT = [1, 1.45, 1.95] as const
/** 同时在手的订单数量 */
export const ORDER_SLOTS = 2

// ==================== 订单档位（文档 5.1）====================

/**
 * ★ 结构与倍率**照搬**文档 5.1（4 档 / 1× / 2.2× / 5.5× / 12×）。
 *
 * 第三批「内容扩容」把主链从 3 个普通等级加深到 **7 个**（+顶端 = Lv8），
 * 于是档位区间**回到了文档原本的形态**：
 *   文档写「普通 Lv1–3 / 进阶 Lv4–5 / 稀有 Lv6–7 / 紧急 Lv7–8」，
 *   我们把紧急收敛到 Lv7 —— 因为 Lv8 是链的顶端（母体 / 纯任务物品），不参与交付。
 *
 * 在此之前（3 级链时代）稀有与紧急都退化成 "要 Lv3"，档位只剩倒计时与倍率的差别。
 * 链加深后，"要交什么东西"重新有区分度 —— 这正是加深链路的首要目的。
 */
export interface OrderTierDef {
  key: OrderTier
  name: string
  /** 需求等级区间（实际会被各条链的深度收敛，见 logic.ts 的 tierLevelRange） */
  minLv: number
  maxLv: number
  /** 倒计时（小时） */
  hours: number
  /** 奖励倍率 */
  mult: number
  /** 玩家等级门槛 */
  needLevel: number
  /** 额外要求已解锁的区域 */
  needRegion?: RegionKey
  /** 满足条件后的抽取权重 */
  w: number
}

export const ORDER_TIERS: readonly OrderTierDef[] = [
  { key: 'normal', name: '普通', minLv: 1, maxLv: 3, hours: 8, mult: 1, needLevel: 1, w: 100 },
  { key: 'advanced', name: '进阶', minLv: 4, maxLv: 5, hours: 4, mult: 2.2, needLevel: 10, w: 55 },
  {
    key: 'rare',
    name: '稀有',
    minLv: 6,
    maxLv: 7,
    hours: 2,
    mult: 5.5,
    needLevel: 22,
    needRegion: 'training',
    w: 22,
  },
  { key: 'urgent', name: '紧急', minLv: 7, maxLv: 7, hours: 0.5, mult: 12, needLevel: 35, w: 8 },
]

const TIER_MAP: Record<string, OrderTierDef> = {}
for (const t of ORDER_TIERS) TIER_MAP[t.key] = t

export function orderTierDef(k: OrderTier): OrderTierDef {
  return TIER_MAP[k] ?? ORDER_TIERS[0]
}

/** 订单基础星星（装饰专用货币，与主经济隔离） */
export const ORDER_BASE_STAR = 3
/** 订单基础好感度（文档 5.1 原版实测值 40） */
export const ORDER_BASE_AFFINITY = 40
/** 每提升 N 级，订单奖励整体上浮 ORDER_RISE */
export const ORDER_RISE_PITCH = 5
export const ORDER_RISE = 0.2

// ==================== 好感度与常驻宠物（文档 5.2 / 07-02）====================

/** 好感满格值：约 6 个普通订单转化一只常驻宠物 */
export const AFFINITY_FULL = 240
/** 每只常驻宠物每小时的自动产出 */
export const PET_GOLD_PER_HOUR = 24
/** 每结算 N 小时，额外产 1 钻石 */
export const PET_GEM_EVERY_HOURS = 5
/** 离线累积上限（小时）。午睡区解锁后提升到 12 */
export const PET_ACCUM_MAX_HOURS = 8

// ==================== 顾客时段（文档 5.2）====================

/** 白天时段 [DAY_START, DAY_END) */
export const DAY_START = 6
export const DAY_END = 18
/** 白天狗顾客的出现率（夜间为猫的出场率） */
export const DAY_DOG_RATE = 0.65

// ==================== 特殊道具 ====================

/**
 * 能量球补的体力（**可突破上限**）。
 * 体力是本作真正的限速项 —— 设施走冷却、链路走合成，但每一步点击都要体力。
 * 所以"直接补体力"是最贵的那种道具，用它换一次冲刺是划算且直觉明确的。
 */
export const ORB_STAMINA = 50

// ==================== 每日补给（手动型发射器）====================

/**
 * 每日免费领的设施等级（对应设施链的等级）。
 *
 * 这是设计文档 4.2 里「手动型发射器」的落地形态：原版是"点击放出猫/狗、每日免费领 1 个"，
 * 我们把它映射成**每日免费领 1 个玩具架** —— 理由是两个：
 *   ① 设施链已经存在，不需要为"猫/狗"再造一套物品与合成规则；
 *   ② 它给玩家一条**不依赖豪华礼盒转化**的设施获取途径，避免设施数量完全被运气锁死。
 * 领取是玩家主动点的（不是自动到账），所以归在"手动型"。
 */
export const DAILY_FAC_LEVEL = 1

// ==================== 自动型发射器 ====================

/**
 * 自动型的离线累积上限。
 *
 * ★ 自动型**不消耗体力**，所以它是唯一能绕过"体力是限速项"这条规则的产出方式 ——
 * 必须用上限把它压住，否则挂机收益会盖过核心循环。
 * 上限给得很低（约 3–4 分钟的量），定位是"回来收菜"的惊喜，而不是挂机引擎。
 */
export const AUTO_ACCUM_MAX = 8

// ==================== 商城 ====================

/**
 * 商城的**货物刷新时段**（与每日体力补贴的 BONUS_HOURS 同一套节奏）。
 * 设计文档 1.3 写「商城 6:00 / 12:00 / 18:00 / 24:00 刷新货物」——
 * 实现上用它作为**限购计数器的重置点**：跨过一个时段，钻石类商品的当日次数就清零。
 */
export const SHOP_REFRESH_HOURS = [6, 12, 18, 24] as const

/**
 * 金币商品的**每日限购上限**。
 *
 * 设计文档 9.2 明确：破解版取消全部每日次数限制，**金币类商品取消限购没有平衡风险**
 * （金币仍受玩法产出约束），所以这里金币商品一律不限购。
 */
export const SHOP_GOLD_DAILY_LIMIT = null as number | null

// ==================== 模拟充值 / 付费内容（设计文档 10 章）====================

/** 会员卡：体力上限加成（一律经由 staminaMax() 生效，不要直接读常量） */
export const VIP_STAMINA_BONUS = 50
/** 会员每日福利：钻石 */
export const VIP_DAILY_GEM = 50
/** 会员每日福利：体力（可突破上限） */
export const VIP_DAILY_STAMINA = 100
/** 会员卡价格（钻石）与有效期（天）；续期 = 到期时间往后叠加 */
export const VIP_PRICE = 300
export const VIP_DAYS = 30

/** 成长基金价格（钻石） */
export const FUND_PRICE = 888
/** 成长基金每 5 级返还的钻石 */
export const FUND_PER_CLAIM = 200
/** 成长基金最多返还次数（Lv5 → Lv50，共 10 次，总返 2000） */
export const FUND_MAX_CLAIMS = 10

/** 抽奖机：单抽 / 十连价格（十连 = 9 折） */
export const LUCKY_SINGLE = 50
export const LUCKY_TEN = 450
/** 保底窗口：距上次"稀有及以上"累计 10 抽，下一抽必出稀有 */
export const LUCKY_PITY = 10
/** 抽到造型（视为重复，造型系统在 M3）→ 自动转换的钻石 */
export const LUCKY_SKIN_TO_GEM = 120
/** 抽到稀有装饰（视为重复，装饰摆放系统在 M3）→ 自动转换的钻石 */
export const LUCKY_DECOR_TO_GEM = 40

// ==================== 表现层 ====================

/**
 * 屏幕震动振幅（px）。全项目唯一值，所有合成与升级完全一致，不做分级、不做递增。
 * 改成 0 即全局关闭屏幕震动（粒子与触觉反馈不受影响）。
 *
 * 注意：震的是整个 #app，眼睛会跟整帧走，整屏位移的感知强度远高于同振幅的局部动画，
 * 所以这个值必须压得很低。
 */
export const SHAKE_AMP = 1.0

// ==================== 存档 ====================

export const SAVE_KEY = 'pawpark_save'
/** 存档结构版本。结构变更时递增，旧版存档会被丢弃（除非写了迁移） */
export const SAVE_VERSION = 1
