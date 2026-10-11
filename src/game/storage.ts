/**
 * 存档读写。
 *
 * ★ 存档安全是本项目最重要的工程问题（单机、零服务器，玩家数据只有本地一份）。
 *   两条硬规则：
 *   1. **任何单条坏数据只能牺牲它自己，绝不能连累整份存档** —— 迁移时逐格 try/catch。
 *   2. **load() 整体失败时必须返回 null 并保留原始字符串**，不能静默覆盖成新档。
 */

import { CHAINS } from './chains'
import { BAG_INITIAL_CAP, BAG_TOTAL, ORDER_SLOTS, ORDER_TIERS, SAVE_KEY, SAVE_VERSION, TOTAL } from './config'
import { customerDef, decorDef, freshRegions, regionDef } from './business'
import { normalizeLive } from './content'
import { raisePlotsForChains } from './yard'
import {
  defOf,
  ensureFacilities,
  fullCharges,
  isClickable,
  makeOrder,
  migrateChainDepth,
  orderCtxOf,
  placeBag,
  reconcileWebs,
  type GameState,
} from './logic'
import { TOOLS } from './tools'
import type { BagSlot, BoardItem, ChainKey, Order, RegionKey, ResolvedDef, ToolKey } from './types'
import { isAutoDef } from './types'

/** P0 原型用过的旧存档 key，用于把老进度平滑迁到 Vue 版 */
const LEGACY_KEY = 'pawpark_p0_save'

export interface LoadResult {
  state: GameState
  /** 迁移过程中改过东西，需要立刻回写 */
  dirty: boolean
  /**
   * 主存档缺失或损坏时，是从第几号备份槽位恢复的。
   * UI **必须**把这个告诉玩家（"你的主存档坏了，已从备份 N 恢复"）——
   * 静默恢复会让玩家以为一切正常，直到下次再坏才发现连备份也没了。
   */
  fromBackup?: number
}

function isChainKey(k: unknown): k is ChainKey {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(CHAINS, k)
}

function emptyUnlocked(): Record<ChainKey, boolean> {
  const u = {} as Record<ChainKey, boolean>
  for (const k of Object.keys(CHAINS) as ChainKey[]) u[k] = false
  return u
}

/** 把旧存档（P0 的 `{c,l,u}` / `{c,l}`）转成新结构 */
function migrateLegacy(raw: any): any {
  const board = (raw.board || []).map((it: any) =>
    it && it.c != null ? { chain: it.c, level: it.l, charges: it.u } : null
  )
  // ★ 订单结构变化太大（第一批加了 档位 / 顾客 / 倒计时 / 星星 / 好感），
  //   老订单不再逐字段补默认值，直接丢掉让 normalize() 重抽 —— 订单是纯临时数据，重抽无损失。
  return { ...raw, v: SAVE_VERSION, board, orders: [] }
}

/**
 * 校正一个可点击对象的「储备 / 冷却」字段。
 *
 * ★ 这里最容易写错、后果也最严重的一条：
 *   **不能把 `charges === 0` 当成"数据缺失"去补满**。
 *   储备为 0 是「冷却型对象正在补充」这个**合法状态**。如果 load 时把它补满，
 *   玩家只要刷新一次页面就能跳过冷却 —— 冷却系统等于不存在。
 *   所以只修正**非法值**（缺失 / 负数 / 超上限 / 类型不对），0 必须原样保留。
 */
