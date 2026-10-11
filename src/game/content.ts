/**
 * 长线内容：剧情、图鉴标记、造型、卡牌、节日、天气、羁绊、乐园摆放、
 * 每日任务、签到、放弃订单、分享码。
 *
 * 只放表和纯函数。改存档的动作在 store。
 */

import type { Camp, ChainKey, CustomerKey } from './types'
import { ABANDON_MS } from './config'
import { DECORS } from './business'
import { freshPlotLv, normalizePlotLv, type ThemeId } from './yard'

export interface Placement {
  decor: string
  x: number
  y: number
  rot: number
}

export interface LiveState {
  /** 旧字段。开局不再选择阵营，主题看 theme */
  camp: '' | Camp
  /** 乐园外观。进度不跟这个走 */
  theme: ThemeId
  /** 地块等级。0 = 还没买，1 = 盖好，2 = 升级过 */
  plotLv: Record<string, number>
  /** 见过的链物品，形如 `toy:3` */
  seen: string[]
  /** 已拥有的造型 */
  skins: string[]
  /** 顾客 key → 穿上的造型 */
  equipped: Record<string, string>
  /** 已解锁的卡牌 */
  cards: string[]
  /** 三套乐园方案 */
  schemes: Placement[][]
  schemeNames: string[]
  schemeIx: number
  /** 常驻宠物派到哪个区域 */
  post: Record<string, string>
  /** 羁绊今日是否已发奖，日期键 */
  bondDay: string
  questDay: string
  questMerge: number
  questDeliver: number
  questProduce: number
  questClaimed: boolean
  checkinDay: string
  streak: number
  /** 放弃订单后禁刷的 `链:等级` */
  banKey: string
  banUntil: number
  /** 非空 = 时间旅行到这个节日，忽略真实日期 */
  festFocus: string
  festClaim: string
  infiniteUntil: number
  weatherTold: string
  backupPrompted: boolean
  delivers: number
  playMs: number
  startedAt: number
  sound: boolean
  postcards: number
}

export const PARK_COLS = 6
export const PARK_ROWS = 4
export const ACT_AT = [80, 160, 240] as const

export function freshLive(now = Date.now()): LiveState {
  return {
    camp: '',
    theme: 'cat',
    plotLv: freshPlotLv(),
    seen: [],
    skins: [],
    equipped: {},
    cards: [],
    schemes: [[], [], []],
    schemeNames: ['日常', '节日', '备用'],
    schemeIx: 0,
    post: {},
    bondDay: '',
    questDay: '',
    questMerge: 0,
    questDeliver: 0,
    questProduce: 0,
    questClaimed: false,
    checkinDay: '',
    streak: 0,
    banKey: '',
    banUntil: 0,
    festFocus: '',
    festClaim: '',
    infiniteUntil: 0,
    weatherTold: '',
    backupPrompted: false,
    delivers: 0,
    playMs: 0,
    startedAt: now,
    sound: false,
    postcards: 0,
  }
}

