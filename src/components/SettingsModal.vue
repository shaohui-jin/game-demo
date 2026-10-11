<script setup lang="ts">
/**
 * 设置弹窗：存档安全（M5）的玩家入口。
 *
 * 设计文档 15 章把「存档丢失」列为**高风险**，16 章要求「存档安全排在玩法之前」——
 * 但在此之前它一直没有一个玩家可达的入口（备份是自动的、导出/导入根本没做）。
 * 这个弹窗就是那个入口：看得见存档状态、能手动备份、能把进度带走、能把进度带回来。
 *
 * 导入用粘贴文本而不是文件选择器：手机上选文件路径不可控，而"复制一段文本"
 * 在任何设备上都成立；桌面端可以后续再加"选择文件"。
 */
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'
import { fmtLeft } from '../game/logic'

const store = useGameStore()
const { saveMeta, backups } = storeToRefs(store)

const importText = ref('')
const shareText = ref('')
const importing = ref(false)

function fmtAt(ts: number): string {
  if (!ts) return '空'
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "多久之前"的人话（存档越新越安心） */
function ago(ts: number): string {
  if (!ts) return '—'
  return `${fmtLeft(Math.max(0, Date.now() - ts))}前`
}

function onBackup(): void {
  store.doBackup()
}

function onRestore(slot: number): void {
  if (!confirm(`确定从第 ${slot} 号备份恢复吗？当前进度会被覆盖。`)) return
  store.doRestore(slot)
}

function onExport(): void {
  store.doExport()
}

async function onImport(): Promise<void> {
  const text = importText.value.trim()
  if (!text) {
    alert('请先把存档文本粘贴进来')
    return
  }
  if (!confirm('导入会覆盖当前进度，确定继续吗？')) return
  importing.value = true
  const ok = store.doImport(text)
  importing.value = false
  if (ok) importText.value = ''
}

function onReset(): void {
  if (!confirm('确定重置存档吗？当前进度会全部清空（备份槽位仍保留）。')) return
  store.reset()
  store.closeSettings()
}
</script>

<template>
  <div class="modal" @click.self="store.closeSettings()">
    <div class="card set-card">
      <div class="bag-head">
        <span class="bag-title">存档</span>
        <button class="bag-x" @click="store.closeSettings()">✕</button>
      </div>

      <!-- 当前存档状态 -->
      <div class="set-status" :class="{ bad: saveMeta.exists && !saveMeta.ok }">
        <div class="set-row">
          <span class="k">当前存档</span>
          <span class="v">
            <template v-if="!saveMeta.exists">还没有存档</template>
            <template v-else-if="!saveMeta.ok">⚠️ 数据不完整</template>
            <template v-else>{{ fmtAt(saveMeta.savedAt) }}（{{ ago(saveMeta.savedAt) }}）</template>
          </span>
        </div>
        <div class="set-row">
          <span class="k">大小</span>
          <span class="v">{{ saveMeta.exists ? (saveMeta.bytes / 1024).toFixed(1) + ' KB' : '—' }}</span>
        </div>
      </div>

      <p class="set-note">
        游戏每次启动会自动备份一份（轮转保留最近 3 份）。浏览器清理数据会<strong>连主档一起清掉</strong>，
        所以请定期用下面的「导出」把进度存到别处。
      </p>

      <!-- 备份槽位 -->
      <div class="set-sec">备份槽位</div>
      <div v-for="b in backups" :key="b.slot" class="set-row slot">
        <span class="k">#{{ b.slot }}</span>
        <span class="v">
          <template v-if="!b.savedAt">空</template>
          <template v-else>
            {{ fmtAt(b.savedAt) }}（{{ ago(b.savedAt) }}）{{ b.ok ? '' : ' · 数据不完整' }}
          </template>
        </span>
        <button class="set-btn" :disabled="!b.savedAt" @click="onRestore(b.slot)">恢复</button>
      </div>

      <div class="set-actions">
        <button class="set-btn big" @click="onBackup">立即备份</button>
        <button class="set-btn big" @click="onExport">导出到剪贴板</button>
      </div>

      <!-- 导入 -->
      <div class="set-sec">导入存档</div>
      <textarea
        v-model="importText"
        class="set-area"
        rows="4"
        placeholder="把之前导出的存档文本粘贴到这里…"
        spellcheck="false"
      ></textarea>
      <div class="set-actions">
        <button class="set-btn big" :disabled="importing" @click="onImport">导入并覆盖当前进度</button>
      </div>

      <div class="set-sec">外观</div>
      <div class="set-actions">
        <button class="set-btn big" @click="store.setTheme('cat')">猫的样子</button>
        <button class="set-btn big" @click="store.setTheme('dog')">狗的样子</button>
      </div>

      <div class="set-sec">游玩与分享</div>
      <p class="set-note" v-if="store.g">
        合成 {{ store.g.merges }} 次 · 交付 {{ store.g.live.delivers }} 单 · 点击产出 {{ store.g.produces }} 次 ·
        游玩约 {{ Math.floor(store.g.live.playMs / 60000) }} 分钟
      </p>
      <div class="set-actions">
        <button class="set-btn big" @click="store.toggleSound()">
          {{ store.g?.live.sound ? '关闭音效' : '打开音效' }}
        </button>
        <button class="set-btn big" @click="shareText = store.shareCode()">复制布局码到下面</button>
      </div>
      <textarea v-model="shareText" class="set-area" rows="3" placeholder="乐园布局分享码（paw1. 开头）" spellcheck="false"></textarea>
      <div class="set-actions">
        <button class="set-btn big" @click="store.importShare(shareText)">导入布局</button>
      </div>

      <div class="set-sec danger">危险区</div>
      <div class="set-actions">
        <button class="set-btn big danger" @click="onReset">重置存档（备份仍保留）</button>
      </div>

      <div class="bag-tools">
        <button class="close ghost" @click="store.closeSettings()">关闭</button>
      </div>
    </div>
  </div>
</template>
