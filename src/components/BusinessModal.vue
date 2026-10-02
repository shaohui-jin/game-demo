<script setup lang="ts">
/**
 * 经营弹窗 —— 三个页签：装饰 / 区域 / 顾客。
 *
 * 这是「经营层」的第一批实现，补齐了设计文档 1.3 里原本完全空缺的三个子系统：
 *   ① **区域**（文档 6.1）：等级门槛 + 依次解锁，解锁后真实加成（体力上限 / 订单金币 / 星星 / 离线时长 / 订单档位）
 *   ② **装饰**（文档 6.2）：只消耗星星、**不产生任何数值收益** —— 它的价值是把审美投入变成沉没成本
 *   ③ **顾客**（文档 5.2）：订单绑定顾客 → 积好感 → 满格转化为**常驻宠物** → 每小时自动产出
 *
 * 三个页签都在底部放一行小字，就地解释这一页特有的反直觉规则
 * （这是从对标截图 2.6 条抄来的做法：贴在使用现场的解释比弹 Toast 更持久）。
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'
import SpriteIcon from '../ui/SpriteIcon.vue'
import { AFFINITY_FULL, PET_GOLD_PER_HOUR } from '../game/config'
import { DECOR_SETS } from '../game/business'

const store = useGameStore()
const { stars, bizTab, decorList, regionList, regionBonus, decorLevelSum, petList, petCapHours } =
  storeToRefs(store)

/** 装饰按系列分组展示 */
const decorGroups = computed(() =>
  DECOR_SETS.map((set) => ({ set, items: decorList.value.filter((d) => d.set === set) }))
)

function pct(cur: number, max: number): number {
  return max > 0 ? Math.min(100, (cur / max) * 100) : 0
}
</script>