function fixStock(it: BoardItem, d: ResolvedDef): boolean {
  let dirty = false
  const full = fullCharges(d)
  const c = it.charges
  if (typeof c !== 'number' || !Number.isFinite(c)) {
    // 字段缺失（老存档）：当作满储备
    it.charges = full
    dirty = true
  } else if (c < 0 || c > full) {
    it.charges = Math.max(0, Math.min(full, Math.floor(c)))
    dirty = true
  }

  const cd = it.cdAt
  if (typeof cd !== 'number' || !Number.isFinite(cd) || cd < 0) {
    it.cdAt = 0
    dirty = true
  }

  // 背包里的挂起冷却：非法值清零，并在此时把它算回"绝对时间戳"是不对的
  // （物品还在背包里，取出的那一刻才算），所以这里只做合法性矫正
  const cl = it.cdLeft
  if (cl != null && (typeof cl !== 'number' || !Number.isFinite(cl) || cl < 0)) {
    it.cdLeft = 0
    dirty = true
  }
  // 挂起与运行中的冷却不能同时存在
  if ((it.cdLeft ?? 0) > 0 && (it.cdAt ?? 0) > 0) {
    it.cdAt = 0
    dirty = true
  }

  // 储备与冷却互斥：还有储备就不该在冷却
  if ((it.charges ?? 0) > 0 && (it.cdAt ?? 0) > 0) {
    it.cdAt = 0
    dirty = true
  }
  // 不冷却的类型永远不该带冷却字段
  if ((d.refillMs ?? 0) <= 0 && ((it.cdAt ?? 0) > 0 || (it.cdLeft ?? 0) > 0)) {
    it.cdAt = 0
    it.cdLeft = 0
    dirty = true
  }
  // 冷却型对象储备为 0 却没有冷却（数据坏了）：补一个冷却，
  // 避免它永久卡在"点不动、也等不到补满"的死状态
  if (
    (d.refillMs ?? 0) > 0 &&
    (it.charges ?? 0) <= 0 &&
    (it.cdAt ?? 0) <= 0 &&
    (it.cdLeft ?? 0) <= 0
  ) {
    it.cdAt = Date.now() + d.refillMs!
    dirty = true
  }
  return dirty
}

/**
 * 自动型只带 `lastAutoAt`，其余字段一律清掉。
 * 时间戳非法时按"刚释放过"处理 —— 与其猜一个可能白送收益的值，不如让它从零开始攒。
 */
function fixAuto(it: BoardItem): boolean {
  let dirty = false
  const la = it.lastAutoAt
  if (typeof la !== 'number' || !Number.isFinite(la) || la < 0) {
    it.lastAutoAt = Date.now()
    dirty = true
  }
  if (it.charges != null || it.cdAt != null || it.cdLeft != null) {
    delete it.charges
    delete it.cdAt
    delete it.cdLeft
    dirty = true
  }
  return dirty
}

