<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'
import { CUSTOMERS, DECORS, REGIONS } from '../game/business'
import { FESTS, PARK_COLS, PARK_ROWS, SKINS, actsUnlocked, storyLines, cardId } from '../game/content'
import { QUEST_DELIVER, QUEST_MERGE, QUEST_PRODUCE } from '../game/config'
import { isRegionUnlocked } from '../game/logic'

const store = useGameStore()
const { g, parkTab, codex, todayWeather, todayFest } = storeToRefs(store)

const tabs = [
  { id: 'codex', name: '图鉴' },
  { id: 'story', name: '剧情' },
  { id: 'park', name: '乐园' },
  { id: 'fest', name: '活动' },
  { id: 'skin', name: '造型' },
  { id: 'card', name: '卡牌' },
] as const

const scheme = computed(() => g.value?.live.schemes[g.value.live.schemeIx] ?? [])
const ownedDecor = computed(() => DECORS.filter((d) => (g.value ? (g.value.decor[d.key] ?? 0) > 0 : false)))

function cellDecor(x: number, y: number) {
  return scheme.value.find((p) => p.x === x && p.y === y)
}

function onCell(x: number, y: number) {
  const here = cellDecor(x, y)
  if (here) {
    store.turnDecor(here.decor)
    return
  }
  const next = ownedDecor.value.find((d) => !scheme.value.some((p) => p.decor === d.key))
  if (next) store.putDecor(next.key, x, y)
}

function savePostcard(): void {
  if (!g.value || !isRegionUnlocked(g.value, 'studio')) {
    store.markPostcard()
    return
  }
  const c = document.createElement('canvas')
  c.width = 720
  c.height = 420
  const x = c.getContext('2d')
  if (!x) return
  x.fillStyle = '#F6E7C1'
  x.fillRect(0, 0, 720, 420)
  x.strokeStyle = '#C4A46A'
  x.lineWidth = 12
  x.strokeRect(16, 16, 688, 388)
  x.fillStyle = '#4A2513'
  x.font = '700 36px sans-serif'
  x.fillText('爪爪乐园', 48, 86)
  x.font = '22px sans-serif'
  const pets = g.value.pets.map((k) => CUSTOMERS.find((c) => c.key === k)?.name ?? k).join('、') || '还没有常驻宠物'
  const lines = [
    `店长 Lv${g.value.level} · ${g.value.live.theme === 'dog' ? '狗' : '猫'}`,
    `常驻：${pets}`,
    `装饰 ${codex.value.decorGot} 件 · 明信片第 ${g.value.live.postcards + 1} 张`,
    todayWeather.value === 'rain' ? '今天在下雨' : '今天是晴天',
  ]
  lines.forEach((t, i) => x.fillText(t, 48, 150 + i * 40))
  const a = document.createElement('a')
  a.href = c.toDataURL('image/png')
  a.download = 'paw-postcard.png'
  a.click()
  store.markPostcard()
}
</script>