<template>
  <div class="modal" @click.self="store.closeBusiness()">
    <div class="card biz-card">
      <div class="bag-head">
        <span class="bag-title">经营</span>
        <span class="bag-gold star"
          ><SpriteIcon name="ico-star" fallback="⭐" />{{ stars }}</span
        >
        <button class="bag-x" @click="store.closeBusiness()">
          <SpriteIcon name="ico-close" fallback="✕" />
        </button>
      </div>

      <div class="biz-tabs">
        <button class="biz-tab" :class="{ on: bizTab === 'decor' }" @click="store.setBizTab('decor')">
          装饰
        </button>
        <button class="biz-tab" :class="{ on: bizTab === 'region' }" @click="store.setBizTab('region')">
          区域
        </button>
        <button
          class="biz-tab"
          :class="{ on: bizTab === 'customer' }"
          @click="store.setBizTab('customer')"
        >
          顾客
          <i v-if="petList.length" class="dot">{{ petList.length }}</i>
        </button>
      </div>

      <!-- ==================== 装饰 ==================== -->
      <div v-if="bizTab === 'decor'" class="biz-body">
        <div class="bag-cap">
          <span class="pill">乐园繁荣度 {{ decorLevelSum }}</span>
          <span class="pill alt"><SpriteIcon name="ico-star" fallback="⭐" />{{ stars }}</span>
        </div>

        <div v-for="grp in decorGroups" :key="grp.set" class="biz-group">
          <div class="biz-group-t">{{ grp.set }}</div>
          <div class="decor-grid">
            <div v-for="d in grp.items" :key="d.key" class="decor-card" :class="{ owned: d.owned }">
              <div class="decor-ico"><SpriteIcon :name="d.sprite" :fallback="d.emoji" /></div>
              <div class="decor-name">{{ d.name }}</div>
              <div class="decor-lv">
                <span>Lv {{ d.level }}/{{ d.maxLevel }}</span>
                <span class="decor-bar"><i :style="{ width: pct(d.level, d.maxLevel) + '%' }"></i></span>
              </div>
              <button
                class="decor-btn"
                :class="{ maxed: d.maxed, poor: !d.maxed && stars < d.cost }"
                :disabled="d.maxed"
                @click="store.upgradeDecor(d.key)"
              >
                <template v-if="d.maxed">已满级</template>
                <template v-else
                  >{{ d.owned ? '升级' : '购买' }} ·
                  <SpriteIcon name="ico-star" fallback="⭐" />{{ d.cost }}</template
                >
              </button>
            </div>
          </div>
        </div>

        <div class="bag-foot">
          装饰<b>不产生任何数值收益</b> —— 它换的是你自己的审美投入。想赚金币要去做订单，装饰只花星星。
        </div>
      </div>

      <!-- ==================== 区域 ==================== -->
      <div v-else-if="bizTab === 'region'" class="biz-body">
        <div class="bag-cap" v-if="regionBonus">
          <span class="pill">体力上限 +{{ regionBonus.staminaMax }}</span>
          <span class="pill alt">订单金币 +{{ Math.round(regionBonus.goldMult * 100) }}%</span>
          <span class="pill alt">每单 +{{ regionBonus.starBonus }} <SpriteIcon name="ico-star" fallback="⭐" /></span>
        </div>

        <div class="region-list">
          <div
            v-for="r in regionList"
            :key="r.key"
            class="region-row"
            :class="{ on: r.unlocked, can: r.canUnlock }"
          >
            <div class="region-ico"><SpriteIcon :name="r.sprite" :fallback="r.emoji" /></div>
            <div class="region-info">
              <div class="region-name">
                {{ r.name }}
                <span class="region-lv">Lv{{ r.unlockLevel }}</span>
                <span v-if="r.unlocked" class="tag on">已解锁</span>
              </div>
              <div class="region-benefit">{{ r.benefit }}</div>
            </div>
            <button
              v-if="r.canUnlock"
              class="region-btn go"
              @click="store.unlockRegion(r.key)"
            >
              建设
            </button>
            <button v-else-if="r.unlocked" class="region-btn done" disabled>已开放</button>
            <button v-else class="region-btn" disabled>差 {{ r.gap }} 级</button>
          </div>
        </div>

        <div class="bag-foot">
          区域必须<b>依次建设</b>：等级到了才能开下一个，不能跳着开后期区域。每次建设都会立刻重抽订单，新档位当场生效。
        </div>
      </div>

      <!-- ==================== 顾客 ==================== -->
      <div v-else class="biz-body">
        <div class="bag-cap">
          <span class="pill">常驻宠物 {{ petList.length }}</span>
          <span class="pill alt">离线累积上限 {{ petCapHours }}h</span>
        </div>

        <div class="cust-list">
          <div v-for="c in store.customerList" :key="c.key" class="cust-card" :class="{ pet: c.isPet }">
            <div class="cust-ico"><SpriteIcon :name="c.sprite" :fallback="c.emoji" /></div>
            <div class="cust-info">
              <div class="cust-name">
                {{ c.name }}
                <span class="cust-camp" :class="c.camp">{{ c.camp === 'cat' ? '猫派' : '狗派' }}</span>
                <span v-if="c.isPet" class="tag on">常驻</span>
              </div>
              <div class="cust-tag">{{ c.tag }}</div>
              <div class="cust-aff">
                <span class="cust-bar"><i :style="{ width: c.pct + '%' }"></i></span>
                <span class="cust-num">
                  {{ c.isPet ? '已转化' : `${c.affinity}/${AFFINITY_FULL}` }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="bag-foot">
          完成订单会积累发单顾客的好感，满 {{ AFFINITY_FULL }} 后转化为<b>常驻宠物</b>：每小时自动产出
          <SpriteIcon name="ico-gold" fallback="🪙" />{{ PET_GOLD_PER_HOUR }}， 离线最多累积 {{ petCapHours }}
          小时（午睡区可提升到 12 小时）。
        </div>
      </div>

      <div class="bag-tools">
        <button class="close ghost" @click="store.closeBusiness()">关闭</button>
      </div>
    </div>
  </div>
</template>