/** 逐条校验 / 补齐字段。返回 null 表示结构不可用。 */
function normalize(raw: any): LoadResult | null {
  if (!raw || typeof raw !== 'object') return null
  if (!Array.isArray(raw.board) || raw.board.length !== TOTAL) return null
  if (raw.v !== SAVE_VERSION) return null

  let dirty = false
  const s = raw as GameState

  const unlocked = emptyUnlocked()
  if (raw.unlocked && typeof raw.unlocked === 'object') {
    for (const k of Object.keys(unlocked) as ChainKey[]) unlocked[k] = !!raw.unlocked[k]
  }
  s.unlocked = unlocked
  // 设施链是产出源头、礼包链由设施直接产出 —— 两条都必须始终可用，
  // 否则玩家会因为老存档里缺这两个键而彻底失去产出能力
  if (!s.unlocked.fac) {
    s.unlocked.fac = true
    dirty = true
  }
  if (!s.unlocked.supply) {
    s.unlocked.supply = true
    dirty = true
  }
  const prevLive = JSON.stringify(s.live ?? null)
  s.live = normalizeLive(s.live)
  if (JSON.stringify(s.live) !== prevLive) dirty = true

  if (typeof s.gem !== 'number') (s.gem = 60), (dirty = true)
  if (typeof s.gold !== 'number') (s.gold = 0), (dirty = true)
  if (typeof s.exp !== 'number') (s.exp = 0), (dirty = true)
  if (typeof s.level !== 'number') (s.level = 1), (dirty = true)
  if (typeof s.stamina !== 'number') (s.stamina = 0), (dirty = true)
  if (typeof s.merges !== 'number') (s.merges = 0), (dirty = true)
  if (typeof s.gensMade !== 'number') (s.gensMade = 0), (dirty = true)
  if (typeof s.regenAt !== 'number') (s.regenAt = Date.now()), (dirty = true)
  if (!s.bonusClaimed || typeof s.bonusClaimed !== 'object') (s.bonusClaimed = {}), (dirty = true)

  // ★ 已删除 spawnCd（旧的"两个主发射器各自的点击冷却"）——
  //   设施现在是棋盘上的对象，冷却状态记在物品自己的 `cdAt` 上，没有全局数组了
  if (!Array.isArray(s.web) || s.web.length !== TOTAL) {
    s.web = new Array(TOTAL).fill(false)
    dirty = true
  }
  if (typeof s.websCleared !== 'number') (s.websCleared = 0), (dirty = true)
  if (typeof s.produces !== 'number') (s.produces = 0), (dirty = true)

  // ---- 订单：未知链 / 结构不对 / 缺了第一批新增字段的，一律重抽 ----
  if (!Array.isArray(s.orders)) {
    s.orders = []
    dirty = true
  }
  s.orders = s.orders.map((o: Order) => {
    const ok =
      !!o &&
      isChainKey(o.chain) &&
      typeof o.level === 'number' &&
      !!defOf(o.chain, o.level) &&
      // 第一批给订单加了 档位 / 顾客 / 倒计时 / 星星 / 好感，
      // 旧订单（含 P0 迁移过来的）没有这些字段 → 直接重抽，不用默认值硬撑
      ORDER_TIERS.some((t) => t.key === o.tier) &&
      !!customerDef(o.customer) &&
      typeof o.expireAt === 'number'
    if (ok) return o
    dirty = true
    return makeOrder(orderCtxOf(s))
  })
  // 槽位数变化时对齐（多了截断、少了补齐），否则 UI 会出现空档
  while (s.orders.length < ORDER_SLOTS) {
    s.orders.push(makeOrder(orderCtxOf(s)))
    dirty = true
  }
  if (s.orders.length > ORDER_SLOTS) {
    s.orders.length = ORDER_SLOTS
    dirty = true
  }

  // ---- 棋盘：链结构变更后可能留下"读不出定义的孤儿物品"，直接清掉 ----
  // ★ 先跑链深度迁移，再做物品校验：加深链路会让旧存档的顶端物品（如 Lv4 猫城堡）
  //   在新表里变成完全不同的东西（Lv4 猫抓板），必须先把它们搬到新顶端再校验。
  if (migrateChainDepth(s)) dirty = true

  for (let i = 0; i < TOTAL; i++) {
    try {
      const it = s.board[i]
      if (!it) continue
      if (!isChainKey(it.chain)) {
        s.board[i] = null
        dirty = true
        continue
      }
      // 可点击的发射器补齐 / 清掉 charges，避免旧存档出现 undefined 耐久
      const it2 = it as BoardItem
      if (typeof it2.level !== 'number') {
        s.board[i] = null
        dirty = true
        continue
      }
      const d = defOf(it2.chain, it2.level)
      if (!d) {
        s.board[i] = null
        dirty = true
        continue
      }
      if (isClickable(d)) {
        if (fixStock(it2, d)) dirty = true
      } else if (isAutoDef(d)) {
        if (fixAuto(it2)) dirty = true
      } else if (it2.charges != null || it2.cdAt != null || it2.lastAutoAt != null) {
        // 既不是可点击对象也不是自动型，却带着它们的运行时字段 → 清掉
        delete it2.charges
        delete it2.cdAt
        delete it2.lastAutoAt
        dirty = true
      }
    } catch {
      // 单个坏物品只能牺牲自己，绝不能连累整份存档
      s.board[i] = null
      dirty = true
    }
  }

  if (reconcileWebs(s)) dirty = true

  // ---- 背包 ----
  if (!Array.isArray(s.bag) || s.bag.length !== BAG_TOTAL) {
    s.bag = new Array(BAG_TOTAL).fill(null)
    dirty = true
  }
  if (typeof s.bagCap !== 'number' || s.bagCap < 0) {
    s.bagCap = BAG_INITIAL_CAP
    dirty = true
  }
  if (typeof s.bagExpanded !== 'number' || s.bagExpanded < 0) {
    s.bagExpanded = 0
    dirty = true
  }

  // 逐个槽位清洗：孤儿物品 / 未知道具只清它自己
  let lastOccupied = -1
  for (let i = 0; i < BAG_TOTAL; i++) {
    const slot = s.bag[i] as BagSlot
    if (!slot) continue
    if (slot.k === 'tool') {
      const key = slot.st?.tool
      const count = slot.st?.count
      if (!key || !Object.prototype.hasOwnProperty.call(TOOLS, key) || !(count > 0)) {
        s.bag[i] = null
        dirty = true
        continue
      }
      if (count !== Math.floor(count)) {
        slot.st.count = Math.floor(count)
        dirty = true
      }
      lastOccupied = i
      continue
    }
    if (slot.k === 'item') {
      const it = slot.it
      if (!it || !isChainKey(it.chain) || !defOf(it.chain, it.level)) {
        s.bag[i] = null
        dirty = true
        continue
      }
      if (isClickable(defOf(it.chain, it.level)!)) {
        if (fixStock(it, defOf(it.chain, it.level)!)) dirty = true
      } else if (isAutoDef(defOf(it.chain, it.level)!)) {
        if (fixAuto(it)) dirty = true
      } else if (it.charges != null || it.cdAt != null || it.cdLeft != null || it.lastAutoAt != null) {
        delete it.charges
        delete it.cdAt
        delete it.cdLeft
        delete it.lastAutoAt
        dirty = true
      }
      lastOccupied = i
      continue
    }
    // 结构不认识
    s.bag[i] = null
    dirty = true
  }

  // 容量不能小于已经装了东西的范围，否则会出现"看不见但占着位"的幽灵物品
  const minCap = Math.min(BAG_TOTAL, Math.max(BAG_INITIAL_CAP, lastOccupied + 1))
  if (s.bagCap > BAG_TOTAL) {
    s.bagCap = BAG_TOTAL
    dirty = true
  }
  if (s.bagCap < minCap) {
    s.bagCap = minCap
    dirty = true
  }

  // ---- 背包上棋盘（2026-10-02 交互修正）----
  // 背包从"外部按钮"变成"摆在主场景右下角的可拖拽道具"。
  // 旧存档没有 bagAt 字段：按"可加字段 + 默认值"补齐，不升 SAVE_VERSION。
  // placeBag 会避开蛛网格；目标格被物品占着就把它挤到随机空位（挤不动就暂不上棋盘，-1）。
  {
    const ba = s.bagAt
    const invalid =
      typeof ba !== 'number' ||
      !Number.isInteger(ba) ||
      ba < -1 ||
      ba >= TOTAL ||
      (ba >= 0 && ((Array.isArray(s.web) && s.web[ba]) || (Array.isArray(s.board) && s.board[ba])))
    if (invalid) {
      placeBag(s, TOTAL - 1)
      dirty = true
    }
  }

  // ---- 产出源头兜底 ----
  // ★ 必须放在背包归一化**之后**：`countFacilities()` 要把背包里的设施也算进去。
  //   放在前面的话，"设施全收进背包"的玩家每次读档都会被重复补发两个设施。
  //   设施是唯一的无限产出源，棋盘与背包一个都没有时补回开局设施，
  //   否则玩家进入"什么都产不出"的死局。
  if (ensureFacilities(s)) dirty = true

  // ---- 经营层（第一批新增）----
  // 全部按"可加字段 + 默认值"处理，**刻意不升 SAVE_VERSION**：老存档不会因为这次扩展被丢弃。
  if (typeof s.stars !== 'number' || !(s.stars >= 0)) (s.stars = 0), (dirty = true)
  if (typeof s.cardDay !== 'string') (s.cardDay = ''), (dirty = true)
  if (typeof s.facDay !== 'string') (s.facDay = ''), (dirty = true)
  // 限购计数在旧存档里可能缺失：store 的 markBought 会直接对它写键，
  // 缺了会抛 TypeError —— 必须在这里补齐（存档杀手规则的防御点之一）
  if (!s.shopBought || typeof s.shopBought !== 'object') (s.shopBought = {}), (dirty = true)

  // ---- 模拟充值 / 付费内容（第四批 M2 新增字段，可加字段 + 默认值）----
  if (typeof s.firstRecharge !== 'boolean') (s.firstRecharge = false), (dirty = true)
  if (typeof s.vipUntil !== 'number') (s.vipUntil = 0), (dirty = true)
  if (typeof s.vipDay !== 'string') (s.vipDay = ''), (dirty = true)
  if (typeof s.fundOwned !== 'boolean') (s.fundOwned = false), (dirty = true)
  if (typeof s.fundClaimed !== 'number' || s.fundClaimed < 0) (s.fundClaimed = 0), (dirty = true)
  if (typeof s.luckyPity !== 'number' || s.luckyPity < 0) (s.luckyPity = 0), (dirty = true)
  if (!s.giftBought || typeof s.giftBought !== 'object') (s.giftBought = {}), (dirty = true)

  if (!s.affinity || typeof s.affinity !== 'object') (s.affinity = {}), (dirty = true)
  for (const k of Object.keys(s.affinity)) {
    const v = s.affinity[k]
    // 已下线的顾客、非数字、负数：只删这一条好感，不动别人
    if (!customerDef(k) || typeof v !== 'number' || !(v >= 0)) {
      delete s.affinity[k]
      dirty = true
    }
  }

  if (!Array.isArray(s.pets)) (s.pets = []), (dirty = true)
  const pets = s.pets.filter((k) => typeof k === 'string' && !!customerDef(k))
  if (pets.length !== s.pets.length) dirty = true
  s.pets = Array.from(new Set(pets))
  if (typeof s.petAt !== 'number') (s.petAt = Date.now()), (dirty = true)

  // 缺失时按"只有前台大厅开着"初始化；**已有数据不做整体重建**，
  // 否则会把玩家花钱花时间解锁的区域一次抹掉
  if (!s.regions || typeof s.regions !== 'object') (s.regions = freshRegions()), (dirty = true)
  for (const k of Object.keys(s.regions) as RegionKey[]) {
    if (!regionDef(k)) {
      delete s.regions[k]
      dirty = true
    }
  }
  // 前台大厅是开局区域：任何情况下都必须开着，否则整条区域链会断在这里
  if (!s.regions.lobby) (s.regions.lobby = true), (dirty = true)
  if (raisePlotsForChains(s.live.plotLv, s.unlocked)) dirty = true

  if (!s.decor || typeof s.decor !== 'object') (s.decor = {}), (dirty = true)
  for (const k of Object.keys(s.decor)) {
    const d = decorDef(k)
    const lv = s.decor[k]
    if (!d || typeof lv !== 'number' || !(lv > 0)) {
      delete s.decor[k]
      dirty = true
      continue
    }
    if (lv > d.maxLevel) {
      s.decor[k] = d.maxLevel
      dirty = true
    }
  }

  s.v = SAVE_VERSION
  return { state: s, dirty }
}

