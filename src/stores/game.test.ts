/**
 * 整机冒烟：真实挂载 App + Pinia，验证"组件 ↔ store ↔ 逻辑"三层确实连起来了。
 *
 * 对应 P0 的 `tests/smoke.test.js`：静态语法检查与纯逻辑仿真查不出 DOM 层与时序问题，
 * 这一层专门抓那类 bug（P0 时期一次抓出 4 个）。
 */

import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import App from '../App.vue'
import { useGameStore } from './game'
import { defOf, fullCharges, makeItem, maxLv, staminaMax } from '../game/logic'
import {
  AFFINITY_FULL,
  BAG_INITIAL_CAP,
  BAG_TOTAL,
  COLS,
  ORB_STAMINA,
  PET_GOLD_PER_HOUR,
  STAMINA_MAX,
  TOTAL,
} from '../game/config'
import { CUSTOMERS, DECORS, REGIONS } from '../game/business'
import { TOOL_ORDER } from '../game/tools'

let pinia: Pinia
let wrapper: VueWrapper | null = null

function mountApp() {
  pinia = createPinia()
  setActivePinia(pinia)
  const w = mount(App, { global: { plugins: [pinia] } })
  return { w, store: useGameStore() }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
})

describe('棋盘渲染', () => {
  it('渲染 7×9 共 63 格，且**没有锁定格**（主场景整块可用）', async () => {
    const { w } = mountApp()
    wrapper = w
    await nextTick()

    expect(w.findAll('.cell').length).toBe(TOTAL)
    expect(w.findAll('.cell.locked').length).toBe(0)
  })

  it('开局种子里有 2 个设施 + 4 个玩具物品 + 1 个背包格，设施带储备徽标', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    // 6 件物品 + 1 个背包道具格（.bagbox 也是 .item，2026-10-02 起）
    expect(w.findAll('.item').length).toBe(7)
    expect(w.find('.item.bagbox').exists()).toBe(true) // 背包摆在棋盘右下角
    expect(w.findAll('.item.fac').length).toBe(2)
    // 设施是可点击对象 → 显示储备数字
    expect(w.findAll('.item.fac .use').length).toBe(2)
    const facs = store.board.filter((it) => it && it.chain === 'fac')
    expect(facs.length).toBe(2)
  })

  it('顶部 HUD 显示体力 / 金币 / 钻石', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    expect(w.find('.coin.stamina .val').text()).toBe(`${STAMINA_MAX}/${STAMINA_MAX}`)
    expect(store.g!.gold).toBe(0)
    expect(store.g!.gem).toBe(60)
  })
})

describe('合成', () => {
  it('二合为一：两个 Lv1 合成一个 Lv2', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    // 清空后用固定位置摆放，避免受随机种子影响
    g.board.fill(null)
    g.board[0] = makeItem('toy', 1)
    g.board[1] = makeItem('toy', 1)
    await nextTick()

    expect(store.merge(0, 1)).toBe(true)
    await nextTick()

    expect(g.board[0]).toBeNull()
    expect(g.board[1]).toMatchObject({ chain: 'toy', level: 2 })
    expect(g.merges).toBe(1)
  })

  it('顶端母体不可合成', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.board[0] = makeItem('toy', maxLv('toy'))
    g.board[1] = makeItem('toy', maxLv('toy'))
    await nextTick()

    expect(store.merge(0, 1)).toBe(false)
    expect(g.board[0]).not.toBeNull()
  })

  it('「甲·重置为满」：合成出的发射器耐久回满，不继承剩余次数', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.board[0] = { chain: 'supply', level: 1, charges: 1 } // 点剩 1 次
    g.board[1] = { chain: 'supply', level: 1, charges: 3 }
    await nextTick()

    expect(store.merge(0, 1)).toBe(true)
    // 合成出的「小礼盒」储备重置为满 —— 两个素材各自剩多少都不继承
    expect(g.board[1]).toMatchObject({ chain: 'supply', level: 2 })
    expect(g.board[1]!.charges).toBe(fullCharges(defOf('supply', 2)!))
  })

  it('合成出母体后自动解锁下一条链，并把订单换成新链的', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    const topLv = maxLv('toy') - 1
    g.board[0] = makeItem('toy', topLv)
    g.board[1] = makeItem('toy', topLv)
    expect(g.unlocked.care).toBe(false)
    await nextTick()

    expect(store.merge(0, 1)).toBe(true)
    expect(g.unlocked.care).toBe(true)
    expect(g.gensMade).toBe(1)
    expect(g.board[1]).toMatchObject({ chain: 'toy', level: maxLv('toy') })
    // 合成出的母体储备重置为满（数值取自定义，不在测试里写死）
    expect(g.board[1]!.charges).toBe(fullCharges(defOf('toy', maxLv('toy'))!))
    expect(g.board[1]!.cdAt).toBe(0)
  })
})

describe('蛛网', () => {
  it('花金币清除：扣钱、清网、涨价', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.gold = 100
    g.web[10] = true
    await nextTick()

    const before = store.price
    store.tapWeb(10)
    await nextTick()

    expect(g.gold).toBe(100 - before)
    expect(g.web[10]).toBe(false)
    expect(g.websCleared).toBe(1)
    expect(store.price).toBeGreaterThan(before)
  })

  it('金币不足时不清除', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.gold = 0
    g.web[10] = true
    await nextTick()

    store.tapWeb(10)
    expect(g.web[10]).toBe(true)
  })

  it('牺牲物品换空格', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.board[3] = makeItem('toy', 1)
    g.web[20] = true
    await nextTick()

    expect(store.sacrificeToWeb(20, 3)).toBe(true)
    await nextTick()

    expect(g.board[3]).toBeNull()
    expect(g.web[20]).toBe(false)
  })
})

describe('订单交付', () => {
  it('交付后拿金币与经验，并换上新订单', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    const order = g.orders[0]
    g.board[7] = makeItem(order.chain, order.level)
    await nextTick()

    const goldBefore = g.gold
    const idBefore = order.id
    expect(store.deliver(order.id)).toBe(true)
    await nextTick()

    expect(g.gold).toBe(goldBefore + order.gold)
    expect(g.board[7]).toBeNull()
    expect(g.orders[0].id).not.toBe(idBefore)
  })

  it('棋盘上没有该物品时交付失败', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    expect(store.deliver(g.orders[0].id)).toBe(false)
    expect(g.orders[0].id).toBe(g.orders[0].id)
  })

  it('可交付的物品带 ✓ 角标', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    const order = g.orders[0]
    g.board[7] = makeItem(order.chain, order.level)
    await nextTick()

    expect(w.findAll('.badge').length).toBe(1)
  })
})

