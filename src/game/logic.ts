/**
 * 《爪爪乐园》纯逻辑层
 *
 * 从 P0 原型（单文件 HTML，已移除并迁入本 Vue 工程，见 git 历史）里抽出，
 * **不依赖任何 DOM**，因此可以直接单测。
 * 所有函数保持原型的语义，改动只有两处：
 *   1. 掉落表从原型的隐式结构 `{c,l,w}` / `{gold:[a,b],w}` 换成 types.ts 里的判别联合；
 *   2. 点击的节奏阀从"每点一次冷却一次"改成 **储备（buffer）+ 一次性冷却（refillMs）**，
 *      并把"储备耗尽后怎么办"显式建模成 `exhaust`（冷却续命 / 原地转化 / 直接消失）。
 *
 * ★ 铁律（来自 P0 踩坑记录，改动时务必保持）：
 *   - defOf() / maxLv() 对未知链必须返回 null / 0，**绝不能抛错**。
 *     旧存档里的孤儿物品会走到这里，一抛错就被 load() 的 catch 吞掉 → 整份存档被静默清空。
 */

import { CHAINS, CHAIN_DEPTH_V, CHAIN_ORDER } from './chains'
import { festActive, freshLive, isBanned, weatherOn, type LiveState } from './content'
import { START_FACILITIES } from './spawners'
import {
  CUSTOMERS,
  REGION_ORDER,
  customerDef,
  customersOfCamp,
  decorDef,
  decorPrice,
  freshRegions,
  regionDef,
  regionIndex,
} from './business'
import {
  AUTO_ACCUM_MAX,
  BAG_BASE_PRICE,
  BAG_INITIAL_CAP,
  BAG_PRICE_STEP,
  BAG_TOTAL,
  BONUS_AMOUNT,
  BONUS_HOURS,
  COLS,
  DAY_DOG_RATE,
  DAY_END,
  DAY_START,
  EXP_PER_LEVEL,
  ORDER_BASE_AFFINITY,
  ORDER_BASE_EXP,
  ORDER_BASE_GOLD,
  ORDER_BASE_STAR,
  ORDER_CHAIN_MULT,
  ORDER_GROWTH,
  ORDER_RISE,
  ORDER_RISE_PITCH,
  ORDER_SLOTS,
  ORDER_TIERS,
  PET_ACCUM_MAX_HOURS,
  PET_GEM_EVERY_HOURS,
  PET_GOLD_PER_HOUR,
  REGEN_MS,
  ROWS,
  SAVE_VERSION,
  STAMINA_MAX,
  TOTAL,
  VIP_STAMINA_BONUS,
  WEB_BASE_PRICE,
  WEB_STEP,
  orderTierDef,
} from './config'
import {
  isAutoDef,
  isResourceDrop,
  type BagSlot,
  type BoardItem,
  type Camp,
  type ChainKey,
  type CustomerKey,
  type DecorKey,
  type Drop,
  type Order,
  type OrderTier,
  type RegionKey,
  type ResolvedDef,
  type ResourceDrop,
} from './types'

export type Rng = () => number

// ==================== 链定义读取 ====================

/** 链上的普通等级数量（不含顶端） */
export function itemsLen(k: ChainKey): number {
  const c = CHAINS[k]
  return c ? c.items.length : 0
}

/**
 * 链的最高等级。
 * 顶端（母体 / 纯任务物品）是链的终点、不参与合成；少数链没有顶端（如礼包链，Lv2 即终点），
 * 此时最高等级 = items.length。
 */
export function maxLv(k: ChainKey): number {
  const c = CHAINS[k]
  if (!c) return 0 // 未知链：当作没有等级，避免抛错
  return c.items.length + (c.top ? 1 : 0)
}

/**
 * 取某个等级的完整定义。
 * kind: 'item' 普通物品 / 'producer' 链中段发射器 / 'generator' 顶端母体 / 'final' 纯任务物品
 */
export function defOf(k: ChainKey, lv: number): ResolvedDef | null {
  const c = CHAINS[k]
  // 未知链必须返回 null 而不是抛错 —— 见文件头铁律
  if (!c) return null

  const n = c.items.length
  const t = c.top

  if (lv <= n) {
    const d = c.items[lv - 1]
    if (!d) return null
    // 自动型：自己按间隔释放，玩家不点、不耗体力。它**不是**可点击对象 ——
    // isClickable() 对它返回 false，这样"点击 = 产出"的交互就不会被它抢走。
    if (d.auto) {
      return {
        name: d.name,
        emoji: d.emoji,
        sprite: d.sprite,
        bg: d.bg,
        fg: d.fg,
        fx: d.fx,
        kind: 'auto',
        drops: d.auto.drops,
        autoMs: d.auto.ms,
        autoMax: d.auto.max,
      }
    }
    const isP = !!d.click
    // producer 把 click 里的 buffer / refillMs / exhaust 提到顶层，
    // 使它与 generator 结构完全一致，这样 produce() / fullCharges() 不必区分两者
    return {
      name: d.name,
      emoji: d.emoji,
      sprite: d.sprite,
      bg: d.bg,
      fg: d.fg,
      fx: d.fx,
      kind: isP ? 'producer' : 'item',
      buffer: isP ? d.click!.buffer : undefined,
      refillMs: isP ? d.click!.refillMs : undefined,
      drops: isP ? d.click!.drops : undefined,
      exhaust: isP ? d.click!.exhaust : undefined,
    }
  }

  // 顶端是唯一的一个等级，必须正好等于 items.length + 1。
  // ★ 这里比 P0 原型严格：原型写成 `if (!t) return null`，于是任何 lv > items.length
  //   都会静默返回顶端定义 —— 越界的孤儿物品（如 Lv99）会被 load() 判定为"合法"而保留下来，
  //   渲染成"顶端的造型 + 错误的等级数字"。改成精确匹配后，这类脏数据会在迁移时被清掉。
  if (!t || lv !== n + 1) return null

  if (t.kind === 'generator') {
    return {
      name: t.name,
      emoji: t.emoji,
      sprite: t.sprite,
      bg: t.bg,
      fg: t.fg,
      fx: t.fx,
      kind: 'generator',
      buffer: t.click.buffer,
      refillMs: t.click.refillMs,
      drops: t.click.drops,
      exhaust: t.click.exhaust,
      produces: firstItemChain(t.click.drops),
    }
  }

  return {
    name: t.name,
    emoji: t.emoji,
    sprite: t.sprite,
    bg: t.bg,
    fg: t.fg,
    fx: t.fx,
    kind: 'final',
  }
}