function readKey(key: string): unknown | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// ==================== 存档信封（SaveEnvelope，文档 13.3 的数据契约）====================

/**
 * 存档的**外层信封**。
 *
 * ★ 为什么要包一层而不是直接存 state：
 *   未来接服务端同步时，冲突判定需要「谁在什么时候、用哪台设备写的、内容是否完整」
 *   这四样元信息。现在就把它们做进存档本体，未来接服务端**玩法代码零改动**
 *   （文档 13.6 的承诺：实现 HttpSyncAdapter 就够了）。
 *
 * `checksum` 不是加密，只是**完整性标记**：能看出"这份数据被截断 / 手改坏了"，
 * 让 load() 明智地退到备份，而不是把一坨坏数据当真。
 */
export const ENVELOPE_VERSION = 1

export interface SaveEnvelope {
  schemaVersion: number
  /** 保存时刻 */
  savedAt: number
  /** 设备标识：区分"这份存档被哪台设备写过" */
  deviceId: string
  /** payload 的校验和 */
  checksum: string
  payload: GameState
}

const DEVICE_KEY = 'pawpark_device'

/** 设备标识（首次访问生成，与游戏状态分离 —— 重置存档不应该换设备身份） */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return 'unknown'
  }
}

/**
 * djb2 校验和。
 * 目的只有一个：**识别"这份数据已经不完整了"**，让 load() 退到备份。
 * 它防不了蓄意篡改（那也不是单机游戏的威胁模型）。
 */
