/**
 * 《爪爪乐园》核心类型定义
 *
 * 设计约束（来自 P0 原型的踩坑记录，务必遵守）：
 *  1. 掉落项用判别联合（type 字段），而不是 `{c,l,w}` / `{gold:[a,b],w}` 这类隐式结构。
 *     P0 里掉落表在 producer 上挂在 click.drops、在 generator 上挂在 drops，
 *     结果 produce() 直接读 d.drops 就崩了。判别联合 + 收窄可以让这类错误在编译期暴露。
 *  2. ResolvedDef 统一 generator 与 producer 的字段（都用 maxCharges / drops），
 *     两者在行为上只差"是否出现在链中段、能否继续合成"，不应有两套字段形状。
 */

/**
 * 合成链标识。
 *
 * `fac` 是**设施链**（玩具架 → 玩具箱）—— 它和别的链不同：
 *   - 它是**产出源头**，不在订单轮换里，开局就在棋盘上；
 *   - 它的物品**永远是"主场景常驻对象"**，可以被拖进背包、也可以两两合成升级（Lv1→Lv2）；
 *   - 它只走「储备 + 冷却」模型，储备耗尽后冷却补满，**永不消失**。
 * 把它建模成一条链而不是"另一种东西"，是为了让棋盘对象、拖拽、背包、存档、渲染
 * 全都复用同一套机制 —— 设施在系统眼里就是"一个可点击的链物品"。
 */
export type ChainKey =
  | 'fac'
  | 'toy'
  | 'care'
  | 'food'
  | 'supply'
  | 'comfort'
  | 'train'
  | 'med'
  | 'clean'
  | 'coin'

// ==================== 掉落表 ====================

/** 掉落：产出一个棋盘物品 */
export interface DropItem {
  type: 'item'
  chain: ChainKey
  level: number
  w: number
}

/** 掉落：直接产出金币（进余额，不占棋盘格） */
export interface DropGold {
  type: 'gold'
  min: number
  max: number
  w: number
}

/** 掉落：直接产出钻石（进余额，不占棋盘格） */
export interface DropGem {
  type: 'gem'
  min: number
  max: number
  w: number
}

export type Drop = DropItem | DropGold | DropGem

/** 资源型掉落（货币）—— 不占棋盘格，因此不需要预检空格 */
export type ResourceDrop = DropGold | DropGem

export function isResourceDrop(d: Drop): d is ResourceDrop {
  return d.type === 'gold' || d.type === 'gem'
}

// ==================== 点击：储备 / 冷却 / 耗尽 ====================

/**
 * 储备耗尽之后会发生什么。**这是本作链路设计的核心之一**（对标《肥鹅健身房》）：
 * 「母体点完不一定就没了」—— 有的会冷却续命，有的会变成另一样东西。
 */
export type ExhaustSpec =
  /** 直接消失（一次性物资包） */
  | { kind: 'vanish' }
  /** 转化：原地变成另一个链物品 */
  | { kind: 'convert'; to: ChainKey; level: number }

/**
 * 一次点击产出配置。**注意这里没有"每次点击的冷却"** ——
 * 节奏阀是 `buffer`（储备）+ `refillMs`（一次性冷却），不是"点一下等 X 秒"。
 */
export interface ClickSpec {
  /** 储备上限：一次冷却能补满的可点击次数 */
  buffer: number
  /**
   * 储备耗尽后的冷却毫秒。
   *  - `> 0`：**冷却型** —— 到点储备补满，主体永不消失（设施、美容台）
   *  - `0` ：不冷却，走 `exhaust` 规则（消失 / 转化）
   */
  refillMs: number
  drops: Drop[]
  /** refillMs = 0 时的耗尽行为；缺省视为 vanish */
  exhaust?: ExhaustSpec
}

/**
 * 自动型发射器：**按固定间隔自己释放，玩家不用点、也不消耗体力**。
 *
 * 它牺牲主动收益换取"离线也在跑"，是设计文档 4.2 里的第二类发射器。
 * ★ 但**必须有上限**，否则挂机收益会盖过核心循环、把体力这道限速项直接架空：
 *   所以间隔给得很长（25–30 秒），且离线最多累积 `max` 次（到点不再累积，只等你回来收）。
 */