describe('体力与补贴', () => {
  it('点击体力条领取补贴，可突破上限', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 2, 13, 0, 0))

    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    // 13:00 落在 12:00 时段内，且该时段未领取
    expect(store.canClaimBonus).toBe(true)
    expect(w.find('.coin.stamina').classes()).toContain('bonus')

    await w.find('.coin.stamina').trigger('click')
    expect(store.g!.stamina).toBe(STAMINA_MAX + 50)
    expect(store.canClaimBonus).toBe(false) // 同一时段只能领一次
  })

  it('同一时段重复领取无效', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 2, 13, 0, 0))

    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    store.claimBonus()
    const after = store.g!.stamina
    store.claimBonus()
    expect(store.g!.stamina).toBe(after)
  })
})

describe('存档', () => {
  it('挂载时写入存档，重新挂载能读回', async () => {
    const first = mountApp()
    first.w.unmount()
    first.store.g!.gold = 4321
    first.store.persist()

    const second = mountApp()
    wrapper = second.w
    await nextTick()

    expect(second.store.g!.gold).toBe(4321)
  })

  it('重置后再挂载是全新开局（有种子、满体力）', async () => {
    const first = mountApp()
    first.w.unmount()
    first.store.g!.gold = 999
    first.store.reset()

    const second = mountApp()
    wrapper = second.w
    await nextTick()

    expect(second.store.g!.gold).toBe(0)
    expect(second.store.g!.stamina).toBe(STAMINA_MAX)
    expect(second.store.board.filter(Boolean).length).toBe(6) // 2 设施 + 4 玩具
  })
})

describe('背包：存入 / 取出', () => {
  it('长按选中后存入背包，物品从棋盘消失', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.board[0] = makeItem('toy', 2)
    await nextTick()

    store.selectBoardItem(0)
    expect(store.selectedItem).not.toBeNull()

    expect(store.moveToBag(0)).toBe(true)
    await nextTick()

    expect(g.board[0]).toBeNull()
    expect(store.selectedBoard).toBe(-1)
    // 开局背包里已有 5 格道具（五种各一，升级卡 x2），所以物品落在 index 5
    expect(g.bag[5]).toEqual({ k: 'item', it: { chain: 'toy', level: 2 } })
  })

  it('背包满时存入失败，物品留在棋盘上', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.board[0] = makeItem('toy', 1)
    g.bagCap = 2 // 开局那两格道具正好占满
    await nextTick()

    expect(store.moveToBag(0)).toBe(false)
    expect(g.board[0]).not.toBeNull()
  })

  it('取出到棋盘第一个空格', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.bag[2] = { k: 'item', it: makeItem('care', 3) }
    await nextTick()

    expect(store.takeFromBag(2)).toBe(true)
    expect(g.bag[2]).toBeNull()
    expect(g.board.filter(Boolean).length).toBe(1)
    expect(g.board.find(Boolean)).toMatchObject({ chain: 'care', level: 3 })
  })

  it('棋盘满时取不出来', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    for (let i = 0; i < TOTAL; i++) g.board[i] = makeItem('toy', 1)
    g.bag[2] = { k: 'item', it: makeItem('care', 1) }
    await nextTick()

    expect(store.takeFromBag(2)).toBe(false)
    expect(g.bag[2]).not.toBeNull()
  })

  it('道具格不能被"取出"（道具只存在于背包）', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()
    expect(store.takeFromBag(0)).toBe(false)
  })
})

describe('背包：金币扩容', () => {
  it('扣金币、加一格、下次更贵', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.gold = 100000
    const before = store.bagPriceNow
    const capBefore = g.bagCap

    expect(store.expandBag()).toBe(true)
    await nextTick()

    expect(g.gold).toBe(100000 - before)
    expect(g.bagCap).toBe(capBefore + 1)
    expect(g.bagExpanded).toBe(1)
    expect(store.bagPriceNow).toBeGreaterThan(before)
  })

  it('金币不足时不扩容', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.gold = 0
    expect(store.expandBag()).toBe(false)
    expect(g.bagCap).toBe(BAG_INITIAL_CAP)
  })
})

describe('特殊道具', () => {
  it('开局背包里有两种道具，其中升级卡是 x2', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    expect(store.toolCount('scissors')).toBe(1)
    expect(store.toolCount('upgradeCard')).toBe(2)
  })

  it('升级卡把一个物品升一级并消耗一张', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.board[0] = makeItem('toy', 1)
    await nextTick()

    store.beginToolUse('upgradeCard')
    expect(store.pendingTool).toBe('upgradeCard')
    expect(store.applyToolAt(0)).toBe(true)
    await nextTick()

    expect(g.board[0]).toMatchObject({ chain: 'toy', level: 2 })
    expect(store.toolCount('upgradeCard')).toBe(1)
    expect(store.pendingTool).toBeNull() // 用掉后自动退出待用态
  })

  it('升级卡对链的顶端无效，且不消耗道具', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.board[0] = makeItem('toy', maxLv('toy'))
    await nextTick()

    store.beginToolUse('upgradeCard')
    expect(store.applyToolAt(0)).toBe(false)
    expect(store.toolCount('upgradeCard')).toBe(2)
    expect(store.pendingTool).toBe('upgradeCard') // 仍待用，玩家可以换个目标
  })

  it('剪刀把 Lv3 拆成两个 Lv2 并消耗一把', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.board[0] = makeItem('toy', 3)
    await nextTick()

    store.beginToolUse('scissors')
    expect(store.applyToolAt(0)).toBe(true)
    await nextTick()

    const lv2 = g.board.filter((it) => it && it.chain === 'toy' && it.level === 2)
    expect(lv2.length).toBe(2)
    expect(g.board.filter(Boolean).length).toBe(2) // 原来的 Lv3 已经不在了
    expect(store.toolCount('scissors')).toBe(0)
    expect(g.bag[0]).toBeNull() // 用完即清空格子
  })

  it('剪刀对 Lv1 无效，且不消耗道具', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.board[0] = makeItem('toy', 1)
    await nextTick()

    store.beginToolUse('scissors')
    expect(store.applyToolAt(0)).toBe(false)
    expect(store.toolCount('scissors')).toBe(1)
  })

  it('棋盘没有空位时剪刀不生效、不消耗', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    // 只留 board[0] 有物品，其余格全被蛛网占掉 —— 拆出来无处可放
    g.board.fill(null)
    for (let i = 0; i < TOTAL; i++) {
      if (i !== 0) g.web[i] = true
    }
    g.board[0] = makeItem('toy', 2)
    await nextTick()

    store.beginToolUse('scissors')
    expect(store.applyToolAt(0)).toBe(false)
    expect(store.toolCount('scissors')).toBe(1)
    expect(g.board[0]).not.toBeNull()
  })
})