/** 掉落表里第一条「物品掉落」指向的链（母体产出的是哪条链） */
function firstItemChain(drops: Drop[]): ChainKey | undefined {
  for (const d of drops) if (d.type === 'item') return d.chain
  return undefined
}

/** 是否可点击的发射器（母体 或 可点击的链物品，含设施） */
export function isClickable(
  d: ResolvedDef | null | undefined
): d is ResolvedDef & { buffer: number; refillMs: number; drops: Drop[] } {
  return !!d && (d.kind === 'generator' || d.kind === 'producer')
}

/** 可点击对象的储备上限 */
export function fullCharges(d: ResolvedDef): number {
  return d.buffer ?? 0
}

/** 储备耗尽后走哪条路：冷却续命 / 原地转化 / 直接消失 */
export type ExhaustMode = 'cooldown' | 'convert' | 'vanish'

export function exhaustMode(d: ResolvedDef): ExhaustMode {
  if ((d.refillMs ?? 0) > 0) return 'cooldown'
  return d.exhaust?.kind === 'convert' ? 'convert' : 'vanish'
}

/** 取转化目标；只在 exhaustMode() === 'convert' 时非空 */
export function exhaustTarget(
  d: ResolvedDef
): { kind: 'convert'; to: ChainKey; level: number } | null {
  return d.exhaust?.kind === 'convert' ? d.exhaust : null
}

/** 新建一个棋盘物品；可点击的对象带储备与冷却，自动型带上一次释放时间 */
export function makeItem(c: ChainKey, l: number): BoardItem {
  const d = defOf(c, l)
  const it: BoardItem = { chain: c, level: l }
  if (isClickable(d)) {
    it.charges = fullCharges(d)
    it.cdAt = 0
  } else if (isAutoDef(d)) {
    // lastAutoAt 从"现在"起算：第一份产出要等一个完整周期，而不是立刻白送
    it.lastAutoAt = Date.now()
  }
  return it
}

/** 该物品是不是自动型 */
export function isAutoItem(it: BoardItem | null | undefined): boolean {
  return !!it && isAutoDef(defOf(it.chain, it.level))
}

/** 该对象是否正在冷却中 */
export function isCooling(it: BoardItem | null, now: number = Date.now()): boolean {
  return !!it && (it.cdAt ?? 0) > now
}

/** 距冷却结束还有多少毫秒（不在冷却则为 0） */
export function coolingLeft(it: BoardItem | null, now: number = Date.now()): number {
  if (!it) return 0
  if ((it.cdLeft ?? 0) > 0) return it.cdLeft!
  return Math.max(0, (it.cdAt ?? 0) - now)
}

/**
 * 挂起冷却 —— 把"还剩多久"从绝对时间戳转成剩余毫秒。
 * 物品存进背包时调用：背包内一切冻结，冷却也不能继续走。
 */
export function suspendCooldown(it: BoardItem, now: number = Date.now()): void {
  if ((it.cdAt ?? 0) > 0) {
    it.cdLeft = Math.max(0, it.cdAt! - now)
    it.cdAt = 0
  }
}

/**
 * 恢复冷却 —— 把剩余毫秒换算回新的绝对时间戳。
 * 从背包取出时调用。没有它，冷却中的设施"放进背包又取出"就等于免费的补满。
 */
export function resumeCooldown(it: BoardItem, now: number = Date.now()): void {
  if ((it.cdLeft ?? 0) > 0) {
    it.cdAt = now + it.cdLeft!
    it.cdLeft = 0
  }
}

/**
 * 推进所有"冷却型"对象的冷却：到点就把储备补满并清掉 cdAt。
 * 返回被补满的格子下标，方便调用方播特效。
 *
 * ★ 这是「储备 + 一次性冷却」模型里唯一的补货入口。
 *   它必须跑在每秒的 tick 里（而不是等到玩家点击时才补），
 *   否则玩家点开的瞬间才会结算，冷却圆环会一直显示满格、看起来像没生效。
 */
export function tickGenerators(s: GameState, now: number = Date.now()): number[] {
  const refilled: number[] = []
  for (let i = 0; i < TOTAL; i++) {
    const it = s.board[i]
    if (!it) continue
    const cd = it.cdAt ?? 0
    if (cd <= 0 || cd > now) continue
    const d = defOf(it.chain, it.level)
    if (!isClickable(d)) continue
    it.charges = fullCharges(d)
    it.cdAt = 0
    refilled.push(i)
  }
  return refilled
}

// ==================== 自动型发射器 ====================

export interface AutoYield {
  /** 这次产出涉及到的格子（含自动型本体所在的格子，用于播"它转起来了"的反馈） */
  cells: number[]
  /** 资源型掉落直接进余额（自动型也可能产货币，与点击型同一套掉落结构） */
  gold: number
  gem: number
}

/**
 * 结算自动型发射器：按 `autoMs` 间隔自己释放，**玩家不点、也不消耗体力**。
 *
 * ★ 三条必须遵守的规则（都是"别把挂机收益做成外挂"这条红线）：
 *
 *  1. **离线累积有上限**（`autoMax`，缺省 AUTO_ACCUM_MAX）。
 *     达到上限后 `lastAutoAt` 直接推到 now —— 上限之外的时间**彻底作废**。
 *     与常驻宠物的 `petAt` 是同一套路：上限之外不无限累积，否则挂机一周回来能开一家店。
 *
 *  2. **棋盘满且可能产物品时，先不推进时间戳**。
 *     物品型掉落需要空位；没空位就把攒下的次数留着，等玩家腾出格子再一次性放出来。
 *     （资源型掉落不占格子，总能结算。）
 *
 *  3. **一次结算最多放 `cap` 个**，多余的不补 —— 它是"回来收菜"的惊喜，不是主力产出。
 */