export interface AutoSpec {
  /** 自动释放间隔（毫秒） */
  ms: number
  drops: Drop[]
  /** 离线最多累积几次；缺省用 config.AUTO_ACCUM_MAX */
  max?: number
}

/** 链上的普通等级（Lv1..N） */
export interface ChainItemDef {
  name: string
  emoji: string
  /**
   * 贴图资源键（对应 src/ui/sprites.ts）。
   * 与 emoji 并存而不是替换：贴图缺失时由 SpriteIcon 降级到 emoji，
   * 保证新加一条链但美术还没出图时不会开天窗。
   */
  sprite: string
  /** 物品底色 */
  bg: string
  /** 前景色（emoji 之外的文字） */
  fg: string
  /** 特效主色（粒子 / 光圈 / 飘字） */
  fx: string
  click?: ClickSpec
  /** 自动型：带这个字段就是"自己会跑的发射器"，与 click 互斥 */
  auto?: AutoSpec
}

/** 链的顶端——即链的终点 */
export type ChainTopDef =
  | {
      /** 母体：可点击产出下一条链，储备耗尽后按 refillMs / exhaust 处理，不可再合成 */
      kind: 'generator'
      name: string
      emoji: string
      sprite: string
      bg: string
      fg: string
      fx: string
      click: ClickSpec
    }
  | {
      /** 纯任务物品：只用于交付订单，不可合成、不可点击 */
      kind: 'final'
      name: string
      emoji: string
      sprite: string
      bg: string
      fg: string
      fx: string
    }

export interface Chain {
  key: ChainKey
  name: string
  /** Lv1..LvN */
  items: ChainItemDef[]
  /** 链的终点；为 null 表示最高等级就是 items 的末位（如设施链 / 礼包链） */
  top: ChainTopDef | null
}

// ==================== 解析后的定义 ====================

/**
 * 物品种类：
 *  - item      普通物品（只能合成）
 *  - producer  可点击且能继续合成的发射器（含设施链的玩具架 / 玩具箱 / 玩具仓库）
 *  - generator 顶端母体（可点击产出，链的终点，不可合成）
 *  - final     纯任务物品（链的终点，只能交订单）
 *  - auto      自动型发射器（自己按间隔释放，玩家不点、不耗体力）
 */
export type ItemKind = 'item' | 'producer' | 'generator' | 'final' | 'auto'

/** defOf() 的返回值。可点击的两类（producer / generator）字段刻意保持一致 */
export interface ResolvedDef {
  name: string
  emoji: string
  /** 贴图资源键 —— 渲染层优先用它，emoji 只作兜底 */
  sprite: string
  bg: string
  fg: string
  fx: string
  kind: ItemKind
  /** 仅 producer / generator：储备上限 */
  buffer?: number
  /** 仅 producer / generator：储备耗尽后的冷却毫秒（0 = 不冷却） */
  refillMs?: number
  /** 仅 producer / generator / auto：掉落表 */
  drops?: Drop[]
  /** 仅 producer / generator：refillMs = 0 时的耗尽行为 */
  exhaust?: ExhaustSpec
  /** 仅 auto：自动释放间隔（毫秒） */
  autoMs?: number
  /** 仅 auto：离线最多累积次数 */
  autoMax?: number
  /** 仅 generator：产出的下一条链 */
  produces?: ChainKey
}

/** 可点击的发射器定义（producer 或 generator） */
export interface ClickableDef extends ResolvedDef {
  kind: 'producer' | 'generator'
  buffer: number
  refillMs: number
  drops: Drop[]
}

export function isClickableDef(d: ResolvedDef | null | undefined): d is ClickableDef {
  return !!d && (d.kind === 'producer' || d.kind === 'generator')
}

/** 自己会跑的定义（自动型） */
export interface AutoDef extends ResolvedDef {
  kind: 'auto'
  autoMs: number
  drops: Drop[]
}

export function isAutoDef(d: ResolvedDef | null | undefined): d is AutoDef {
  return !!d && d.kind === 'auto' && (d.autoMs ?? 0) > 0
}

// ==================== 棋盘物品 ====================