describe('背包弹窗', () => {
  it('渲染 5×5 = 25 格，未解锁格 + 1 个扩容格', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    store.openBag()
    await nextTick()

    expect(w.findAll('.bag-cell').length).toBe(BAG_TOTAL)
    expect(w.findAll('.bag-cell.locked').length).toBe(BAG_TOTAL - BAG_INITIAL_CAP - 1)
    expect(w.findAll('.bag-cell.expand').length).toBe(1)
    expect(w.find('.expand-price').text()).toContain(String(store.bagPriceNow))
  })

  it('特殊道具带有独立标识与堆叠数量', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    store.openBag()
    await nextTick()

    const tools = w.findAll('.item.tool-item')
    expect(tools.length).toBe(TOOL_ORDER.length)
    expect(w.findAll('.tool-mark').length).toBe(TOOL_ORDER.length)
    const stacks = w.findAll('.stack').map((n) => n.text())
    expect(stacks).toContain('x1')
    expect(stacks).toContain('x2') // 升级卡开局给 2 张
  })

  it('点道具格进入待用态，并自动关掉弹窗', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    store.openBag()
    await nextTick()

    await w.findAll('.bag-cell')[1].trigger('click') // 第 2 格是升级卡
    expect(store.pendingTool).toBe('upgradeCard')
    expect(store.bagOpen).toBe(false)
  })

  it('点物品格即取出到棋盘', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.bag[2] = { k: 'item', it: makeItem('toy', 1) }
    store.openBag()
    await nextTick()

    await w.findAll('.bag-cell')[2].trigger('click')
    expect(g.bag[2]).toBeNull()
    expect(g.board.filter(Boolean).length).toBe(1)
  })
})

// ==================== 经营层（第一批）====================

describe('经营层：订单结算产出（星星 / 好感）', () => {
  it('交付订单同时给金币、星星与顾客好感', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    const o = g.orders[0]
    g.board[7] = makeItem(o.chain, o.level)
    await nextTick()

    const goldBefore = g.gold
    const starsBefore = g.stars
    expect(store.deliver(o.id)).toBe(true)
    await nextTick()

    expect(g.gold).toBe(goldBefore + o.gold)
    expect(g.stars).toBe(starsBefore + o.stars)
    expect(g.affinity[o.customer]).toBe(o.affinity)
  })

  it('好感满格时顾客转化为常驻宠物', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    const o = g.orders[0]
    g.affinity[o.customer] = AFFINITY_FULL - 1
    g.board[7] = makeItem(o.chain, o.level)
    await nextTick()

    expect(store.deliver(o.id)).toBe(true)
    expect(g.pets).toContain(o.customer)
    expect(g.affinity[o.customer]).toBe(AFFINITY_FULL)
    expect(store.petCount).toBe(1)
  })

  it('已转化为常驻宠物的顾客不再累积好感，也不会重复入列', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    const o = g.orders[0]
    g.pets = [o.customer]
    g.affinity[o.customer] = AFFINITY_FULL
    g.board[7] = makeItem(o.chain, o.level)
    await nextTick()

    expect(store.deliver(o.id)).toBe(true)
    expect(g.affinity[o.customer]).toBe(AFFINITY_FULL)
    expect(g.pets.filter((k) => k === o.customer).length).toBe(1)
  })

  it('订单卡片带档位与顾客，UI 不用自己拼', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    for (const c of store.orderCards) {
      expect(c.tierName.length).toBeGreaterThan(0)
      expect(c.customerName.length).toBeGreaterThan(0)
      expect(c.leftMs).toBeGreaterThan(0)
    }
  })
})

describe('经营层：区域', () => {
  it('等级不够时建设失败，也不会改状态', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.level = 2
    expect(store.unlockRegion('grooming')).toBe(false)
    expect(g.regions.grooming).toBe(false)
  })

  it('等级够了就能建设，体力上限当场抬高', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    expect(store.staminaMaxN).toBe(STAMINA_MAX)
    g.level = 3
    expect(store.unlockRegion('grooming')).toBe(true)
    expect(g.regions.grooming).toBe(true)
    expect(store.staminaMaxN).toBe(STAMINA_MAX + 10)
  })

  it('区域必须依次建设，不能跳着开', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.level = 8
    expect(store.unlockRegion('play')).toBe(false) // 洗护区还没建设

    g.level = 3
    expect(store.unlockRegion('grooming')).toBe(true)
    await nextTick()

    g.level = 8
    expect(store.unlockRegion('play')).toBe(true)
  })

  it('解锁训练场后立刻重抽订单 —— 稀有档位当场生效，不用等 8 小时', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.level = 30
    // 先把前置区域全部补齐（顺序解锁的要求）
    for (const k of ['grooming', 'play', 'diner'] as const) g.regions[k] = true
    await nextTick()

    const idsBefore = g.orders.map((o) => o.id)
    expect(store.unlockRegion('training')).toBe(true)
    await nextTick()

    expect(g.orders.map((o) => o.id)).not.toEqual(idsBefore)
    expect(store.regionList.find((r) => r.key === 'training')!.unlocked).toBe(true)
  })
})