function num(v: unknown, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

export function normalizeLive(raw: unknown, now = Date.now()): LiveState {
  const base = freshLive(now)
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Partial<LiveState>
  base.camp = o.camp === 'cat' || o.camp === 'dog' ? o.camp : ''
  base.theme = o.theme === 'dog' ? 'dog' : 'cat'
  base.plotLv = normalizePlotLv(o.plotLv)
  base.seen = Array.isArray(o.seen) ? o.seen.filter((x) => typeof x === 'string').slice(0, 400) : []
  base.skins = Array.isArray(o.skins) ? [...new Set(o.skins.filter((x) => typeof x === 'string' && skinDef(x)))] : []
  base.equipped = o.equipped && typeof o.equipped === 'object' ? { ...o.equipped } : {}
  base.cards = Array.isArray(o.cards) ? [...new Set(o.cards.filter((x) => typeof x === 'string'))] : []
  base.schemes = [0, 1, 2].map((i) => sanitizeScheme(o.schemes?.[i]))
  if (Array.isArray(o.schemeNames) && o.schemeNames.length === 3) {
    base.schemeNames = o.schemeNames.map((n, i) => (typeof n === 'string' && n.trim() ? n.slice(0, 8) : base.schemeNames[i]))
  }
  base.schemeIx = Math.min(2, Math.max(0, Math.floor(num(o.schemeIx))))
  base.post = o.post && typeof o.post === 'object' ? { ...o.post } : {}
  base.bondDay = typeof o.bondDay === 'string' ? o.bondDay : ''
  base.questDay = typeof o.questDay === 'string' ? o.questDay : ''
  base.questMerge = Math.max(0, Math.floor(num(o.questMerge)))
  base.questDeliver = Math.max(0, Math.floor(num(o.questDeliver)))
  base.questProduce = Math.max(0, Math.floor(num(o.questProduce)))
  base.questClaimed = !!o.questClaimed
  base.checkinDay = typeof o.checkinDay === 'string' ? o.checkinDay : ''
  base.streak = Math.max(0, Math.floor(num(o.streak)))
  base.banKey = typeof o.banKey === 'string' ? o.banKey : ''
  base.banUntil = num(o.banUntil)
  base.festFocus = typeof o.festFocus === 'string' && FESTS.some((f) => f.key === o.festFocus) ? o.festFocus : ''
  base.festClaim = typeof o.festClaim === 'string' ? o.festClaim : ''
  base.infiniteUntil = num(o.infiniteUntil)
  base.weatherTold = typeof o.weatherTold === 'string' ? o.weatherTold : ''
  base.backupPrompted = !!o.backupPrompted
  base.delivers = Math.max(0, Math.floor(num(o.delivers)))
  base.playMs = Math.max(0, Math.floor(num(o.playMs)))
  base.startedAt = num(o.startedAt, now) || now
  base.sound = !!o.sound
  base.postcards = Math.max(0, Math.floor(num(o.postcards)))
  return base
}

function sanitizeScheme(raw: unknown): Placement[] {
  if (!Array.isArray(raw)) return []
  const used = new Set<string>()
  const cells = new Set<string>()
  const out: Placement[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const d = (p as Placement).decor
    const x = Math.floor(num((p as Placement).x))
    const y = Math.floor(num((p as Placement).y))
    const rot = ((Math.floor(num((p as Placement).rot)) % 4) + 4) % 4
    if (typeof d !== 'string' || !DECORS.some((x) => x.key === d)) continue
    if (x < 0 || y < 0 || x >= PARK_COLS || y >= PARK_ROWS) continue
    const cell = `${x},${y}`
    if (used.has(d) || cells.has(cell)) continue
    used.add(d)
    cells.add(cell)
    out.push({ decor: d, x, y, rot })
  }
  return out
}

export function itemSeenId(chain: string, level: number): string {
  return `${chain}:${level}`
}

export function noteSeen(live: LiveState, chain: string, level: number): boolean {
  const id = itemSeenId(chain, level)
  if (live.seen.includes(id)) return false
  live.seen.push(id)
  return true
}

export function actsUnlocked(affinity: number): number {
  return ACT_AT.filter((n) => affinity >= n).length
}

export function banActive(live: LiveState, now: number): boolean {
  return !!live.banKey && live.banUntil > now
}

export function setBan(live: LiveState, chain: ChainKey, level: number, now: number): void {
  live.banKey = `${chain}:${level}`
  live.banUntil = now + ABANDON_MS
}

export function isBanned(live: LiveState, chain: string, level: number, now: number): boolean {
  return banActive(live, now) && live.banKey === `${chain}:${level}`
}

export function weatherOn(day: string): 'clear' | 'rain' {
  let h = 2166136261
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 16777619)
  return (h >>> 0) % 4 === 0 ? 'rain' : 'clear'
}

export interface Fest {
  key: string
  name: string
  emoji: string
  month: number
  day: number
  span: number
  blurb: string
}