export function checksumOf(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function wrapSave(s: GameState): SaveEnvelope {
  const payload = s
  return {
    schemaVersion: ENVELOPE_VERSION,
    savedAt: Date.now(),
    deviceId: deviceId(),
    checksum: checksumOf(JSON.stringify(payload)),
    payload,
  }
}

/**
 * 从读取到的对象里取出 state。
 * 兼容两种历史格式：
 *  - 现在的信封（有 payload / checksum / schemaVersion）
 *  - 旧版的裸 state（直接就是 GameState）—— 不校验 checksum，交给 normalize 容错
 */
function unwrapSave(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.payload !== 'object' || obj.payload === null) return raw as GameState

  const env = obj as unknown as SaveEnvelope
  if (env.schemaVersion !== ENVELOPE_VERSION) return null
  if (checksumOf(JSON.stringify(env.payload)) !== env.checksum) return null // 数据不完整 → 交给备份
  return env.payload
}

function envelopeAt(raw: unknown): number {
  if (raw && typeof raw === 'object' && typeof (raw as { savedAt?: unknown }).savedAt === 'number') {
    return (raw as { savedAt: number }).savedAt
  }
  return 0
}

// ==================== 多槽位备份 ====================

/** 备份槽位：轮转写入（1→2→3→1），永远保留最近三份 */
const BACKUP_SLOTS = [1, 2, 3] as const