describe('经营层：装饰', () => {
  it('星星不足时买不了，状态一点不动', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.stars = 1
    expect(store.upgradeDecor('fountain')).toBe(false)
    expect(g.stars).toBe(1)
    expect(store.decorLevelSum).toBe(0)
  })

  it('买装饰扣星星，繁荣度与等级一起涨', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.stars = 1000
    const cost = store.decorList.find((d) => d.key === 'plant')!.cost
    expect(store.upgradeDecor('plant')).toBe(true)
    await nextTick()

    expect(g.stars).toBe(1000 - cost)
    expect(g.decor.plant).toBe(1)
    expect(store.decorLevelSum).toBe(1)

    // 再升一级更贵
    const next = store.decorList.find((d) => d.key === 'plant')!.cost
    expect(next).toBeGreaterThan(cost)
  })

  it('装饰不产生任何数值收益（这是文档 6.2 的硬约束）', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    const goldMultBefore = store.regionBonus!.goldMult
    const staminaBefore = store.staminaMaxN
    g.stars = 10 ** 6
    store.upgradeDecor('fountain')
    store.upgradeDecor('catTree')
    await nextTick()

    expect(store.regionBonus!.goldMult).toBe(goldMultBefore)
    expect(store.staminaMaxN).toBe(staminaBefore)
  })
})

describe('经营层：常驻宠物与每日卡（时间驱动）', () => {
  it('常驻宠物按小时把金币结算进余额', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 2, 13, 0, 0))

    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.pets = ['ragdoll']
    g.petAt = Date.now() - 3 * 3600000

    vi.advanceTimersByTime(1100)
    await nextTick()

    expect(g.gold).toBe(3 * PET_GOLD_PER_HOUR)
  })

  it('订单到期后自动重抽', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 2, 13, 0, 0))

    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    const idsBefore = g.orders.map((o) => o.id)
    for (const o of g.orders) o.expireAt = 0

    vi.advanceTimersByTime(1100)
    await nextTick()

    expect(g.orders.map((o) => o.id)).not.toEqual(idsBefore)
    expect(g.orders.every((o) => o.expireAt > Date.now())).toBe(true)
  })

  it('诊疗室每天送 1 张升级卡，同一天不重复发', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 2, 13, 0, 0))

    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.regions.clinic = true
    const before = store.toolCount('upgradeCard')

    vi.advanceTimersByTime(1100)
    await nextTick()
    expect(store.toolCount('upgradeCard')).toBe(before + 1)

    vi.advanceTimersByTime(5000)
    await nextTick()
    expect(store.toolCount('upgradeCard')).toBe(before + 1)
  })
})

describe('经营弹窗', () => {
  it('三个页签分别渲染装饰 / 区域 / 顾客', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    store.openBusiness('decor')
    await nextTick()
    expect(w.findAll('.biz-tab').length).toBe(3)
    expect(w.findAll('.decor-card').length).toBe(DECORS.length)

    await w.findAll('.biz-tab')[1].trigger('click')
    await nextTick()
    expect(w.findAll('.region-row').length).toBe(REGIONS.length)

    await w.findAll('.biz-tab')[2].trigger('click')
    await nextTick()
    expect(w.findAll('.cust-card').length).toBe(CUSTOMERS.length)
  })

  it('点区域上的「建设」按钮真的能解锁', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.level = 3
    store.openBusiness('region')
    await nextTick()

    const buildable = w.findAll('.region-btn.go')
    expect(buildable.length).toBe(1)
    await buildable[0].trigger('click')
    await nextTick()

    expect(g.regions.grooming).toBe(true)
  })

  it('点装饰卡上的按钮真的能购买', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.stars = 1000
    store.openBusiness('decor')
    await nextTick()

    const btns = w.findAll('.decor-btn')
    expect(btns.length).toBe(DECORS.length)
    await btns[0].trigger('click')
    await nextTick()

    expect(store.decorLevelSum).toBe(1)
  })

  it('HUD 显示等级与星星；点等级格打开经营弹窗', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    expect(w.find('.coin.lvbox .val').text()).toBe('Lv1')
    expect(w.find('.coin.star .val').text()).toBe('0')

    await w.find('.coin.lvbox').trigger('click')
    await nextTick()
    expect(store.businessOpen).toBe(true)
    expect(store.bizTab).toBe('region')
  })
})

// ==================== 本轮设计修正：设施 / 储备 / 冷却 / 转化 / 拖拽 ====================

describe('设施：储备 + 一次性冷却（不是点一次冷却一次）', () => {
  it('连点只扣储备，**不会**每点一次就进冷却', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.stamina = 100
    g.board[0] = makeItem('fac', 1) // 玩具架：储备 8，冷却 60s
    await nextTick()

    store.produce(0)
    expect(g.board[0]!.charges).toBe(7)
    expect(g.board[0]!.cdAt).toBe(0) // ★ 关键：点一次不进冷却
    store.produce(0)
    store.produce(0)
    expect(g.board[0]!.charges).toBe(5)
    expect(g.board[0]!.cdAt).toBe(0)
  })

  it('储备耗尽才进冷却，且 UI 出现倒计时遮罩', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.stamina = 1000
    g.board[0] = makeItem('fac', 1)
    g.board[0]!.charges = 1
    await nextTick()

    store.produce(0)
    await nextTick()

    expect(g.board[0]!.charges).toBe(0)
    expect(g.board[0]!.cdAt).toBeGreaterThan(Date.now())
    expect(g.board[0]!.charges).toBe(0) // 设施**没有消失**
    expect(w.findAll('.cdmask').length).toBe(1)
    expect(w.find('.cdmask .cdt').text()).toMatch(/\d+:\d\d/)
  })

  it('冷却中再点只会提示，不会扣体力也不会产出', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.stamina = 100
    const fac = makeItem('fac', 1)
    fac.charges = 0
    fac.cdAt = Date.now() + 60_000
    g.board[0] = fac
    await nextTick()

    store.produce(0)
    expect(g.stamina).toBe(100)
    expect(fac.charges).toBe(0)
  })

  it('冷却到点后由每秒 tick 自动补满（不是等玩家点击才结算）', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 2, 13, 0, 0))

    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    const fac = makeItem('fac', 1)
    fac.charges = 0
    fac.cdAt = Date.now() + 3000
    g.board[0] = fac
    await nextTick()

    vi.advanceTimersByTime(1100)
    await nextTick()
    expect(fac.charges).toBe(0) // 还没到点

    vi.advanceTimersByTime(2500)
    await nextTick()
    expect(fac.charges).toBe(8) // 补满
    expect(fac.cdAt).toBe(0)
  })

  it('设施可以被拖进背包，背包里冷却被挂起', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    const fac = makeItem('fac', 1)
    fac.charges = 0
    fac.cdAt = Date.now() + 60_000
    g.board[0] = fac
    await nextTick()

    expect(store.moveToBag(0)).toBe(true)
    expect(g.board[0]).toBeNull()
    // 挂起：绝对时间戳清零，剩余时长存到 cdLeft
    const slot = g.bag.find((s) => s && s.k === 'item')
    expect(slot && slot.k === 'item' && slot.it.cdLeft).toBeGreaterThan(0)
    expect(slot && slot.k === 'item' && slot.it.cdAt).toBe(0)
  })

  it('设施不能被蛛网牺牲（否则玩家会失去产出能力）', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.board[3] = makeItem('fac', 1)
    g.web[20] = true
    await nextTick()

    expect(store.sacrificeToWeb(20, 3)).toBe(false)
    expect(g.board[3]).not.toBeNull()
    expect(g.web[20]).toBe(true)
  })
})

