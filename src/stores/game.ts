/**
 * 玩法状态中枢。
 *
 * 设计约定（沿用 P0 的代码层教训）：
 *   1. **任何改动 state 的分支都必须自己负责收尾**（刷新提示栏 / 存档），
 *      不能指望别的分支顺手帮它做 —— 原型曾因此漏刷耐久徽标。
 *   2. **改动 state 之前先把源元素 rect 取好**，`emit()` 之后棋盘元素可能已经被重建。
 *   3. 单条坏数据只清它自己，不能让异常冒到存档层（见 storage.ts）。
 */

import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { CHAINS, TREE_ORDER } from '../game/chains'
import {
  CUSTOMERS,
  DECORS,
  REGIONS,
  customerDef,
  decorDef,
  decorTotalLevel,
  regionDef,
  type RegionDef,
} from '../game/business'
import {
  AFFINITY_FULL,
  BAG_TOTAL,
  CLICK_COST,
  DAILY_FAC_LEVEL,
  INFINITE_MS,
  LUCKY_DECOR_TO_GEM,
  LUCKY_SKIN_TO_GEM,
  ORB_GREEN,
  ORB_PURPLE,
  ORB_STAMINA,
  QUEST_DELIVER,
  QUEST_MERGE,
  QUEST_PRODUCE,
  PET_ACCUM_MAX_HOURS,
  SHAKE_AMP,
  STAMINA_MAX,
  TOTAL,
  VIP_DAILY_GEM,
  VIP_DAILY_STAMINA,
  WEB_EVERY,
  WEB_MAX,
  orderTierDef,
} from '../game/config'
import {
  BONUS_AMOUNT,
  bagPrice,
  bagUsed,
  buyOrUpgradeDecor,
  canExpandBag,
  canUnlockRegion,
  coolingLeft,
  countEmpty,
  currentBonus,
  dayKey,
  decorLevel,
  decorNextCost,
  defOf,
  dropsDesc,
  ensureFacilities,
  exhaustTarget,
  findBagFree,
  findItem,
  fmtLeft,
  fmtMs,
  freshState,
  fullCharges,
  gainExp,
  findDisplaceCell,
  isBagCell,
  isClickable,
  isCooling,
  isFacility,
  isRegionUnlocked,
  isVip,
  itemKey,
  makeItem,
  makeOrder,
  maxLv,
  nextRegenIn,
  nextRegionToUnlock,
  orderCtxOf,
  pickRandomEmpty,
  moveBagTo,
  regionBonuses,
  resumeCooldown,
  rollDrops,
  rollRange,
  seedBag,
  seedBoard,
  staminaMax,
  suspendCooldown,
  tickAuto,
  tickGenerators,
  tickPets,
  tickRegen,
  trimBonusClaimed,
  webPrice,
  type GameState,
} from '../game/logic'
import {
  backupNow,
  clearSave,
  exportSaveText,
  importSaveText,
  listBackups,
  load,
  restoreBackup,
  save,
  saveInfo,
} from '../game/storage'
import { GOODS, goodsDef, shopSlotKey, type GoodsDef } from '../game/shop'
import {
  GIFTS,
  IAP_TIERS,
  LUCKY_META,
  FUND_META,
  fundClaimsReady,
  giftCountKey,
  giftDef,
  iapTier,
  payTier,
  spinOnce,
  vipNewUntil,
  vipPrice,
  type GiftGive,
  type LuckyPrize,
} from '../game/iap'
import { TOOL_ORDER, toolDef } from '../game/tools'
import type {
  BagSlot,
  BoardItem,
  ChainKey,
  DecorKey,
  Order,
  RegionKey,
  ResolvedDef,
  ToolKey,
} from '../game/types'
import { useFx, type Rect } from '../composables/useFx'
import { playMerge } from '../fx/sound'
import { nextPlot, plotDef, skinOf, type ThemeId } from '../game/yard'
import {
  FESTS,
  actsUnlocked,
  cardId,
  decodeLayout,
  encodeLayout,
  festActive,
  grantSkin,
  liftPlacement,
  noteSeen,
  placeDecor,
  readyBonds,
  rollQuestDay,
  rotatePlacement,
  setBan,
  storyLines,
  weatherOn,
} from '../game/content'