export function tickAuto(
  s: GameState,
  now: number = Date.now(),
  rng: Rng = Math.random
): AutoYield {
  const out: AutoYield = { cells: [], gold: 0, gem: 0 }

  for (let i = 0; i < TOTAL; i++) {
    const it = s.board[i]
    if (!it) continue
    const d = defOf(it.chain, it.level)
    if (!isAutoDef(d)) continue

    const last = it.lastAutoAt ?? now
    if (last > now) continue // 时钟回拨等异常：按"刚释放过"处理，不结算也不报错
    const cycles = Math.floor((now - last) / d.autoMs)
    if (cycles <= 0) continue

    const cap = d.autoMax ?? AUTO_ACCUM_MAX
    const n = Math.min(cycles, cap)

    // 规则 2：可能产出物品但没有空位 → 不推进时间戳，把次数留着
    const mayProduceItem = (d.drops ?? []).some((x) => x.type === 'item')
    if (mayProduceItem && countEmpty(s) === 0) continue

    it.lastAutoAt = cycles >= cap ? now : last + cycles * d.autoMs
    out.cells.push(i)

    for (let k = 0; k < n; k++) {
      const drop = rollDrops(d.drops ?? [], rng)
      if (drop.type === 'gold' || drop.type === 'gem') {
        const amount = rollRange(drop.min, drop.max, rng)
        if (drop.type === 'gold') out.gold += amount
        else out.gem += amount
        continue
      }
      const t = pickRandomEmpty(s.board, s.web, rng, s.bagAt ?? -1)
      if (t < 0) break // 中途满了就停，剩下的次数并入下次
      s.board[t] = makeItem(drop.chain, drop.level)
      out.cells.push(t)
    }
  }

  out.cells = Array.from(new Set(out.cells))
  return out
}

/** 该等级是否是链的顶端（终点） */
export function isTop(k: ChainKey, lv: number): boolean {
  return lv === maxLv(k)
}

// ==================== 掉落 ====================

/** 按权重抽一条掉落 */
export function rollDrops(table: readonly Drop[], rng: Rng = Math.random): Drop {
  if (!table.length) throw new Error('rollDrops: 空掉落表')
  let total = 0
  for (const t of table) total += t.w
  let r = rng() * total
  for (const t of table) {
    r -= t.w
    if (r <= 0) return t
  }
  return table[table.length - 1]
}

/** 在 [min, max] 内取整数（闭区间） */
export function rollRange(min: number, max: number, rng: Rng = Math.random): number {
  return min + Math.floor(rng() * (max - min + 1))
}

export function isResource(t: Drop): t is ResourceDrop {
  return isResourceDrop(t)
}

/** 掉落表 → 一行可读文本（按权重降序） */
export function dropsDesc(table: readonly Drop[]): string {
  const arr = table.slice().sort((a, b) => b.w - a.w)
  return arr
    .map((t) => {
      if (t.type === 'gold') return `🪙金币 ${t.min}~${t.max} ${t.w}%`
      if (t.type === 'gem') return `💎钻石 ${t.min}~${t.max} ${t.w}%`
      const d = defOf(t.chain, t.level)
      if (!d) return `未知物品 ${t.w}%`
      return `${d.emoji}${d.name} ${t.w}%`
    })
    .join(' · ')
}

// ==================== 棋盘 ====================

/**
 * ★ 已删除 `isLocked()`（2026-10-02 第二轮设计修正）。
 *   主场景不再有锁定格：整块棋盘从开局起就全部可用。
 *   "花金币解锁格子"只属于背包这一个系统。
 */

export function sameKind(a: BoardItem | null, b: BoardItem | null): boolean {
  return !!a && !!b && a.chain === b.chain && a.level === b.level
}

/**
 * 稳定键：用于判断"这个格子的元素要不要重建"。
 * ★ 必须带上 cdAt —— 否则「储备耗尽进入冷却」这次状态变化不会触发重渲染，
 *   冷却圆环和倒计时就不会出现。
 */
export function itemKey(it: BoardItem | null): string {
  if (!it) return ''
  return `${it.chain}:${it.level}${it.charges == null ? '' : ':' + it.charges}${
    it.cdAt ? ':cd' + it.cdAt : ''
  }`
}

/**
 * 随机选一个空格。
 * ★ 产出必须随机位置抛出（不得按顺序填空格），否则连续产出会有机械节奏感。
 *
 * ★ `bagAt`：背包占用的棋盘格（-1 = 背包不在棋盘上）。背包格不是空位——
 *   产出、蛛网、挤出、兜底设施都不能落到它头上。
 *   默认 -1 保证旧的纯函数调用（测试里手搓的 board/web）行为完全不变。
 */
export function pickRandomEmpty(
  board: readonly (BoardItem | null)[],
  web: readonly boolean[],
  rng: Rng = Math.random,
  bagAt = -1
): number {
  const empties: number[] = []
  for (let i = 0; i < TOTAL; i++) {
    if (i === bagAt) continue
    if (!web[i] && board[i] === null) empties.push(i)
  }
  if (!empties.length) return -1
  return empties[Math.floor(rng() * empties.length)]
}

// ==================== 背包上棋盘（背包是一件可拖拽的"道具"）====================

/** 该格是否被背包占用（对残缺 state 安全：bagAt 缺失按 -1 处理） */
export function isBagCell(s: GameState, i: number): boolean {
  return (s.bagAt ?? -1) === i
}

/**
 * 把背包安置到 `prefer` 格（默认右下角 TOTAL-1）。
 * - prefer 是空格且无蛛网 → 直接放；
 * - prefer 被物品占着 → 把它挤到随机空位（没有空位背包就放不下）；
 * - prefer 有蛛网 → 换一个非蛛网空格（蛛网只能花钱清，白清等于送金币）。
 * 返回实际落格（-1 = 放不下，背包暂不在棋盘上，走信息栏入口）。
 *
 * ★ 只在「新档初始化」与「旧存档归一化」里调用：运行中背包只会被玩家拖动，
 *   不允许系统悄悄挪位（那会让玩家觉得棋盘自己在动）。
 */
export function placeBag(s: GameState, prefer = TOTAL - 1, rng: Rng = Math.random): number {
  if (typeof (s.bagAt ?? -1) === 'number' && (s.bagAt ?? -1) >= 0 && (s.bagAt ?? -1) < TOTAL) {
    return s.bagAt // 已经在棋盘上，不动
  }
  const board = Array.isArray(s.board) ? s.board : []
  const web = Array.isArray(s.web) ? s.web : []
  if (prefer >= 0 && prefer < TOTAL && !web[prefer]) {
    const blocker = board[prefer]
    if (!blocker) {
      s.bagAt = prefer
      return prefer
    }
    // 被物品占着：把它挤到任意空位（不含背包格——此时背包还没落位）
    const t = pickRandomEmpty(board, web, rng, -1)
    if (t >= 0) {
      board[t] = blocker
      board[prefer] = null
      s.bagAt = prefer
      return prefer
    }
  }
  // prefer 放不下：在整个棋盘找一个非蛛网空格兜底
  const t = pickRandomEmpty(board, web, rng, -1)
  if (t >= 0) {
    s.bagAt = t
    return t
  }
  s.bagAt = -1
  return -1
}

/**
 * 把背包从当前格移动到 `to`（玩家拖动背包）。
 * 目标必须是**非蛛网空格**；背包不可与其他物品合成/换位。
 */