export const FESTS: readonly Fest[] = [
  { key: 'newyear', name: '元旦', emoji: '🎆', month: 1, day: 1, span: 3, blurb: '订单金币 +20%' },
  { key: 'spring', name: '春节', emoji: '🧧', month: 2, day: 10, span: 7, blurb: '订单金币 +20%' },
  { key: 'valentine', name: '情人节', emoji: '💝', month: 2, day: 14, span: 1, blurb: '订单金币 +20%' },
  { key: 'children', name: '儿童节', emoji: '🎈', month: 6, day: 1, span: 1, blurb: '订单金币 +20%' },
  { key: 'dragon', name: '端午', emoji: '🎏', month: 6, day: 10, span: 3, blurb: '订单金币 +20%' },
  { key: 'summer', name: '夏日', emoji: '🏖️', month: 7, day: 15, span: 7, blurb: '订单金币 +20%' },
  { key: 'midautumn', name: '中秋', emoji: '🌕', month: 9, day: 15, span: 3, blurb: '订单金币 +20%' },
  { key: 'halloween', name: '万圣', emoji: '🎃', month: 10, day: 31, span: 1, blurb: '订单金币 +20%' },
  { key: 'xmas', name: '圣诞', emoji: '🎄', month: 12, day: 24, span: 3, blurb: '订单金币 +20%' },
]

export function festByDate(now: number): Fest | null {
  const d = new Date(now)
  const m = d.getMonth() + 1
  const day = d.getDate()
  return FESTS.find((f) => m === f.month && day >= f.day && day < f.day + f.span) ?? null
}

/** focus 非空时无视日历，这是单机时间旅行 */
export function festActive(now: number, focus: string): Fest | null {
  if (focus) return FESTS.find((f) => f.key === focus) ?? null
  return festByDate(now)
}

export function rollQuestDay(live: LiveState, day: string): void {
  if (live.questDay === day) return
  live.questDay = day
  live.questMerge = 0
  live.questDeliver = 0
  live.questProduce = 0
  live.questClaimed = false
}

export interface SkinDef {
  key: string
  name: string
  emoji: string
  camp: Camp | 'both'
}

export const SKINS: readonly SkinDef[] = [
  { key: 'scarf-red', name: '红围巾', emoji: '🧣', camp: 'both' },
  { key: 'bow-pink', name: '粉蝴蝶结', emoji: '🎀', camp: 'cat' },
  { key: 'cap-blue', name: '蓝鸭舌帽', emoji: '🧢', camp: 'dog' },
  { key: 'bell-gold', name: '金铃铛', emoji: '🔔', camp: 'cat' },
  { key: 'bandana', name: '花纹头巾', emoji: '🧣', camp: 'dog' },
  { key: 'glasses', name: '圆眼镜', emoji: '👓', camp: 'both' },
  { key: 'flower', name: '小雏菊', emoji: '🌼', camp: 'cat' },
  { key: 'tie', name: '条纹领带', emoji: '👔', camp: 'dog' },
  { key: 'hood', name: '连帽斗篷', emoji: '🧥', camp: 'both' },
  { key: 'star', name: '星星发卡', emoji: '⭐', camp: 'cat' },
  { key: 'bone', name: '骨头项圈', emoji: '🦴', camp: 'dog' },
  { key: 'yarn', name: '毛线围脖', emoji: '🧶', camp: 'cat' },
  { key: 'crown', name: '纸皇冠', emoji: '👑', camp: 'both' },
  { key: 'rain', name: '黄雨衣', emoji: '🧥', camp: 'both' },
  { key: 'swim', name: '泳圈', emoji: '🛟', camp: 'dog' },
  { key: 'santa', name: '圣诞帽', emoji: '🎅', camp: 'both' },
  { key: 'lantern', name: '灯笼挂饰', emoji: '🏮', camp: 'both' },
  { key: 'moon', name: '月饼盒背包', emoji: '🥮', camp: 'both' },
  { key: 'pumpkin', name: '南瓜披风', emoji: '🎃', camp: 'both' },
  { key: 'heart', name: '心形吊牌', emoji: '💌', camp: 'both' },
  { key: 'leaf', name: '粽叶斗笠', emoji: '🍃', camp: 'both' },
  { key: 'sun', name: '遮阳帽', emoji: '👒', camp: 'both' },
  { key: 'balloon', name: '气球背带', emoji: '🎈', camp: 'both' },
  { key: 'medal', name: '小金牌', emoji: '🏅', camp: 'dog' },
]

