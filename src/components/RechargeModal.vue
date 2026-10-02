<script setup lang="ts">
/**
 * 充值中心弹窗（M2 剩余）。
 *
 * 四个页签：充值（档位 + 模拟支付）/ 会员 / 基金 / 抽奖。
 *
 * ★ 模拟支付的**仪式感**是设计文档 10.2 的明确要求：完整保留真实充值的
 *   界面节奏（选档 → 支付中 1 秒 → 支付成功 → 到账），不要做成一个简陋的加钱按钮。
 *   页脚小字"不产生任何真实费用"也是文档要求——既诚实又不破坏体验。
 *
 * 礼包不放这里：礼包是"买东西"，统一放商城钻石区（充值中心只管钻石的来源与增值服务）。
 */
import { computed, ref } from 'vue'
import { useGameStore } from '../stores/game'
import type { LuckyPrize } from '../game/iap'

const store = useGameStore()

type Tab = 'recharge' | 'vip' | 'fund' | 'lucky'
const tab = ref<Tab>('recharge')

// ---- 模拟支付状态机：选档 → 支付中（1s）→ 成功 ----
const payingKey = ref('')
const payStage = ref<'idle' | 'paying' | 'done'>('idle')
let payTimer: ReturnType<typeof setTimeout> | null = null

const payingTier = computed(() => store.IAP_TIERS.find((t) => t.key === payingKey.value) ?? null)

function startPay(key: string): void {
  payingKey.value = key
  payStage.value = 'paying'
  if (payTimer) clearTimeout(payTimer)
  // 1 秒后显示"支付成功"（文档：模拟支付页 1 秒后成功，不产生真实扣费）
  payTimer = setTimeout(() => {
    payStage.value = 'done'
  }, 1000)
}

/** 支付成功页点"完成"：此刻才真正到账 */
function finishPay(): void {
  const t = payingTier.value
  if (t && payStage.value === 'done') store.recharge(t.key)
  payStage.value = 'idle'
  payingKey.value = ''
  if (payTimer) {
    clearTimeout(payTimer)
    payTimer = null
  }
}

function cancelPay(): void {
  payStage.value = 'idle'
  payingKey.value = ''
  if (payTimer) {
    clearTimeout(payTimer)
    payTimer = null
  }
}

// ---- 会员 / 基金 ----
const vipLeft = computed(() => {
  const until = store.g?.vipUntil ?? 0
  if (!store.vipActive || until <= 0) return 0
  return Math.ceil((until - Date.now()) / 86400000)
})

const vipUntilText = computed(() => {
  const until = store.g?.vipUntil ?? 0
  if (!until) return '—'
  return new Date(until).toLocaleDateString()
})

const fundTotal = 10
const fundClaimed = computed(() => store.g?.fundClaimed ?? 0)
const fundReady = computed(() => store.fundReady())

// ---- 抽奖 ----
const luckyOpen = ref(false)
const luckyList = ref<LuckyPrize[]>([])

const PRIZE_FACE: Record<string, { face: string; label: string }> = {
  gold: { face: '🪙', label: '金币' },
  tool: { face: '🧰', label: '道具' },
  skin: { face: '🎭', label: '限定造型' },
  decor: { face: '🏡', label: '稀有装饰' },
}

function prizeText(p: LuckyPrize): string {
  if (p.kind === 'gold') return `金币 +${p.amount}`
  if (p.kind === 'tool') return `${p.tool} ×${p.amount}`
  return `折算 💎+${p.amount}（重复）`
}

function doSpin(times: 1 | 10): void {
  if (!store.spin(times)) return
  luckyList.value = store.luckyHistory
  luckyOpen.value = true
}

const pityPct = computed(() => {
  const pity = store.g?.luckyPity ?? 0
  return Math.min(100, Math.round((pity / store.LUCKY_META.pity) * 100))
})

function close(): void {
  cancelPay()
  luckyOpen.value = false
  store.closeRecharge()
}
</script>