export function moveBagTo(s: GameState, to: number): boolean {
  if (!Array.isArray(s.board) || !Array.isArray(s.web)) return false
  if (to < 0 || to >= TOTAL) return false
  if (isBagCell(s, to)) return true // 拖回原地 = 无事发生
  if (s.web[to] || s.board[to] !== null) return false
  s.bagAt = to
  return true
}

// ==================== 挤出 / 换位（拖到占用格的落点规则）====================

/**
 * 拖拽释放到**被占用**格时的落点规则（2026-10-02 交互修正）：
 *   1. 把原物品挤到**周围 8 格**里的随机空位；
 *   2. 周围都满 → 挤到**再外一圈**（5×5 环）的随机空位；
 *   3. 都没有 → 返回 `'swap'`，调用方让两个物品**换位**。
 *
 * 蛛网格与背包格不算空位（蛛网要花钱清，背包不能被物品挤走）。
 * 目标格自身（ring 0）永远不参与搜索。
 */
export function findDisplaceCell(
  board: readonly (BoardItem | null)[],
  web: readonly boolean[],
  targetIdx: number,
  bagAt = -1,
  rng: Rng = Math.random
): number | 'swap' {
  const tr = Math.floor(targetIdx / COLS)
  const tc = targetIdx % COLS
  for (let ring = 1; ring <= 2; ring++) {
    const empties: number[] = []
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        // 只走当前环（切比雪夫距离恰为 ring 的格子）
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue
        const r = tr + dr
        const c = tc + dc
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue
        const i = r * COLS + c
        if (web[i] || i === bagAt) continue
        if (board[i] === null) empties.push(i)
      }
    }
    if (empties.length) return empties[Math.floor(rng() * empties.length)]
  }
  return 'swap'
}

// ==================== 蛛网 ====================

/** 清除价随已清除数量递增：拖得越久越贵，逼玩家尽早处理 */
export function webPrice(websCleared: number): number {
  return WEB_BASE_PRICE + WEB_STEP * websCleared
}

// ==================== 背包（纯收纳箱）====================

/** 下一次扩容的价格（每格递增） */
export function bagPrice(bagExpanded: number): number {
  return Math.round(BAG_BASE_PRICE * Math.pow(BAG_PRICE_STEP, bagExpanded))
}

/** 该格是否还未解锁（扩容只解锁、不回收） */
export function isBagCellLocked(s: GameState, i: number): boolean {
  return i >= s.bagCap
}

/** 背包里已占用的格数（只看已解锁范围） */
export function bagUsed(s: GameState): number {
  let n = 0
  for (let i = 0; i < s.bagCap; i++) if (s.bag[i]) n++
  return n
}

/** 背包里第一个空格；-1 = 已满（或还没扩容） */
export function findBagFree(s: GameState): number {
  for (let i = 0; i < s.bagCap; i++) if (!s.bag[i]) return i
  return -1
}

export function canExpandBag(s: GameState): boolean {
  return s.bagCap < BAG_TOTAL
}

/** 棋盘上可用空格的数量（蛛网不算；背包格也不算——它被常驻对象占着） */
export function countEmpty(s: GameState): number {
  const bagAt = s.bagAt ?? -1
  let n = 0
  for (let i = 0; i < TOTAL; i++) {
    if (i === bagAt) continue
    if (!s.web[i] && s.board[i] === null) n++
  }
  return n
}

// ==================== 体力：自然恢复 ====================

/**
 * 每 2 分钟 +1，到上限停止累积（不攒溢出的恢复量）。
 * 返回是否发生了变化（供调用方决定要不要存档）。
 */
export function tickRegen(s: GameState, now: number = Date.now()): boolean {
  // 上限走 staminaMax(s)：洗护区 / 餐厅解锁后会抬高上限
  const max = staminaMax(s)
  if (s.stamina >= max) {
    s.regenAt = now
    return false
  }
  const n = Math.floor((now - s.regenAt) / REGEN_MS)
  if (n <= 0) return false
  s.stamina = Math.min(max, s.stamina + n)
  s.regenAt += n * REGEN_MS
  if (s.stamina >= max) s.regenAt = now
  return true
}

/** 距下一点恢复还有多少毫秒 */
export function nextRegenIn(s: GameState, now: number = Date.now()): number {
  if (s.stamina >= staminaMax(s)) return 0
  return Math.max(0, REGEN_MS - ((now - s.regenAt) % REGEN_MS))
}

export function fmtMs(ms: number): string {
  let sec = Math.ceil(ms / 1000)
  const m = Math.floor(sec / 60)
  sec %= 60
  return `${m}:${sec < 10 ? '0' : ''}${sec}`
}

