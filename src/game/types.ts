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

/** 合成链标识 */
export type ChainKey = 'toy' | 'care' | 'food' | 'supply'

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

// ==================== 链定义 ====================

/** 发射器的一次点击配置（用于链中段的 producer） */
export interface ClickSpec {
  /** 满耐久（可点击次数） */
  charges: number
  drops: Drop[]
}

/** 链上的普通等级（Lv1..N）。带 click 的即为「链中段发射器」 */
export interface ChainItemDef {
  name: string
  emoji: string
  /** 物品底色 */
  bg: string
  /** 前景色（emoji 之外的文字） */
  fg: string
  /** 特效主色（粒子 / 光圈 / 飘字） */
  fx: string
  click?: ClickSpec
}

/** 链的顶端——即链的终点 */
export type ChainTopDef =
  | {
      /** 母体：可点击产出下一条链，耐久耗尽即消失，不可再合成 */
      kind: 'generator'
      name: string
      emoji: string
      bg: string
      fg: string
      fx: string
      charges: number
      drops: Drop[]
    }
  | {
      /** 纯任务物品：只用于交付订单，不可合成、不可点击 */
      kind: 'final'
      name: string
      emoji: string
      bg: string
      fg: string
      fx: string
    }

export interface Chain {
  key: ChainKey
  name: string
  /** Lv1..LvN */
  items: ChainItemDef[]
  /** 链的终点；为 null 表示最高等级就是 items 的末位（如礼包链） */
  top: ChainTopDef | null
}

// ==================== 解析后的定义 ====================

/**
 * 物品种类：
 *  - item      普通物品（只能合成）
 *  - producer  链中段发射器（可点击产出，且能继续合成）
 *  - generator 顶端母体（可点击产出，链的终点，不可合成）
 *  - final     纯任务物品（链的终点，只能交订单）
 */
export type ItemKind = 'item' | 'producer' | 'generator' | 'final'

/** defOf() 的返回值。generator 与 producer 的字段结构刻意保持一致 */
export interface ResolvedDef {
  name: string
  emoji: string
  bg: string
  fg: string
  fx: string
  kind: ItemKind
  /** 仅 producer / generator：满耐久 */
  maxCharges?: number
  /** 仅 producer / generator：掉落表 */
  drops?: Drop[]
  /** 仅 generator：产出的下一条链 */
  produces?: ChainKey
}

/** 可点击的发射器定义（producer 或 generator） */
export interface ClickableDef extends ResolvedDef {
  kind: 'producer' | 'generator'
  maxCharges: number
  drops: Drop[]
}

export function isClickableDef(d: ResolvedDef | null | undefined): d is ClickableDef {
  return !!d && (d.kind === 'producer' || d.kind === 'generator')
}

// ==================== 棋盘物品 ====================

export interface BoardItem {
  chain: ChainKey
  level: number
  /** 仅可点击发射器：剩余耐久。普通物品不带此字段 */
  charges?: number
}

/** 棋盘坐标（一维索引，配合 COLS 换算行列） */
export type CellIndex = number

// ==================== 订单 ====================

export interface Order {
  id: string
  chain: ChainKey
  level: number
  gold: number
  exp: number
}
