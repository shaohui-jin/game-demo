/**
 * 特殊道具定义。
 *
 * 与合成链物品的三条硬差别（写代码时别混）：
 *   ① **不入链**：没有等级，不参与二合一，`defOf()` 查不到它们；
 *   ② **可堆叠**：同一种道具占一格、右下角显示数量 xN（对应参考截图里的 x1）；
 *   ③ **只作用于他人**：道具本身不能被合成，只能对棋盘上的物品使用。
 *
 * 背包里要靠 `ToolStack.tool` 反查这里的定义来渲染，所以每个 key 都必须有定义。
 */

import type { ToolKey, ToolStack } from './types'

export interface ToolDef {
  key: ToolKey
  name: string
  emoji: string
  /** 贴图资源键（src/assets/sprites/tools/*） */
  sprite: string
  bg: string
  fg: string
  /** 特效主色（粒子 / 飘字） */
  fx: string
  /** 一句话作用说明，用于详情与使用提示 */
  desc: string
  /**
   * 使用方式：
   *  - `item`：**需要目标**。点背包里的它 → 进入"待用态" → 再点棋盘上的物品生效。
   *  - `none`：**直接生效**。点背包里的它立刻结算（作用范围是全盘或玩家自己，不需要指目标）。
   * 这个区分是必须的：让"加速沙漏"去点一个格子会很荒谬 —— 它要清的是全盘冷却。
   */
  target: 'item' | 'none'
}

export const TOOLS: Record<ToolKey, ToolDef> = {
  scissors: {
    key: 'scissors',
    name: '剪刀',
    emoji: '✂️',
    sprite: 'tool-scissors',
    bg: '#FFE3EE',
    fg: '#72243E',
    fx: '#E4517F',
    desc: '把一个 Lv2 及以上的物品拆成两个低一级的',
    target: 'item',
  },
  upgradeCard: {
    key: 'upgradeCard',
    name: '升级卡',
    emoji: '🎟️',
    sprite: 'tool-card',
    bg: '#E4F0FD',
    fg: '#042C53',
    fx: '#4A8FE3',
    desc: '把一个物品直接升一级（不超过该链顶端）',
    target: 'item',
  },
  charger: {
    key: 'charger',
    name: '充能器',
    emoji: '🔋',
    sprite: 'tool-charger',
    bg: '#DDF7EC',
    fg: '#04342C',
    fx: '#22A87E',
    desc: '立刻补满一个发射器的储备，并结束它的冷却',
    target: 'item',
  },
  hourglass: {
    key: 'hourglass',
    name: '加速沙漏',
    emoji: '⏳',
    sprite: 'tool-hourglass',
    bg: '#FAEEDA',
    fg: '#412402',
    fx: '#BA7517',
    desc: '立刻结束棋盘上所有设施的冷却，并补满储备',
    target: 'none',
  },
  orb: {
    key: 'orb',
    name: '能量球',
    emoji: '⚡',
    sprite: 'tool-orb',
    bg: '#EEEDFE',
    fg: '#26215C',
    fx: '#7F77DD',
    desc: '立刻恢复 50 点体力（可以超过上限）',
    target: 'none',
  },
}

/** 商店 / 背包的展示顺序（按"使用频率 × 直觉强度"排） */
export const TOOL_ORDER: ToolKey[] = ['scissors', 'upgradeCard', 'charger', 'hourglass', 'orb']

/** 四种基础道具的贴图颜色家族不同，方便一眼分辨（用于图鉴/商店未来的分组展示） */
export const TOOL_FAMILY: Record<ToolKey, 'usage' | 'boost'> = {
  scissors: 'usage',
  upgradeCard: 'usage',
  charger: 'usage',
  hourglass: 'boost',
  orb: 'boost',
}

export function toolDef(key: ToolKey): ToolDef {
  // 未知 key（例如旧存档里的孤儿道具）返回兜底定义，绝不抛错 —— 同 defOf 的铁律
  return (
    TOOLS[key] ?? {
      key,
      name: '未知道具',
      emoji: '❔',
      sprite: '',
      bg: '#F1EFE8',
      fg: '#5F5E5A',
      fx: '#888780',
      desc: '',
      target: 'item',
    }
  )
}

/** 类型守卫：背包槽位里装的是不是一叠道具 */
export function isToolSlot(v: unknown): v is { k: 'tool'; st: ToolStack } {
  return !!v && typeof v === 'object' && (v as { k?: unknown }).k === 'tool'
}