<template>
  <div class="modal" @click.self="close()">
    <div class="card shop-card">
      <div class="bag-head">
        <span class="bag-title">充值中心</span>
        <span class="bag-gold">💎 {{ g?.gem ?? 0 }}</span>
        <button class="bag-x" @click="close()">✕</button>
      </div>

      <div class="shop-tabs">
        <button class="shop-tab rc-tab" :class="{ on: tab === 'recharge' }" @click="tab = 'recharge'">💎 充值</button>
        <button class="shop-tab rc-tab" :class="{ on: tab === 'vip' }" @click="tab = 'vip'">🐾 会员</button>
        <button class="shop-tab rc-tab" :class="{ on: tab === 'fund' }" @click="tab = 'fund'">📈 基金</button>
        <button class="shop-tab rc-tab" :class="{ on: tab === 'lucky' }" @click="tab = 'lucky'">🎰 抽奖</button>
      </div>

      <!-- ============ 模拟支付页（覆盖在档位列表上）============ -->
      <div v-if="payStage !== 'idle' && payingTier" class="rc-pay">
        <template v-if="payStage === 'paying'">
          <div class="rc-pay-face">🐾</div>
          <div class="rc-pay-title">乐园支付</div>
          <div class="rc-pay-amount">¥{{ payingTier.price }}</div>
          <div class="rc-pay-note">正在模拟支付…</div>
          <div class="rc-pay-dots"><span></span><span></span><span></span></div>
          <button class="close ghost" @click="cancelPay()">取消</button>
        </template>
        <template v-else>
          <div class="rc-pay-face ok">✓</div>
          <div class="rc-pay-title">支付成功</div>
          <div class="rc-pay-amount">💎 {{ payingTier.gems }}<span v-if="store.firstRechargePending" class="rc-x2">首充双倍已到账</span></div>
          <div class="rc-pay-note">钻石将在点击"完成"后入账</div>
          <button class="rc-done" @click="finishPay()">完成</button>
        </template>
      </div>

      <!-- ============ 页签：充值 ============ -->
      <div v-else-if="tab === 'recharge'" class="shop-body">
        <div class="rc-grid">
          <button
            v-for="t in store.IAP_TIERS"
            :key="t.key"
            class="rc-tier"
            :class="{ hot: !!t.tag }"
            @click="startPay(t.key)"
          >
            <span v-if="t.tag" class="rc-tag">{{ t.tag }}</span>
            <span class="rc-tier-price">¥{{ t.price }}</span>
            <span class="rc-tier-gems">💎 {{ t.gems }}</span>
            <span v-if="store.firstRechargePending" class="rc-tier-x2">首充双倍 → {{ t.gems * 2 }}</span>
          </button>
        </div>
        <div class="bag-foot">
          充值只会获得钻石；<b>金币永远不能充值</b>，它只能靠玩法产出——这是数值挑战的底线。
        </div>
      </div>

      <!-- ============ 页签：会员 ============ -->
      <div v-else-if="tab === 'vip'" class="shop-body">
        <div class="rc-hero">
          <div class="rc-hero-face">🐾</div>
          <div class="rc-hero-name">乐园会员卡（30 天）</div>
          <div class="rc-hero-sub">
            <template v-if="store.vipActive">生效中 · 剩 {{ vipLeft }} 天（{{ vipUntilText }} 到期）</template>
            <template v-else>未开通 · 续期会在剩余天数上叠加</template>
          </div>
        </div>
        <div class="rc-benefits">
          <div class="rc-benefit"><span>💎</span>每日领 50 钻 + ⚡100 体力 + 随机道具 ×1</div>
          <div class="rc-benefit"><span>⚡</span>体力上限 +50（立即生效）</div>
          <div class="rc-benefit"><span>🪙</span>商城金币商品 9 折</div>
          <div class="rc-benefit dim">🎭 会员限定造型（造型系统上线后自动补发）</div>
        </div>
        <div class="rc-actions">
          <button class="rc-done" :disabled="!store.g || (store.g?.gem ?? 0) < 300" @click="store.buyVip()">
            💎 300 · {{ store.vipActive ? '续期 30 天' : '开通会员' }}
          </button>
          <button class="rc-done ghosted" :disabled="!store.vipDailyReady()" @click="store.claimVipDaily()">
            {{ store.vipDailyReady() ? '领取今日福利' : '今日已领' }}
          </button>
        </div>
      </div>

      <!-- ============ 页签：基金 ============ -->
      <div v-else-if="tab === 'fund'" class="shop-body">
        <div class="rc-hero">
          <div class="rc-hero-face">📈</div>
          <div class="rc-hero-name">乐园投资基金</div>
          <div class="rc-hero-sub">💎888 买入 · 每 5 级返 💎200 · Lv50 满级共返 💎2000</div>
        </div>
        <div v-if="!store.g?.fundOwned" class="rc-actions">
          <button class="rc-done" :disabled="(store.g?.gem ?? 0) < 888" @click="store.buyFund()">
            💎 888 · 投资乐园
          </button>
          <div class="rc-pay-note">重复购买会重置返还进度</div>
        </div>
        <template v-else>
          <div class="rc-fund-bar">
            <div class="rc-fund-fill" :style="{ width: (fundClaimed / fundTotal) * 100 + '%' }"></div>
            <span class="rc-fund-text">{{ fundClaimed }} / {{ fundTotal }} 次</span>
          </div>
          <div class="rc-actions">
            <button class="rc-done" :disabled="fundReady <= 0" @click="store.claimFund()">
              {{ fundReady > 0 ? `领取 ${fundReady} 份（💎+${fundReady * 200}）` : '还没有到账的返还' }}
            </button>
          </div>
          <div class="rc-pay-note">等级每过 5 级到账一份；满级解锁「乐园合伙人」称号</div>
        </template>
      </div>

      <!-- ============ 页签：抽奖 ============ -->
      <div v-else class="shop-body">
        <div class="rc-pity">
          <div class="rc-pity-label">保底进度（每 {{ store.LUCKY_META.pity }} 抽必出稀有及以上）</div>
          <div class="rc-fund-bar slim">
            <div class="rc-fund-fill" :style="{ width: pityPct + '%' }"></div>
          </div>
        </div>
        <div class="rc-lucky-row">
          <button class="rc-done" @click="doSpin(1)">💎 {{ store.LUCKY_META.single }} 单抽</button>
          <button class="rc-done" @click="doSpin(10)">💎 {{ store.LUCKY_META.ten }} 十连</button>
        </div>
        <div class="bag-foot">
          奖池：限定造型 3% · 稀有装饰 12% · 道具 35% · 金币 50%。
          造型与装饰摆放系统上线前，抽到按"重复获得"自动折算成钻石。
        </div>
      </div>

      <div class="bag-tools">
        <button class="close ghost" @click="close()">关闭</button>
      </div>

      <!-- ============ 抽奖结果层 ============ -->
      <div v-if="luckyOpen" class="rc-result" @click.self="luckyOpen = false">
        <div class="rc-result-card">
          <div class="rc-pay-title">抽奖结果</div>
          <div class="rc-result-grid">
            <div
              v-for="(p, i) in luckyList"
              :key="i"
              class="rc-prize"
              :class="{ rare: p.rarity === 'rare' }"
            >
              <span class="rc-prize-face">{{ PRIZE_FACE[p.kind]?.face ?? '🎁' }}</span>
              <span class="rc-prize-label">{{ PRIZE_FACE[p.kind]?.label ?? p.kind }}</span>
              <span class="rc-prize-amount">{{ prizeText(p) }}</span>
            </div>
          </div>
          <button class="rc-done" @click="luckyOpen = false">收下</button>
        </div>
      </div>

      <div class="rc-foot-note">本版本为模拟充值，不产生任何真实费用。</div>
    </div>
  </div>
</template>
