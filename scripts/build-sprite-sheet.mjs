/**
 * 造型总览生成器 —— 扫描 src/assets/sprites 下所有贴图，产出一张可直接打开的总览页。
 *
 * 为什么要用脚本生成而不是手写一份 HTML：
 *   贴图会一直加，手写的那份一定会过期。这里以**文件系统为唯一事实来源**，
 *   每次加完造型跑一次 `node scripts/build-sprite-sheet.mjs` 就同步了。
 *
 * 用法：node scripts/build-sprite-sheet.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SPRITE_DIR = path.join(ROOT, 'src/assets/sprites')
const OUT = path.join(ROOT, 'docs/爪爪乐园-全造型一览.html')

/** 目录 → 中文分组名（顺序即展示顺序） */
const GROUPS = [
  ['items', '合成链物品'],
  ['gen', '母体 / 任务物品'],
  ['spawn', '设施 · 主发射器'],
  ['tools', '特殊道具'],
  ['customers', '顾客 · 8 只'],
  ['regions', '区域 · 9 个'],
  ['decors', '装饰 · 11 件'],
  ['icons', '货币与状态图标'],
]

/** 中文名表：key → 显示名。没收录的会退化成 key 本身 */
const NAMES = {
  'toy-1': '毛线球', 'toy-2': '逗猫棒', 'toy-3': '铃铛球',
  'care-1': '梳毛刷', 'care-2': '指甲剪', 'care-3': '洗澡球',
  'food-1': '猫罐头', 'food-2': '冻干块', 'food-3': '鲜鱼排',
  'supply-1': '伴手礼', 'supply-2': '豪华礼盒',
  'gen-fort': '猫城堡 · 母体', 'gen-groom': '美容台 · 母体', 'fin-meal': '豪华鲜食 · 任务物',
  'spawn-rack': '玩具架 · 设施', 'spawn-chest': '玩具箱 · 设施',
  'tool-scissors': '剪刀', 'tool-card': '升级卡',
  'cust-ragdoll': '布偶猫', 'cust-orange': '橘猫', 'cust-siamese': '暹罗猫', 'cust-british': '英短',
  'cust-husky': '哈士奇', 'cust-corgi': '柯基', 'cust-shiba': '柴犬', 'cust-golden': '金毛',
  'region-lobby': '前台大厅', 'region-grooming': '洗护区', 'region-play': '玩耍区',
  'region-diner': '餐厅', 'region-training': '训练场', 'region-nap': '午睡区',
  'region-pool': '泳池区', 'region-clinic': '诊疗室', 'region-studio': '摄影棚',
  'decor-cat-tree': '猫爬架', 'decor-cat-bed': '猫吊床', 'decor-cat-house': '猫宫殿',
  'decor-dog-bed': '狗窝', 'decor-frisbee': '飞盘架', 'decor-agility': '敏捷赛道',
  'decor-plant': '绿植', 'decor-rug': '地毯', 'decor-lamp': '落地灯',
  'decor-sign': '门口招牌', 'decor-fountain': '中央喷泉',
  'ico-stamina': '体力', 'ico-gold': '金币', 'ico-gem': '钻石', 'ico-star': '星星',
  'ico-level': '等级', 'ico-bag': '背包', 'ico-in': '存入', 'ico-shop': '商店',
  'ico-back': '返回', 'ico-close': '关闭', 'ico-web': '蛛网',
  'ico-manage': '经营', 'ico-order': '订单',
}