describe('转化型母体：释放完变成另一样东西', () => {
  it('猫城堡放完 6 次 → 原地变成伴手礼（不是消失）', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.stamina = 1000
    // 猫城堡：储备 6，drops 全是 care 物品
    const fort = makeItem('toy', maxLv('toy'))
    fort.charges = 1
    g.board[0] = fort
    await nextTick()

    store.produce(0)
    await nextTick()

    expect(g.board[0]).toMatchObject({ chain: 'supply', level: 1 }) // 变成伴手礼
    expect(g.board[0]!.charges).toBe(8) // 伴手礼自己的储备
  })

  it('豪华礼盒开完 → 变成一个玩具架（回到主场景）', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.stamina = 1000
    const box = makeItem('supply', maxLv('supply')) // 豪华礼盒 = 礼包链链尾
    box.charges = 1
    g.board[0] = box
    await nextTick()

    store.produce(0)
    await nextTick()

    expect(g.board[0]).toMatchObject({ chain: 'fac', level: 1 })
  })
})

describe('背包弹窗（居中悬浮，2026-10-02 交互修正）', () => {
  it('打开后渲染为居中弹窗，主场景不被挤压', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    store.openBag()
    await nextTick()

    expect(w.find('.modal').exists()).toBe(true) // 居中悬浮弹窗（不再是底部抽屉）
    expect(w.find('.bag-card').exists()).toBe(true)
    expect(w.find('.bagdrawer').exists()).toBe(false) // 旧抽屉已拆除
    expect(w.find('.board').exists()).toBe(true) // 棋盘照常渲染，纹丝不动
    // 主场景不再有任何"给抽屉腾位"的挤压痕迹
    const screen = w.find('.screen')
    expect(screen.classes()).not.toContain('bag-open')
    expect(screen.attributes('style') ?? '').not.toContain('--bag-h')
    expect(w.findAll('.bag-cell').length).toBe(BAG_TOTAL)
  })

  it('棋盘上有背包格（bagAt），点它 = 打开弹窗（由 GameBoard 接线，store 层验证 bagAt 就位）', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    expect(g.bagAt).toBe(TOTAL - 1) // 默认右下角
  })

  it('点弹窗里的物品 = 直接放回主场景（随机空位 + 飞行动画）', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.bag[3] = { k: 'item', it: makeItem('toy', 2) }
    store.openBag()
    await nextTick()

    await w.findAll('.bag-cell')[3].trigger('click')
    await nextTick()

    expect(g.bag[3]).toBeNull()
    expect(g.board.filter(Boolean).length).toBe(1)
  })

  it('棋盘满时取出失败，物品留在背包', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    for (let i = 0; i < TOTAL; i++) g.board[i] = makeItem('toy', 1)
    g.bag[3] = { k: 'item', it: makeItem('care', 1) }
    await nextTick()

    expect(store.takeFromBag(3)).toBe(false)
    expect(g.bag[3]).not.toBeNull()
  })
})

describe('图鉴：链路与产出', () => {
  it('每条链都渲染出来，且节点数 = 链的等级数', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    store.openTree()
    await nextTick()

    // 5 条链：设施 / 玩具 / 护理 / 食物 / 礼包
    expect(w.findAll('.atlas-row').length).toBe(5)
    // 设施链 5 级（3 个点击型 + 2 个自动型）→ 5 个节点（产出源头，必须完整出现在图鉴里）
    const first = w.findAll('.atlas-row')[0]
    expect(first.findAll('.anode').length).toBe(5)
    expect(first.text()).toContain('玩具架')
    expect(first.text()).toContain('玩具箱')
    expect(first.text()).toContain('玩具仓库')
    expect(first.text()).toContain('逗猫转盘')
    expect(first.text()).toContain('自动喂食器')

    // 玩具链已经加深到 7 个普通等级 + 顶端 = 8 个节点
    const toy = w.findAll('.atlas-row')[1]
    expect(toy.findAll('.anode').length).toBe(8)
    expect(toy.text()).toContain('毛线球')
    expect(toy.text()).toContain('猫游乐场')
    expect(toy.text()).toContain('猫城堡')
  })

  it('图鉴里的每日设施补给：可领 → 点一下真的进棋盘 → 变成已领', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    store.openTree()
    await nextTick()
    expect(store.canClaimFacility).toBe(true)

    const before = store.board.filter(Boolean).length
    await w.find('.atlas-claim').trigger('click')
    await nextTick()

    expect(store.board.filter(Boolean).length).toBe(before + 1)
    expect(store.canClaimFacility).toBe(false)
    // 开局 2 个设施 + 今天补给的 1 个
    expect(store.board.filter((it) => it && it.chain === 'fac').length).toBe(3)
  })

  it('三种「用完会怎样」在图鉴里被明确标注', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    store.openTree()
    await nextTick()

    expect(w.findAll('.ad-after.cooldown').length).toBeGreaterThan(0)
    expect(w.findAll('.ad-after.convert').length).toBeGreaterThan(0)
    expect(w.findAll('.ad-after.vanish').length).toBeGreaterThan(0)
    expect(w.text()).toContain('释放完变成')
  })
})