export const useGameStore = defineStore('game', () => {
  const fx = useFx()

  // ==================== 状态 ====================
  const g = ref<GameState | null>(null)

  /** 每秒刷新的“现在”，用来驱动体力倒计时与发射器 CD 倒计时 */
  const now = ref(Date.now())

  /** 各动画状态：记录格子下标，到时自动清除 */
  const popCells = reactive(new Set<number>())
  const glowCells = reactive(new Set<number>())
  const landedCells = reactive(new Set<number>())
  const clearingCells = reactive(new Set<number>())

  /** 底部提示栏文案（内部生成的富文本，用 v-html 渲染） */
  const hintHTML = ref('拖动相同物品合成 · 轻点带边框的物品产出 · 轻点🕸️花金币清除')

  /** 链树弹窗开关 */
  const treeOpen = ref(false)

  /** 背包弹窗开关 */
  const bagOpen = ref(false)

  /** 当前选中的棋盘格（长按物品进入选中态，提示栏会出现「存入背包」） */
  const selectedBoard = ref(-1)

  /** 待使用的道具。非空时，点击棋盘物品 = 对该物品使用这个道具 */
  const pendingTool = ref<ToolKey | null>(null)

  /** 经营弹窗开关（装饰 / 区域 / 顾客 三页签） */
  const businessOpen = ref(false)

  /** 经营弹窗的当前页签 */
  const bizTab = ref<'decor' | 'region' | 'customer'>('decor')

  let timer: ReturnType<typeof setInterval> | null = null

  // ==================== 派生 ====================
  const ready = computed(() => !!g.value)
  // 未 init 前也必须返回定长数组：棋盘组件会按 TOTAL 逐格取下标，
  // 返回空数组会让 web[i] 变成 undefined，触发 "Expected Boolean, got Undefined" 的 prop 警告
  const board = computed<readonly (BoardItem | null)[]>(
    () => g.value?.board ?? new Array(TOTAL).fill(null)
  )
  const web = computed<readonly boolean[]>(() => g.value?.web ?? new Array(TOTAL).fill(false))

  /** 体力上限 = 基础值 + 已解锁区域加成（洗护区 / 餐厅） */
  const staminaMaxN = computed(() => (g.value ? staminaMax(g.value) : STAMINA_MAX))

  const staminaPct = computed(() => {
    const max = staminaMaxN.value
    return g.value && max > 0 ? Math.min(100, (g.value.stamina / max) * 100) : 0
  })

  const bonus = computed(() => (g.value ? currentBonus(g.value, now.value) : null))
  const canClaimBonus = computed(() => !!bonus.value && !bonus.value.claimed)

  const staminaSub = computed(() => {
    if (!g.value) return ''
    if (canClaimBonus.value) return `可领 ${bonus.value!.label} +${BONUS_AMOUNT}`
    if (g.value.stamina >= STAMINA_MAX) return '已满'
    return `下一点 ${fmtMs(nextRegenIn(g.value, now.value))}`
  })

  /** 订单需求集合，用于给棋盘上的可交付物品打 ✓ 角标 */
  const orderNeed = computed(() => {
    const set = new Set<string>()
    for (const o of g.value?.orders ?? []) set.add(`${o.chain}:${o.level}`)
    return set
  })

  const orders = computed<Order[]>(() => g.value?.orders ?? [])
  const readyOrders = computed(
    () => orders.value.filter((o) => g.value && findItem(g.value, o.chain, o.level) !== -1).length
  )
  const price = computed(() => webPrice(g.value?.websCleared ?? 0))
  /**
   * 每个格子的冷却剩余毫秒（不在冷却 = 0）。
   * 组件靠它画冷却圆环与倒计时；**只在有冷却对象时才非零**。
   */
  const cdLeftByCell = computed<number[]>(() => {
    const out = new Array(TOTAL).fill(0)
    const s = g.value
    if (!s) return out
    const t = now.value
    for (let i = 0; i < TOTAL; i++) {
      const it = s.board[i]
      if (it) out[i] = Math.max(0, (it.cdAt ?? 0) - t)
    }
    return out
  })

  /** 全盘冷却中最长的剩余时间（给"设施都在冷却"这类整体提示用） */
  const anyCoolingLeft = computed(() => Math.max(0, ...cdLeftByCell.value))

  /** 今天的设施补给还没领 + 棋盘还有空位 */
  const canClaimFacility = computed(() => {
    if (!g.value) return false
    return g.value.facDay !== dayKey(now.value)
  })

  // ---- 背包 / 道具 / 选中 ----
  const bag = computed<readonly BagSlot[]>(() => g.value?.bag ?? new Array(BAG_TOTAL).fill(null))
  const bagCap = computed(() => g.value?.bagCap ?? 0)
  const bagUsedN = computed(() => (g.value ? bagUsed(g.value) : 0))
  const bagPriceNow = computed(() => bagPrice(g.value?.bagExpanded ?? 0))
  const canExpand = computed(() => (g.value ? canExpandBag(g.value) : false))
  const selectedItem = computed<BoardItem | null>(() =>
    g.value && selectedBoard.value >= 0 ? (g.value.board[selectedBoard.value] ?? null) : null
  )

  // ---- 经营层（第一批）----
  const stars = computed(() => g.value?.stars ?? 0)
  const petCount = computed(() => g.value?.pets.length ?? 0)
  const petCapHours = computed(() =>
    g.value ? regionBonuses(g.value).petHours : PET_ACCUM_MAX_HOURS
  )
  const regionBonus = computed(() => (g.value ? regionBonuses(g.value) : null))
  /** 乐园繁荣度 = 所有装饰的等级之和。**纯展示，无数值作用**（见 business.ts 的说明） */
  const decorLevelSum = computed(() => (g.value ? decorTotalLevel(g.value.decor ?? {}) : 0))

  /** 下一个可解锁的区域，UI 用它做红点 */
  const nextRegion = computed<RegionKey | null>(() =>
    g.value ? nextRegionToUnlock(g.value) : null
  )

  const regionList = computed(() =>
    REGIONS.map((r: RegionDef) => ({
      ...r,
      unlocked: g.value ? isRegionUnlocked(g.value, r.key) : false,
      canUnlock: g.value ? canUnlockRegion(g.value, r.key) : false,
      /** 还差多少级 */
      gap: g.value ? Math.max(0, r.unlockLevel - g.value.level) : r.unlockLevel,
    }))
  )

  const decorList = computed(() =>
    DECORS.map((d) => {
      const level = g.value ? decorLevel(g.value, d.key) : 0
      const cost = g.value ? decorNextCost(g.value, d.key) : -2
      return { ...d, level, cost, maxed: cost === -1, owned: level > 0 }
    })
  )

  const customerList = computed(() =>
    CUSTOMERS.map((c) => {
      const affinity = g.value?.affinity[c.key] ?? 0
      const isPet = !!g.value?.pets.includes(c.key)
      return { ...c, affinity, isPet, pct: Math.min(100, (affinity / AFFINITY_FULL) * 100) }
    })
  )

  const petList = computed(() => customerList.value.filter((c) => c.isPet))

  /** 订单展示数据：档位名 / 顾客 / 剩余时间 —— UI 不用自己拼 */
  const orderCards = computed(() =>
    orders.value.map((o) => {
      const tier = orderTierDef(o.tier)
      const c = customerDef(o.customer)
      return {
        ...o,
        tierName: tier.name,
        tierMult: tier.mult,
        customerName: c?.name ?? '神秘顾客',
        customerEmoji: c?.emoji ?? '❔',
        leftMs: Math.max(0, o.expireAt - now.value),
        ready: !!g.value && findItem(g.value, o.chain, o.level) !== -1,
      }
    })
  )

  // ==================== 小工具 ====================
  function defAt(i: number): ResolvedDef | null {
    const it = g.value?.board[i]
    return it ? defOf(it.chain, it.level) : null
  }

  function persist(): void {
    if (g.value) save(g.value)
  }

  function touchQuest(kind: 'merge' | 'deliver' | 'produce'): void {
    if (!g.value?.live) return
    rollQuestDay(g.value.live, dayKey(now.value))
    if (kind === 'merge') g.value.live.questMerge++
    else if (kind === 'deliver') {
      g.value.live.questDeliver++
      g.value.live.delivers++
    } else g.value.live.questProduce++
  }

  function flag(set: Set<number>, i: number, ms: number): void {
    set.add(i)
    setTimeout(() => set.delete(i), ms)
  }

  /** 取某格中心的屏幕坐标（拿不到就退化成棋盘中心） */
  function cellCenter(i: number): { x: number; y: number } {
    const r = fx.getCellRect(i)
    if (r) return fx.centerOfRect(r)
    const b = fx.getBoardRect()
    return b ? fx.centerOfRect(b) : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  }

  // ==================== 生命周期 ====================
  function init(): void {
    const loaded = load()
    if (loaded) {
      g.value = loaded.state
      // 旧存档被迁移过就立刻回写，避免玩家不操作时迁移结果丢失
      if (loaded.dirty) persist()
    } else {
      const s = freshState()
      g.value = s
      seedBag(s)
      seedBoard(s)
      persist()
    }
    tickRegen(g.value, Date.now())
    fx.pendingCells.clear()
    now.value = Date.now()
    // 老存档兜底：产出源头一个都不剩就补回开局设施（否则玩家进入无法产出的死局）
    if (ensureFacilities(g.value)) {
      fx.toast('检测到没有设施了 —— 已补回玩具架与玩具箱')
      persist()
    }
    // 每天第一次启动时自动备份一份（轮转 3 槽）。
    // ★ 放在 init 而不是每秒 tick：备份是 IO，不该在一秒一次的循环里反复判断。
    if (g.value.bakDay !== dayKey(now.value)) {
      const slot = backupNow(g.value)
      g.value.bakDay = dayKey(now.value)
      if (slot) fx.toast(`已自动备份存档（第 ${slot} 号槽位）`)
      persist()
    }
    tickBusiness(now.value)

    if (timer) clearInterval(timer)
    // 每秒刷新：体力恢复 + 补贴可领 + 设施冷却补满 + 经营层结算
    timer = setInterval(() => {
      if (!g.value) return
      now.value = Date.now()
      let dirty = tickRegen(g.value, now.value)
      if (tickBusiness(now.value)) dirty = true
      if (dirty) persist()
    }, 1000)

    // 手机切后台时 setInterval 会被节流，回到前台要立刻补算
    document.addEventListener('visibilitychange', onVisible)
  }

  function onVisible(): void {
    if (document.visibilityState !== 'visible' || !g.value) return
    now.value = Date.now()
    let dirty = tickRegen(g.value, now.value)
    if (tickBusiness(now.value)) dirty = true
    if (dirty) persist()
  }

  /**
   * 时间驱动的结算：设施冷却补满 / 常驻宠物离线产出 / 订单到期重抽 / 诊疗室每日升级卡。
   * 全部放进同一个入口，避免以后新增"按时间发货"的功能时散落到各处漏掉。
   */
  function tickBusiness(nowMs: number): boolean {
    if (!g.value) return false
    let dirty = false

    // ① 冷却型设施 / 母体：到点把储备补满
    //    必须在这里补（而不是等玩家点击时才结算），否则冷却圆环会一直停在满格、看起来像没生效
    const refilled = tickGenerators(g.value, nowMs)
    if (refilled.length) {
      for (const i of refilled) {
        const c = cellCenter(i)
        fx.burst(c.x, c.y, '#4CAF50', 12, 0.8)
        fx.ring(c.x, c.y, '#4CAF50', 40, 2.4)
        fx.floatText(c.x, c.y - 22, '储备已补满', '#3B6D11')
      }
      dirty = true
    }

    // ② 常驻宠物：每只每小时一次，离线最多累积 petCapHours 小时（午睡区可提升）
    const gain = tickPets(g.value, nowMs)
    if (gain.hours > 0 && gain.gold > 0) {
      const b = fx.getBoardRect()
      const x = b ? fx.centerOfRect(b).x : window.innerWidth / 2
      const y = b ? b.top + 70 : window.innerHeight / 2
      fx.floatText(x, y, `+${gain.gold} 🪙`, '#EF9F27')
      fx.burst(x, y, '#EF9F27', 12, 0.9)
      fx.toast(
        `常驻宠物帮忙看店：${gain.hours}h 产出 ${gain.gold} 🪙${
          gain.gem ? ` +${gain.gem} 💎` : ''
        }`
      )
      dirty = true
    }

    // ③ 自动型发射器：按间隔自己释放（不耗体力，有累积上限）
    const auto = tickAuto(g.value, nowMs)
    if (auto.cells.length || auto.gold || auto.gem) {
      for (const i of auto.cells) {
        const c = cellCenter(i)
        fx.ring(c.x, c.y, '#E08A3C', 36, 2.2)
        fx.burst(c.x, c.y, '#E08A3C', 8, 0.6)
      }
      if (auto.gold) {
        const b = fx.getBoardRect()
        const x = b ? fx.centerOfRect(b).x : window.innerWidth / 2
        const y = b ? b.top + 70 : window.innerHeight / 2
        fx.floatText(x, y, `+${auto.gold} 🪙`, '#EF9F27')
      }
      const n = auto.cells.length
      fx.toast(
        `自动型设施自己转起来了：${n} 处产出${auto.gold ? ` · ${auto.gold} 🪙` : ''}${
          auto.gem ? ` · ${auto.gem} 💎` : ''
        }`
      )
      dirty = true
    }

    // ④ 订单到期：重抽。过期的订单不能一直占着槽位，否则玩家会以为游戏卡住了
    let expired = 0
    g.value.orders = g.value.orders.map((o) => {
      if (o.expireAt > nowMs) return o
      expired++
      return makeOrder(orderCtxOf(g.value!, nowMs))
    })
    if (expired) {
      fx.toast(`${expired} 个订单到期，顾客重新排了单`)
      dirty = true
    }

    // ⑤ 诊疗室：每天赠送 1 张升级卡
    if (isRegionUnlocked(g.value, 'clinic')) {
      const key = dayKey(nowMs)
      if (g.value.cardDay !== key && addToolToBag('upgradeCard', 1)) {
        g.value.cardDay = key
        fx.toast('🩺 诊疗室今日赠送：🎟️ 升级卡 ×1（已放进背包）')
        dirty = true
      }
      // 背包满时不写 cardDay —— 等玩家腾出位置再发，不吞这份收益
    }

    if (g.value.live) {
      g.value.live.playMs += 1000
      rollQuestDay(g.value.live, dayKey(nowMs))
      const day = dayKey(nowMs)
      if (weatherOn(day) === 'rain' && g.value.live.weatherTold !== day) {
        g.value.live.weatherTold = day
        fx.toast('下雨了：今天的护理订单金币翻倍')
        dirty = true
      }
      const bonds = readyBonds(g.value.live, g.value.pets)
      if (bonds.length && g.value.live.bondDay !== day) {
        g.value.live.bondDay = day
        for (const b of bonds) {
          const t = pickRandomEmpty(g.value.board, g.value.web, Math.random, g.value.bagAt)
          if (t < 0) break
          g.value.board[t] = makeItem(b.chain, b.level)
          noteSeen(g.value.live, b.chain, b.level)
        }
        fx.toast(`羁绊触发：${bonds.map((b) => b.name).join('、')}`)
        dirty = true
      }
    }

    return dirty
  }

  function dispose(): void {
    if (timer) clearInterval(timer)
    timer = null
    document.removeEventListener('visibilitychange', onVisible)
  }

  // ==================== 物品描述 ====================
  /**
   * 把一个可点击对象的「耗尽后会发生什么」写成一句人话。
   * 这段文案是玩家理解链路设计的**主要入口**（图鉴里用的也是同一套说法），
   * 所以三种行为必须用词一致：补充 / 变成 / 消失。
   */
  function exhaustText(d: ResolvedDef): string {
    const refill = d.refillMs ?? 0
    if (refill > 0) return `储备用完后 ${fmtLeft(refill)} 自动补满，<b>不会消失</b>`
    const t = d.exhaust
    if (t && t.kind === 'convert') {
      const nd = defOf(t.to, t.level)
      return `<b>释放完会变成 ${nd?.emoji ?? ''}${nd?.name ?? '另一样东西'}</b>`
    }
    return '储备用完即消失（一次性物资包）'
  }

  function describe(it: BoardItem): string {
    const d = defOf(it.chain, it.level)
    if (!d) return ''
    const ch = CHAINS[it.chain]
    const cool = (d.refillMs ?? 0) > 0 ? `（冷却 ${fmtLeft(d.refillMs!)}）` : ''
    const stock = isCooling(it, now.value)
      ? `<b class="warn">补充中 ${fmtLeft(coolingLeft(it, now.value))}</b>`
      : `储备 ${it.charges}/${fullCharges(d)}${cool}`

    if (d.kind === 'generator') {
      return `<b>${d.name}</b>　Lv${it.level}　母体 · ${stock}　点击产出 ${dropsDesc(
        d.drops ?? []
      )}　<b>母体不可合成</b>；${exhaustText(d)}`
    }
    if (d.kind === 'producer') {
      const pn = defOf(it.chain, it.level + 1)
      const chainName = it.chain === 'fac' ? '设施' : ch.name
      return `<b>${d.name}</b>　Lv${it.level}　${chainName}　${stock}　点击产出 ${dropsDesc(
        d.drops ?? []
      )}；${exhaustText(d)}${
        pn ? `　再合 1 个 → ${pn.emoji}${pn.name}（储备重置为满）` : '　<b>已是链的终点</b>'
      }`
    }
    if (d.kind === 'final') {
      return `<b>${d.name}</b>　Lv${it.level}　${ch.name}顶级 · 只用于交付订单`
    }
    const nxt = defOf(it.chain, it.level + 1)
    if (!nxt) return `<b>${d.name}</b>　Lv${it.level}　${ch.name}`
    return `<b>${d.name}</b>　Lv${it.level}　${ch.name}　再合 1 个 → ${nxt.emoji}${
      nxt.kind === 'generator' ? '母体' + nxt.name : nxt.name
    }`
  }

  // ==================== 产出：抛物线抛出 ====================
  /**
   * 把新物品放进随机空格并播放飞行；返回落点格号。
   * @param srcRect 源元素位置，**必须在改动 state 之前取好**
   */
  function emit(srcRect: Rect | null, c: ChainKey, l: number): number {
    if (!g.value) return -1
    const target = pickRandomEmpty(g.value.board, g.value.web, Math.random, g.value.bagAt)
    if (target === -1) {
      fx.toast('棋盘已满，先合成、清除蛛网或交付订单')
      return -1
    }

    const it = makeItem(c, l)
    const d = defOf(c, l)
    g.value.board[target] = it
    // 目标格先放一个透明占位，等飞行落地再显形
    fx.pendingCells.add(target)

    fx
      .flyTo(srcRect, target, {
        emoji: d?.emoji ?? '❔',
        sprite: d?.sprite ?? '',
        bg: d?.bg ?? '#eeeeee',
        fg: d?.fg ?? '#333333',
      })
      .then(() => {
        fx.pendingCells.delete(target)
        flag(landedCells, target, 240)
        const cc = cellCenter(target)
        fx.burst(cc.x, cc.y, d?.fx ?? '#1D9E75', 6, 0.5)
      })

    return target
  }

  /**
   * ★ 已删除 `spawn(idx)`（2026-10-02 第二轮设计修正）。
   *
   * 原来"玩具架 / 玩具箱"是棋盘下方一条独立工具栏里的两个按钮，各自带自己的
   * **每次点击冷却**（4s / 10s）—— 这是错的，两个问题：
   *   ① 它们本该是**主场景里的常驻母体**（棋盘上的对象），而不是外挂按钮；
   *   ② 节奏阀应该是「储备耗尽后一次性冷却」，不是"点一下等一会儿"。
   *
   * 现在它们就是设施链（`fac`）的两个链物品，走统一的 `produce()`：
   * 储备 8 / 12 次可连点，耗尽后冷却 60s / 90s 补满，永不消失，还能拖进背包。
   */

  /** 资源掉落直接进余额、不占棋盘格 */
  function addResource(kind: 'gold' | 'gem', amount: number): void {
    if (!g.value) return
    const b = fx.getBoardRect()
    const x = b ? fx.centerOfRect(b).x : window.innerWidth / 2
    const y = b ? b.top + 40 : window.innerHeight / 2
    const color = kind === 'gold' ? '#EF9F27' : '#7F77DD'
    if (kind === 'gold') g.value.gold += amount
    else g.value.gem += amount
    fx.floatText(x, y, `+${amount} ${kind === 'gold' ? '🪙' : '💎'}`, color)
    fx.burst(x, y, color, 12, 0.85)
    fx.ring(x, y, color, 34, 2.2)
  }

  // ==================== 点击产出（设施 / 母体 / 链中段）====================
  /**
   * 点击一个可点击对象。
   *
   * ★ 储备 + 一次性冷却模型（本轮设计修正的核心）：
   *   - 每点一次只扣 1 点**储备**，**不进冷却** —— 玩家可以连着释放完（玩具架 8 次）；
   *   - 储备归零时才按 `exhaustMode()` 分三条路收尾：
   *       **冷却型** → 记 cdAt，到点由 `tickGenerators()` 补满，主体**永不消失**
   *       **转化型** → 原地变成另一个物品（猫城堡 → 伴手礼 / 豪华礼盒 → 玩具架）
   *       **消失型** → 直接移除（链中段的 Lv3 一次性物资包）
   *   原来的实现是"点一次冷却一次"，方向完全错了。
   */
  function produce(cellIdx: number): void {
    if (!g.value) return
    const it = g.value.board[cellIdx]
    if (!it) return
    const d = defOf(it.chain, it.level)
    if (!isClickable(d)) return
    if (typeof it.charges !== 'number') it.charges = fullCharges(d) // 兼容旧存档

    // 储备为 0：正在冷却就说清还剩多久，而不是静默不动
    if (it.charges <= 0) {
      const left = coolingLeft(it, Date.now())
      if (left > 0) fx.toast(`${d.name} 补充中 · 还需 ${fmtLeft(left)}`)
      else fx.toast(`${d.name} 储备已耗尽`)
      return
    }
    const freeClick = (g.value.live?.infiniteUntil ?? 0) > Date.now()
    if (!freeClick && g.value.stamina < CLICK_COST) {
      fx.toast('体力不足 · 每 2 分钟恢复 1 点')
      return
    }

    const drop = rollDrops(d.drops ?? [])
    const isRes = drop.type !== 'item'
    // 货币直接进余额、不占棋盘格，所以只有产物品时才需要预检空格
    if (!isRes && pickRandomEmpty(g.value.board, g.value.web, Math.random, g.value.bagAt) === -1) {
      fx.toast('棋盘已满，先合成、清除蛛网或交付订单')
      return
    }

    // 位置与中心点必须在改动 state 之前取好（储备变化会让元素被重建，重建后 rect 归零）
    const cc = cellCenter(cellIdx)
    const srcRect = fx.getCellRect(cellIdx)

    if (!freeClick) g.value.stamina -= CLICK_COST
    it.charges--
    touchQuest('produce')

    if (drop.type === 'gold' || drop.type === 'gem') {
      // 资源掉落：加余额 + 飘字 + 轻微粒子，不进棋盘
      const amount = rollRange(drop.min, drop.max)
      const isGold = drop.type === 'gold'
      const rcol = isGold ? '#EF9F27' : '#7F77DD'
      if (isGold) g.value.gold += amount
      else g.value.gem += amount
      fx.floatText(cc.x, cc.y - 10, `+${amount} ${isGold ? '🪙' : '💎'}`, rcol)
      fx.burst(cc.x, cc.y, rcol, 12, 0.85)
      fx.ring(cc.x, cc.y, rcol, 34, 2.2)
      // 资源掉落不走 emit()，所以必须自己刷新该格的储备徽标
      flag(glowCells, cellIdx, 300)
    } else {
      emit(srcRect, drop.chain, drop.level)
      const pkd = defOf(drop.chain, drop.level)
      fx.ring(cc.x, cc.y, pkd?.fx ?? '#1D9E75', 40, 2.5)
      fx.floatText(cc.x, cc.y - 10, CHAINS[drop.chain].name, pkd?.fx ?? '#1D9E75')
    }

    // ---- 储备归零：三种收尾 ----
    if (it.charges <= 0) {
      const refill = d.refillMs ?? 0
      if (refill > 0) {
        // 冷却型：占着格子等补充，主体永不消失
        it.cdAt = Date.now() + refill
        fx.burst(cc.x, cc.y, d.fx, 14, 0.9)
        fx.ring(cc.x, cc.y, d.fx, 46, 3)
        fx.floatText(cc.x, cc.y - 26, '储备耗尽', '#8A8781')
        fx.toast(`${d.name} 储备用完，${fmtLeft(refill)} 后自动补满 —— 设施不会消失`)
        // 冷却状态变化必须让元素重建，否则冷却圆环与倒计时不会出现
        flag(glowCells, cellIdx, 460)
        fx.haptic(20)
      } else {
        const target = exhaustTarget(d)
        if (target) {
          const nd = defOf(target.to, target.level)
          g.value.board[cellIdx] = makeItem(target.to, target.level)
          flag(popCells, cellIdx, 360)
          flag(glowCells, cellIdx, 420)
          fx.burst(cc.x, cc.y, nd?.fx ?? d.fx, 26, 1.3)
          fx.ring(cc.x, cc.y, nd?.fx ?? d.fx, 58, 3.5)
          fx.floatText(cc.x, cc.y - 6, `${nd?.emoji ?? ''} ${nd?.name ?? ''}`, nd?.fx ?? d.fx)
          fx.toast(`${d.name} 释放完毕，变成了 ${nd?.name ?? '新的东西'}`)
          if (SHAKE_AMP > 0) fx.shake(SHAKE_AMP)
          fx.haptic(26)
        } else {
          g.value.board[cellIdx] = null
          fx.burst(cc.x, cc.y, d.fx, 18, 1.1)
          fx.ring(cc.x, cc.y, d.fx, 54, 3)
          fx.floatText(cc.x, cc.y - 28, `${d.name} 已耗尽`, '#8A8781')
          fx.toast(`${d.name} 用完已消失 —— 需要重新合成一个`)
          fx.haptic(22)
        }
      }
    } else {
      flag(glowCells, cellIdx, 260)
      fx.haptic(9)
    }

    countProduce(drop.type === 'item' ? { chain: drop.chain, level: drop.level } : undefined)
    persist()
  }

  // ==================== 蛛网 ====================
  /** 每次产出后累计计数，到阈值就落一张蛛网（前期节奏阀） */
  function countProduce(dropped?: { chain: ChainKey; level: number }): void {
    if (!g.value) return
    if (dropped) noteSeen(g.value.live, dropped.chain, dropped.level)
    g.value.produces++
    if (g.value.produces % WEB_EVERY !== 0) return
    if (addWeb()) fx.toast('棋盘上出现了蛛网 —— 轻点花金币清除，或拖一个物品上去牺牲它')
  }

  function addWeb(): boolean {
    if (!g.value) return false
    if (g.value.web.filter(Boolean).length >= WEB_MAX) return false

    const cands: number[] = []
    for (let i = 0; i < TOTAL; i++) {
      // 背包格不算空位：蛛网不许盖住背包（盖住就点不开了）
      if (i === g.value.bagAt) continue
      if (!g.value.web[i] && g.value.board[i] === null) cands.push(i)
    }
    if (!cands.length) return false

    const t = cands[Math.floor(Math.random() * cands.length)]
    g.value.web[t] = true
    const c = cellCenter(t)
    fx.ring(c.x, c.y, '#BA7517', 40, 2.5)
    fx.burst(c.x, c.y, '#DCD5CA', 10, 0.7)
    return true
  }

  function removeWeb(i: number): { x: number; y: number } {
    const c = cellCenter(i)
    if (g.value) {
      g.value.web[i] = false
      g.value.websCleared++
    }
    flag(clearingCells, i, 320)
    fx.burst(c.x, c.y, '#BA7517', 16, 1.0)
    fx.ring(c.x, c.y, '#BA7517', 46, 3)
    return c
  }

  /** 方式一：轻点蛛网 → 花金币清除（价格随已清除数量递增） */
  function tapWeb(i: number): void {
    if (!g.value) return
    const p = webPrice(g.value.websCleared)
    if (g.value.gold < p) {
      fx.toast(`金币不足 · 清除蛛网需 ${p} 🪙`)
      return
    }
    g.value.gold -= p
    const c = removeWeb(i)
    fx.floatText(c.x, c.y - 6, `-${p} 🪙`, '#854F0B')
    fx.haptic(12)
    persist()
  }

  /** 方式二：把物品拖到蛛网上 → 牺牲该物品换一个空格 */
  function sacrificeToWeb(webIdx: number, fromIdx: number): boolean {
    if (!g.value) return false
    const it = g.value.board[fromIdx]
    if (!it) return false
    // ★ 禁止牺牲设施：设施是产出源头，被吃掉会让玩家彻底失去产出能力（死局）。
    //   这是"设施常驻 / 永不消失"这条设计必须配套的保护。
    if (isFacility(it)) {
      fx.toast('设施不能被牺牲 —— 它是产出源头。想腾格子请把它拖进背包，或花金币清网')
      return false
    }
    const d = defOf(it.chain, it.level)
    const c = removeWeb(webIdx)
    g.value.board[fromIdx] = null
    fx.burst(c.x, c.y, d?.fx ?? '#1D9E75', 14, 1.0)
    fx.floatText(c.x, c.y - 6, `${d?.emoji} 被蛛网吞掉`, '#854F0B')
    fx.toast(`牺牲了 ${d?.name} 换回一个空格 —— 也可以改用金币清除`)
    fx.haptic(14)
    persist()
    return true
  }

  // ==================== 合成 ====================
  function merge(from: number, to: number): boolean {
    if (!g.value) return false
    const it = g.value.board[from]
    if (!it) return false

    const k = it.chain
    const lv = it.level
    const dFrom = defOf(k, lv)
    if (!dFrom) return false

    // 顶端是链的终点：母体不可合成，纯任务物品也不可合成
    if (lv >= maxLv(k)) {
      fx.toast(dFrom.kind === 'generator' ? '母体不可合成' : '已是顶端，不能再合成')
      return false
    }

    const nextLv = lv + 1
    const dNext = defOf(k, nextLv)
    if (!dNext) return false

    // 甲·重置为满：合成出的发射器耐久一律回满，两个素材各自剩多少耐久都不继承。
    // 于是"点剩最后 1 次再合成"从"必须留 1 次才能合"升级成隐藏福利 ——
    // 下面把白赚的次数算出来，合成后显性化反馈给玩家（藏着不说等于没有）。
    const itB = g.value.board[to]
    let spent = 0
    if (isClickable(dNext)) {
      const fullFrom = fullCharges(dFrom)
      if (typeof it.charges === 'number') spent += Math.max(0, fullFrom - it.charges)
      if (itB && typeof itB.charges === 'number') spent += Math.max(0, fullFrom - itB.charges)
    }

    g.value.board[from] = null
    const newIt = makeItem(k, nextLv)
    g.value.board[to] = newIt
    g.value.merges++
    touchQuest('merge')
    noteSeen(g.value.live, k, nextLv)
    if (g.value.live.sound) playMerge()

    // 走到链的终点（母体 / 纯任务物品 / 无顶端的最高级）才算里程碑
    const isMilestone = nextLv >= maxLv(k)
    flag(popCells, to, 360)
    flag(glowCells, to, 420)

    const c = cellCenter(to)
    const col = dNext.fx
    // 粒子随等级递增：撤掉屏幕震动后，用局部特效承担"越合越爽"的反馈
    const lvBoost = Math.min(nextLv, 6) * 2
    fx.burst(c.x, c.y, col, (isMilestone ? 30 : 18) + lvBoost, isMilestone ? 1.5 : 1.05 + nextLv * 0.03)
    fx.burst(c.x, c.y, '#FFFFFF', isMilestone ? 14 : 8, 0.8)
    fx.ring(c.x, c.y, col, isMilestone ? 68 : 42 + nextLv * 3, isMilestone ? 4 : 3)

    const label = isMilestone
      ? dNext.kind === 'generator'
        ? `母体 · ${dNext.name}`
        : dNext.kind === 'producer'
          ? `终点 · ${dNext.name}`
          : dNext.name
      : `Lv${nextLv}`
    fx.floatText(c.x, c.y - 6, label, col)

    if (spent > 0) {
      setTimeout(() => {
        fx.toast(
          `隐藏福利：${dNext.name} 耐久重置为满 ${fullCharges(dNext)} 次 —— 你之前点掉的 ${spent} 次白赚了`
        )
      }, 430)
    }

    // 震动：全局统一振幅，所有合成完全一致
    if (SHAKE_AMP > 0) fx.shake(SHAKE_AMP)
    fx.haptic(isMilestone ? 26 : 12)

    // 解锁下一条链
    if (dNext.kind === 'generator' && dNext.produces) {
      g.value.gensMade++
      const pk = dNext.produces
      if (unlockChain(pk)) {
        setTimeout(() => {
          fx.toast(`解锁 ${CHAINS[pk].name}！${dNext.name} 点击可产出 ${defOf(pk, 1)?.name ?? ''}`)
        }, 260)
      }
    }

    persist()
    return true
  }

  /** 解锁一条新链；成功则重抽订单（订单只从已解锁的链里出） */
  function unlockChain(k: ChainKey): boolean {
    if (!g.value || g.value.unlocked[k]) return false
    g.value.unlocked[k] = true
    g.value.orders = g.value.orders.map(() => makeOrder(orderCtxOf(g.value!)))
    return true
  }

  function moveItem(from: number, to: number): void {
    if (!g.value) return
    g.value.board[to] = g.value.board[from]
    g.value.board[from] = null
    fx.haptic(6)
    persist()
  }

  // ==================== 挤出 / 换位（拖到占用格的落点规则）====================
  /**
   * 2026-10-02 交互修正：把物品拖到**被占用且不可合成**的格子上时，
   * 原物品不是"纹丝不动"，而是：
   *   1. 被挤到周围 8 格里的随机空位；
   *   2. 周围都满 → 再外一圈的随机空位；
   *   3. 全满 → 与拖入的物品**换位**。
   * 蛛网牺牲 / 空格移动 / 同链合成在 GameBoard.onDrop 里已先行分流，不会走到这里。
   * 背包格是这里的硬禁区（背包不可被挤走），onDrop 的 bag-cell 分支同样先行分流。
   */
  function displaceDrop(from: number, to: number): boolean {
    if (!g.value) return false
    if (from === to || isBagCell(g.value, to)) return false
    const a = g.value.board[from]
    const b = g.value.board[to]
    if (!a || !b) return false

    const t = findDisplaceCell(g.value.board, g.value.web, to, g.value.bagAt)
    if (t === 'swap') {
      g.value.board[to] = a
      g.value.board[from] = b
      fx.haptic(12)
      fx.toast('棋盘满了 —— 两个物品换了位置')
    } else {
      g.value.board[t] = b
      g.value.board[to] = a
      g.value.board[from] = null
      const c = cellCenter(t)
      fx.floatText(c.x, c.y - 6, `${defOf(b.chain, b.level)?.emoji ?? ''} 被挤开`, '#854F0B')
      fx.haptic(8)
    }
    persist()
    return true
  }

  // ==================== 交付订单 ====================
  function deliver(orderId: string): boolean {
    if (!g.value) return false
    const idx = g.value.orders.findIndex((o) => o.id === orderId)
    if (idx === -1) return false

    const o = g.value.orders[idx]
    const slot = findItem(g.value, o.chain, o.level)
    if (slot === -1) {
      fx.toast('棋盘上没有这个物品')
      return false
    }

    const c = cellCenter(slot)
    g.value.board[slot] = null
    g.value.gold += o.gold
    // 星星与金币分开走：星星是装饰专用货币，与主经济隔离（文档 9.1）
    g.value.stars += o.stars

    // 好感度记在发单顾客头上。**已转化为常驻宠物的顾客不再累积** ——
    // 否则好感条会一直涨到没有意义，而且会掩盖"这只已经转化过了"这个事实。
    const cust = customerDef(o.customer)
    let becamePet = false
    if (!g.value.pets.includes(o.customer)) {
      const next = (g.value.affinity[o.customer] ?? 0) + o.affinity
      if (next >= AFFINITY_FULL) {
        g.value.affinity[o.customer] = AFFINITY_FULL
        g.value.pets.push(o.customer)
        becamePet = true
      } else {
        g.value.affinity[o.customer] = next
      }
      const after = g.value.affinity[o.customer] ?? 0
      const prevActs = actsUnlocked(Math.max(0, after - o.affinity))
      const nowActs = actsUnlocked(after)
      if (nowActs > prevActs && cust) {
        fx.toast(`${cust.emoji} ${storyLines(o.customer)[nowActs - 1]}`)
      }
      if (nowActs >= 2 && !g.value.live.cards.includes(cardId(o.customer))) {
        g.value.live.cards.push(cardId(o.customer))
        fx.toast(`获得故事卡 · ${cust?.name ?? '顾客'}`)
      }
    }
    touchQuest('deliver')

    fx.burst(c.x, c.y, '#BA7517', 20, 1.1)
    fx.ring(c.x, c.y, '#BA7517', 44, 3)
    fx.floatText(c.x, c.y - 6, `+${o.gold} 🪙`, '#BA7517')
    if (o.stars > 0) fx.floatText(c.x + 30, c.y - 24, `+${o.stars} ⭐`, '#854F0B')

    const leveled = gainExp(g.value, o.exp)
    fx.haptic(18)

    if (leveled) {
      if (SHAKE_AMP > 0) fx.shake(SHAKE_AMP)
      const vw = window.innerWidth
      const vh = window.innerHeight
      for (let n = 0; n < 3; n++) {
        setTimeout(() => {
          fx.burst(vw * (0.25 + n * 0.25), vh * 0.32, '#7F77DD', 22, 1.4)
          fx.ring(vw * (0.25 + n * 0.25), vh * 0.32, '#7F77DD', 60, 4)
        }, n * 110)
      }
      fx.floatText(vw / 2, vh * 0.3, `Lv${g.value.level} 达成`, '#7F77DD')
      fx.haptic(40)

      // 升级后如果有区域可以解锁，主动提示 —— 否则玩家根本不知道"经营"里多了东西
      const nr = nextRegionToUnlock(g.value)
      const nd = nr ? regionDef(nr) : null
      if (nd) {
        setTimeout(() => {
          fx.toast(`🏗️ ${nd.emoji} ${nd.name} 可以解锁了 —— 打开底部「经营」建设乐园`)
        }, 560)
      }
    }

    // 顾客转化为常驻宠物（好感满格）
    if (becamePet && cust) {
      const b = fx.getBoardRect()
      const px = b ? fx.centerOfRect(b).x : window.innerWidth / 2
      const py = b ? b.top + 120 : window.innerHeight / 2
      fx.burst(px, py, '#7F77DD', 26, 1.4)
      fx.ring(px, py, '#7F77DD', 64, 3.5)
      fx.floatText(px, py, `${cust.emoji} ${cust.name} 常驻`, '#7F77DD')
      fx.haptic(30)
      setTimeout(() => {
        fx.toast(
          `${cust.emoji} ${cust.name} 决定留下来 ——「${cust.quote}」常驻宠物会每小时自动产出 🪙`
        )
      }, 340)
    }

    g.value.orders[idx] = makeOrder(orderCtxOf(g.value))
    persist()
    return true
  }

  function deliverAll(): void {
    if (!g.value) return
    const ids = g.value.orders
      .filter((o) => findItem(g.value!, o.chain, o.level) !== -1)
      .map((o) => o.id)
    if (!ids.length) {
      fx.toast('没有可交付的订单')
      return
    }
    let done = 0
    for (const id of ids) if (deliver(id)) done++
    if (done) fx.toast(`已交付 ${done} 个订单`)
  }

  // ==================== 每日补贴 ====================
  function claimBonus(): void {
    if (!g.value) return
    const b = currentBonus(g.value, now.value)
    if (!b) return
    if (b.claimed) {
      fx.toast(`${b.label} 的体力补贴已领取`)
      return
    }
    g.value.bonusClaimed[b.key] = 1
    trimBonusClaimed(g.value)
    g.value.stamina += BONUS_AMOUNT // 补贴可突破上限
    fx.haptic(24)
    fx.toast(`已领取 ${b.label} 体力补贴 +${BONUS_AMOUNT}`)
    persist()
  }

  // ==================== 背包（纯收纳箱）====================
  /** 背包还有没有空位（决定"拖物品到背包格"是否提示可放） */
  const bagHasSpace = computed(() => (g.value ? findBagFree(g.value) >= 0 : false))

  /**
   * 拖动背包（棋盘上的"背包道具"）到另一个格子。
   * 只能落到非蛛网空格；拖回原地 = 无事发生。
   */
  function moveBag(to: number): boolean {
    if (!g.value) return false
    if (!moveBagTo(g.value, to)) return false
    fx.haptic(8)
    persist()
    return true
  }

  /**
   * 存入背包。
   * 背包是**纯存储**：放进去的物品冻结（不能点击产出、不走冷却、不消耗储备），
   * 与对标截图底部那句"在背包中的元素无法恢复时间"同义 —— 它同时也是一个防手滑误点的工具。
   *
   * ★ 冻结必须连冷却一起冻结：`suspendCooldown()` 把剩余冷却转成毫秒存下来。
   *   否则"把冷却中的设施塞进背包再拿出来"就白拿一次补满，背包会变成跳过冷却的漏洞。
   */
  function moveToBag(boardIdx: number): boolean {
    if (!g.value) return false
    const it = g.value.board[boardIdx]
    if (!it) return false

    const target = findBagFree(g.value)
    if (target === -1) {
      fx.toast('背包已满 —— 花金币扩容，或先取出一件')
      return false
    }

    const rect = fx.getCellRect(boardIdx)
    suspendCooldown(it)
    g.value.bag[target] = { k: 'item', it }
    g.value.board[boardIdx] = null
    selectedBoard.value = -1

    if (rect) {
      const c = fx.centerOfRect(rect)
      fx.burst(c.x, c.y, defOf(it.chain, it.level)?.fx ?? '#1D9E75', 10, 0.8)
      fx.floatText(c.x, c.y - 8, '已存入背包', '#185FA5')
    }
    fx.haptic(10)
    persist()
    return true
  }

  /**
   * 从背包取出到棋盘第一个空格（点击背包物品即取出）。
   * 冷却是挂起状态，取出时换算回时间戳 —— 搬一次背包不会白拿补满。
   */
  function takeFromBag(bagIdx: number): boolean {
    if (!g.value) return false
    const slot = g.value.bag[bagIdx]
    if (!slot || slot.k !== 'item') return false

    const target = pickRandomEmpty(g.value.board, g.value.web, Math.random, g.value.bagAt)
    if (target === -1) {
      fx.toast('棋盘已满，无法取出 —— 先合成、清网或交付订单')
      return false
    }

    resumeCooldown(slot.it)
    g.value.board[target] = slot.it
    g.value.bag[bagIdx] = null
    // 目标格先隐藏，等飞行落地再显形
    fx.pendingCells.add(target)
    const from = fx.getBoardRect()
    fx.flyTo(
      from
        ? { ...from, left: from.left + from.width / 2 - 20, top: from.top - 40, width: 40, height: 40 }
        : null,
      target,
      {
        emoji: defOf(slot.it.chain, slot.it.level)?.emoji ?? '❔',
        sprite: defOf(slot.it.chain, slot.it.level)?.sprite ?? '',
        bg: defOf(slot.it.chain, slot.it.level)?.bg ?? '#eee',
        fg: defOf(slot.it.chain, slot.it.level)?.fg ?? '#333',
      }
    ).then(() => {
      fx.pendingCells.delete(target)
      flag(landedCells, target, 240)
    })
    fx.haptic(8)
    persist()
    return true
  }

  /** 花金币扩容一格 */
  function expandBag(): boolean {
    if (!g.value) return false
    if (!canExpandBag(g.value)) {
      fx.toast('背包已经扩到上限了')
      return false
    }
    const p = bagPrice(g.value.bagExpanded)
    if (g.value.gold < p) {
      fx.toast(`金币不足 · 扩容需要 ${p} 🪙`)
      return false
    }
    g.value.gold -= p
    g.value.bagCap = Math.min(BAG_TOTAL, g.value.bagCap + 1)
    g.value.bagExpanded++
    fx.haptic(16)
    fx.toast(`背包 +1 格（${g.value.bagCap}/${BAG_TOTAL}）`)
    persist()
    return true
  }

  // ==================== 特殊道具 ====================
  /** 进入"使用中"状态：下一步点击棋盘上的物品即生效 */
  function beginToolUse(tool: ToolKey): void {
    const count = toolCount(tool)
    if (count <= 0) {
      fx.toast('这个道具已经用完了')
      return
    }
    const d = toolDef(tool)
    // 直接生效类（加速沙漏 / 能量球）：作用范围是全盘或玩家自己，指不了目标，
    // 所以点一下就用掉；让玩家再去点某个格子会非常莫名其妙。
    if (d.target === 'none') {
      bagOpen.value = false
      useGlobalTool(tool)
      return
    }
    pendingTool.value = tool
    bagOpen.value = false
    fx.toast(`${d.emoji} ${d.name}：请点击棋盘上要使用的物品`)
    fx.haptic(8)
  }

  /**
   * 不需要目标的道具：立刻结算。
   * ★ 与 applyToolAt 同一条原则 —— **条件不满足时不消耗道具**，不让玩家白亏。
   */
  function useGlobalTool(tool: ToolKey): boolean {
    if (!g.value) return false
    if (toolCount(tool) <= 0) {
      fx.toast('这个道具已经用完了')
      return false
    }
    const d = toolDef(tool)
    const b = fx.getBoardRect()
    const cx = b ? fx.centerOfRect(b).x : window.innerWidth / 2
    const cy = b ? b.top + 120 : window.innerHeight / 2

    if (tool === 'hourglass') {
      // 收集"正在补充中"的设施/母体（冷却型的才需要这个）
      const targets: number[] = []
      for (let i = 0; i < TOTAL; i++) {
        const it = g.value.board[i]
        if (!it) continue
        const def = defOf(it.chain, it.level)
        if (!isClickable(def) || (def.refillMs ?? 0) <= 0) continue
        const full = fullCharges(def)
        if ((it.charges ?? 0) >= full && !isCooling(it, now.value)) continue
        targets.push(i)
      }
      if (!targets.length) {
        fx.toast('现在没有设施在补充中，沙漏先留着')
        return false
      }
      for (const i of targets) {
        const it = g.value.board[i]!
        const def = defOf(it.chain, it.level)!
        it.charges = fullCharges(def)
        it.cdAt = 0
        it.cdLeft = 0
        flag(glowCells, i, 460)
        const c = cellCenter(i)
        fx.burst(c.x, c.y, '#BA7517', 12, 0.9)
        fx.ring(c.x, c.y, '#BA7517', 44, 2.6)
      }
      consumeTool(tool)
      fx.floatText(cx, cy, `⏳ ${targets.length} 个设施已就绪`, '#854F0B')
      fx.haptic(24)
      fx.toast(`加速沙漏：${targets.length} 个设施的冷却已结束，储备补满`)
      persist()
      return true
    }

    const orbAmt = tool === 'orb' ? ORB_STAMINA : tool === 'orbGreen' ? ORB_GREEN : tool === 'orbPurple' ? ORB_PURPLE : 0
    if (orbAmt > 0) {
      g.value.stamina += orbAmt
      consumeTool(tool)
      fx.floatText(cx, cy, `+${orbAmt} ⚡`, '#7F77DD')
      fx.burst(cx, cy, '#7F77DD', 18, 1.15)
      fx.ring(cx, cy, '#7F77DD', 54, 3.2)
      fx.haptic(22)
      fx.toast(`${d.name}：体力 +${orbAmt}（可超过上限）`)
      persist()
      return true
    }

    if (tool === 'infinite') {
      g.value.live.infiniteUntil = Date.now() + INFINITE_MS
      consumeTool(tool)
      fx.floatText(cx, cy, '5 分钟无限体力', '#E6B422')
      fx.haptic(22)
      fx.toast('无限能量生效：5 分钟内点击不消耗体力')
      persist()
      return true
    }

    fx.toast(`${d.name} 需要指定一个目标`)
    return false
  }

  function cancelToolUse(): void {
    pendingTool.value = null
  }

  /** 统计背包里某种道具的总数（道具可堆叠，跨格累加） */
  function toolCount(tool: ToolKey): number {
    if (!g.value) return 0
    let n = 0
    for (const slot of g.value.bag) {
      if (slot && slot.k === 'tool' && slot.st.tool === tool) n += slot.st.count
    }
    return n
  }

  /** 扣掉一个道具；某个格子归零就清空该格 */
  function consumeTool(tool: ToolKey): boolean {
    if (!g.value) return false
    for (let i = 0; i < g.value.bag.length; i++) {
      const slot = g.value.bag[i]
      if (slot && slot.k === 'tool' && slot.st.tool === tool && slot.st.count > 0) {
        slot.st.count--
        if (slot.st.count <= 0) g.value.bag[i] = null
        return true
      }
    }
    return false
  }

  /**
   * 对棋盘某一格使用当前待用道具。
   * 两条效果都**先校验再扣道具** —— 用错了不消耗，避免玩家白亏。
   */
  function applyToolAt(boardIdx: number): boolean {
    if (!g.value || !pendingTool.value) return false
    const it = g.value.board[boardIdx]
    const tool = pendingTool.value
    if (!it) {
      fx.toast('这里没有物品')
      return false
    }

    const d = defOf(it.chain, it.level)
    if (!d) return false
    const targetRect = fx.getCellRect(boardIdx)
    const c = targetRect ? fx.centerOfRect(targetRect) : cellCenter(boardIdx)

    if (tool === 'upgradeCard') {
      if (it.level >= maxLv(it.chain)) {
        fx.toast('已经是这条链的顶端，不能再升了')
        return false
      }
      const nextLv = it.level + 1
      const next = makeItem(it.chain, nextLv)
      const nd = defOf(it.chain, nextLv)
      g.value.board[boardIdx] = next
      consumeTool(tool)
      pendingTool.value = null

      flag(popCells, boardIdx, 360)
      flag(glowCells, boardIdx, 420)
      const col = nd?.fx ?? '#378ADD'
      fx.burst(c.x, c.y, col, 26, 1.3)
      fx.ring(c.x, c.y, col, 56, 3.5)
      fx.floatText(c.x, c.y - 6, `${nd?.emoji ?? ''} Lv${nextLv}`, col)
      if (SHAKE_AMP > 0) fx.shake(SHAKE_AMP)
      fx.haptic(20)
      fx.toast(`升级卡已使用：${d.name} → ${nd?.name ?? ''} Lv${nextLv}`)
      persist()
      return true
    }

    // 充能器：补满储备 + 结束冷却。对"储备本来就满、也没在冷却"的发射器不生效也不消耗
    if (tool === 'charger') {
      if (!isClickable(d)) {
        fx.toast('充能器只能用在设施或母体上')
        return false
      }
      const full = fullCharges(d)
      if ((it.charges ?? 0) >= full && !isCooling(it, now.value)) {
        fx.toast(`${d.name} 的储备已经满了，充能器先留着`)
        return false
      }
      it.charges = full
      it.cdAt = 0
      it.cdLeft = 0
      consumeTool(tool)
      pendingTool.value = null
      flag(glowCells, boardIdx, 460)
      fx.burst(c.x, c.y, '#22A87E', 24, 1.25)
      fx.ring(c.x, c.y, '#22A87E', 56, 3.4)
      fx.floatText(c.x, c.y - 6, `储备 ${full}/${full}`, '#0F6E56')
      fx.haptic(20)
      fx.toast(`充能器已使用：${d.name} 冷却结束、储备补满`)
      persist()
      return true
    }

    // 剪刀：拆成两个低一级的
    if (it.level < 2) {
      fx.toast('Lv1 已经是最低等级，拆不了')
      return false
    }
    // 先把源格腾出来，再看棋盘上是否有足够位置放两个
    if (countEmpty(g.value) < 1) {
      fx.toast('棋盘没有空位放下拆出来的两个物品')
      return false
    }

    const lowerLv = it.level - 1
    g.value.board[boardIdx] = null
    const lower = makeItem(it.chain, lowerLv)
    let placed = 0
    for (let n = 0; n < 2; n++) {
      const t = pickRandomEmpty(g.value.board, g.value.web, Math.random, g.value.bagAt)
      if (t < 0) continue
      g.value.board[t] = { ...lower }
      flag(landedCells, t, 240)
      placed++
    }
    consumeTool(tool)
    pendingTool.value = null

    if (placed < 2) {
      fx.toast(`棋盘只剩 ${placed} 个空位，拆出来 ${placed} 个（另一个没地方放）`)
    } else {
      fx.toast(`剪刀已使用：Lv${it.level} 拆成两个 Lv${lowerLv}`)
    }
    const col = defOf(it.chain, lowerLv)?.fx ?? '#D4537E'
    fx.burst(c.x, c.y, col, 22, 1.2)
    fx.ring(c.x, c.y, col, 50, 3)
    fx.floatText(c.x, c.y - 6, `拆成 ×2 Lv${lowerLv}`, col)
    fx.haptic(18)
    persist()
    return true
  }

  // ==================== 选中棋盘物品 ====================
  function selectBoardItem(i: number): void {
    if (!g.value) return
    const it = g.value.board[i]
    if (!it) return
    selectedBoard.value = i
    hintHTML.value = describe(it)
    flag(glowCells, i, 500)
    fx.haptic(6)
  }

  function clearSelection(): void {
    selectedBoard.value = -1
  }

  function openBag(): void {
    bagOpen.value = true
    selectedBoard.value = -1
  }
  function closeBag(): void {
    bagOpen.value = false
    pendingTool.value = null
  }

  // ==================== 经营层：区域 / 装饰 / 顾客 ====================

  /**
   * 往背包里加道具：先叠到已有的同种道具上，没有才占新格。
   * 返回 false = 背包满 —— 调用方据此决定"稍后再发"，绝不能静默吞掉玩家的收益。
   */
  function addToolToBag(tool: ToolKey, n: number): boolean {
    if (!g.value || n <= 0) return false
    for (const slot of g.value.bag) {
      if (slot && slot.k === 'tool' && slot.st.tool === tool) {
        slot.st.count += n
        return true
      }
    }
    const free = findBagFree(g.value)
    if (free === -1) return false
    g.value.bag[free] = { k: 'tool', st: { tool, count: n } }
    return true
  }

  /** 解锁区域。免费，只吃等级门槛 + 顺序约束（见 logic.canUnlockRegion） */
  function unlockRegion(k: RegionKey): boolean {
    if (!g.value) return false
    const d = regionDef(k)
    if (!d) return false
    if (!canUnlockRegion(g.value, k)) {
      fx.toast(`${d.name} 还需要 Lv${d.unlockLevel}（当前 Lv${g.value.level}）`)
      return false
    }
    g.value.regions[k] = true
    // 体力上限可能被抬高：按新上限补算一次恢复，不让加成"等到下一分钟才生效"
    tickRegen(g.value, Date.now())
    fx.haptic(28)
    if (SHAKE_AMP > 0) fx.shake(SHAKE_AMP)
    // 新档位（如训练场的稀有订单）开放后**立刻重抽订单**，
    // 否则玩家要等最长 8 小时才看得到，白瞎了刚解锁的兴奋
    g.value.orders = g.value.orders.map(() => makeOrder(orderCtxOf(g.value!)))
    fx.toast(`🏗️ 解锁 ${d.emoji} ${d.name} —— ${d.benefit}`)
    persist()
    return true
  }

  /** 买一件 / 升一级装饰。装饰**不产生数值收益**，只消耗星星（文档 6.2） */
  function upgradeDecor(k: DecorKey): boolean {
    if (!g.value) return false
    const d = decorDef(k)
    if (!d) return false
    const cost = decorNextCost(g.value, k)
    if (cost === -1) {
      fx.toast(`${d.name} 已经满级了`)
      return false
    }
    if (cost < 0) return false
    if (g.value.stars < cost) {
      fx.toast(`星星不足 · 需要 ${cost} ⭐（交付订单可获得）`)
      return false
    }
    if (!buyOrUpgradeDecor(g.value, k)) return false
    fx.haptic(16)
    fx.toast(`${d.emoji} ${d.name} → Lv${decorLevel(g.value, k)}`)
    persist()
    return true
  }

  /**
   * 每日设施补给（设计文档 4.2 的「手动型发射器」落地形态）。
   *
   * 玩家主动领取，每天 1 个玩具架。它给了一条**不依赖豪华礼盒转化**的设施获取途径 ——
   * 否则设施数量完全被运气锁死，而设施是唯一的产出源头。
   *
   * ★ 棋盘满时不写 facDay：等玩家腾出空位再来领，不吞掉这份收益。
   */
  function claimDailyFacility(): boolean {
    if (!g.value) return false
    // ★ 用真实时间判断"是不是同一天"，而不是 store 里那个每秒刷新的 now：
    //   领取这个动作必须按**点击那一刻**的天来判定，不能受"最后一次 tick 是几秒前"影响。
    //   （now.value 只服务于 UI 的响应式红点）
    const key = dayKey(Date.now())
    if (g.value.facDay === key) {
      fx.toast('今天的设施补给已经领过了，明天再来')
      return false
    }
    const t = pickRandomEmpty(g.value.board, g.value.web, Math.random, g.value.bagAt)
    if (t < 0) {
      fx.toast('棋盘已满 —— 先合成、清网或交付订单，腾出空位再来领')
      return false
    }

    g.value.board[t] = makeItem('fac', DAILY_FAC_LEVEL)
    g.value.facDay = key
    flag(landedCells, t, 260)
    const c = cellCenter(t)
    fx.burst(c.x, c.y, '#E08A3C', 20, 1.15)
    fx.ring(c.x, c.y, '#E08A3C', 46, 3)
    fx.floatText(c.x, c.y - 10, '每日补给', '#A85B18')
    fx.haptic(20)
    fx.toast('每日补给：玩具架 ×1 已放进棋盘')
    persist()
    return true
  }

  // ==================== 商城（M2）====================

  /** 商店弹窗开关 */
  const shopOpen = ref(false)

  /**
   * 某件商品在本刷新时段内已购买几次。
   * 限购键 = `时段键:商品键`，跨过一个时段（6/12/18/24）自然换键 → 限购清零。
   */
  function boughtCount(key: string): number {
    if (!g.value) return 0
    return g.value.shopBought[`${shopSlotKey(now.value)}:${key}`] ?? 0
  }

  /** 记一笔购买，并裁掉太老的记录（与 bonusClaimed 同一套思路） */
  function markBought(key: string): void {
    if (!g.value) return
    g.value.shopBought[`${shopSlotKey(now.value)}:${key}`] = boughtCount(key) + 1
    const keys = Object.keys(g.value.shopBought).sort()
    while (keys.length > 12) {
      const k = keys.shift()!
      delete g.value.shopBought[k]
    }
  }

  /** 商品的商品卡数据：限购余量、能不能买、缺什么 */
  const shopList = computed(() =>
    GOODS.map((gd: GoodsDef) => {
      const limit = gd.dailyLimit
      const bought = boughtCount(gd.key)
      const lockedByLevel = !!g.value && g.value.level < gd.needLevel
      const outOfStock = limit != null && bought >= limit
      const currencyAmount = gd.currency === 'gold' ? (g.value?.gold ?? 0) : (g.value?.gem ?? 0)
      const poor = currencyAmount < gd.price
      const space = g.value ? countEmpty(g.value) : 0
      const noSpace = gd.needsBoardSpace > 0 && space < gd.needsBoardSpace
      return {
        ...gd,
        bought,
        /** 本时段还能买几次（不限购的商品显示 null） */
        left: limit == null ? null : Math.max(0, limit - bought),
        buyable: !lockedByLevel && !outOfStock && !poor && !noSpace,
        lockedByLevel,
        outOfStock,
        poor,
        noSpace,
        spaceLeft: gd.needsBoardSpace - space,
      }
    })
  )

  /**
   * 购买一件商品。
   * ★ 四条校验，任何一条不过都**不扣钱**：
   *   等级不够 / 时段限购已满 / 货币不足 / 棋盘空位不足（材料箱与设施要落格子）。
   */
  function buyGoods(key: string): boolean {
    if (!g.value) return false
    const def = goodsDef(key)
    if (!def) {
      fx.toast('这个商品已经下架了')
      return false
    }
    if (g.value.level < def.needLevel) {
      fx.toast(`${def.name} 需要 Lv${def.needLevel}（当前 Lv${g.value.level}）`)
      return false
    }
    if (def.dailyLimit != null && boughtCount(key) >= def.dailyLimit) {
      fx.toast('本时段已经买满了，等下一次刷新（6/12/18/24 点）')
      return false
    }
    const balance = def.currency === 'gold' ? g.value.gold : g.value.gem
    if (balance < def.price) {
      fx.toast(
        `${def.currency === 'gold' ? '金币' : '钻石'}不足 · 需要 ${def.price} ${
          def.currency === 'gold' ? '🪙' : '💎'
        }`
      )
      return false
    }
    const space = countEmpty(g.value)
    if (def.give.kind === 'crate') {
      // 材料箱允许"放不满"：能放几个放几个、按实际数量扣费（见下方 finalCost），
      // 所以门槛只是"至少有 1 个空位"，不要求凑齐 count 个
      if (space < 1) {
        fx.toast('棋盘已满 —— 先清出空位再来买')
        return false
      }
    } else if (def.needsBoardSpace > 0 && space < def.needsBoardSpace) {
      fx.toast(`棋盘空位不足 · 还差 ${def.needsBoardSpace - space} 格`)
      return false
    }

    // ---- 先发货，再扣钱（发货失败就不扣）----
    const give = def.give
    let placed = 0
    /** 实际扣的钱：材料箱可能只放下了一部分，按实收扣，不白扣 */
    let finalCost = def.price
    if (give.kind === 'tool') {
      if (!addToolToBag(give.tool, give.count)) {
        fx.toast('背包已满 —— 先清出格子再来买')
        return false
      }
    } else if (give.kind === 'stamina') {
      g.value.stamina += give.amount
    } else if (give.kind === 'fac') {
      const t = pickRandomEmpty(g.value.board, g.value.web, Math.random, g.value.bagAt)
      if (t < 0) {
        fx.toast('棋盘已满 —— 先清出空位再来买')
        return false
      }
      g.value.board[t] = makeItem('fac', give.level)
      flag(landedCells, t, 260)
      placed = 1
    } else if (give.kind === 'crate') {
      for (let k = 0; k < give.count; k++) {
        const chain = give.pool[Math.floor(Math.random() * give.pool.length)]
        const t = pickRandomEmpty(g.value.board, g.value.web, Math.random, g.value.bagAt)
        if (t < 0) break
        g.value.board[t] = makeItem(chain, give.level)
        flag(landedCells, t, 240)
        placed++
      }
      if (placed < give.count) {
        // 只拿到一部分：按实际拿到的东西收钱，不白扣
        fx.toast(`棋盘空位不足，只放下了 ${placed}/${give.count} 个 —— 已按实收扣费`)
      }
      finalCost = give.count > 0 ? Math.round((def.price * placed) / give.count) : 0
    }

    // 会员卡权益：商城金币商品 9 折（钻石商品不打折——它们本来就是钻石的出口）
    if (def.currency === 'gold') {
      g.value.gold -= isVip(g.value) ? Math.ceil(finalCost * 0.9) : finalCost
    } else {
      g.value.gem -= finalCost
    }
    markBought(key)

    fx.haptic(18)
    fx.toast(`${def.emoji} ${def.name} 已购买${placed ? `（放进了棋盘 ${placed} 格）` : ''}`)
    persist()
    return true
  }

  function openShop(): void {
    shopOpen.value = true
    selectedBoard.value = -1
  }
  function closeShop(): void {
    shopOpen.value = false
  }

  // ==================== 充值中心（M2 剩余：模拟充值 / 会员 / 基金 / 礼包 / 抽奖）====================
  // ★ 架构红线：模拟充值是独立旁路——只往钻石余额加钱，不认识任何商品逻辑。

  const rechargeOpen = ref(false)
  function openRecharge(): void {
    rechargeOpen.value = true
    selectedBoard.value = -1
  }
  function closeRecharge(): void {
    rechargeOpen.value = false
  }

  /** 首充双倍还挂着（还没充值过任何档位） */
  const firstRechargePending = computed(() => !!g.value && !g.value.firstRecharge)

  /**
   * 模拟支付一个档位并到账。返回实际到账钻石（0 = 档位不存在）。
   * 支付动画由 UI 层负责（先动画后调这里，或先调这里后动画均可——状态只在这里落地一次）。
   */
  function recharge(tierKey: string): number {
    if (!g.value) return 0
    const tier = iapTier(tierKey)
    if (!tier) return 0
    const res = payTier(tier, g.value.firstRecharge)
    g.value.gem += res.gems
    g.value.firstRecharge = true
    persist()
    fx.haptic(24)
    fx.toast(`💎 +${res.gems} 到账${res.doubled ? '（首充双倍！）' : ''}`)
    return res.gems
  }

  // ---- 会员卡 ----
  /** 会员卡是否生效中（响应式包装，UI 直接读） */
  const vipActive = computed(() => !!g.value && isVip(g.value))

  function buyVip(): boolean {
    if (!g.value) return false
    const price = vipPrice()
    if (g.value.gem < price) {
      fx.toast(`钻石不足 · 需要 ${price} 💎`)
      return false
    }
    g.value.gem -= price
    g.value.vipUntil = vipNewUntil(g.value.vipUntil, Date.now())
    persist()
    fx.haptic(24)
    fx.toast('🐾 乐园会员卡已生效（30 天）')
    return true
  }

  /** 今天的会员每日福利领了没有（按天去重；非会员恒 false） */
  function vipDailyReady(): boolean {
    if (!g.value || !isVip(g.value)) return false
    return g.value.vipDay !== dayKey(Date.now())
  }

  function claimVipDaily(): boolean {
    if (!g.value || !vipDailyReady()) return false
    g.value.vipDay = dayKey(Date.now())
    g.value.gem += VIP_DAILY_GEM
    g.value.stamina += VIP_DAILY_STAMINA
    // 随机道具 ×1 进背包；背包满就不发（福利是每天的，不补偿也不吞钻）
    const tool = TOOL_ORDER[Math.floor(Math.random() * TOOL_ORDER.length)]
    const ok = addToolToBag(tool, 1)
    persist()
    fx.haptic(18)
    fx.toast(
      ok
        ? `🐾 会员福利：💎+${VIP_DAILY_GEM} ⚡+${VIP_DAILY_STAMINA} ${toolDef(tool).emoji}×1`
        : `🐾 会员福利：💎+${VIP_DAILY_GEM} ⚡+${VIP_DAILY_STAMINA}（背包满，道具没发）`
    )
    return true
  }

  // ---- 成长基金 ----
  function buyFund(): boolean {
    if (!g.value) return false
    if (g.value.gem < FUND_META.price) {
      fx.toast(`钻石不足 · 需要 ${FUND_META.price} 💎`)
      return false
    }
    g.value.gem -= FUND_META.price
    g.value.fundOwned = true
    g.value.fundClaimed = 0 // 重复购买 = 重置返还进度（文档 10.3）
    persist()
    fx.haptic(24)
    fx.toast('📈 乐园投资基金已生效')
    return true
  }

  /** 当前等级下可领的基金返还份数（0 = 没买 / 没到账） */
  function fundReady(): number {
    if (!g.value || !g.value.fundOwned) return 0
    return fundClaimsReady(g.value.level, g.value.fundClaimed)
  }

  /** 领取全部已到账的基金返还，返回到账钻石数 */
  function claimFund(): number {
    if (!g.value) return 0
    const n = fundReady()
    if (n <= 0) return 0
    g.value.fundClaimed += n
    const gems = n * FUND_META.perClaim
    g.value.gem += gems
    persist()
    fx.haptic(18)
    fx.toast(`📈 基金返还 💎+${gems}`)
    return gems
  }

  // ---- 礼包 ----
  /** 已解锁区域数（区域礼包的计数口径：解锁过的区域不会倒退） */
  function unlockedRegionCount(s: GameState): number {
    return Object.values(s.regions ?? {}).filter(Boolean).length
  }

  function giftBoughtCount(key: string): number {
    if (!g.value) return 0
    const ck = giftCountKey(key, g.value.level, unlockedRegionCount(g.value))
    return g.value.giftBought[ck] ?? 0
  }

  /** 礼包内容物落地：体力直加；道具进背包；材料箱先进棋盘、满了进背包、再满就停 */
  function applyGiftGive(give: GiftGive): void {
    if (!g.value) return
    if (give.kind === 'stamina') {
      g.value.stamina += give.amount
      return
    }
    if (give.kind === 'tool') {
      addToolToBag(give.tool, give.count)
      return
    }
    for (let k = 0; k < give.count; k++) {
      const chain = give.pool[Math.floor(Math.random() * give.pool.length)]
      const t = pickRandomEmpty(g.value.board, g.value.web, Math.random, g.value.bagAt)
      if (t >= 0) {
        g.value.board[t] = makeItem(chain, give.level)
        flag(landedCells, t, 240)
        continue
      }
      const b = findBagFree(g.value)
      if (b < 0) break // 棋盘与背包都满：剩余作废（礼包不拆零退钻）
      g.value.bag[b] = { k: 'item', it: makeItem(chain, give.level) }
    }
  }

  function buyGift(key: string): boolean {
    if (!g.value) return false
    const d = giftDef(key)
    if (!d) {
      fx.toast('礼包不存在或已下架')
      return false
    }
    if (g.value.level < d.needLevel) {
      fx.toast(`${d.name} 需要 Lv${d.needLevel}`)
      return false
    }
    if (d.limit !== 'unlimited' && giftBoughtCount(key) > 0) {
      fx.toast('这个礼包在当前阶段已经买过了')
      return false
    }
    if (g.value.gem < d.price) {
      fx.toast(`钻石不足 · 需要 ${d.price} 💎`)
      return false
    }
    // 先发货再扣钱（与商城同口径）
    for (const give of d.gives) applyGiftGive(give)
    g.value.gem -= d.price
    const ck = giftCountKey(key, g.value.level, unlockedRegionCount(g.value))
    g.value.giftBought[ck] = (g.value.giftBought[ck] ?? 0) + 1
    persist()
    fx.haptic(24)
    fx.toast(`${d.emoji} ${d.name} 已购买`)
    return true
  }

  // ---- 抽奖机 ----
  /** 本次会话的抽取结果（仅 UI 展示用，不进存档） */
  const luckyHistory = ref<LuckyPrize[]>([])

  function luckyPrice(times: 1 | 10): number {
    return times === 1 ? LUCKY_META.single : LUCKY_META.ten
  }

  /** 抽奖（先扣钱再开奖；结果写入 luckyHistory 供 UI 弹结果层） */
  function spin(times: 1 | 10): boolean {
    if (!g.value) return false
    const cost = luckyPrice(times)
    if (g.value.gem < cost) {
      fx.toast(`钻石不足 · 需要 ${cost} 💎`)
      return false
    }
    g.value.gem -= cost
    const out: LuckyPrize[] = []
    for (let i = 0; i < times; i++) {
      const r = spinOnce(g.value.luckyPity)
      g.value.luckyPity = r.pity
      out.push(r.prize)
    }
    for (const p of out) {
      if (p.kind === 'gold') g.value.gold += p.amount
      else if (p.kind === 'tool' && p.tool) addToolToBag(p.tool, p.amount)
      else if (p.kind === 'skin' && p.skinKey) {
        const got = grantSkin(g.value.live, p.skinKey)
        if (got !== 'new') {
          g.value.gem += LUCKY_SKIN_TO_GEM
          p.converted = true
          p.amount = LUCKY_SKIN_TO_GEM
        }
      } else if (p.kind === 'decor' && p.decorKey) {
        if (decorLevel(g.value, p.decorKey) > 0) {
          g.value.gem += LUCKY_DECOR_TO_GEM
          p.converted = true
          p.amount = LUCKY_DECOR_TO_GEM
        } else {
          g.value.decor[p.decorKey] = 1
        }
      }
    }
    luckyHistory.value = out
    persist()
    fx.haptic(30)
    return true
  }

  // ==================== 存档与分发（M5）====================

  /** 设置弹窗开关（存档状态 / 备份 / 导出 / 导入 / 重置） */
  const settingsOpen = ref(false)

  /** 当前存档元信息（响应式包装 storage.saveInfo，UI 直接读） */
  const saveMeta = computed(() => saveInfo())

  /** 三个备份槽位的状态（响应式包装） */
  const backups = computed(() => listBackups())

  function openSettings(): void {
    settingsOpen.value = true
    selectedBoard.value = -1
  }
  function closeSettings(): void {
    settingsOpen.value = false
  }

  /** 手动备份一份。返回槽位号（0 = 失败） */
  function doBackup(): number {
    if (!g.value) return 0
    const slot = backupNow(g.value)
    if (slot) fx.toast(`已备份到第 ${slot} 号槽位`)
    else fx.toast('备份失败（可能是浏览器隐私模式或空间不足）')
    return slot
  }

  function doRestore(slot: number): boolean {
    const r = restoreBackup(slot)
    if (!r.ok) {
      fx.toast(r.error ?? '恢复失败')
      return false
    }
    const loaded = load()
    if (loaded) {
      g.value = loaded.state
      tickRegen(g.value, Date.now())
      fx.toast(`已从第 ${slot} 号备份恢复`)
    }
    persist()
    return true
  }

  /** 导出存档文本（复制到剪贴板），失败时退回到"显示在提示栏让玩家自己复制" */
  function doExport(): string | null {
    const text = exportSaveText()
    if (!text) {
      fx.toast('没有可导出的存档')
      return null
    }
    try {
      void navigator.clipboard?.writeText(text)
      fx.toast('存档已复制到剪贴板 —— 粘贴保存到任意地方即可')
    } catch {
      fx.toast('已生成存档文本（浏览器不允许自动复制，请手动复制）')
    }
    return text
  }

  function doImport(text: string): boolean {
    const r = importSaveText(text)
    if (!r.ok) {
      fx.toast(r.error ?? '导入失败')
      return false
    }
    const loaded = load()
    if (loaded) g.value = loaded.state
    fx.toast(r.legacy ? '导入成功（旧版存档格式）' : '导入成功')
    persist()
    return true
  }

  function openBusiness(tab: 'decor' | 'region' | 'customer' = 'decor'): void {
    bizTab.value = tab
    businessOpen.value = true
    selectedBoard.value = -1
  }

  function closeBusiness(): void {
    businessOpen.value = false
  }

  function setBizTab(tab: 'decor' | 'region' | 'customer'): void {
    bizTab.value = tab
  }

  /** 调试：直接发星星。正式版星星只从订单结算产出，这里只为验证装饰链 */
  function debugGiveStars(n = 300): void {
    if (!g.value) return
    g.value.stars += n
    persist()
    fx.toast(`调试：星星 +${n}`)
  }

  /** 调试：让所有订单立刻到期，用于验证重抽逻辑（正式版要等 8 小时） */
  function debugExpireOrders(): void {
    if (!g.value) return
    g.value.orders = g.value.orders.map((o) => ({ ...o, expireAt: 0 }))
    persist()
    fx.toast('调试：订单已标记为到期，下一秒会重抽')
  }

  // ==================== 调试 / 重置 ====================
  function reset(): void {
    clearSave()
    const s = freshState()
    g.value = s
    seedBag(s)
    seedBoard(s)
    hintHTML.value = '拖动相同物品合成 · 轻点带边框的物品产出 · 轻点🕸️花金币清除'
    persist()
    fx.toast('已重置')
  }

  function fillStamina(): void {
    if (!g.value) return
    g.value.stamina = STAMINA_MAX
    persist()
    fx.toast('体力已补满')
  }

  /** 一步验证两种终点：玩具链顶级 ×2（合成出母体）+ 伴手礼 ×2（合成出礼盒）+ 1 张蛛网 */
  function debugGive(): void {
    if (!g.value) return
    const give: [ChainKey, number][] = [
      ['toy', maxLv('toy') - 1],
      ['toy', maxLv('toy') - 1],
      ['supply', 1],
      ['supply', 1],
    ]
    let n = 0
    for (const [c, l] of give) {
      const t = pickRandomEmpty(g.value.board, g.value.web, Math.random, g.value.bagAt)
      if (t < 0) continue
      g.value.board[t] = makeItem(c, l)
      n++
    }
    const addedWeb = addWeb()
    persist()
    let msg = n
      ? `已放入 ${n} 个素材（玩具链顶级 ×2 → 母体；伴手礼 ×2 → 礼盒）`
      : '棋盘已满'
    if (addedWeb) msg += `；并落下一张蛛网（价 ${webPrice(g.value.websCleared)} 🪙）`
    fx.toast(msg)
  }

  /**
   * 调试：把所有冷却型对象的储备一次抽干并立刻进入冷却。
   * 用于验证"冷却 → 到点补满"这条路径 —— 正常玩要把设施点 8 次才看得到。
   */
  function debugDrain(): void {
    if (!g.value) return
    let n = 0
    for (let i = 0; i < TOTAL; i++) {
      const it = g.value.board[i]
      if (!it) continue
      const d = defOf(it.chain, it.level)
      if (!isClickable(d) || (d.refillMs ?? 0) <= 0) continue
      it.charges = 0
      it.cdAt = Date.now() + d.refillMs!
      n++
    }
    persist()
    fx.toast(n ? `${n} 个冷却型对象的储备已抽干，等它们自动补满` : '棋盘上没有冷却型对象')
  }

  /** 打开游戏先进乐园，棋盘是从乐园进去的另一个场景 */
  const scene = ref<'yard' | 'board'>('yard')
  const parkOpen = ref(false)
  const orderOpen = ref(false)
  const parkTab = ref<'codex' | 'story' | 'park' | 'fest' | 'skin' | 'card'>('codex')

  const needsBackupPrompt = computed(() => !!g.value && !g.value.live.backupPrompted)

  function enterBoard(): void {
    scene.value = 'board'
  }

  function leaveBoard(): void {
    scene.value = 'yard'
    bagOpen.value = false
    shopOpen.value = false
    orderOpen.value = false
    businessOpen.value = false
    rechargeOpen.value = false
    treeOpen.value = false
  }

  function setTheme(theme: ThemeId): void {
    if (!g.value) return
    g.value.live.theme = theme
    persist()
    fx.toast(theme === 'dog' ? '已换成狗的样子' : '已换成猫的样子')
  }

  function buyPlot(id: string): boolean {
    if (!g.value) return false
    const plot = plotDef(id)
    if (!plot) return false
    const lv = g.value.live.plotLv
    if ((lv[id] ?? 0) >= 1) {
      fx.toast('这块地已经盖好了')
      return false
    }
    if (nextPlot(lv)?.id !== id) {
      fx.toast('先把前面的地买下来')
      return false
    }
    if (g.value.stars < plot.cost) {
      fx.toast(`星星不够，还要 ${plot.cost} ⭐`)
      return false
    }
    g.value.stars -= plot.cost
    lv[id] = 1
    const skin = skinOf(plot.building, g.value.live.theme)
    if (plot.chain) unlockChain(plot.chain)
    persist()
    fx.toast(plot.chain ? `${skin.name} 盖好了，对应的链已经打开` : `${skin.name} 盖好了`)
    return true
  }

  function upgradePlot(id: string): boolean {
    if (!g.value) return false
    const plot = plotDef(id)
    if (!plot) return false
    const lv = g.value.live.plotLv[id] ?? 0
    if (lv < 1) {
      fx.toast('还没盖')
      return false
    }
    if (lv >= 2) {
      fx.toast('已经升过了')
      return false
    }
    if (g.value.stars < plot.upCost) {
      fx.toast(`星星不够，升级要 ${plot.upCost} ⭐`)
      return false
    }
    g.value.stars -= plot.upCost
    g.value.live.plotLv[id] = 2
    persist()
    fx.toast(`${skinOf(plot.building, g.value.live.theme).name} 升到 2 级`)
    return true
  }

  function chooseCamp(camp: 'cat' | 'dog'): void {
    if (!g.value) return
    g.value.live.camp = camp
    persist()
    fx.toast(camp === 'cat' ? '你是猫派店长。护理客人会更对味。' : '你是狗派店长。训练客人会更对味。')
  }

  function ackBackup(): void {
    if (!g.value) return
    backupNow(g.value)
    g.value.live.backupPrompted = true
    g.value.bakDay = dayKey(Date.now())
    persist()
    fx.toast('已备份一份。以后也可以在存档里导出。')
  }

  function skipBackup(): void {
    if (!g.value) return
    g.value.live.backupPrompted = true
    persist()
  }

  function openPark(tab: typeof parkTab.value = 'codex'): void {
    parkTab.value = tab
    parkOpen.value = true
  }
  function closePark(): void {
    parkOpen.value = false
  }

  function abandonOrder(orderId: string): boolean {
    if (!g.value) return false
    const idx = g.value.orders.findIndex((o) => o.id === orderId)
    if (idx < 0) return false
    const o = g.value.orders[idx]
    setBan(g.value.live, o.chain, o.level, Date.now())
    g.value.orders[idx] = makeOrder(orderCtxOf(g.value))
    persist()
    fx.toast('订单已放弃。同样的需求 10 分钟内不会再出现。')
    return true
  }

  function claimQuest(): boolean {
    if (!g.value) return false
    const L = g.value.live
    rollQuestDay(L, dayKey(now.value))
    if (L.questClaimed) {
      fx.toast('今天的任务奖励已经领过了')
      return false
    }
    if (L.questMerge < QUEST_MERGE || L.questDeliver < QUEST_DELIVER || L.questProduce < QUEST_PRODUCE) {
      fx.toast(`还差一点点：合成 ${L.questMerge}/${QUEST_MERGE}，交付 ${L.questDeliver}/${QUEST_DELIVER}，点击 ${L.questProduce}/${QUEST_PRODUCE}`)
      return false
    }
    L.questClaimed = true
    g.value.gold += 80
    addToolToBag('orbGreen', 1)
    persist()
    fx.toast('每日任务完成：80 金币，绿能量球已放进背包')
    return true
  }

  function checkIn(): boolean {
    if (!g.value) return false
    const L = g.value.live
    const day = dayKey(now.value)
    if (L.checkinDay === day) {
      fx.toast('今天已经签过到了')
      return false
    }
    const yesterday = dayKey(now.value - 24 * 60 * 60 * 1000)
    L.streak = L.checkinDay === yesterday ? L.streak + 1 : 1
    L.checkinDay = day
    const gem = Math.min(20, 4 + L.streak * 2)
    g.value.gem += gem
    persist()
    fx.toast(`签到第 ${L.streak} 天，获得 ${gem} 钻石`)
    return true
  }

  function focusFest(key: string): void {
    if (!g.value) return
    g.value.live.festFocus = key
    g.value.orders = g.value.orders.map(() => makeOrder(orderCtxOf(g.value!)))
    persist()
    const f = FESTS.find((x) => x.key === key)
    fx.toast(f ? `时间旅行：现在是${f.name}。订单金币提高了。` : '回到今天的日期')
  }

  function claimFest(): boolean {
    if (!g.value) return false
    const f = festActive(now.value, g.value.live.festFocus)
    if (!f) {
      fx.toast('现在没有节日')
      return false
    }
    const mark = `${dayKey(now.value)}@${f.key}`
    if (g.value.live.festClaim === mark) {
      fx.toast('这份节日礼物今天领过了')
      return false
    }
    g.value.live.festClaim = mark
    addToolToBag('orb', 1)
    persist()
    fx.toast(`${f.emoji} ${f.name}礼物：能量球 ×1`)
    return true
  }

  function assignPet(pet: string, region: RegionKey): void {
    if (!g.value || !g.value.pets.includes(pet)) {
      fx.toast('先把这只顾客养成常驻宠物')
      return
    }
    if (!isRegionUnlocked(g.value, region)) {
      fx.toast('这个区域还没解锁')
      return
    }
    g.value.live.post[pet] = region
    persist()
    fx.toast(`${customerDef(pet)?.name ?? '宠物'} 去了 ${regionDef(region)?.name ?? '区域'}`)
  }

  function dispatchPet(pet: string): boolean {
    if (!g.value || !g.value.pets.includes(pet)) {
      fx.toast('只有常驻宠物能代打')
      return false
    }
    let cell = -1
    for (let i = 0; i < TOTAL; i++) {
      const it = g.value.board[i]
      if (!it) continue
      const d = defOf(it.chain, it.level)
      if (isClickable(d) && (it.charges ?? 0) > 0) {
        cell = i
        break
      }
    }
    if (cell < 0) {
      fx.toast('棋盘上没有还能点的设施')
      return false
    }
    const it = g.value.board[cell]!
    const d = defOf(it.chain, it.level)!
    let n = 0
    const times = Math.min(5, it.charges ?? 0)
    for (let k = 0; k < times; k++) {
      const drop = rollDrops(d.drops ?? [])
      if (drop.type === 'item') {
        const t = pickRandomEmpty(g.value.board, g.value.web, Math.random, g.value.bagAt)
        if (t < 0) break
        g.value.board[t] = makeItem(drop.chain, drop.level)
        noteSeen(g.value.live, drop.chain, drop.level)
      } else {
        const amount = rollRange(drop.min, drop.max)
        if (drop.type === 'gold') g.value.gold += amount
        else g.value.gem += amount
      }
      it.charges = (it.charges ?? 1) - 1
      n++
    }
    persist()
    fx.toast(`${customerDef(pet)?.name ?? '宠物'} 帮忙点了 ${n} 次，不消耗你的体力`)
    return n > 0
  }

  function putDecor(decor: DecorKey, x: number, y: number): boolean {
    if (!g.value) return false
    if (decorLevel(g.value, decor) <= 0) {
      fx.toast('先用星星买下这件装饰')
      return false
    }
    if (!placeDecor(g.value.live, decor, x, y)) {
      fx.toast('这个位置已经有东西，或者这件装饰已经摆过了')
      return false
    }
    persist()
    return true
  }

  function turnDecor(decor: string): void {
    if (!g.value) return
    if (rotatePlacement(g.value.live, decor)) persist()
  }

  function removeDecor(decor: string): void {
    if (!g.value) return
    if (liftPlacement(g.value.live, decor)) persist()
  }

  function useScheme(i: number): void {
    if (!g.value) return
    g.value.live.schemeIx = Math.min(2, Math.max(0, i))
    persist()
  }

  function shareCode(): string {
    return g.value ? encodeLayout(g.value.live) : ''
  }

  function importShare(text: string): boolean {
    if (!g.value) return false
    const pack = decodeLayout(text)
    if (!pack) {
      fx.toast('这不是乐园分享码')
      return false
    }
    g.value.live.schemes = pack.schemes
    g.value.live.schemeNames = pack.schemeNames.length === 3 ? pack.schemeNames : g.value.live.schemeNames
    g.value.live.schemeIx = pack.schemeIx
    g.value.live.post = pack.post
    persist()
    fx.toast('乐园布局已导入')
    return true
  }

  function toggleSound(): void {
    if (!g.value) return
    g.value.live.sound = !g.value.live.sound
    persist()
    fx.toast(g.value.live.sound ? '音效已打开' : '音效已关闭')
  }

  function markPostcard(): void {
    if (!g.value) return
    if (!isRegionUnlocked(g.value, 'studio')) {
      fx.toast('解锁摄影棚之后才能导出明信片')
      return
    }
    g.value.live.postcards++
    persist()
  }

  function equipSkin(customer: string, skin: string): void {
    if (!g.value) return
    if (!g.value.live.skins.includes(skin)) {
      fx.toast('还没有这件造型')
      return
    }
    g.value.live.equipped[customer] = skin
    persist()
  }

  const codex = computed(() => {
    let itemTotal = 0
    let items = 0
    const seen = new Set(g.value?.live.seen ?? [])
    for (const k of TREE_ORDER) {
      const n = maxLv(k)
      itemTotal += n
      for (let lv = 1; lv <= n; lv++) if (seen.has(`${k}:${lv}`)) items++
    }
    const decorGot = DECORS.filter((d) => (g.value ? decorLevel(g.value, d.key) > 0 : false)).length
    const custGot = CUSTOMERS.filter(
      (c) => !!g.value && ((g.value.affinity[c.key] ?? 0) > 0 || g.value.pets.includes(c.key))
    ).length
    return {
      items,
      itemTotal,
      decorGot,
      decorTotal: DECORS.length,
      custGot,
      custTotal: CUSTOMERS.length,
    }
  })

  const todayWeather = computed(() => weatherOn(dayKey(now.value)))
  const todayFest = computed(() => festActive(now.value, g.value?.live.festFocus ?? ''))

  function showOrders(): void {
    orderOpen.value = true
  }
  function closeOrders(): void {
    orderOpen.value = false
  }

  function showHintFor(i: number): void {
    if (!g.value) return
    const it = g.value.board[i]
    if (!it) return
    hintHTML.value = describe(it)
    flag(glowCells, i, 420)
  }

  function setHint(text: string): void {
    hintHTML.value = text
  }

  const openTree = (): void => {
    treeOpen.value = true
  }
  const closeTree = (): void => {
    treeOpen.value = false
  }

  return {
    // state
    g,
    now,
    board,
    web,
    orders,
    orderNeed,
    price,
    // ui flags
    popCells,
    glowCells,
    landedCells,
    clearingCells,
    pendingCells: fx.pendingCells,
    hintHTML,
    treeOpen,
    bagOpen,
    scene,
    parkOpen,
    parkTab,
    orderOpen,
    needsBackupPrompt,
    codex,
    todayWeather,
    todayFest,
    selectedBoard,
    pendingTool,
    businessOpen,
    bizTab,
    shopOpen,
    settingsOpen,
    // derived
    ready,
    staminaPct,
    staminaMaxN,
    staminaSub,
    canClaimBonus,
    readyOrders,
    bonus,
    cdLeftByCell,
    anyCoolingLeft,
    canClaimFacility,
    bag,
    bagCap,
    bagUsedN,
    bagPriceNow,
    canExpand,
    selectedItem,
    // 经营层 derived
    stars,
    petCount,
    petCapHours,
    regionBonus,
    decorLevelSum,
    nextRegion,
    regionList,
    decorList,
    customerList,
    petList,
    orderCards,
    shopList,
    saveMeta,
    backups,
    // helpers
    defAt,
    itemKey,
    toolCount,
    // lifecycle
    init,
    dispose,
    // actions
    produce,
    merge,
    moveItem,
    tapWeb,
    sacrificeToWeb,
    deliver,
    deliverAll,
    claimBonus,
    // 背包 / 道具 / 选中
    moveToBag,
    takeFromBag,
    expandBag,
    beginToolUse,
    cancelToolUse,
    applyToolAt,
    useGlobalTool,
    selectBoardItem,
    clearSelection,
    openBag,
    closeBag,
    // 背包上棋盘 / 挤出换位（2026-10-02 交互修正）
    moveBag,
    displaceDrop,
    bagHasSpace,
    // 经营层
    unlockRegion,
    upgradeDecor,
    openBusiness,
    closeBusiness,
    setBizTab,
    addToolToBag,
    claimDailyFacility,
    buyGoods,
    openShop,
    closeShop,
    // 充值中心（M2 剩余）
    rechargeOpen,
    openRecharge,
    closeRecharge,
    recharge,
    firstRechargePending,
    IAP_TIERS,
    vipActive,
    buyVip,
    vipDailyReady,
    claimVipDaily,
    buyFund,
    fundReady,
    claimFund,
    GIFTS,
    giftBoughtCount,
    buyGift,
    luckyHistory,
    luckyPrice,
    spin,
    LUCKY_META,
    openSettings,
    closeSettings,
    doBackup,
    doRestore,
    doExport,
    doImport,
    debugGiveStars,
    debugExpireOrders,
    reset,
    fillStamina,
    debugGive,
    debugDrain,
    showOrders,
    closeOrders,
    enterBoard,
    leaveBoard,
    setTheme,
    buyPlot,
    upgradePlot,
    chooseCamp,
    ackBackup,
    skipBackup,
    openPark,
    closePark,
    abandonOrder,
    claimQuest,
    checkIn,
    focusFest,
    claimFest,
    assignPet,
    dispatchPet,
    putDecor,
    turnDecor,
    removeDecor,
    useScheme,
    shareCode,
    importShare,
    toggleSound,
    markPostcard,
    equipSkin,
    showHintFor,
    setHint,
    openTree,
    closeTree,
    persist,
  }
})
