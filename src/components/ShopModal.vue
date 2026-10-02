<script setup lang="ts">
/**
 * 商店弹窗。
 *
 * 两个分区（金币区 / 钻石区）刻意分开，因为它们的**限购规则完全不同**：
 *   - 金币区：**不限购** —— 金币只能由玩法产出，取消限购没有平衡风险（文档 9.2）；
 *   - 钻石区：**每时段限购** —— 它是充值货币，不限购等于花钱通关。
 *
 * 刷新：跨过 6/12/18/24 点中的一个，钻石区的"今日已购"就清零（`shopSlotKey()`）。
 * 底部那行小字写的是**红线**：不卖金币。这条必须让玩家看见，否则他们会一直找"氪金换金币"的入口。
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'
import SpriteIcon from '../ui/SpriteIcon.vue'

const store = useGameStore()
const { g, shopList } = storeToRefs(store)

const goldTab = computed(() => shopList.value.filter((x) => x.tab === 'gold'))
const gemTab = computed(() => shopList.value.filter((x) => x.tab === 'gem'))

/** 礼包是否已买（一次性口径下显示"已购"并禁用按钮） */
function giftSoldOut(key: string): boolean {
  return store.giftBoughtCount(key) > 0
}

function giftLimitText(key: string): string {
  const d = store.GIFTS.find((x) => x.key === key)
  if (!d) return ''
  if (d.limit === 'once') return '限购 1 次'
  if (d.limit === 'perRegion') return '每次解锁新区域可买 1 次'
  if (d.limit === 'per10Lv') return '每 10 级可买 1 次'
  return '常驻 · 不限量'
}

const refreshText = '6:00 / 12:00 / 18:00 / 24:00'
</script>

<template>
  <div class="modal" @click.self="store.closeShop()">
    <div class="card shop-card">
      <div class="bag-head">
        <span class="bag-title">商店</span>
        <span class="bag-gold">🪙 {{ g?.gold ?? 0 }}</span>
        <span class="bag-gold">💎 {{ g?.gem ?? 0 }}</span>
        <button class="bag-x" @click="store.closeShop()">✕</button>
      </div>

      <div class="shop-tabs">
        <span class="shop-tab gold">🪙 金币区 · 不限购</span>
        <span class="shop-tab gem">💎 钻石区 · 每时段限购</span>
      </div>

      <div class="shop-body">
        <!-- 金币区 -->
        <div class="shop-group">
          <div v-for="x in goldTab" :key="x.key" class="shop-row" :class="{ poor: x.poor }">
            <div class="shop-ico"><SpriteIcon :name="x.sprite" :fallback="x.emoji" /></div>
            <div class="shop-info">
              <div class="shop-name">{{ x.name }}</div>
              <div class="shop-desc">{{ x.desc }}</div>
              <div v-if="x.lockedByLevel" class="shop-warn">Lv{{ x.needLevel }} 解锁</div>
              <div v-else-if="x.noSpace" class="shop-warn">棋盘还差 {{ x.spaceLeft }} 格</div>
            </div>
            <button
              class="shop-btn"
              :class="{ poor: x.poor || x.lockedByLevel || x.noSpace }"
              :disabled="!x.buyable"
              @click="store.buyGoods(x.key)"
            >
              🪙{{ x.price }}
            </button>
          </div>
        </div>

        <!-- 钻石区 -->
        <div class="shop-group">
          <div v-for="x in gemTab" :key="x.key" class="shop-row gem" :class="{ poor: x.poor }">
            <div class="shop-ico"><SpriteIcon :name="x.sprite" :fallback="x.emoji" /></div>
            <div class="shop-info">
              <div class="shop-name">{{ x.name }}</div>
              <div class="shop-desc">{{ x.desc }}</div>
              <div class="shop-limit">
                <template v-if="x.left === null">不限购</template>
                <template v-else-if="x.outOfStock">本时段已买满</template>
                <template v-else>本时段还可买 {{ x.left }} 次</template>
                <template v-if="x.lockedByLevel">· Lv{{ x.needLevel }} 解锁</template>
                <template v-else-if="x.noSpace">· 棋盘还差 {{ x.spaceLeft }} 格</template>
              </div>
            </div>
            <button
              class="shop-btn gem"
              :class="{ poor: x.poor || x.lockedByLevel || x.outOfStock || x.noSpace }"
              :disabled="!x.buyable"
              @click="store.buyGoods(x.key)"
            >
              💎{{ x.price }}
            </button>
          </div>
        </div>

        <!-- 礼包区（文档 10.3 / 10.4：阶段性限量超值，商城补给包常驻不限量） -->
        <div class="shop-group">
          <div class="shop-group-title">🎁 礼包</div>
          <div v-for="d in store.GIFTS" :key="d.key" class="shop-row gem" :class="{ poor: (g?.gem ?? 0) < d.price }">
            <div class="shop-ico"><span class="spr-big">{{ d.emoji }}</span></div>
            <div class="shop-info">
              <div class="shop-name">{{ d.name }}</div>
              <div class="shop-desc">{{ d.desc }}</div>
              <div class="shop-limit">
                {{ giftLimitText(d.key) }}
                <template v-if="d.needLevel > 0">· Lv{{ d.needLevel }} 解锁</template>
              </div>
            </div>
            <button
              class="shop-btn gem"
              :class="{ poor: giftSoldOut(d.key) || (g?.gem ?? 0) < d.price || (g?.level ?? 0) < d.needLevel }"
              :disabled="giftSoldOut(d.key) || (g?.level ?? 0) < d.needLevel"
              @click="store.buyGift(d.key)"
            >
              {{ giftSoldOut(d.key) ? '已购' : `💎${d.price}` }}
            </button>
          </div>
        </div>
      </div>

      <div class="bag-foot">
        货物每 {{ refreshText }} 刷新一次（限购重置）。<b>商店不卖金币</b> —— 金币只能靠玩法产出，
        这是本作经济不崩的底线。
      </div>

      <div class="bag-tools">
        <button class="close ghost" @click="store.closeShop()">关闭</button>
      </div>
    </div>
  </div>
</template>