export function skinDef(key: string): SkinDef | null {
  return SKINS.find((s) => s.key === key) ?? null
}

export function grantSkin(live: LiveState, key: string): 'new' | 'dup' | 'bad' {
  if (!skinDef(key)) return 'bad'
  if (live.skins.includes(key)) return 'dup'
  live.skins.push(key)
  return 'new'
}

export function pickSkin(rng: () => number): SkinDef {
  return SKINS[Math.floor(rng() * SKINS.length)] ?? SKINS[0]
}

export function pickDecorKey(rng: () => number): string {
  const d = DECORS[Math.floor(rng() * DECORS.length)] ?? DECORS[0]
  return d.key
}

export interface Bond {
  id: string
  cat: CustomerKey
  dog: CustomerKey
  name: string
  chain: ChainKey
  level: number
}

export const BONDS: readonly Bond[] = [
  { id: 'nap', cat: 'ragdoll', dog: 'golden', name: '相拥午睡', chain: 'comfort', level: 2 },
  { id: 'play', cat: 'siamese', dog: 'husky', name: '拆家同盟', chain: 'toy', level: 3 },
  { id: 'meal', cat: 'orange', dog: 'shiba', name: '干饭搭子', chain: 'food', level: 2 },
  { id: 'spa', cat: 'british', dog: 'corgi', name: '美容日', chain: 'care', level: 2 },
]

export function readyBonds(live: LiveState, pets: readonly string[]): Bond[] {
  return BONDS.filter((b) => {
    if (!pets.includes(b.cat) || !pets.includes(b.dog)) return false
    const a = live.post[b.cat]
    const c = live.post[b.dog]
    return !!a && a === c
  })
}

export function placeDecor(live: LiveState, decor: string, x: number, y: number): boolean {
  if (!DECORS.some((d) => d.key === decor)) return false
  if (x < 0 || y < 0 || x >= PARK_COLS || y >= PARK_ROWS) return false
  const scheme = live.schemes[live.schemeIx] ?? []
  if (scheme.some((p) => p.decor === decor || (p.x === x && p.y === y))) return false
  scheme.push({ decor, x, y, rot: 0 })
  live.schemes[live.schemeIx] = scheme
  return true
}

export function rotatePlacement(live: LiveState, decor: string): boolean {
  const scheme = live.schemes[live.schemeIx] ?? []
  const p = scheme.find((x) => x.decor === decor)
  if (!p) return false
  p.rot = (p.rot + 1) % 4
  return true
}

export function liftPlacement(live: LiveState, decor: string): boolean {
  const scheme = live.schemes[live.schemeIx] ?? []
  const i = scheme.findIndex((x) => x.decor === decor)
  if (i < 0) return false
  scheme.splice(i, 1)
  return true
}