// ==================== 第三批「内容扩容」：新道具与每日补给 ====================

describe('新道具：充能器', () => {
  it('补满目标发射器的储备并结束冷却，消耗 1 个', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    const fac = makeItem('fac', 1)
    fac.charges = 0
    fac.cdAt = Date.now() + 30_000
    g.board[0] = fac
    await nextTick()

    const before = store.toolCount('charger')
    store.beginToolUse('charger')
    expect(store.pendingTool).toBe('charger') // 需要目标 → 进入待用态
    expect(store.applyToolAt(0)).toBe(true)
    await nextTick()

    expect(fac.charges).toBe(8)
    expect(fac.cdAt).toBe(0)
    expect(store.toolCount('charger')).toBe(before - 1)
  })

  it('储备已经满了、也没在冷却时不生效，也不消耗', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.board[0] = makeItem('fac', 1) // 满储备、不在冷却
    await nextTick()

    const before = store.toolCount('charger')
    store.beginToolUse('charger')
    expect(store.applyToolAt(0)).toBe(false)
    expect(store.toolCount('charger')).toBe(before)
  })

  it('用在普通物品上无效，也不消耗', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.board[0] = makeItem('toy', 1)
    await nextTick()

    const before = store.toolCount('charger')
    store.beginToolUse('charger')
    expect(store.applyToolAt(0)).toBe(false)
    expect(store.toolCount('charger')).toBe(before)
  })
})

describe('新道具：加速沙漏 / 能量球（不需要目标，直接生效）', () => {
  it('加速沙漏点一下就用掉：全盘冷却清零、储备补满', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    const a = makeItem('fac', 1)
    a.charges = 0
    a.cdAt = Date.now() + 60_000
    const b = makeItem('care', maxLv('care')) // 美容台也是冷却型
    b.charges = 0
    b.cdAt = Date.now() + 120_000
    g.board[0] = a
    g.board[1] = b
    await nextTick()

    const before = store.toolCount('hourglass')
    store.beginToolUse('hourglass')
    await nextTick()

    // 直接生效：不进入待用态
    expect(store.pendingTool).toBeNull()
    expect(a.charges).toBe(8)
    expect(a.cdAt).toBe(0)
    expect(b.charges).toBeGreaterThan(0)
    expect(b.cdAt).toBe(0)
    expect(store.toolCount('hourglass')).toBe(before - 1)
  })

  it('没有东西在冷却时，沙漏不消耗', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.board[0] = makeItem('fac', 1) // 满储备、不在冷却
    await nextTick()

    const before = store.toolCount('hourglass')
    store.beginToolUse('hourglass')
    await nextTick()
    expect(store.toolCount('hourglass')).toBe(before)
  })

  it('能量球立刻加体力，且可以突破上限', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.stamina = STAMINA_MAX // 已经在上限
    const before = store.toolCount('orb')
    store.beginToolUse('orb')
    await nextTick()

    expect(g.stamina).toBe(STAMINA_MAX + ORB_STAMINA)
    expect(store.toolCount('orb')).toBe(before - 1)
  })
})

describe('每日设施补给（手动型）', () => {
  it('领一次进棋盘；同一天不能再领；跨天恢复', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 2, 13, 0, 0))

    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    expect(store.canClaimFacility).toBe(true)
    expect(store.claimDailyFacility()).toBe(true)
    expect(store.canClaimFacility).toBe(false)
    expect(store.claimDailyFacility()).toBe(false) // 同一天第二次无效

    // 跨天：把系统时间推到第二天，并让每秒 tick 刷新一次 now
    vi.setSystemTime(new Date(2026, 9, 3, 9, 0, 0))
    vi.advanceTimersByTime(1100)
    await nextTick()
    expect(store.canClaimFacility).toBe(true)
    expect(store.claimDailyFacility()).toBe(true) // 第二天能再领
    
  })

  it('棋盘满时不吞收益（不写 facDay，腾出空位后还能领）', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    for (let i = 0; i < TOTAL; i++) g.board[i] = makeItem('toy', 1)
    await nextTick()

    expect(store.claimDailyFacility()).toBe(false)
    expect(g.facDay).toBe('') // 关键：没有把今天的名额用掉
    expect(store.canClaimFacility).toBe(true)

    g.board[0] = null // 腾一个空位
    await nextTick()
    expect(store.claimDailyFacility()).toBe(true)
  })
})

describe('链深迁移的整机表现', () => {
  it('开局就是 8 级链：猫城堡在 Lv8，且图鉴显示 8 个节点', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    expect(maxLv('toy')).toBe(8)
    expect(defOf('toy', 8)!.kind).toBe('generator')
    // 三条主链的顶端各自还是有明确的耗尽行为
    expect(defOf('toy', 8)!.refillMs).toBe(0)
    expect(defOf('care', 8)!.refillMs).toBeGreaterThan(0)

    store.openTree()
    await nextTick()
    expect(w.findAll('.anode').length).toBeGreaterThan(15)
  })
})

// ==================== 第四批：自动型 / 存档契约 / 商城 ====================

describe('自动型发射器（整机表现）', () => {
  it('设施链出现自动型：图鉴里能看到，棋盘上带 ⟳ 标记', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.board[0] = makeItem('fac', 4) // 逗猫转盘（自动型）
    await nextTick()

    expect(w.find('.item.auto .auto-mark').exists()).toBe(true)
    expect(w.find('.item.auto .use').exists()).toBe(false) // 自动型没有储备数字

    store.openTree()
    await nextTick()
    expect(w.text()).toContain('逗猫转盘')
    expect(w.text()).toContain('自动型')
  })

  it('自动型由每秒 tick 驱动产出，不需要玩家点击', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 2, 13, 0, 0))
    const T0 = Date.now()

    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    const auto = makeItem('fac', 4)
    auto.lastAutoAt = T0 - 30_000
    g.board[0] = auto
    await nextTick()

    vi.advanceTimersByTime(1100)
    await nextTick()

    // 产出了一个玩具 Lv1，且本体的 lastAutoAt 已按「周期对齐」推进：
    // (T0-30s) + 1×30s = T0，剩下的 1.1 秒进度保留到下一轮，不会被结算吞掉
    expect(g.board.filter((x) => x && x.chain === 'toy').length).toBe(1)
    expect(auto.lastAutoAt).toBe(T0)
  })
})

