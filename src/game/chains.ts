import type { Chain, ChainKey } from './types'

/**
 * 合成链定义 —— 游戏的玩法事实来源。
 *
 * 三条铁律（来自《肥鹅健身房》机制拆解，见 docs/肥鹅健身房-玩法机制拆解.html）：
 *  ① 链的终点只有两种：母体（generator，可点击产出下一条链）或纯任务物品（final，只交订单）。
 *     两者都 **不可再合成**。
 *  ② 发射器 **可以出现在链的中段**（items[i].click 即 producer）——既能点击产出，又能继续往上合。
 *     这是「甲·重置为满」得以成立的前提，每条链都应刻意留至少一个中段发射器。
 *  ③ 母体耐久耗尽即消失，本质是"一次性物资包"，需要重新从基础发射器发育。
 */
export const CHAINS: Record<ChainKey, Chain> = {
  toy: {
    key: 'toy',
    name: '玩具链',
    items: [
      { name: '毛线球', emoji: '🧶', bg: '#FBEAF0', fg: '#72243E', fx: '#D4537E' },
      { name: '逗猫棒', emoji: '🎣', bg: '#F4C0D1', fg: '#72243E', fx: '#D4537E' },
      { name: '铃铛球', emoji: '🔔', bg: '#ED93B1', fg: '#4B1528', fx: '#D4537E' },
    ],
    top: {
      kind: 'generator',
      name: '猫城堡',
      emoji: '🏰',
      bg: '#993556',
      fg: '#FFFFFF',
      fx: '#993556',
      charges: 8,
      drops: [
        { type: 'item', chain: 'care', level: 1, w: 82 },
        { type: 'item', chain: 'care', level: 2, w: 15 },
        { type: 'item', chain: 'care', level: 3, w: 3 },
      ],
    },
  },

  care: {
    key: 'care',
    name: '护理链',
    items: [
      { name: '梳毛刷', emoji: '🪮', bg: '#E1F5EE', fg: '#04342C', fx: '#1D9E75' },
      { name: '指甲剪', emoji: '✂️', bg: '#9FE1CB', fg: '#04342C', fx: '#1D9E75' },
      { name: '洗澡球', emoji: '🛁', bg: '#5DCAA5', fg: '#04342C', fx: '#0F6E56' },
    ],
    top: {
      kind: 'generator',
      name: '美容台',
      emoji: '💈',
      bg: '#1D9E75',
      fg: '#FFFFFF',
      fx: '#0F6E56',
      charges: 8,
      drops: [
        { type: 'item', chain: 'food', level: 1, w: 82 },
        { type: 'item', chain: 'food', level: 2, w: 15 },
        { type: 'item', chain: 'food', level: 3, w: 3 },
      ],
    },
  },

  food: {
    key: 'food',
    name: '食物链',
    items: [
      { name: '猫罐头', emoji: '🥫', bg: '#FAEEDA', fg: '#412402', fx: '#BA7517' },
      { name: '冻干块', emoji: '🍖', bg: '#FAC775', fg: '#412402', fx: '#BA7517' },
      { name: '鲜鱼排', emoji: '🐟', bg: '#EF9F27', fg: '#412402', fx: '#854F0B' },
    ],
    top: {
      kind: 'final',
      name: '豪华鲜食',
      emoji: '🍱',
      bg: '#BA7517',
      fg: '#FFFFFF',
      fx: '#854F0B',
    },
  },

  /**
   * 礼包链：专门承载「甲 · 重置为满」的规则。
   * 两级都是中段发射器（可点击、可合并），没有顶端 —— Lv2 就是链的终点。
   * 它把"点击发射器"直接接到货币体系上，让玩家在体力分配之外多一层
   * "点货币还是点材料"的取舍。
   */
  supply: {
    key: 'supply',
    name: '礼包链',
    items: [
      {
        name: '伴手礼',
        emoji: '🎁',
        bg: '#E6F1FB',
        fg: '#042C53',
        fx: '#378ADD',
        click: {
          charges: 8,
          drops: [{ type: 'gold', min: 15, max: 40, w: 100 }],
        },
      },
      {
        name: '豪华礼盒',
        emoji: '🎀',
        bg: '#B5D4F4',
        fg: '#042C53',
        fx: '#185FA5',
        click: {
          charges: 18,
          drops: [
            { type: 'gold', min: 40, max: 110, w: 92 },
            { type: 'gem', min: 1, max: 1, w: 8 },
          ],
        },
      },
    ],
    top: null,
  },
}

/** 会出现在订单里的链。礼包链是产出工具，不作为交付物 */
export const CHAIN_ORDER: ChainKey[] = ['toy', 'care', 'food']

/** 链树面板的展示顺序 */
export const TREE_ORDER: ChainKey[] = ['toy', 'care', 'supply', 'food']