/** 本地日期键（`Y-M-D`）。用于「每日一次」类收益的去重（诊疗室的每日升级卡） */
export function dayKey(now: number = Date.now()): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** 把毫秒格式化成"还剩 3h12m / 12m30s"——订单倒计时与宠物离线时长共用 */
export function fmtLeft(ms: number): string {
  if (ms <= 0) return '已到期'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h${m}m`
  const sec = s % 60
  return `${m}m${sec < 10 ? '0' : ''}${sec}s`
}

// ==================== 体力：每日补贴 ====================

export interface BonusSlot {
  key: string
  at: number
  label: string
  claimed: boolean
}

/**
 * 当前所处时段的补贴。
 * 三个时段 12:00 / 18:00 / 24:00（24 点即次日 0 点）；只认"当前所处时段"，过期作废、不补发。
 */
export function currentBonus(s: GameState, now: number = Date.now()): BonusSlot | null {
  const d = new Date(now)
  const day0 = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const list: Omit<BonusSlot, 'claimed'>[] = []

  for (let off = -1; off <= 1; off++) {
    const base = new Date(day0.getTime() + off * 86400000)
    const kd = `${base.getFullYear()}-${base.getMonth() + 1}-${base.getDate()}`
    for (const h of BONUS_HOURS) {
      const at =
        h === 24
          ? new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, 0, 0, 0, 0)
          : new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, 0, 0, 0)
      list.push({ key: `${kd}@${h}`, at: at.getTime(), label: h === 24 ? '24:00' : `${h}:00` })
    }
  }

  list.sort((a, b) => a.at - b.at)
  let cur: Omit<BonusSlot, 'claimed'> | null = null
  for (const item of list) if (item.at <= now) cur = item
  if (!cur) return null

  return { ...cur, claimed: !!s.bonusClaimed[cur.key] }
}

/** 补贴记录只保留最近 8 条，避免存档无限增长 */
export function trimBonusClaimed(s: GameState): void {
  const keys = Object.keys(s.bonusClaimed).sort()
  while (keys.length > 8) {
    const k = keys.shift()!
    delete s.bonusClaimed[k]
  }
}

export { BONUS_AMOUNT }

// ==================== 经营层：区域 ====================

/** 是否已解锁某区域 */
export function isRegionUnlocked(s: GameState, k: RegionKey): boolean {
  return !!s.regions?.[k]
}

/**
 * 区域是否**现在可以**解锁。
 * 顺序解锁：前一个区域没开就不能开后一个，避免玩家跳着开后期区域。
 */
export function canUnlockRegion(s: GameState, k: RegionKey): boolean {
  if (isRegionUnlocked(s, k)) return false
  const def = regionDef(k)
  if (!def) return false
  if (s.level < def.unlockLevel) return false
  const idx = regionIndex(k)
  const prev = idx > 0 ? REGION_ORDER[idx - 1] : null
  return !prev || isRegionUnlocked(s, prev)
}

/** 下一个可解锁的区域（没有则 null），UI 用它做"可解锁"红点 */
export function nextRegionToUnlock(s: GameState): RegionKey | null {
  for (const k of REGION_ORDER) if (canUnlockRegion(s, k)) return k
  return null
}

/** 已解锁区域的加成汇总 */
export interface RegionBonuses {
  /** 体力上限加成 */
  staminaMax: number
  /** 订单金币加成（0.1 = +10%） */
  goldMult: number
  /** 每单额外星星 */
  starBonus: number
  /** 常驻宠物离线累积上限（小时） */
  petHours: number
  /** 额外开放的订单档位 */
  tiers: OrderTier[]
}

export function regionBonuses(s: GameState): RegionBonuses {
  const b: RegionBonuses = {
    staminaMax: 0,
    goldMult: 0,
    starBonus: 0,
    petHours: PET_ACCUM_MAX_HOURS,
    tiers: [],
  }
  for (const k of REGION_ORDER) {
    if (!isRegionUnlocked(s, k)) continue
    const e = regionDef(k)?.effect
    if (!e) continue
    b.staminaMax += e.staminaMax ?? 0
    b.goldMult += e.goldMult ?? 0
    b.starBonus += e.starBonus ?? 0
    if (e.petHours) b.petHours = Math.max(b.petHours, e.petHours)
    if (e.openTier && !b.tiers.includes(e.openTier)) b.tiers.push(e.openTier)
  }
  return b
}

/**
 * 体力上限 = 基础值 + 区域加成。
 * ★ 一律走这个函数，不要直接读 STAMINA_MAX —— 否则洗护区/餐厅的加成会失效。
 */
/** 会员卡是否有效（到期时间戳在未来） */
export function isVip(s: GameState): boolean {
  return (s.vipUntil ?? 0) > Date.now()
}

export function staminaMax(s: GameState): number {
  // 会员卡的体力上限加成也走这个统一出口（铁律：不要在别处直接读 VIP_STAMINA_BONUS）
  return STAMINA_MAX + regionBonuses(s).staminaMax + (isVip(s) ? VIP_STAMINA_BONUS : 0)
}

// ==================== 经营层：装饰 ====================

/** 装饰等级（0 = 还没买） */
export function decorLevel(s: GameState, k: DecorKey): number {
  return s.decor?.[k] ?? 0
}

/** 下一次升级装饰的星星价格：-1 = 已满级，-2 = 未知装饰 */
export function decorNextCost(s: GameState, k: DecorKey): number {
  const d = decorDef(k)
  if (!d) return -2
  const lv = decorLevel(s, k)
  if (lv >= d.maxLevel) return -1
  return decorPrice(d, lv)
}

/**
 * 买一件 / 升一级装饰。
 * 星星与主经济隔离（只从订单结算产出，只在这里消耗），所以只动 s.stars。
 */
export function buyOrUpgradeDecor(s: GameState, k: DecorKey): boolean {
  const cost = decorNextCost(s, k)
  if (cost < 0) return false
  if (s.stars < cost) return false
  s.stars -= cost
  s.decor[k] = decorLevel(s, k) + 1
  return true
}

// ==================== 经营层：常驻宠物离线产出（文档 07-02）====================

export interface PetYield {
  /** 本次结算覆盖的小时数 */
  hours: number
  gold: number
  gem: number
}

/**
 * 结算常驻宠物的自动产出：每只每小时一次，**离线最多累积 petHours 小时**（午睡区可提升到 12）。
 *
 * ★ 结算完必须推进 s.petAt，两种走法不能混：
 *   - 未达上限：`petAt += 已结算小时数`，把不足 1 小时的零头留住，不吞玩家时间；
 *   - 已达上限：**直接把 petAt 推到 now**，上限之外的时间彻底作废。
 *     否则玩家离线一整天回来，上限会被当成新的起点，同一段时间被反复结算。
 */
export function tickPets(s: GameState, now: number = Date.now()): PetYield {
  const zero: PetYield = { hours: 0, gold: 0, gem: 0 }
  const n = s.pets?.length ?? 0
  if (n === 0) {
    s.petAt = now
    return zero
  }
  const cap = regionBonuses(s).petHours
  const base = s.petAt || now
  const elapsed = Math.floor((now - base) / 3600000)
  if (elapsed <= 0) return zero

  const hours = Math.min(elapsed, cap)
  const gold = n * hours * PET_GOLD_PER_HOUR
  const gem = n * Math.floor(hours / PET_GEM_EVERY_HOURS)
  s.gold += gold
  s.gem += gem
  s.petAt = elapsed >= cap ? now : base + elapsed * 3600000
  return { hours, gold, gem }
}

// ==================== 订单 ====================

export interface OrderCtx {
  unlocked: Record<ChainKey, boolean>
  /** 玩家等级：决定能抽哪些档位，以及奖励的等级上浮 */
  level: number
  regions: Record<RegionKey, boolean>
  /** 订单金币加成（来自已解锁区域） */
  goldMult?: number
  /** 每单额外星星（来自已解锁区域） */
  starBonus?: number
  /** 结算时刻，决定顾客阵营 */
  now?: number
  /** 雨天：护理链订单金币翻倍 */
  weather?: 'clear' | 'rain'
  /** 节日或时间旅行期间，订单金币 +20% */
  fest?: boolean
  banKey?: string
  banUntil?: number
}

/** 当前等级 + 区域进度下，可抽的档位 */
export function availableTiers(ctx: OrderCtx): OrderTier[] {
  const out: OrderTier[] = []
  for (const t of ORDER_TIERS) {
    if (ctx.level < t.needLevel) continue
    if (t.needRegion && !ctx.regions[t.needRegion]) continue
    out.push(t.key)
  }
  return out.length ? out : ['normal']
}

/**
 * 把档位的等级区间**收敛到该链的实际深度**，且只取可交付的普通等级（不含顶端）。
 *
 * 文档 5.1 假定链有 8 级，我们的链只有 3–4 个普通等级，所以"稀有订单要 Lv6–7"这种区间
 * 直接映射过来会永远抽不出来。收敛后：请求 `Lv4–Lv4` 在 supply 链（只有 Lv1–3）上会退化成 Lv3。
 */
export function tierLevelRange(k: ChainKey, tier: OrderTier): { lo: number; hi: number } | null {
  const n = itemsLen(k)
  if (n <= 0) return null
  const d = orderTierDef(tier)
  const hi = Math.min(d.maxLv, n)
  if (hi < 1) return null
  const lo = Math.max(1, Math.min(d.minLv, hi))
  return { lo, hi }
}

/** 按时段挑顾客：白天狗 65%，夜间猫 65%（文档 5.2） */
export function pickCustomer(now: number, rng: Rng = Math.random): CustomerKey {
  const h = new Date(now).getHours()
  const isDay = h >= DAY_START && h < DAY_END
  const dog = isDay ? rng() < DAY_DOG_RATE : rng() >= DAY_DOG_RATE
  const camp: Camp = dog ? 'dog' : 'cat'
  const list = customersOfCamp(camp)
  const pool = list.length ? list : CUSTOMERS
  return pool[Math.floor(rng() * pool.length)].key
}

/** 订单奖励统一算法（金币 / 经验 / 星星 / 好感度），四处奖励口径只在这里定义 */
export function orderRewards(
  tier: OrderTier,
  lv: number,
  ci: number,
  playerLevel: number,
  goldMult = 0,
  starBonus = 0
): { gold: number; exp: number; stars: number; affinity: number } {
  const t = orderTierDef(tier)
  // 文档 5.1：每提升 5 级整体上浮 20%
  const rise = 1 + ORDER_RISE * Math.floor(playerLevel / ORDER_RISE_PITCH)
  const base = Math.pow(ORDER_GROWTH, lv - 1)
  const chainMult = ORDER_CHAIN_MULT[ci] ?? 1
  return {
    gold: Math.round(ORDER_BASE_GOLD * base * chainMult * t.mult * rise * (1 + goldMult)),
    exp: Math.round(ORDER_BASE_EXP * base * t.mult * rise),
    stars: Math.round(ORDER_BASE_STAR * t.mult) + starBonus,
    affinity: Math.round(ORDER_BASE_AFFINITY * t.mult * rise),
  }
}

/**
 * 抽一个订单。三步：
 *  ① 按等级 / 区域进度抽档位；
 *  ② 在已解锁的链里抽 (链, 等级)，低等级权重更高（`(hi + 1 - lv) * 2`）；
 *  ③ 抽顾客 —— **偏好该链的顾客有 70% 概率优先出场**，
 *     让"顾客有性格"这件事落到玩家看得见的订单分布上，而不只是一句设定文案。
 */
export function makeOrder(ctx: OrderCtx, rng: Rng = Math.random): Order {
  const now = ctx.now ?? Date.now()
  const goldMult = ctx.goldMult ?? 0
  const starBonus = ctx.starBonus ?? 0

  // ① 档位
  const tiers = availableTiers(ctx)
  let tw = 0
  for (const k of tiers) tw += orderTierDef(k).w
  let r = rng() * tw
  let tier: OrderTier = tiers[0]
  for (const k of tiers) {
    r -= orderTierDef(k).w
    if (r <= 0) {
      tier = k
      break
    }
  }

  // ② 链 + 等级
  const pool: { c: ChainKey; l: number; ci: number }[] = []
  CHAIN_ORDER.forEach((k, ci) => {
    if (!ctx.unlocked[k]) return
    const range = tierLevelRange(k, tier)
    if (!range) return
    for (let lv = range.lo; lv <= range.hi; lv++) {
      if (isBanned({ banKey: ctx.banKey ?? '', banUntil: ctx.banUntil ?? 0 } as LiveState, k, lv, now)) continue
      const w = Math.max(1, (range.hi + 1 - lv) * 2)
      for (let q = 0; q < w; q++) pool.push({ c: k, l: lv, ci })
    }
  })
  if (!pool.length) pool.push({ c: 'toy', l: 1, ci: 0 })
  const p = pool[Math.floor(rng() * pool.length)]

  // ③ 顾客
  const prefer = CUSTOMERS.filter((c) => c.likes === p.c)
  const preferHit = rng() < 0.7 && prefer.length > 0
  const chosen = preferHit
    ? prefer[Math.floor(rng() * prefer.length)]
    : customerDef(pickCustomer(now, rng))
  const customer = chosen ? chosen.key : pickCustomer(now, rng)

  const rw = orderRewards(tier, p.l, p.ci, ctx.level, goldMult, starBonus)
  if (ctx.weather === 'rain' && p.c === 'care') rw.gold = Math.round(rw.gold * 2)
  if (ctx.fest) rw.gold = Math.round(rw.gold * 1.2)
  return {
    id: Math.random().toString(36).slice(2, 9),
    chain: p.c,
    level: p.l,
    tier,
    customer,
    gold: rw.gold,
    exp: rw.exp,
    stars: rw.stars,
    affinity: rw.affinity,
    expireAt: now + orderTierDef(tier).hours * 3600000,
  }
}

// ==================== 成长：经验 / 等级 ====================

/**
 * 升级经验。等级越高每级所需越多（`level * EXP_PER_LEVEL`）。
 * 返回是否升级过。
 */
export function gainExp(s: GameState, exp: number): boolean {
  s.exp += exp
  let leveled = false
  while (s.exp >= s.level * EXP_PER_LEVEL) {
    s.exp -= s.level * EXP_PER_LEVEL
    s.level++
    leveled = true
  }
  return leveled
}

// ==================== 初始状态 ====================

export interface GameState {
  v: number
  board: (BoardItem | null)[]
  stamina: number
  regenAt: number
  bonusClaimed: Record<string, number>
  gold: number
  gem: number
  exp: number
  level: number
  unlocked: Record<ChainKey, boolean>
  orders: Order[]
  merges: number
  gensMade: number
  web: boolean[]
  /** 已清除的蛛网数量（决定下次清除价） */
  websCleared: number
  /** 累计产出次数（决定何时生成蛛网） */
  produces: number

  /** 背包槽位：纯收纳，放进去的一切冻结（见 config.ts 的说明） */
  bag: BagSlot[]
  /** 已解锁的背包格数（前 N 格按行优先可用） */
  bagCap: number
  /** 已扩容次数，决定下一次扩容价 */
  bagExpanded: number
  /**
   * 背包在主场景上占用的棋盘格下标（2026-10-02 交互修正：背包是一件放在棋盘上的"道具"）。
   * -1 = 背包暂不在棋盘上（棋盘全满兜底失败），走底部信息栏的入口打开。
   * 不进 board 数组：背包不是 BoardItem，不参与合成/订单/蛛网，但**占格**。
   */
  bagAt: number

  // ---- 经营层（第一批）----
  /** 星星：装饰专用货币，只从订单结算产出、只在装饰上消耗，与主经济隔离 */
  stars: number
  /** 顾客好感度：customerKey → 好感值 */
  affinity: Record<CustomerKey, number>
  /** 已转化为常驻宠物的顾客（好感满格后转化） */
  pets: CustomerKey[]
  /** 常驻宠物上次结算时间戳 */
  petAt: number
  /** 区域解锁状态 */
  regions: Record<RegionKey, boolean>
  /** 装饰等级：decorKey → level（0 / 缺失 = 未购买） */
  decor: Record<DecorKey, number>
  /** 最近一次领"每日升级卡"的日期键（诊疗室收益，按天去重） */
  cardDay: string
  /** 最近一次领"每日设施补给"的日期键（手动型发射器，按天去重） */
  facDay: string
  /**
   * 链深度版本（见 chains.ts 的 CHAIN_DEPTH_V）。
   * 缺省 / 1 = 3 级链时代的老存档，读档时要跑一次顶端迁移。
   */
  depthV: number

  // ---- 商城 ----
  /**
   * 限购计数：`"2026-10-2@12:charger" → 已购次数`。
   * 键里带**刷新时段**（shopSlotKey），跨过一个时段就自然换了一批键 → 限购清零。
   * 只保留最近 12 条，避免无限增长。
   */
  shopBought: Record<string, number>
  /** 最近一次自动备份的日期键（每天第一次存档时备份一次） */
  bakDay: string

  // ---- 模拟充值 / 付费内容（第四批 M2，全部"可加字段 + 默认值"，不升 SAVE_VERSION）----
  /** 是否已经完成过一次模拟充值（首充双倍 + 首充礼包只触发一次） */
  firstRecharge: boolean
  /** 会员卡到期时间戳（0 = 从未开卡）；30 天一档，续期往后叠加 */
  vipUntil: number
  /** 最近一次领"会员每日福利"的日期键（按天去重） */
  vipDay: string
  /** 是否已购买成长基金（重复购买 = 重置返还进度） */
  fundOwned: boolean
  /** 成长基金已领取次数（每 5 级一次，共 10 次） */
  fundClaimed: number
  /** 抽奖保底计数：距上次"稀有及以上"的抽数，达到 10 必出稀有 */
  luckyPity: number
  /** 阶段性礼包限购计数：礼包 key → 已购次数（键不带时段，一次性的永远 1） */
  giftBought: Record<string, number>
  /** 长线内容（阵营、图鉴、造型、乐园、节日、任务）。可缺省，读档时补齐 */
  live: LiveState
}

export function freshState(rng: Rng = Math.random): GameState {
  const s: GameState = {
    v: SAVE_VERSION,
    board: new Array(TOTAL).fill(null),
    stamina: STAMINA_MAX,
    regenAt: Date.now(),
    bonusClaimed: {},
    gold: 0,
    gem: 60,
    exp: 0,
    level: 1,
    // 设施链开局就可用（它就是产出源头）；礼包链由基础设施直接产出，也始终可用
    unlocked: freshUnlocked(),
    orders: [],
    merges: 0,
    gensMade: 0,
    web: new Array(TOTAL).fill(false),
    websCleared: 0,
    produces: 0,
    bag: new Array(BAG_TOTAL).fill(null),
    bagCap: BAG_INITIAL_CAP,
    bagExpanded: 0,
    // 背包开局就"摆"在主场景右下角——它是道具，不是外部按钮
    bagAt: TOTAL - 1,
    stars: 0,
    affinity: {},
    pets: [],
    petAt: Date.now(),
    regions: freshRegions(),
    decor: {},
    cardDay: '',
    facDay: '',
    depthV: CHAIN_DEPTH_V,
    shopBought: {},
    bakDay: '',
    firstRecharge: false,
    vipUntil: 0,
    vipDay: '',
    fundOwned: false,
    fundClaimed: 0,
    luckyPity: 0,
    giftBought: {},
    live: freshLive(),
  }
  s.orders = Array.from({ length: ORDER_SLOTS }, () => makeOrder(orderCtxOf(s), rng))
  return s
}

/** 从 state 现算一份抽订单所需的上下文（等级 / 区域 / 加成），避免各处重复拼参数 */
function freshUnlocked(): Record<ChainKey, boolean> {
  const u = {} as Record<ChainKey, boolean>
  for (const k of Object.keys(CHAINS) as ChainKey[]) {
    u[k] = k === 'fac' || k === 'toy' || k === 'supply'
  }
  return u
}

export function orderCtxOf(s: GameState, now: number = Date.now()): OrderCtx {
  const b = regionBonuses(s)
  const live = s.live
  return {
    unlocked: s.unlocked,
    level: s.level,
    regions: s.regions ?? freshRegions(),
    goldMult: b.goldMult,
    starBonus: b.starBonus,
    now,
    weather: weatherOn(dayKey(now)),
    fest: !!festActive(now, live?.festFocus ?? ''),
    banKey: live?.banKey,
    banUntil: live?.banUntil,
  }
}

/**
 * 开局给道具，让玩家第一次打开背包就看到"特殊道具"长什么样。
 *
 * 每种道具各给 1 个（升级卡给 2 张），开局就能在背包里看到。
 * 初始背包用掉 8/10 格。
 */
export function seedBag(s: GameState): void {
  s.bag[0] = { k: 'tool', st: { tool: 'scissors', count: 1 } }
  s.bag[1] = { k: 'tool', st: { tool: 'upgradeCard', count: 2 } }
  s.bag[2] = { k: 'tool', st: { tool: 'charger', count: 1 } }
  s.bag[3] = { k: 'tool', st: { tool: 'hourglass', count: 1 } }
  s.bag[4] = { k: 'tool', st: { tool: 'orbGreen', count: 1 } }
  s.bag[5] = { k: 'tool', st: { tool: 'orb', count: 1 } }
  s.bag[6] = { k: 'tool', st: { tool: 'orbPurple', count: 1 } }
  s.bag[7] = { k: 'tool', st: { tool: 'infinite', count: 1 } }
}

/**
 * 开局种子：**先把设施摆上主场景**，再给几个玩具物品让玩家第一秒就有东西可合。
 * 必须在 state 就位之后调用；「重置存档」也要走这里，否则重置出来是空棋盘，与全新开局不一致。
 */
export function seedBoard(s: GameState, rng: Rng = Math.random): void {
  // 设施先占位（它们是常驻产出源头）；背包格不可占用（bagAt 已在 freshState 设为右下角）
  const bagAt = s.bagAt ?? -1
  for (const f of START_FACILITIES) {
    const t = pickRandomEmpty(s.board, s.web, rng, bagAt)
    if (t >= 0) s.board[t] = makeItem(f.chain, f.level)
  }
  const seeds: [ChainKey, number][] = [
    ['toy', 1],
    ['toy', 1],
    ['toy', 1],
    ['toy', 2],
  ]
  for (const [c, l] of seeds) {
    const t = pickRandomEmpty(s.board, s.web, rng, bagAt)
    if (t >= 0) s.board[t] = makeItem(c, l)
  }
}

/**
 * 该物品是不是设施（设施链的任何等级）。
 * 用途：
 *   - **禁止蛛网牺牲设施** —— 设施是产出源头，被吃掉会让玩家彻底卡死；
 *   - 存档兜底时判断"玩家手上还有没有产出能力"。
 */
export function isFacility(it: BoardItem | null | undefined): boolean {
  return !!it && it.chain === 'fac'
}

/**
 * 棋盘 + 背包里一共还有几个设施。
 *
 * ★ 必须对残缺 state 免疫（与 `defOf()` 同一条铁律）：
 *   它会被 `ensureFacilities()` 从**存档归一化流程**里调用，而那是老存档进来时的第一站 ——
 *   此时 `s.bag` 可能根本不存在（旧版本没有背包）。直接 `for...of s.bag` 会抛
 *   `TypeError: s.bag is not iterable`，异常冒到 `load()` 外面 → **整份存档加载失败**。
 */
export function countFacilities(s: GameState): number {
  let n = 0
  const board = Array.isArray(s.board) ? s.board : []
  for (let i = 0; i < TOTAL; i++) if (isFacility(board[i])) n++
  const bag = Array.isArray(s.bag) ? s.bag : []
  for (const slot of bag) if (slot && slot.k === 'item' && isFacility(slot.it)) n++
  return n
}

/** 兜底：产出源头一个都不剩时补回开局设施，避免玩家进入无法产出任何东西的死局 */
export function ensureFacilities(s: GameState, rng: Rng = Math.random): boolean {
  if (countFacilities(s) > 0) return false
  let placed = 0
  for (const f of START_FACILITIES) {
    const t = pickRandomEmpty(s.board, s.web, rng, s.bagAt ?? -1)
    if (t < 0) break
    s.board[t] = makeItem(f.chain, f.level)
    placed++
  }
  return placed > 0
}

// ==================== 链深度迁移 ====================

/**
 * 旧深度 → 新深度 的**顶端**等级映射。
 *
 * ★ 为什么只需要搬顶端：加深链路时 Lv1–3 的名字与含义**完全没变**（毛线球还是毛线球），
 *   只有链尾往后长了。所以：
 *     - toy / care / food：旧顶端 Lv4（猫城堡 / 美容台 / 豪华鲜食）→ 新顶端 Lv8
 *     - supply：旧末位 Lv2（豪华礼盒）→ 新末位 Lv4
 *     - fac：**不动**。旧 Lv1/Lv2（玩具架 / 玩具箱）含义没变，Lv3 玩具仓库是纯新增
 *
 * ★ 不做这一步的后果：旧存档里的猫城堡（Lv4）在新表里查出来是"猫抓板"——
 *   玩家的母体会**静默变成一个普通物品**，既不报错也不提示，属于最难受的那种丢数据。
 */
const DEPTH_TOP_MAP: Partial<Record<ChainKey, { from: number; to: number }>> = {
  toy: { from: 4, to: 8 },
  care: { from: 4, to: 8 },
  food: { from: 4, to: 8 },
  supply: { from: 2, to: 4 },
}

function moveToNewTop(it: BoardItem | null): BoardItem | null {
  if (!it) return it
  const m = DEPTH_TOP_MAP[it.chain]
  if (!m || it.level !== m.from) return it
  const next = makeItem(it.chain, m.to)
  // 剩余储备跟着搬（夹到新上限于），不让"改了一次表"就把玩家点掉的次数抹平
  const nd = defOf(next.chain, next.level)
  if (nd && typeof it.charges === 'number' && it.charges > 0) {
    next.charges = Math.min(it.charges, fullCharges(nd))
  }
  // 冷却状态跟着搬，否则"读一次档就白拿一次补满"
  if (it.cdAt) next.cdAt = it.cdAt
  if (it.cdLeft) next.cdLeft = it.cdLeft
  return next
}

/**
 * 把老存档的物品从旧链深搬到新链深。返回是否改过东西。
 * 幂等：`depthV` 已经是当前版本时直接返回 false。
 */
export function migrateChainDepth(s: GameState): boolean {
  if ((s.depthV ?? 1) >= CHAIN_DEPTH_V) return false

  const board = Array.isArray(s.board) ? s.board : []
  for (let i = 0; i < board.length; i++) board[i] = moveToNewTop(board[i])
  if (Array.isArray(s.bag)) {
    for (const slot of s.bag) {
      if (slot && slot.k === 'item') slot.it = moveToNewTop(slot.it) as BoardItem
    }
  }
  s.depthV = CHAIN_DEPTH_V
  return true
}

/** 棋盘上某一格是否存在某个链/等级的物品，返回下标 */
export function findItem(s: GameState, c: ChainKey, l: number): number {
  for (let i = 0; i < TOTAL; i++) {
    const it = s.board[i]
    if (it && it.chain === c && it.level === l) return i
  }
  return -1
}

/**
 * 校正棋盘与蛛网的矛盾状态：有物品的格子不可能同时有蛛网；
 * 背包格也不该有蛛网（蛛网只落空格，这里是老档 / 异常数据的兜底）。
 */
export function reconcileWebs(s: GameState): boolean {
  let dirty = false
  const bagAt = s.bagAt ?? -1
  for (let w = 0; w < TOTAL; w++) {
    if (s.web[w] && (s.board[w] || w === bagAt)) {
      s.web[w] = false
      dirty = true
    }
  }
  return dirty
}

export { COLS, ROWS, TOTAL, STAMINA_MAX, EXP_PER_LEVEL }
