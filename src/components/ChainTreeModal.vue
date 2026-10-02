<script setup lang="ts">
/**
 * 图鉴 · 链路图。
 *
 * ★ 本轮从「链树」升级为「图鉴」（2026-10-02 第二轮设计修正）。
 *   用户的原话是"产品的链路需要设计一下，现在看不出来" —— 旧版的链树
 *   只写了一行 emoji 箭头 + 一段密集文字，看不出三件事：
 *     ① 这条链一共几级、每一级长什么样；
 *     ② 哪几级可以点、点了产出什么；
 *     ③ **储备耗尽之后会发生什么**（冷却续命 / 变成别的东西 / 消失）。
 *   第 ③ 条是本轮新增的核心玩法，必须在这里被讲清楚，否则玩家永远猜不到。
 *
 * 实现约定：这里读的是**原始链定义**（`CHAINS[k].top`），与 `defOf()` 返回的
 * ResolvedDef 字段不同（原始定义里 generator 的 click 是个整体对象）。
 * P0 曾在这里对原始定义取 `.produces` → 启动即崩，别再犯。
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'
import { CHAINS, TREE_ORDER } from '../game/chains'
import SpriteIcon from '../ui/SpriteIcon.vue'
import { defOf, dropsDesc, fmtLeft, itemsLen, maxLv } from '../game/logic'
import type { AutoSpec, ChainKey, ClickSpec } from '../game/types'

const store = useGameStore()
const { g, canClaimFacility } = storeToRefs(store)

/** 一个链路节点（普通等级 / 顶端统一成一个形状，渲染层不用分叉） */
interface Node {
  key: string
  lv: number
  name: string
  sprite: string
  emoji: string
  bg: string
  fg: string
  /** 可点击（设施 / 母体 / 链中段） */
  clickable: boolean
  /** 不可合成：顶端（母体 / 纯任务物品） */
  last: boolean
  /** 纯任务物品 */
  final: boolean
  /** 设施（产出源头） */
  facility: boolean
  /** 点击说明：储备 / 冷却 / 耗尽行为 */
  click?: ClickSpec
  /** 自动型：按间隔自己跑 */
  auto?: AutoSpec
  /** 产出一行 */
  produce?: string
  /** 耗尽后会发生什么（一句人话） */
  after?: string
  /** 耗尽行为的类型，用于上色 */
  afterKind?: 'cooldown' | 'convert' | 'vanish'
}

interface ChainRow {
  key: ChainKey
  name: string
  on: boolean
  nodes: Node[]
  /** 这条链的"怎么玩"一句话 */
  tip: string
}

function afterOf(c: ClickSpec): { text: string; kind: 'cooldown' | 'convert' | 'vanish' } {
  if (c.refillMs > 0) {
    return { text: `用完后冷却 ${fmtLeft(c.refillMs)} 自动补满，不会消失`, kind: 'cooldown' }
  }
  if (c.exhaust && c.exhaust.kind === 'convert') {
    const nd = defOf(c.exhaust.to, c.exhaust.level)
    return { text: `释放完变成 ${nd?.emoji ?? ''}${nd?.name ?? '另一样东西'}`, kind: 'convert' }
  }
  return { text: '用完即消失（一次性物资包）', kind: 'vanish' }
}

const rows = computed<ChainRow[]>(() =>
  TREE_ORDER.map((k) => {
    const ch = CHAINS[k]
    const on = !!g.value?.unlocked[k]
    const n = itemsLen(k)
    const nodes: Node[] = []

    ch.items.forEach((d, idx) => {
      const lv = idx + 1
      const node: Node = {
        key: `${k}-${lv}`,
        lv,
        name: d.name,
        sprite: d.sprite,
        emoji: d.emoji,
        bg: d.bg,
        fg: d.fg,
        clickable: !!d.click,
        last: false,
        final: false,
        facility: k === 'fac',
      }
      if (d.click) {
        node.click = d.click
        node.produce = dropsDesc(d.click.drops)
        const a = afterOf(d.click)
        node.after = a.text
        node.afterKind = a.kind
      } else if (d.auto) {
        // 自动型：玩家不点，它自己跑 —— 说明文案要讲清"间隔"与"上限"两件事
        node.auto = d.auto
        node.produce = dropsDesc(d.auto.drops)
        node.after = `每 ${Math.round(d.auto.ms / 1000)} 秒自己产出一次，不耗体力（离线最多攒 ${
          d.auto.max ?? 8
        } 次）`
        node.afterKind = 'cooldown'
      }
      nodes.push(node)
    })

    const top = ch.top
    if (top) {
      const lv = n + 1
      if (top.kind === 'generator') {
        const a = afterOf(top.click)
        nodes.push({
          key: `${k}-top`,
          lv,
          name: top.name,
          sprite: top.sprite,
          emoji: top.emoji,
          bg: top.bg,
          fg: top.fg,
          clickable: true,
          last: true,
          final: false,
          facility: false,
          click: top.click,
          produce: dropsDesc(top.click.drops),
          after: a.text,
          afterKind: a.kind,
        })
      } else {
        nodes.push({
          key: `${k}-top`,
          lv,
          name: top.name,
          sprite: top.sprite,
          emoji: top.emoji,
          bg: top.bg,
          fg: top.fg,
          clickable: false,
          last: true,
          final: true,
          facility: false,
        })
      }
    }

    let tip: string
    if (k === 'fac') {
      tip = `开局就在主场景上（占格），走「储备 + 冷却」永不消失。两个${ch.items[0].name}可以合成一个${ch.items[1]?.name ?? '更高级设施'}，也可以拖进背包暂存。`
    } else if (k === 'supply') {
      tip = '链尾就是最高级（没有母体）。它把"点击"直接接到货币上，也是猫城堡释放完之后的去处。'
    } else if (top && top.kind === 'generator') {
      tip = `两条 ${ch.items[0].name} 可以一路合到顶端的 ${top.name}；${top.name} 不可再合成。`
    } else {
      tip = `${top?.name ?? '链尾'} 是纯任务物品：只能交订单，不能点击、不能合成。`
    }

    return { key: k, name: ch.name, on, nodes, tip }
  })
)

