<script setup lang="ts">
/**
 * 顶部 HUD。
 *
 * 第一批改造要点：
 *   1. 新增**等级**格 —— 区域解锁全看等级，玩家必须随时知道自己在几级。点它直接跳到「经营 · 区域」，
 *      把"差几级"这件事变成一次点击就能看到的信息，而不是要玩家自己记。
 *   2. 新增**星星**格 —— 第四种货币（文档 9.1）：只从订单结算产出、只用于装饰，与主经济刻意隔离。
 *   3. 体力上限改读 store 的 `staminaMaxN`（含区域加成），不再直接读常量 STAMINA_MAX。
 *
 * 分两行而不是挤一行：五行在 460px 竖屏里会把 6 位数的余额压成省略号。
 */
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'
import SpriteIcon from '../ui/SpriteIcon.vue'

const store = useGameStore()
const { g, staminaPct, staminaSub, canClaimBonus, staminaMaxN, stars } = storeToRefs(store)

function onStaminaClick(): void {
  if (canClaimBonus.value) store.claimBonus()
}
</script>

<template>
  <div class="hud" v-if="g">
    <div class="hud-row">
      <div class="coin lvbox" title="点击查看区域进度" @click="store.openBusiness('region')">
        <span class="ico"><SpriteIcon name="ico-level" fallback="🏗️" /></span>
        <span class="val">Lv{{ g.level }}</span>
      </div>
      <div class="coin stamina" :class="{ bonus: canClaimBonus }" @click="onStaminaClick">
        <div class="row">
          <span class="ico"><SpriteIcon name="ico-stamina" fallback="⚡" /></span>
          <span class="val">{{ g.stamina }}/{{ staminaMaxN }}</span>
          <span class="sub">{{ staminaSub }}</span>
        </div>
        <div class="bar"><i :style="{ width: staminaPct + '%' }"></i></div>
      </div>
    </div>

    <div class="hud-row">
      <div class="coin">
        <span class="ico"><SpriteIcon name="ico-gold" fallback="🪙" /></span
        ><span class="val">{{ g.gold }}</span>
      </div>
      <div
        class="coin star"
        title="星星：交付订单获得，用于装饰"
        @click="store.openBusiness('decor')"
      >
        <span class="ico"><SpriteIcon name="ico-star" fallback="🌟" /></span
        ><span class="val">{{ stars }}</span>
      </div>
      <div class="coin">
        <span class="ico"><SpriteIcon name="ico-gem" fallback="💎" /></span
        ><span class="val">{{ g.gem }}</span>
      </div>
    </div>
  </div>
</template>
