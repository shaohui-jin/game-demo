<script setup lang="ts">
/**
 * 《爪爪乐园》· Vue 版根组件
 *
 * 结构：HUD（两行）→ 功能栏 → 棋盘（含**背包道具**格）→ 信息栏 → 调试行，
 * 外加粒子 canvas / 飘字 / 飞行物品 / Toast 浮层与各弹窗（图鉴 / 经营 / 商店 /
 * 充值 / 设置 / **背包**）。
 *
 * ★ 已删除「发射器栏」（2026-10-02 第二轮设计修正）：
 *   玩具架 / 玩具箱 现在是**棋盘上的常驻对象**（设施链），不再有独立工具栏。
 *
 * ★ 2026-10-02 交互修正：
 *   - 背包是**摆在棋盘上的道具**（默认右下角，可拖拽），不再是外部抽屉；
 *   - 点开背包 = **居中悬浮弹窗** —— 旧版底部抽屉会挤压主场景（`--bag-h` 那套
 *     变量已整体拆除），现在棋盘纹丝不动；
 *   - 全屏**无滚动条**（移动端单屏游戏），弹窗内容超长时内部滚动但隐藏滚动条。
 *
 * `#app` 这个 id 由 index.html 提供，它承担两件事：
 *  ① 竖屏布局容器（max-width 460px + 内边距）；
 *  ② 屏幕震动的动画载体（`#app.shake`）—— 震的是整屏，所以振幅必须压得很低。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { useGameStore } from './stores/game'
import HudBar from './components/HudBar.vue'
import ToolBar from './components/ToolBar.vue'
import GameBoard from './components/GameBoard.vue'
import InfoBar from './components/InfoBar.vue'
import DebugBar from './components/DebugBar.vue'
import ChainTreeModal from './components/ChainTreeModal.vue'
import BusinessModal from './components/BusinessModal.vue'
import ShopModal from './components/ShopModal.vue'
import RechargeModal from './components/RechargeModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import BackpackModal from './components/BackpackModal.vue'
import OrderModal from './components/OrderModal.vue'
import YardView from './components/YardView.vue'
import ParkModal from './components/ParkModal.vue'
import FxCanvas from './components/FxCanvas.vue'
import FloatLayer from './components/FloatLayer.vue'
import FlyerLayer from './components/FlyerLayer.vue'
import ToastLayer from './components/ToastLayer.vue'

const store = useGameStore()

onMounted(() => store.init())
onBeforeUnmount(() => store.dispose())
</script>

<template>
  <FxCanvas />

  <YardView v-show="store.scene === 'yard'" />

  <div class="screen" v-show="store.scene === 'board'">
    <HudBar />
    <ToolBar />
    <GameBoard />
    <InfoBar />
    <DebugBar />
  </div>

  <Transition name="fade">
    <BackpackModal v-if="store.bagOpen" />
  </Transition>

  <Transition name="fade">
    <ChainTreeModal v-if="store.treeOpen" />
  </Transition>

  <Transition name="fade">
    <BusinessModal v-if="store.businessOpen" />
  </Transition>

  <Transition name="fade">
    <ShopModal v-if="store.shopOpen" />
  </Transition>

  <Transition name="fade">
    <RechargeModal v-if="store.rechargeOpen" />
  </Transition>

  <Transition name="fade">
    <SettingsModal v-if="store.settingsOpen" />
  </Transition>

  <Transition name="fade">
    <OrderModal v-if="store.orderOpen" />
  </Transition>

  <Transition name="fade">
    <ParkModal v-if="store.parkOpen" />
  </Transition>

  <Transition name="fade">
    <div v-if="store.needsBackupPrompt" class="modal">
      <div class="card">
        <h3>先备份一份</h3>
        <p class="sub">这台设备上的存档就是全部进度。现在写一份备份，以后坏了还能从设置里找回。</p>
        <div class="row">
          <button class="set-btn" @click="store.ackBackup()">现在备份</button>
          <button class="set-btn" @click="store.skipBackup()">以后再说</button>
        </div>
      </div>
    </div>
  </Transition>

  <ToastLayer />
  <FloatLayer />
  <FlyerLayer />
</template>