/** 分组配色（贴纸底色 + 边） */
const TINT = {
  items: ['#FFE3EE', '#F7B8D2'],
  gen: ['#F6E4EE', '#E0BCD0'],
  spawn: ['#F8F1E5', '#E3D2B4'],
  tools: ['#FFF4E2', '#E6C79B'],
  customers: ['#FFF1E0', '#F1D3B0'],
  regions: ['#E7F3FB', '#C2DDF0'],
  decors: ['#EAF7F1', '#C4E7D8'],
  icons: ['#FFFDF6', '#E7D6B8'],
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const sections = []
let total = 0

for (const [dir, label] of GROUPS) {
  const abs = path.join(SPRITE_DIR, dir)
  if (!fs.existsSync(abs)) continue
  const files = fs
    .readdirSync(abs)
    .filter((f) => /\.(svg|png|webp)$/i.test(f))
    .sort()
  if (!files.length) continue
  const [tint, edge] = TINT[dir] ?? ['#FFFDF6', '#E7D6B8']

  const cards = files
    .map((f) => {
      const key = f.replace(/\.(svg|png|webp)$/i, '')
      const svg = fs.readFileSync(path.join(abs, f), 'utf8')
      total++
      return `
      <figure class="cell">
        <div class="stk" style="background:${tint};border-color:${edge}">${svg}</div>
        <figcaption>
          <span class="nm">${esc(NAMES[key] ?? key)}</span>
          <code>${esc(key)}</code>
        </figcaption>
      </figure>`
    })
    .join('')

  sections.push(`
  <section class="group">
    <h2><span class="dot" style="background:${edge}"></span>${esc(label)}<span class="cnt">${files.length}</span></h2>
    <div class="grid">${cards}</div>
  </section>`)
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>爪爪乐园 · 全造型一览</title>
<style>
:root{
  --paper:#FBF1DD; --paper-2:#F6E9D0; --card:#FFFDF6; --cut:#fff;
  --ink:#3B2E20; --ink-2:#6E5B44; --ink-3:#A08B72; --line:#E7D6B8;
  --stk:0 0 0 1px rgba(59,46,32,.10), 0 3px 0 rgba(59,46,32,.13), 0 8px 16px rgba(59,46,32,.09);
}
*{box-sizing:border-box}
body{
  margin:0;padding:44px 30px 80px;color:var(--ink);
  font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  background-color:var(--paper);
  background-image:radial-gradient(rgba(59,46,32,.05) 1.1px, transparent 1.1px);
  background-size:17px 17px;
}
header{max-width:1240px;margin:0 auto 34px}
.kicker{display:inline-block;font-size:11px;letter-spacing:.2em;font-weight:900;text-transform:uppercase;
  color:#fff;background:#E4517F;padding:5px 13px;border-radius:5px;box-shadow:var(--stk)}
h1{margin:16px 0 10px;font-size:30px;font-weight:900;letter-spacing:-.02em}
header p{margin:0;max-width:760px;font-size:13.5px;line-height:1.8;color:var(--ink-2)}
header .meta{margin-top:12px;font-size:12px;color:var(--ink-3)}
.group{max-width:1240px;margin:0 auto 40px}
.group h2{
  display:flex;align-items:center;gap:10px;margin:0 0 16px;font-size:17px;font-weight:900;
}
.group h2 .dot{width:13px;height:13px;border-radius:5px;box-shadow:0 0 0 2px #fff}
.group h2 .cnt{
  font-size:11px;font-weight:900;color:#fff;background:var(--ink);
  padding:2px 9px;border-radius:99px;box-shadow:0 0 0 2.5px #fff;
}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:20px}
.cell{margin:0;display:flex;flex-direction:column;align-items:center;gap:9px}
.cell .stk{
  width:96px;height:96px;border-radius:20px;border:2.5px solid var(--cut);
  display:flex;align-items:center;justify-content:center;box-shadow:var(--stk);
  transition:transform .18s cubic-bezier(.34,1.56,.64,1);
}
.cell .stk svg{width:74%;height:74%;display:block}
.cell .stk:hover{transform:translateY(-4px)}
.cell figcaption{display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center}
.cell .nm{font-size:12px;font-weight:800;line-height:1.35}
.cell code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;color:var(--ink-3)}
footer{max-width:1240px;margin:0 auto;font-size:11.5px;color:var(--ink-3);line-height:1.8;
  border-top:2px dashed var(--line);padding-top:18px}
footer code{font-family:ui-monospace,Menlo,Consolas,monospace;background:var(--paper-2);padding:1px 6px;border-radius:5px}
</style>
</head>
<body>
<header>
  <div class="kicker">Paw Park · Sprite Sheet</div>
  <h1>爪爪乐园 · 全造型一览</h1>
  <p>手绘贴纸风的全部造型。<b>资源键就是文件名</b>——代码里引用的是键，不是图；换美术、换位图格式都不需要改逻辑。</p>
  <div class="meta">共 ${total} 个造型 · 由 <code>scripts/build-sprite-sheet.mjs</code> 自动生成，加完新图重跑一次即可同步</div>
</header>
${sections.join('\n')}
<footer>
  造型源文件位于 <code>src/assets/sprites/&lt;分组&gt;/&lt;资源键&gt;.svg</code>。<br>
  切到正式位图贴图：把同名 <code>.webp</code> 放进同目录、删掉 <code>.svg</code> 即可，代码一行不用改。
</footer>
</body>
</html>
`

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, html)
console.log('sprite sheet → ' + path.relative(ROOT, OUT) + '  (' + total + ' sprites)')
