import type { ChainKey } from './types'

/**
 * 开局就在主场景（棋盘）上的设施。
 *
 * ★ 变更（2026-10-02 第二轮设计修正）：
 *   原来「玩具架 / 玩具箱」是挂在棋盘下方一条独立工具栏里的两个按钮，
 *   点一次就走一次自己的冷却 —— 这是错的。正确的形态是：
 *
 *   - 它们是**主场景里的常驻母体**：本身就是棋盘上的一个对象，占一格；
 *   - 走「储备 + 一次性冷却」模型（`chains.ts` 的 fac 链定义）；
 *   - **可以被拖进背包**（背包里冻结），也可以拖回棋盘；
 *   - 两个玩具架可以合成一个玩具箱 —— 所以"设施摆在哪、要不要升级"是玩家的决策。
 *
 * 现在这里只描述"开局给什么"，定义本身在 `chains.ts` 的 fac 链。
 * 之所以不把设施建模成一种新的对象类型，是因为复用链物品的机制后，
 * 拖拽 / 背包 / 存档 / 渲染 / 特效全都不需要为它写第二套代码。
 */
export interface StartFacility {
  chain: ChainKey
  level: number
}

export const START_FACILITIES: StartFacility[] = [
  { chain: 'fac', level: 1 }, // 玩具架
  { chain: 'fac', level: 2 }, // 玩具箱
]