const STORY: Record<string, readonly [string, string, string]> = {
  ragdoll: ['……别误会，我只是刚好路过前台。', '你把毯子铺平了。我可以坐一下。', '今晚就留在这里。别告诉别的猫。'],
  orange: ['罐头呢？说好的罐头呢？', '第三听我可以慢慢吃。', '乐园的冰箱，以后归我巡视。'],
  siamese: ['这个逗猫棒得换个角度。', '我帮你盯着订单，你负责动手。', '行吧，店长的位置我暂时不争。'],
  british: ['今天能不能躺着办业务。', '沙发晒到太阳了。我验收合格。', '叫我起来之前，请先预约。'],
  husky: ['汪！……我是说，你好。', '那根绳子不是我拆的。是风。', '我可以当夜间保安。会叫。'],
  corgi: ['短腿也能跑很快的！', '飞盘我接到了，虽然是用脸。', '乐园的跑道，按我的腿长重画。'],
  shiba: ['嘿嘿。嘿嘿嘿嘿。', '这块肉干我们平分。我七你三。', '笑一下就算签约了。'],
  golden: ['需要帮忙吗？我随时都在。', '客人的袋子我帮你看过了。', '你忙的时候，我在门口等。'],
  tabby: ['抓板是我的。第二块也是。', '夜里的声音我先去看。', '拆家是巡查，请写进值班表。'],
  black: ['走路没声音是优点。', '灯关了我也找得到路。', '有些客人只肯跟我说。'],
  white: ['地上有一根毛。不是我的。', '洗护区今天可以开放了。', '洁癖也是一种服务质量。'],
  calico: ['抽奖之前先摸我一下。', '这张卡是幸运色。', '手气不好的时候来找我。'],
  teddy: ['我听得懂你没说出口的话。', '那位客人其实想要小一号的。', '察言观色，我可以教。'],
  lab: ['饭量是信誉。', '多出来的那份我可以负责。', '稳重的意思是：饭点不要迟到。'],
  border: ['这个障碍的间距不对。', '我数过了，你少点了一次。', '智商用来帮忙，不用来炫耀。'],
  frenchie: ['呼……我先躺下听你说。', '打呼表示我在值守。', '舒适区的标准，按我的肚皮来。'],
  maine: ['门框有点矮。', '高处的柜子我够得到。', '大型猫也需要自己的垫子。'],
  sphynx: ['毛衣不是装饰，是生存。', '暖气开着我就留下。', '无毛不是缺点，是省下梳毛的时间。'],
  samoyed: ['我笑起来像在下雪。', '白色的毛，请准备滚筒。', '合影的时候我站中间。'],
  bichon: ['圆的比较好抱。', '美容台我可以当模特。', '蓬松是一种专业。'],
  alaska: ['雪是我想念的地板。', '力气够，让我拉那辆小车。', '安静的时候，我也想被叫到名字。'],
  dachshund: ['沙发底下是我的办公室。', '短腿走得慢，但走得到。', '洞里的玩具，我负责归档。'],
  pomeranian: ['我不大，声音很大。', '请把我举到客人看得见的地方。', '小型犬的订单，我来签收。'],
  tianyuan: ['什么活我都干过。', '不挑食，也不挑客人。', '这间乐园，我认。'],
}

export function storyLines(customer: string): readonly string[] {
  return STORY[customer] ?? ['还在熟悉这间乐园。', '又来了一趟。', '这里可以常来。']
}

export function cardId(customer: string): string {
  return `card:${customer}`
}

export interface LayoutPack {
  schemes: Placement[][]
  schemeNames: string[]
  schemeIx: number
  post: Record<string, string>
}

export function encodeLayout(live: LiveState): string {
  const pack: LayoutPack = {
    schemes: live.schemes,
    schemeNames: live.schemeNames,
    schemeIx: live.schemeIx,
    post: live.post,
  }
  const json = JSON.stringify(pack)
  const b64 = btoa(unescape(encodeURIComponent(json)))
  return `paw1.${b64}`
}

export function decodeLayout(text: string): LayoutPack | null {
  const raw = text.trim()
  if (!raw.startsWith('paw1.')) return null
  try {
    const json = decodeURIComponent(escape(atob(raw.slice(5))))
    const o = JSON.parse(json) as LayoutPack
    if (!Array.isArray(o.schemes)) return null
    return {
      schemes: [0, 1, 2].map((i) => sanitizeScheme(o.schemes[i])),
      schemeNames: Array.isArray(o.schemeNames) ? o.schemeNames.slice(0, 3).map(String) : ['日常', '节日', '备用'],
      schemeIx: Math.min(2, Math.max(0, Math.floor(num(o.schemeIx)))),
      post: o.post && typeof o.post === 'object' ? o.post : {},
    }
  } catch {
    return null
  }
}
