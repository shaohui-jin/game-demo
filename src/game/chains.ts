import type { Chain, ChainKey } from './types'

/**
 * 合成链定义 —— 游戏的玩法事实来源。
 *
 * 六条铁律（来自《肥鹅健身房》机制拆解，见 docs/肥鹅健身房-玩法机制拆解.html）：
 *
 *  ① **链路要能被一眼看懂**。图鉴（ChainTreeModal）直接读这张表绘制，
 *     所以每条链的每个等级都必须有名字、贴图与明确的"点击会发生什么"。
 *
 *  ② **点击节奏阀是「储备 + 一次性冷却」，不是"每点一次冷却一次"**。
 *     `buffer` = 一次冷却能补满的可点击次数；`refillMs` = 储备耗尽后的冷却时长。
 *     点第 1 次就开始转圈是错的 —— 玩家应该能连续释放完储备，再去干别的。
 *
 *  ③ **母体/发射器的储备耗尽后，行为分三类**（`refillMs` + `exhaust`）：
 *     - **冷却型**（`refillMs > 0`）：到点补满储备，主体**永不消失**。
 *     - **转化型**（`refillMs = 0` + `exhaust.convert`）：原地变成另一样东西。
 *     - **消失型**（`refillMs = 0` + 无 exhaust）：一次性物资包，用完就没了。
 *
 *  ④ 链的终点只有两种：母体（`generator`，可点击、不可再合成）或
 *     纯任务物品（`final`，只交订单、不可点击）。设施链与礼包链**没有终点**，末位即链尾。
 *
 *  ⑤ **设施链 `fac` 不在订单轮换里**（见 CHAIN_ORDER）。它是产出源头，不是交付物。
 *
 *  ⑥ ★ **每条链都要有"中段发射器"（带 click 的普通等级），而且要在多个等级上留**。
 *     这是「甲·重置为满」得以成立的前提：玩家发现"点剩最后一次再合成 → 储备回满 →
 *     之前点掉的次数白赚"，于是"什么时候停手"变成有正收益的取舍。
 *     本项目在 Lv3 与 Lv6 各留一个（两条链则各留一个）。
 *
 * ★ 链深度（2026-10-02 第三批「内容扩容」）：
 *     toy / care / food = **7 个普通等级 + 1 顶端 = Lv8**
 *     supply            = **4 级**（无顶端）
 *     fac               = **3 级**（无顶端）
 *   加深链路不只是"多几个名字"——它同时修掉两个结构问题：
 *     ① 订单档位重新有区分度（稀疏/紧急不再都退化成同一个等级）；
 *     ② "优先发育哪条链"这个取舍才真正存在。
 *   配套改动：**设施的掉落表必须产出更高等级的产物**，否则 Lv8 需要 128 个 Lv1，
 *   加速比会陡到把游戏变成"等得难受"。见 fac 链的注释。
 *
 * ★ 视觉：`sprite` 是贴图资源键（对应 src/ui/sprites.ts），`emoji` 保留为兜底。
 *   新加的等级也已经配好贴图（`toy-4` … `toy-7`），避免同一块棋盘上出现"贴图 + emoji"混排。
 */