function backupKey(n: number): string {
  return `${SAVE_KEY}_bak_${n}`
}

/**
 * 写一份备份到最旧的槽位（轮转）。
 * 自动触发时机：**每天第一次存档**（见 store 的 init）—— 手动备份也走这里。
 */
export function backupNow(s: GameState): number {
  try {
    let slot: number = BACKUP_SLOTS[0]
    let oldest = Number.POSITIVE_INFINITY
    for (const n of BACKUP_SLOTS) {
      const raw = readKey(backupKey(n))
      if (!raw) {
        slot = n // 有空槽优先用
        break
      }
      const at = envelopeAt(raw)
      if (at < oldest) {
        oldest = at
        slot = n
      }
    }
    localStorage.setItem(backupKey(slot), JSON.stringify(wrapSave(s)))
    return slot
  } catch {
    return 0 // 隐私模式 / 配额满：备份失败不打断玩法，但主存档仍是最新的
  }
}

export interface BackupInfo {
  slot: number
  savedAt: number
  /** 数据完整性校验是否通过 */
  ok: boolean
}

/** 列出三个备份槽位的状态（设置页展示用） */
export function listBackups(): BackupInfo[] {
  return BACKUP_SLOTS.map((slot) => {
    const raw = readKey(backupKey(slot))
    if (!raw) return { slot, savedAt: 0, ok: false }
    const state = unwrapSave(raw)
    return { slot, savedAt: envelopeAt(raw), ok: !!state }
  })
}

/** 从某个备份槽位恢复到主存档。返回是否成功 */
export function restoreBackup(slot: number): { ok: boolean; error?: string } {
  if (!(BACKUP_SLOTS as readonly number[]).includes(slot)) {
    return { ok: false, error: '没有这个备份槽位' }
  }
  const raw = readKey(backupKey(slot))
  if (!raw) return { ok: false, error: '这个槽位还没有备份' }
  const state = unwrapSave(raw)
  if (!state) return { ok: false, error: '备份数据不完整，无法恢复' }
  const res = normalize(state)
  if (!res) return { ok: false, error: '备份结构无法识别（版本不兼容）' }
  save(res.state)
  return { ok: true }
}