describe('存档与分发（整机表现）', () => {
  it('底部「存档」入口打开设置弹窗，能手动备份并看到三个槽位', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    store.openSettings()
    await nextTick()

    expect(w.find('.set-card').exists()).toBe(true)
    expect(w.findAll('.set-row.slot').length).toBe(3)

    await w.find('.set-actions .set-btn.big').trigger('click') // 立即备份
    await nextTick()
    expect(store.backups.filter((b) => b.savedAt > 0).length).toBeGreaterThan(0)
  })

  it('主存档损坏时自动从备份恢复，并提示玩家', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.gold = 4321
    store.persist()
    store.doBackup()

    // 把主存档的 payload 改坏（不动 checksum）→ 模拟数据损坏
    const env = JSON.parse(localStorage.getItem('pawpark_save')!)
    env.payload.gold = 99999
    localStorage.setItem('pawpark_save', JSON.stringify(env))

    // 重新挂载 = 重新读档
    const first = wrapper!
    first.unmount()
    wrapper = null
    const second = mountApp()
    wrapper = second.w
    await nextTick()

    expect(second.store.g!.gold).toBe(4321) // 用的是备份，不是坏数据
  })
})

describe('商城（M2）', () => {
  it('两个分区都渲染，金币区不限购、钻石区限购', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    store.openShop()
    await nextTick()

    expect(w.find('.shop-card').exists()).toBe(true)
    const goldRows = w.findAll('.shop-group')[0].findAll('.shop-row')
    const gemRows = w.findAll('.shop-group')[1].findAll('.shop-row')
    expect(goldRows.length).toBe(5)
    expect(gemRows.length).toBe(4)
    // 金币区按钮全部可点（不限购）
    expect(goldRows.every((r) => !r.find('.shop-btn').attributes('disabled'))).toBe(true)
  })

  it('金币买道具：进背包、扣金币', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.gold = 5000
    const before = store.toolCount('hourglass')
    const goods = store.shopList.find((x) => x.key === 'hourglass')!

    expect(store.buyGoods('hourglass')).toBe(true)
    await nextTick()

    expect(g.gold).toBe(5000 - goods.price)
    expect(store.toolCount('hourglass')).toBe(before + 1)
  })

  it('★ 金币商品不限购：连买多次都成功', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.gold = 10 ** 6
    for (let i = 0; i < 5; i++) expect(store.buyGoods('scissors')).toBe(true)
    expect(store.toolCount('scissors')).toBe(5 + 1) // 开局那 1 把
  })

  it('★ 钻石商品每时段限购：买满后拒绝，且不扣钱', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.gem = 1000
    const goods = store.shopList.find((x) => x.key === 'charger')!
    expect(goods.dailyLimit).toBe(3)

    for (let i = 0; i < 3; i++) expect(store.buyGoods('charger')).toBe(true)
    const after = g.gem
    expect(store.buyGoods('charger')).toBe(false)
    expect(g.gem).toBe(after) // 第 4 次没扣钱
    expect(store.toolCount('charger')).toBe(4) // 3 次购买 + 开局送的 1 个
  })

  it('余额不足不扣钱；材料箱按实际放下的数量扣费', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    // 余额不足
    g.gold = 100
    expect(store.buyGoods('crateBasic')).toBe(false)
    expect(g.gold).toBe(100)

    // 材料箱：只留 1 个空位 → 只放 1 个，按 1/3 价格扣
    g.gold = 10 ** 6
    g.web[0] = false // 开局蛛网位置随机，显式清掉 0 号格的网，保证"恰好 1 个空位"确定成立
    for (let i = 1; i < TOTAL; i++) g.board[i] = makeItem('toy', 1)
    await nextTick()

    const price = store.shopList.find((x) => x.key === 'crateBasic')!.price
    const before = g.board.filter(Boolean).length
    expect(store.buyGoods('crateBasic')).toBe(true)
    // 材料箱的链是随机的（toy/care/food 各 1/3），断言只看「放下几个 / 落在哪 / 扣多少」
    expect(g.board.filter(Boolean).length).toBe(before + 1) // 只放下了 1 个
    expect(g.board[0]).not.toBeNull() // 落在唯一的空位上
    expect(g.gold).toBe(10 ** 6 - Math.round(price / 3)) // 按 1/3 价格扣
  })

  it('★ 红线：商店里没有任何"钻石换金币"的商品', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    for (const x of store.shopList) {
      if (x.currency === 'gem') {
        // 钻石能给的东西里不许有金币
        expect(JSON.stringify(x.give)).not.toContain('"gold"')
      }
    }
  })
})