export interface BoardItem {
  chain: ChainKey
  level: number
  /** 仅可点击发射器：剩余储备。普通物品 / 自动型不带此字段 */
  charges?: number
  /**
   * 仅可点击发射器：**冷却结束时间戳**（0 / 缺省 = 没在冷却）。
   * 储备 > 0 时这个值恒为 0；储备归零且 refillMs > 0 时才被置上。
   */
  cdAt?: number
  /**
   * 仅可点击发射器：**被挂起的剩余冷却毫秒**。
   * 物品放进背包时把剩余冷却存到这里、cdAt 清零（背包内一切冻结、冷却不走）；
   * 取出时再换算回 cdAt。没有这个字段的话，把正在冷却的设施丢进背包再拿出来
   * 会**白拿一次补满** —— 背包就成了跳过冷却的漏洞。
   */
  cdLeft?: number
  /**
   * 仅自动型：**上一次自动释放的时间戳**。
   * 离线时长靠它算"攒了几次"，并有累积上限（见 AutoSpec.max）。
   * 离线累积到达上限后，这个值会被推到"现在"—— 超出部分彻底作废，不再无限累积。
   */
  lastAutoAt?: number
}

/** 棋盘坐标（一维索引，配合 COLS 换算行列） */
export type CellIndex = number

// ==================== 特殊道具 ====================

/**
 * 特殊道具标识。
 * 与合成链物品的**本质差别**：道具不入链、不合成、**可堆叠带数量**、只能作用于别的物品。
 * 后续新增道具只需在这里加一个 key，再到 tools.ts 补定义。
 */
export type ToolKey =
  | 'scissors'
  | 'upgradeCard'
  | 'charger'
  | 'hourglass'
  | 'orb'
  | 'orbGreen'
  | 'orbPurple'
  | 'infinite'

/** 背包里的一叠特殊道具 */
export interface ToolStack {
  tool: ToolKey
  count: number
}

// ==================== 背包 ====================

/**
 * 背包槽位内容。
 *
 * 刻意用判别联合，而不是给 BoardItem 多挂一个可空字段：
 * 道具与物品的行为完全不同（不合成 / 可堆叠 / 只能作用于他人），
 * 混成同一个形状会逼着每个用到的地方都写一遍 `if (isTool)`。
 */
export type BagSlot = { k: 'item'; it: BoardItem } | { k: 'tool'; st: ToolStack } | null

/** 棋盘与背包共用「区域」概念，拖拽与落点判定需要 */
export type Zone = 'board' | 'bag'

// ==================== 经营层：顾客 / 区域 / 装饰 ====================

/** 顾客阵营。节目时段决定哪一派出场更多（白天狗多、夜间猫多） */
export type Camp = 'cat' | 'dog'

/** 顾客标识（对应 business.ts 的 CUSTOMERS 表） */
export type CustomerKey = string

/** 区域标识（对应 business.ts 的 REGIONS 表，顺序即解锁顺序） */
export type RegionKey =
  | 'lobby'
  | 'grooming'
  | 'play'
  | 'diner'
  | 'training'
  | 'nap'
  | 'pool'
  | 'clinic'
  | 'studio'

/** 装饰标识（对应 business.ts 的 DECORS 表） */
export type DecorKey = string

/**
 * 订单档位。
 *
 * ★ 与设计文档的差异（有意为之）：文档 5.1 的档位表按 **8 级链**写（需求 Lv1–Lv8），
 * 本项目现有链只有 3–4 个普通等级 + 1 个顶端，所以**结构与倍率照搬（4 档 / 1 / 2.2 / 5.5 / 12×），
 * 等级区间压缩**到现有深度。等合成链扩到 8 级时，只需改 config.ts 里的区间，不用动结构。
 */
export type OrderTier = 'normal' | 'advanced' | 'rare' | 'urgent'

// ==================== 订单 ====================

export interface Order {
  id: string
  chain: ChainKey
  level: number
  gold: number
  exp: number
  /** 档位 */
  tier: OrderTier
  /** 发单顾客（决定好感度记在谁头上） */
  customer: CustomerKey
  /** 星星奖励（装饰专用货币） */
  stars: number
  /** 顾客好感奖励 */
  affinity: number
  /** 失效时间戳。过期由 store 的每秒 tick 重抽，不需要玩家操作 */
  expireAt: number
}
