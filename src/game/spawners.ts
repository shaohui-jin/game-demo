import type { Drop } from './types'

/**
 * 主要发射器（原版术语）——"只有 CD，不消失、不降级，开局自带"。
 * 与次级发射器（母体 / 链中段发射器）行为完全不同：后者有耐久、用完即消失。
 *
 * CD 是节奏阀：它决定"单位时间内能产出多少"，也是玩家"回来看看"的理由。
 *
 * 两个发射器刻意做成差异化，制造真实取舍 —— 这是"资源分配决策"落到最外层的体现：
 *   玩具架：快（4s）、礼包率低  → 稳定喂材料，适合推进合成链
 *   玩具箱：慢（10s）、礼包率高 → 单次价值高，适合攒货币
 * 玩家需要在两条线之间分配"等待时间"，而不是无脑点同一个按钮。
 */
export interface MainSpawner {
  id: string
  name: string
  emoji: string
  /** 冷却时长（毫秒） */
  cd: number
  drops: Drop[]
}

export const MAIN_SPAWNERS: MainSpawner[] = [
  {
    id: 'rack',
    name: '玩具架',
    emoji: '🧺',
    cd: 4000,
    drops: [
      { type: 'item', chain: 'toy', level: 1, w: 88 },
      { type: 'item', chain: 'supply', level: 1, w: 12 },
    ],
  },
  {
    id: 'chest',
    name: '玩具箱',
    emoji: '🧰',
    cd: 10000,
    drops: [
      { type: 'item', chain: 'toy', level: 1, w: 62 },
      { type: 'item', chain: 'supply', level: 1, w: 38 },
    ],
  },
]