describe('充值中心（M2 剩余）', () => {
  it('模拟充值到账：首充双倍只给第一次，之后原价', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    const base = g.gem
    expect(store.firstRechargePending).toBe(true)
    expect(store.recharge('tier6')).toBe(120) // 首充双倍：60 → 120
    expect(g.gem).toBe(base + 120)
    expect(store.firstRechargePending).toBe(false)
    expect(store.recharge('tier30')).toBe(300) // 原价
    expect(g.gem).toBe(base + 420)
  })

  it('模拟充值不认识任何商品逻辑（旁路红线）：只加钻石，不动金币', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    const gold = g.gold
    store.recharge('tier128')
    expect(g.gold).toBe(gold) // 充值模块绝不碰金币（文档 9 章红线）
  })

  it('会员卡：扣钻开卡、体力上限 +50、商城金币商品 9 折', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.gem = 1000
    const price = 1200 // scissors
    g.gold = price
    expect(store.buyVip()).toBe(true)
    expect(g.gem).toBe(700)
    expect(g.vipUntil).toBeGreaterThan(Date.now())
    expect(store.vipActive).toBe(true)
    expect(staminaMax(g)).toBe(STAMINA_MAX + 50) // 会员加成走统一出口

    // 金币商品 9 折：ceil(1200 * 0.9) = 1080
    const before = store.toolCount('scissors')
    expect(store.buyGoods('scissors')).toBe(true)
    expect(g.gold).toBe(price - Math.ceil(price * 0.9))
    expect(store.toolCount('scissors')).toBe(before + 1)
  })

  it('会员每日福利：领取有效，同一天不能再领；非会员领不了', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    expect(store.vipDailyReady()).toBe(false) // 没开卡

    g.gem = 1000
    store.buyVip()
    const gem = g.gem
    const sta = g.stamina
    expect(store.vipDailyReady()).toBe(true)
    expect(store.claimVipDaily()).toBe(true)
    expect(g.gem).toBe(gem + 50)
    expect(g.stamina).toBe(sta + 100)
    expect(store.vipDailyReady()).toBe(false)
    expect(store.claimVipDaily()).toBe(false)
  })

  it('成长基金：买入后按等级到账，Lv12 可领 2 份 = 💎400', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.gem = 2000
    expect(store.buyFund()).toBe(true)
    expect(g.gem).toBe(2000 - 888)
    expect(store.fundReady()).toBe(0) // Lv1 还没到账

    g.level = 12 // 过了 5 级与 10 级两个节点
    expect(store.fundReady()).toBe(2)
    expect(store.claimFund()).toBe(400)
    expect(g.gem).toBe(2000 - 888 + 400)
    expect(store.fundReady()).toBe(0) // 领过了
  })

  it('抽奖：单抽扣 50 钻出 1 个结果，十连扣 450 出 10 个；余额不足不扣', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.gem = 2000
    const g0 = g.gem

    // 单抽：花 50；抽到造型/装饰会折回钻石（最多 120），所以只能断言区间
    expect(store.spin(1)).toBe(true)
    expect(g.gem).toBeGreaterThanOrEqual(g0 - 50)
    expect(g.gem).toBeLessThanOrEqual(g0 - 50 + 120)
    expect(store.luckyHistory.length).toBe(1)

    // 十连：花 450，折回上限 10×120
    expect(store.spin(10)).toBe(true)
    expect(g.gem).toBeGreaterThanOrEqual(g0 - 500)
    expect(g.gem).toBeLessThanOrEqual(g0 - 500 + 11 * 120)
    expect(store.luckyHistory.length).toBe(10)
    expect(store.g.gem).toBeGreaterThanOrEqual(0)
  })

  it('抽奖：余额不足直接拒绝，不扣钱', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.gem = 20
    expect(store.spin(1)).toBe(false)
    expect(g.gem).toBe(20)
    expect(store.spin(10)).toBe(false)
    expect(g.gem).toBe(20)
  })

  it('新手礼包：once 限购，奖励真的到手', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.gem = 100
    const sta = g.stamina
    const scBefore = store.toolCount('scissors')

    expect(store.buyGift('starter')).toBe(true)
    expect(g.gem).toBe(40)
    expect(g.stamina).toBe(sta + 100)
    expect(store.toolCount('scissors')).toBe(scBefore + 3)
    expect(store.giftBoughtCount('starter')).toBe(1)

    expect(store.buyGift('starter')).toBe(false) // 一生一次
    expect(g.gem).toBe(40) // 没扣钱
  })
})

// ==================== 挤出 / 换位 与 背包上棋盘（2026-10-02 交互修正）====================

describe('挤出 / 换位（拖到占用格的落点规则）', () => {
  it('周围有空位：原物品被挤开，拖入的物品落到目标格', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.board[0] = makeItem('toy', 1) // 拖动的物品
    g.board[1] = makeItem('care', 1) // 目标格（不同链，不可合成）
    await nextTick()

    expect(store.displaceDrop(0, 1)).toBe(true)
    expect(g.board[1]).toMatchObject({ chain: 'toy', level: 1 }) // a 落到目标格
    expect(g.board[0]).toBeNull() // from 清空
    // care1 被挤到 1（r0,c1）的 8 邻域空位之一：[0, 2, 7, 8, 9]
    // （0 在挤出判定时仍被 a 占着，因此实际只会落在 2/7/8/9）
    const neighbors = [0, 2, 7, 8, 9]
    const displaced = neighbors.filter((i) => g.board[i]?.chain === 'care')
    expect(displaced).toHaveLength(1)
  })

  it('棋盘全满：两个物品换位', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    for (let i = 0; i < TOTAL; i++) g.board[i] = makeItem('toy', 1)
    g.board[0] = makeItem('care', 1)
    g.board[1] = makeItem('food', 1)
    await nextTick()

    expect(store.displaceDrop(0, 1)).toBe(true)
    expect(g.board[1]).toMatchObject({ chain: 'care', level: 1 })
    expect(g.board[0]).toMatchObject({ chain: 'food', level: 1 })
  })

  it('背包格是挤出硬禁区：不可作为目标格', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    const bagAt = g.bagAt
    g.board[0] = makeItem('toy', 1)
    g.board[(bagAt + 1) % TOTAL] = makeItem('care', 1)
    await nextTick()

    expect(store.displaceDrop(0, bagAt)).toBe(false)
    expect(g.board[0]).not.toBeNull()
  })
})

describe('背包是一件摆在棋盘上的道具', () => {
  it('新档背包默认在右下角，且不占 board 数组', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    expect(g.bagAt).toBe(TOTAL - 1)
    expect(g.board[TOTAL - 1]).toBeNull() // 背包不在 board 里
  })

  it('拖背包：只能挪到非蛛网空格', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.web.fill(false)
    expect(store.moveBag(28)).toBe(true)
    expect(g.bagAt).toBe(28)
    g.web[21] = true
    expect(store.moveBag(21)).toBe(false) // 蛛网拒绝
    g.board[20] = makeItem('toy', 1)
    expect(store.moveBag(20)).toBe(false) // 占用拒绝
    expect(g.bagAt).toBe(28)
  })

  it('棋盘只剩背包格"可用"时：取出失败，物品留在背包', async () => {
    const { w, store } = mountApp()
    wrapper = w
    await nextTick()

    const g = store.g!
    g.board.fill(null)
    g.web.fill(false)
    for (let i = 0; i < TOTAL; i++) if (i !== g.bagAt) g.board[i] = makeItem('toy', 1)
    g.bag[5] = { k: 'item', it: makeItem('care', 2) }
    await nextTick()

    expect(store.takeFromBag(5)).toBe(false)
    expect(g.bag[5]).not.toBeNull()
  })
})