/** 图鉴顶部的能力汇总：让"我有多少产出能力"一眼可见 */
const capSummary = computed(() => {
  const s = g.value
  if (!s) return { fac: 0, cooling: 0 }
  let fac = 0
  let cooling = 0
  for (const it of s.board) {
    if (!it) continue
    if (it.chain === 'fac') fac++
    const d = defOf(it.chain, it.level)
    if (d && (d.refillMs ?? 0) > 0) cooling++
  }
  return { fac, cooling }
})
</script>

<template>
  <div class="modal" @click.self="store.closeTree()">
    <div class="card atlas-card">
      <h3>图鉴 · 链路与产出</h3>
      <div class="sub">
        棋盘上现在有 <b>{{ capSummary.fac }}</b> 个设施、<b>{{ capSummary.cooling }}</b>
        个会自我补充的产出点。
      </div>

      <!-- 每日补给：设施是唯一的产能源头，必须给玩家一条不依赖运气的获取途径 -->
      <div
        v-if="canClaimFacility"
        class="atlas-claim"
        @click="store.claimDailyFacility()"
      >
        <b>今日设施补给可领</b>
        <span>玩具架 ×1 · 直接放进棋盘（每天一次）</span>
      </div>
      <div v-else class="atlas-claim done">
        <b>今日设施补给已领取</b>
        <span>明天再来 —— 也可以靠豪华礼盒开完转化出新的玩具架</span>
      </div>

      <!-- 三种"用完会怎样"的图例：这是本轮新增的核心玩法，必须摆在最前面 -->
      <div class="atlas-legend">
        <div class="lg cd">
          <b>冷却型</b><span>用完等一会儿自动补满，永不消失</span>
        </div>
        <div class="lg cv">
          <b>转化型</b><span>释放完变成另一样东西</span>
        </div>
        <div class="lg vn">
          <b>消失型</b><span>一次性物资包，用完就没了</span>
        </div>
      </div>

      <div v-for="r in rows" :key="r.key" class="atlas-row" :class="{ off: !r.on }">
        <div class="atlas-rt">
          <span class="atlas-name">{{ r.name }}</span>
          <span class="tag" :class="r.on ? 'on' : 'off'">{{ r.on ? '已解锁' : '未解锁' }}</span>
          <span class="atlas-count">{{ r.nodes.length }} 级</span>
        </div>

        <!-- 链路：从左到右，箭头连接 -->
        <div class="atlas-flow">
          <template v-for="(n, i) in r.nodes" :key="n.key">
            <span v-if="i > 0" class="atlas-arrow">→</span>
            <div class="anode" :class="{ click: n.clickable, last: n.last, fac: n.facility }">
              <div class="anode-ico" :style="{ background: n.bg, color: n.fg }">
                <SpriteIcon :name="n.sprite" :fallback="n.emoji" />
                <span class="anode-lv">{{ n.lv }}</span>
              </div>
              <div class="anode-name">{{ n.name }}</div>
              <div v-if="n.clickable" class="anode-meta">
                储备 {{ n.click!.buffer }}<template v-if="n.click!.refillMs > 0">
                  · 冷却 {{ Math.round(n.click!.refillMs / 1000) }}s</template>
              </div>
              <div v-else-if="n.auto" class="anode-meta">
                自动 · 每 {{ Math.round(n.auto.ms / 1000) }}s
              </div>
              <div v-else class="anode-meta muted">{{ n.final ? '只交订单' : '只能合成' }}</div>
            </div>
          </template>
        </div>

        <!-- 可点击节点的产出与耗尽行为 -->
        <div v-for="n in r.nodes.filter((x) => x.clickable || !!x.auto)" :key="n.key + '-d'" class="atlas-detail">
          <div class="ad-head">
            <b><SpriteIcon :name="n.sprite" :fallback="n.emoji" /> {{ n.name }}</b>
            <span class="ad-tag">
              {{ n.auto ? '自动型' : n.facility ? '设施' : n.last ? '母体' : '链中段' }}
            </span>
            <span class="ad-after" :class="n.afterKind">{{ n.after }}</span>
          </div>
          <div class="ad-body">点击产出：{{ n.produce }}</div>
        </div>

        <div class="atlas-tip">{{ r.tip }}</div>
      </div>

      <div class="atlas-detail note">
        <div class="ad-head"><b>合成规则</b></div>
        <div class="ad-body">
          两个<b>同类同级</b>物品合成一个高一级的；合成后<b>储备重置为满</b>，所以"点剩最后 1 次再合成"是白赚的。
          设施也遵循这条 —— 两个玩具架合成一个玩具箱。
        </div>
      </div>

      <button class="close" @click="store.closeTree()">知道了</button>
    </div>
  </div>
</template>