// ==================== 导出 / 导入 ====================

/**
 * 导出当前存档（信封原文）。
 * 单机版玩家唯一的安全网 —— 让他能把进度带走、发给朋友、贴到网盘里。
 */
export function exportSaveText(): string | null {
  try {
    return localStorage.getItem(SAVE_KEY)
  } catch {
    return null
  }
}

/** 当前存档的元信息（设置页展示用） */
export function saveInfo(): { exists: boolean; savedAt: number; ok: boolean; bytes: number } {
  const raw = exportSaveText()
  if (!raw) return { exists: false, savedAt: 0, ok: false, bytes: 0 }
  const parsed = readKey(SAVE_KEY)
  const state = parsed ? unwrapSave(parsed) : null
  return {
    exists: true,
    savedAt: envelopeAt(parsed),
    ok: !!state,
    bytes: raw.length,
  }
}

export interface ImportResult {
  ok: boolean
  error?: string
  /** 导入的是不是"旧版裸存档"（没有信封），UI 可以据此提示一句 */
  legacy?: boolean
}

/**
 * 导入一份存档文本。
 * ★ 全程走 normalize()：**坏数据只清它自己**，绝不会因为导入了一份脏文件
 *   就让游戏再也起不来。
 */
export function importSaveText(text: string): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: '解析失败：文本不是合法的 JSON' }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: '内容为空或格式不对' }
  }

  const state = unwrapSave(parsed)
  const legacy = !state // 裸 state 也会被 unwrapSave 原样返回，所以这里不会是 null
  if (!state) return { ok: false, error: '这不是《爪爪乐园》的存档文件' }

  const res = normalize(state)
  if (!res) return { ok: false, error: '存档结构无法识别（版本不兼容或已损坏）' }

  // ★ 写回必须走 wrapSave 重新包装：normalize 是就地修改 state（== parsed.payload），
  //   若直接 JSON.stringify(parsed) 写回，payload 已是"修过的"，而 checksum 还是
  //   "修前"的 —— 下一次 load() 校验必失配，主存档被当成损坏数据丢进备份链。
  //   （实测复现：导入后 load() 返回 null。）
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(wrapSave(res.state)))
  } catch {
    return { ok: false, error: '写入失败（可能是浏览器隐私模式或空间不足）' }
  }
  return { ok: true, legacy }
}

export function load(): LoadResult | null {
  // 主存档（信封）
  const cur = readKey(SAVE_KEY)
  if (cur) {
    const state = unwrapSave(cur)
    if (state) {
      const res = normalize(state)
      if (res) return res
      // 主存档结构无法识别 → 继续往下走备份，而不是直接返回 null 丢掉
    }
  }

  // 主存档缺失 / 损坏：依次尝试备份槽位（新 → 旧）
  const slots = [...BACKUP_SLOTS].sort((a, b) => {
    const ra = readKey(backupKey(a))
    const rb = readKey(backupKey(b))
    return envelopeAt(rb) - envelopeAt(ra)
  })
  for (const slot of slots) {
    const raw = readKey(backupKey(slot))
    if (!raw) continue
    const state = unwrapSave(raw)
    if (!state) continue
    const res = normalize(state)
    if (res) return { state: res.state, dirty: true, fromBackup: slot }
  }

  // 没有任何可用存档时，尝试迁移 P0 老存档
  const legacy = readKey(LEGACY_KEY)
  if (legacy) {
    const res = normalize(migrateLegacy(legacy))
    if (res) return { state: res.state, dirty: true }
  }
  return null
}

export function save(s: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(wrapSave(s)))
  } catch {
    // 隐私模式 / 配额满：忽略，不能让存档失败打断玩法
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    /* noop */
  }
}