<template>
  <div class="modal" @click.self="store.closePark()">
    <div class="card park-card">
      <div class="bag-head">
        <span class="bag-title">乐园</span>
        <button class="bag-x" @click="store.closePark()">✕</button>
      </div>
      <div class="tabs">
        <button
          v-for="t in tabs"
          :key="t.id"
          class="tab"
          :class="{ on: parkTab === t.id }"
          @click="parkTab = t.id"
        >
          {{ t.name }}
        </button>
      </div>

      <div v-if="parkTab === 'codex'" class="blk">
        <p>元素 {{ codex.items }}/{{ codex.itemTotal }}</p>
        <p>装饰 {{ codex.decorGot }}/{{ codex.decorTotal }}</p>
        <p>顾客 {{ codex.custGot }}/{{ codex.custTotal }}</p>
        <p class="sub">见过的链物品、买下的装饰、接待过的顾客会计入这里。</p>
      </div>

      <div v-else-if="parkTab === 'story'" class="blk scroll">
        <div v-for="c in CUSTOMERS" :key="c.key" class="row">
          <b>{{ c.emoji }} {{ c.name }}</b>
          <span class="sub">{{ c.tag }}</span>
          <p v-for="(line, i) in storyLines(c.key)" :key="i" :class="{ lock: actsUnlocked(g?.affinity[c.key] ?? 0) <= i }">
            {{ actsUnlocked(g?.affinity[c.key] ?? 0) > i ? line : '好感还不够' }}
          </p>
        </div>
      </div>

      <div v-else-if="parkTab === 'park'" class="blk">
        <div class="schemes">
          <button v-for="(name, i) in g?.live.schemeNames" :key="i" class="tab" :class="{ on: g?.live.schemeIx === i }" @click="store.useScheme(i)">
            {{ name }}
          </button>
        </div>
        <div class="grid">
          <button
            v-for="n in PARK_COLS * PARK_ROWS"
            :key="n"
            class="cell"
            @click="onCell((n - 1) % PARK_COLS, Math.floor((n - 1) / PARK_COLS))"
          >
            <template v-if="cellDecor((n - 1) % PARK_COLS, Math.floor((n - 1) / PARK_COLS))">
              {{ DECORS.find((d) => d.key === cellDecor((n - 1) % PARK_COLS, Math.floor((n - 1) / PARK_COLS))!.decor)?.emoji }}
            </template>
          </button>
        </div>
        <p class="sub">点空格摆下一件已拥有的装饰，点已摆的装饰旋转，长按没有。收起请点下面的名字。</p>
        <button v-for="p in scheme" :key="p.decor" class="tab" @click="store.removeDecor(p.decor)">
          收起 {{ DECORS.find((d) => d.key === p.decor)?.name }}
        </button>
        <div v-if="g && g.pets.length" class="blk">
          <p><b>派驻与代打</b></p>
          <div v-for="pet in g.pets" :key="pet" class="row">
            <span>{{ CUSTOMERS.find((c) => c.key === pet)?.name }}</span>
            <select :value="g.live.post[pet] ?? ''" @change="store.assignPet(pet, ($event.target as HTMLSelectElement).value as never)">
              <option value="" disabled>选择区域</option>
              <option v-for="r in REGIONS" :key="r.key" :value="r.key">{{ r.name }}</option>
            </select>
            <button class="tab" @click="store.dispatchPet(pet)">代打 5 次</button>
          </div>
          <p class="sub">猫和狗派到同一区域，会触发羁绊并产出物品。</p>
        </div>
        <button class="tab" @click="savePostcard">导出明信片</button>
      </div>

      <div v-else-if="parkTab === 'fest'" class="blk scroll">
        <p>天气：{{ todayWeather === 'rain' ? '下雨，护理订单金币翻倍' : '晴' }}</p>
        <p>当前节日：{{ todayFest ? `${todayFest.emoji} ${todayFest.name}` : '无（可在下面穿越）' }}</p>
        <button class="tab" @click="store.focusFest('')">回到今天</button>
        <button v-for="f in FESTS" :key="f.key" class="tab" @click="store.focusFest(f.key)">{{ f.emoji }} {{ f.name }}</button>
        <button class="tab" @click="store.claimFest()">领取节日礼物</button>
        <p v-if="g">
          每日任务：合成 {{ g.live.questMerge }}/{{ QUEST_MERGE }} · 交付 {{ g.live.questDeliver }}/{{ QUEST_DELIVER }} · 点击 {{ g.live.questProduce }}/{{ QUEST_PRODUCE }}
        </p>
        <button class="tab" @click="store.claimQuest()">领取任务</button>
        <button class="tab" @click="store.checkIn()">签到</button>
      </div>

      <div v-else-if="parkTab === 'skin'" class="blk scroll">
        <div v-for="s in SKINS" :key="s.key" class="row">
          <span>{{ s.emoji }} {{ s.name }}</span>
          <span class="sub">{{ g?.live.skins.includes(s.key) ? '已拥有' : '抽奖或节日获得' }}</span>
        </div>
        <div v-if="g && g.live.skins.length && CUSTOMERS.length">
          <p class="sub">把已拥有的造型穿给一位顾客。</p>
          <div v-for="c in CUSTOMERS.slice(0, 8)" :key="c.key" class="row">
            <span>{{ c.name }}</span>
            <select :value="g.live.equipped[c.key] ?? ''" @change="store.equipSkin(c.key, ($event.target as HTMLSelectElement).value)">
              <option value="">不穿</option>
              <option v-for="s in SKINS.filter((x) => g!.live.skins.includes(x.key))" :key="s.key" :value="s.key">{{ s.name }}</option>
            </select>
          </div>
        </div>
      </div>

      <div v-else class="blk scroll">
        <div v-for="c in CUSTOMERS" :key="c.key" class="row">
          <b>{{ c.name }}</b>
          <p :class="{ lock: !g?.live.cards.includes(cardId(c.key)) }">
            {{ g?.live.cards.includes(cardId(c.key)) ? storyLines(c.key)[1] : '好感到第二幕后解锁' }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.park-card {
  width: min(460px, 94vw);
  max-height: 82vh;
  overflow: auto;
}
.tabs,
.schemes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
}
.tab {
  border: 0;
  background: #f4efe6;
  border-radius: 999px;
  padding: 6px 10px;
  cursor: pointer;
}
.tab.on {
  background: #ffe7c2;
}
.scroll {
  max-height: 52vh;
  overflow: auto;
}
.row {
  padding: 6px 0;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}
.lock {
  opacity: 0.45;
}
.grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
}
.cell {
  aspect-ratio: 1;
  border: 1px dashed rgba(0, 0, 0, 0.15);
  border-radius: 8px;
  background: #fffdf8;
  cursor: pointer;
}
</style>