export const CHAINS: Record<ChainKey, Chain> = {
  /**
   * 设施链：**产出源头**，三级递进。
   *
   * ★ 掉落表随等级上移是关键设计，不是顺手加的：
   *   玩具架只产 Lv1、玩具箱只产 Lv1，那 Lv8 就要 128 次点击 —— 一条链的加速比会陡到不可玩。
   *   让高等级设施**掺着产出更高级的产物**，等效产出率就随设施升级一起涨：
   *     玩具架   8 储备 / 60s   → 平均 1.10 级/次
   *     玩具箱  12 储备 / 90s   → 平均 1.40 级/次
   *     玩具仓库 16 储备 / 120s → 平均 2.35 级/次
   *   三个都摆上时约 39 级/分钟，一个 Lv8 约 3 分钟纯点击 —— 体力（100 + 三档补贴 150/天）
   *   仍然是真正的限速项，但不再是"点了半小时还在 Lv4"的挫败感。
   */
  fac: {
    key: 'fac',
    name: '设施链',
    items: [
      {
        name: '玩具架',
        emoji: '🧺',
        sprite: 'spawn-rack',
        bg: '#FFE9D6',
        fg: '#4A2513',
        fx: '#E08A3C',
        click: {
          buffer: 8,
          refillMs: 60_000,
          drops: [
            { type: 'item', chain: 'toy', level: 1, w: 90 },
            { type: 'item', chain: 'toy', level: 2, w: 10 },
          ],
        },
      },
      {
        name: '玩具箱',
        emoji: '🧰',
        sprite: 'spawn-chest',
        bg: '#F7C9A4',
        fg: '#43200F',
        fx: '#C96F26',
        click: {
          buffer: 12,
          refillMs: 90_000,
          drops: [
            { type: 'item', chain: 'toy', level: 1, w: 65 },
            { type: 'item', chain: 'toy', level: 2, w: 30 },
            { type: 'item', chain: 'toy', level: 3, w: 5 },
          ],
        },
      },
      {
        name: '玩具仓库',
        emoji: '🏚️',
        sprite: 'spawn-depot',
        bg: '#E3A874',
        fg: '#3A1B0A',
        fx: '#A85B18',
        click: {
          buffer: 16,
          refillMs: 120_000,
          drops: [
            { type: 'item', chain: 'toy', level: 2, w: 70 },
            { type: 'item', chain: 'toy', level: 3, w: 25 },
            { type: 'item', chain: 'toy', level: 4, w: 5 },
          ],
        },
      },
      /**
       * ★ 自动型（Lv4 / Lv5）：从这一级开始，设施**不再需要点击** ——
       *   它们按固定间隔自己释放，玩家不点、也不消耗体力。
       *
       *   这是设计文档 4.2 的「自动型」：给被动收益，也是"回来看看"的理由。
       *   但它**不消耗体力**，所以必须用「间隔长 + 离线累积上限」把它压住，
       *   否则挂机收益会盖过核心循环、把体力这道限速项直接架空。
       *   数值上看：30 秒 1 个、最多攒 8 个 ≈ 每小时最多 120 个 —— 而点击型
       *   在体力允许下每分钟就能出 8 个，自动型只占很小的份额。
       */
      {
        name: '逗猫转盘',
        emoji: '🎠',
        sprite: 'spawn-carousel',
        bg: '#D08C3E',
        fg: '#2E1504',
        fx: '#9C5412',
        auto: {
          ms: 30_000,
          max: 8,
          drops: [{ type: 'item', chain: 'toy', level: 1, w: 100 }],
        },
      },
      {
        name: '自动喂食器',
        emoji: '⏰',
        sprite: 'spawn-feeder',
        bg: '#C0741F',
        fg: '#FFFFFF',
        fx: '#8F5508',
        auto: {
          ms: 25_000,
          max: 8,
          drops: [{ type: 'item', chain: 'food', level: 1, w: 100 }],
        },
      },
    ],
    top: null,
  },

  toy: {
    key: 'toy',
    name: '玩具链',
    items: [
      { name: '毛线球', emoji: '🧶', sprite: 'toy-1', bg: '#FFE3EE', fg: '#72243E', fx: '#E4517F' },
      { name: '逗猫棒', emoji: '🎣', sprite: 'toy-2', bg: '#FBC0D8', fg: '#5C1A32', fx: '#E4517F' },
      {
        name: '铃铛球',
        emoji: '🔔',
        sprite: 'toy-3',
        bg: '#F49CBE',
        fg: '#4B1528',
        fx: '#E4517F',
        // 消失型：第一个中段物资包（Lv3）
        click: {
          buffer: 5,
          refillMs: 0,
          drops: [
            { type: 'item', chain: 'toy', level: 1, w: 70 },
            { type: 'item', chain: 'toy', level: 2, w: 30 },
          ],
        },
      },
      { name: '猫抓板', emoji: '🪵', sprite: 'toy-4', bg: '#EE7FA6', fg: '#3F0F1F', fx: '#D4537E' },
      { name: '猫爬架', emoji: '🗼', sprite: 'toy-5', bg: '#DE5F8C', fg: '#FFFFFF', fx: '#C4436F' },
      {
        name: '猫隧道',
        emoji: '🌀',
        sprite: 'toy-6',
        bg: '#CB4A78',
        fg: '#FFFFFF',
        fx: '#B03A65',
        // 第二个中段物资包（Lv6）—— 产出中段产物，缩短顶端的距离
        click: {
          buffer: 6,
          refillMs: 0,
          drops: [
            { type: 'item', chain: 'toy', level: 3, w: 55 },
            { type: 'item', chain: 'toy', level: 4, w: 35 },
            { type: 'item', chain: 'toy', level: 5, w: 10 },
          ],
        },
      },
      { name: '猫游乐场', emoji: '🎡', sprite: 'toy-7', bg: '#B44067', fg: '#FFFFFF', fx: '#9C3355' },
    ],
    top: {
      kind: 'generator',
      name: '猫城堡',
      emoji: '🏰',
      sprite: 'gen-fort',
      bg: '#8E2A4E',
      fg: '#FFFFFF',
      fx: '#8E2A4E',
      // 转化型：放完 care 线的物料后变成「伴手礼」，玩家顺势接入礼包链
      click: {
        buffer: 6,
        refillMs: 0,
        drops: [
          { type: 'item', chain: 'care', level: 1, w: 70 },
          { type: 'item', chain: 'care', level: 2, w: 22 },
          { type: 'item', chain: 'care', level: 3, w: 8 },
        ],
        exhaust: { kind: 'convert', to: 'supply', level: 1 },
      },
    },
  },

  care: {
    key: 'care',
    name: '护理链',
    items: [
      { name: '梳毛刷', emoji: '🪮', sprite: 'care-1', bg: '#DDF7EC', fg: '#04342C', fx: '#22A87E' },
      { name: '指甲剪', emoji: '✂️', sprite: 'care-2', bg: '#A9E8CE', fg: '#04342C', fx: '#22A87E' },
      {
        name: '洗澡球',
        emoji: '🛁',
        sprite: 'care-3',
        bg: '#6BD3AC',
        fg: '#04342C',
        fx: '#0E7355',
        click: {
          buffer: 5,
          refillMs: 0,
          drops: [
            { type: 'item', chain: 'care', level: 1, w: 70 },
            { type: 'item', chain: 'care', level: 2, w: 30 },
          ],
        },
      },
      { name: '吹风机', emoji: '💨', sprite: 'care-4', bg: '#43C398', fg: '#04342C', fx: '#0E7355' },
      { name: '烘干箱', emoji: '♨️', sprite: 'care-5', bg: '#2FB086', fg: '#FFFFFF', fx: '#0E7355' },
      {
        name: '美容套装',
        emoji: '🧴',
        sprite: 'care-6',
        bg: '#256F58',
        fg: '#FFFFFF',
        fx: '#1B5B47',
        click: {
          buffer: 6,
          refillMs: 0,
          drops: [
            { type: 'item', chain: 'care', level: 3, w: 55 },
            { type: 'item', chain: 'care', level: 4, w: 35 },
            { type: 'item', chain: 'care', level: 5, w: 10 },
          ],
        },
      },
      { name: '猫 SPA 仪', emoji: '🛀', sprite: 'care-7', bg: '#1FA87C', fg: '#FFFFFF', fx: '#0E7355' },
    ],
    top: {
      kind: 'generator',
      name: '美容台',
      emoji: '💈',
      sprite: 'gen-groom',
      bg: '#14735A',
      fg: '#FFFFFF',
      fx: '#0E7355',
      // 冷却型：储备 8，耗尽后冷却 2 分钟补满 —— 一条永久运转的食物线
      click: {
        buffer: 8,
        refillMs: 120_000,
        drops: [
          { type: 'item', chain: 'food', level: 1, w: 70 },
          { type: 'item', chain: 'food', level: 2, w: 22 },
          { type: 'item', chain: 'food', level: 3, w: 8 },
        ],
      },
    },
  },

  food: {
    key: 'food',
    name: '食物链',
    items: [
      { name: '猫罐头', emoji: '🥫', sprite: 'food-1', bg: '#FFF0D2', fg: '#412402', fx: '#D98A16' },
      { name: '冻干块', emoji: '🍖', sprite: 'food-2', bg: '#FCD48C', fg: '#412402', fx: '#D98A16' },
      {
        name: '鲜鱼排',
        emoji: '🐟',
        sprite: 'food-3',
        bg: '#F5AC3C',
        fg: '#412402',
        fx: '#A96D12',
        click: {
          buffer: 5,
          refillMs: 0,
          drops: [
            { type: 'item', chain: 'food', level: 1, w: 70 },
            { type: 'item', chain: 'food', level: 2, w: 30 },
          ],
        },
      },
      { name: '小鱼干', emoji: '🐠', sprite: 'food-4', bg: '#EE9520', fg: '#3A2101', fx: '#A96D12' },
      { name: '三文鱼', emoji: '🍣', sprite: 'food-5', bg: '#D98A16', fg: '#FFFFFF', fx: '#A96D12' },
      {
        name: '猫零食塔',
        emoji: '🍢',
        sprite: 'food-6',
        bg: '#B06A0C',
        fg: '#FFFFFF',
        fx: '#8F5508',
        click: {
          buffer: 6,
          refillMs: 0,
          drops: [
            { type: 'item', chain: 'food', level: 3, w: 55 },
            { type: 'item', chain: 'food', level: 4, w: 35 },
            { type: 'item', chain: 'food', level: 5, w: 10 },
          ],
        },
      },
      { name: '猫盛宴', emoji: '🍽️', sprite: 'food-7', bg: '#94560A', fg: '#FFFFFF', fx: '#7A4607' },
    ],
    top: {
      kind: 'final',
      name: '豪华鲜食',
      emoji: '🍱',
      sprite: 'fin-meal',
      bg: '#6E3405',
      fg: '#FFFFFF',
      fx: '#5A2A04',
    },
  },

  /**
   * 礼包链：四级都是可点击发射器（可点击、可合并），没有顶端 —— Lv4 就是链尾。
   * 它把"点击"直接接到货币体系上，让玩家在体力分配之外多一层
   * "点货币还是点材料"的取舍。
   *
   * ★ 它也是「转化型」的落点与起点：
   *   猫城堡 →（转化）伴手礼 → 一路合成到豪华礼盒 →（转化）玩具架，形成可循环的闭环。
   *   越往上级，单次点击的货币收益越高，且概率附带钻石 —— 这是"攒体力开一波"的爽点。
   */
  supply: {
    key: 'supply',
    name: '礼包链',
    items: [
      {
        name: '伴手礼',
        emoji: '🎁',
        sprite: 'supply-1',
        bg: '#E4F0FD',
        fg: '#042C53',
        fx: '#4A8FE3',
        click: {
          buffer: 8,
          refillMs: 0,
          drops: [{ type: 'gold', min: 15, max: 40, w: 100 }],
        },
      },
      {
        name: '小礼盒',
        emoji: '🎀',
        sprite: 'supply-2',
        bg: '#C9E1FA',
        fg: '#042C53',
        fx: '#4A8FE3',
        click: {
          buffer: 12,
          refillMs: 0,
          drops: [
            { type: 'gold', min: 30, max: 70, w: 94 },
            { type: 'gem', min: 1, max: 1, w: 6 },
          ],
        },
      },
      {
        name: '大礼盒',
        emoji: '📦',
        sprite: 'supply-3',
        bg: '#9CC7F2',
        fg: '#042C53',
        fx: '#3A7BD1',
        click: {
          buffer: 18,
          refillMs: 0,
          drops: [
            { type: 'gold', min: 60, max: 140, w: 90 },
            { type: 'gem', min: 1, max: 2, w: 10 },
          ],
        },
      },
      {
        name: '豪华礼盒',
        emoji: '💝',
        sprite: 'supply-4',
        bg: '#6BA6E8',
        fg: '#01203C',
        fx: '#3A7BD1',
        // 转化型：开完之后变成一个全新的玩具架 —— 白拿一个常驻设施，是本作最爽的一步
        click: {
          buffer: 24,
          refillMs: 0,
          drops: [
            { type: 'gold', min: 100, max: 240, w: 88 },
            { type: 'gem', min: 1, max: 3, w: 12 },
          ],
          exhaust: { kind: 'convert', to: 'fac', level: 1 },
        },
      },
    ],
    top: null,
  },
}

/** 会出现在订单里的链。设施链是产出源头、礼包链是产出工具，都不作为交付物 */
export const CHAIN_ORDER: ChainKey[] = ['toy', 'care', 'food']

/** 图鉴与链树面板的展示顺序：设施排第一，因为它是所有产出的源头 */
export const TREE_ORDER: ChainKey[] = ['fac', 'toy', 'care', 'food', 'supply']

/**
 * 链深度版本。
 * 1 = 3 级链时代（toy/care/food 各 3 个普通等级、礼包链 2 级、设施链 2 级）
 * 2 = 8 级链时代（当前：主链 7+1 级、礼包链 4 级、设施链 3 级）
 *
 * ★ 加深链路会让**旧存档里的顶端物品改变身份**：旧 Lv4 的猫城堡，在新表里 Lv4 是"猫抓板"。
 *   所以读档时必须按这个版本号做一次迁移，把顶端搬过去 —— 否则玩家的母体会静默变成一个普通物品。
 */
export const CHAIN_DEPTH_V = 2
