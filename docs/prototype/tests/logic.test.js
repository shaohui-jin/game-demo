// 纯逻辑测试：把 HTML 里的「链定义 + 读取函数」区段抽出来直接跑，不依赖 DOM。
// 覆盖：链长度 / kind 判定 / 耐久 / 掉落表结构 / 概率分布 / 数值区间 / 甲规则。
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'paw-park-p0.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const i = html.indexOf('<script>'), j = html.lastIndexOf('</script>');
const lines = html.slice(i + 8, j).split('\n');

// 截取纯逻辑区：从体力常量到 canvas 初始化之前（此区间只有函数定义，无 DOM 调用）
const a = lines.findIndex(l => l.includes('var STAMINA_MAX'));
const b = lines.findIndex(l => l.includes('var fx = $('));
if (a < 0 || b < 0 || b <= a) { console.log('FAIL 无法定位纯逻辑区段'); process.exit(1); }

const corePath = path.join(__dirname, '_core.tmp.js');
fs.writeFileSync(corePath,
  lines.slice(a, b).join('\n') +
  '\nmodule.exports={CHAINS,BASE_SPAWNERS,CHAIN_ORDER,TREE_ORDER,itemsLen,maxLv,defOf,isClickable,fullCharges,makeItem,rollDrops,rollRange,dropsDesc,isResDrop,isTop};\n');

const C = require(corePath);
fs.unlinkSync(corePath);

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('FAIL ' + m); fail++; } else console.log('ok   ' + m); };
const MAXLV = { toy: 4, care: 4, food: 4, supply: 2 };

console.log('=== 1. 链结构与终点 ===');
ok(C.maxLv('toy') === 4 && C.maxLv('care') === 4 && C.maxLv('food') === 4, '玩具/护理/食物链 maxLv=4（3 物品 + 1 顶端）');
ok(C.maxLv('supply') === 2, '礼包链 maxLv=2（无顶端，Lv2 即终点）');
ok(C.defOf('supply', 3) === null, '礼包链 Lv3 无定义');
ok(C.defOf('ghost', 9) === null, '未知链 defOf 返回 null（不抛错）');
ok(C.maxLv('ghost') === 0, '未知链 maxLv 返回 0');
ok(C.CHAIN_ORDER.length === 3 && C.CHAIN_ORDER.indexOf('supply') === -1, '礼包链不进订单池');
ok(C.TREE_ORDER.indexOf('supply') !== -1, '礼包链在链树面板展示');

console.log('=== 2. kind 判定 ===');
ok(C.defOf('toy', 1).kind === 'item', 'toy Lv1 = item（普通物品）');
ok(C.defOf('toy', 4).kind === 'generator', 'toy Lv4 = generator（顶端母体）');
ok(C.defOf('food', 4).kind === 'final', 'food Lv4 = final（纯任务物品）');
ok(C.defOf('supply', 1).kind === 'producer', 'supply Lv1 = producer（链中段发射器）');
ok(C.defOf('supply', 2).kind === 'producer', 'supply Lv2 = producer');
ok(C.isClickable(C.defOf('supply', 1)) && C.isClickable(C.defOf('supply', 2)), '中段发射器可点击');
ok(!C.isClickable(C.defOf('toy', 1)) && C.isClickable(C.defOf('toy', 4)), '普通物品不可点 / 母体可点');
ok(!C.isClickable(C.defOf('food', 4)), '纯任务物品不可点击');

console.log('=== 3. 耐久（generator 与 producer 统一从 d.charges 读）===');
ok(C.fullCharges(C.defOf('toy', 4)) === 8, '猫城堡 8 次');
ok(C.fullCharges(C.defOf('care', 4)) === 8, '美容台 8 次');
ok(C.fullCharges(C.defOf('supply', 1)) === 8, '伴手礼 8 次');
ok(C.fullCharges(C.defOf('supply', 2)) === 18, '豪华礼盒 18 次');
ok(C.makeItem('toy', 4).u === 8 && C.makeItem('supply', 2).u === 18, 'makeItem 给发射器带上满耐久');
ok(C.makeItem('toy', 1).u === undefined, 'makeItem 不给普通物品写耐久');

console.log('=== 4. 掉落表结构（produce 读 d.drops，两种发射器都必须有）===');
ok(Array.isArray(C.defOf('toy', 4).drops), 'generator.drops 存在');
ok(Array.isArray(C.defOf('care', 4).drops), 'care 母体 drops 存在');
ok(Array.isArray(C.defOf('supply', 1).drops), 'producer.drops 存在（关键：曾因挂在 click 下而崩溃）');
ok(Array.isArray(C.defOf('supply', 2).drops), 'producer Lv2 drops 存在');
ok(C.defOf('food', 4).drops === undefined, 'final 无 drops');
ok(C.defOf('toy', 1).drops === undefined, '普通物品无 drops');
ok(C.defOf('toy', 4).produces === 'care' && C.defOf('care', 4).produces === 'food', '母体 produces 指向下一条链');

console.log('=== 5. 概率分布（N=200,000）===');
const N = 200000;
function dist(table) {
  const c = {};
  for (let k = 0; k < N; k++) {
    const d = C.rollDrops(table);
    const key = d.gold ? 'gold' : d.gem ? 'gem' : d.c + ':' + d.l;
    c[key] = (c[key] || 0) + 1;
  }
  const o = {};
  Object.keys(c).forEach(key => o[key] = c[key] / N * 100);
  return o;
}
const d1 = dist(C.defOf('toy', 4).drops);
console.log('     猫城堡  ' + JSON.stringify(d1));
ok(Math.abs(d1['care:1'] - 82) < 1 && Math.abs(d1['care:2'] - 15) < 1 && Math.abs(d1['care:3'] - 3) < 1, '猫城堡 82 / 15 / 3');
const d2 = dist(C.defOf('supply', 2).drops);
console.log('     豪华礼盒 ' + JSON.stringify(d2));
ok(Math.abs(d2['gold'] - 92) < 1 && Math.abs(d2['gem'] - 8) < 1, '礼盒 金币 92 / 钻石 8');
const d3 = dist(C.BASE_SPAWNERS[0].drops);
console.log('     玩具架  ' + JSON.stringify(d3));
ok(Math.abs(d3['toy:1'] - 88) < 1 && Math.abs(d3['supply:1'] - 12) < 1, '玩具架 玩具 88 / 礼包 12');
ok(C.BASE_SPAWNERS[0].drops.reduce((s, x) => s + x.w, 0) === 100, '玩具架权重合计 100');

console.log('=== 6. 数值区间 ===');
let mn = 1e9, mx = -1e9;
for (let k = 0; k < 50000; k++) { const v = C.rollRange([15, 40]); mn = Math.min(mn, v); mx = Math.max(mx, v); }
ok(mn === 15 && mx === 40, '金币 15~40 两端可达（实测 ' + mn + '~' + mx + '）');
mn = 1e9; mx = -1e9;
for (let k = 0; k < 5000; k++) { const v = C.rollRange([1, 1]); mn = Math.min(mn, v); mx = Math.max(mx, v); }
ok(mn === 1 && mx === 1, '钻石固定 1');
for (let k = 0; k < 5000; k++) { const v = C.rollRange([40, 110]); if (v < 40 || v > 110) { ok(false, '金币 40~110 越界'); break; } }
ok(true, '金币 40~110 始终在界内');

console.log('=== 7. 资源掉落识别 ===');
ok(C.isResDrop({ gold: [15, 40], w: 100 }) && C.isResDrop({ gem: [1, 1], w: 8 }), 'gold / gem 识别为资源（不进棋盘）');
ok(!C.isResDrop({ c: 'care', l: 1, w: 82 }), '物品掉落不识别为资源');

console.log('=== 8. 甲规则（合并后耐久重置为满）===');
// 与 merge() 实现逐行一致的算法，含 typeof 守卫
function mergeCalc(chainKey, lv, uA, uB) {
  const dFrom = C.defOf(chainKey, lv), dNext = C.defOf(chainKey, lv + 1);
  const itA = { c: chainKey, l: lv }, itB = { c: chainKey, l: lv };
  if (uA !== undefined) itA.u = uA;
  if (uB !== undefined) itB.u = uB;
  let spent = 0;
  if (C.isClickable(dNext)) {
    const fullFrom = C.fullCharges(dFrom);
    if (typeof itA.u === 'number') spent += Math.max(0, fullFrom - itA.u);
    if (typeof itB.u === 'number') spent += Math.max(0, fullFrom - itB.u);
  }
  const newIt = { c: chainKey, l: lv + 1 };
  if (C.isClickable(dNext)) newIt.u = C.fullCharges(dNext);
  return { u: newIt.u, spent };
}
let r = mergeCalc('supply', 1, 1, 1);
ok(r.u === 18 && r.spent === 14, '伴手礼 各剩 1 次 → 礼盒耐久 18、白赚 14 次');
r = mergeCalc('supply', 1, 8, 8);
ok(r.u === 18 && r.spent === 0, '未点击过就合成 → 回满 18、白赚 0');
r = mergeCalc('supply', 1, 3, 5);
ok(r.u === 18 && r.spent === 8, '剩 3 + 剩 5 → 白赚 8 次');
r = mergeCalc('toy', 3, undefined, undefined);
ok(r.u === 8 && r.spent === 0, '铃铛球（无耐久）→ 母体 8 次、白赚 0（typeof 守卫生效）');
r = mergeCalc('care', 3, undefined, undefined);
ok(r.u === 8 && r.spent === 0, '洗澡球 → 美容台 8 次、白赚 0');
r = mergeCalc('toy', 1, undefined, undefined);
ok(r.u === undefined && r.spent === 0, '毛线球 → 逗猫棒：非发射器，不带耐久');
r = mergeCalc('food', 3, undefined, undefined);
ok(r.u === undefined && r.spent === 0, '鲜鱼排 → 豪华鲜食（final）：不带耐久');

console.log('=== 9. 面板文案 ===');
console.log('     礼包链 Lv2 : ' + C.dropsDesc(C.defOf('supply', 2).drops));
console.log('     礼包链 Lv1 : ' + C.dropsDesc(C.defOf('supply', 1).drops));
console.log('     猫城堡     : ' + C.dropsDesc(C.defOf('toy', 4).drops));
console.log('     玩具架     : ' + C.dropsDesc(C.BASE_SPAWNERS[0].drops));
ok(C.dropsDesc(C.defOf('supply', 2).drops).indexOf('92%') !== -1, '文案含权重百分比');

console.log('');
console.log(fail === 0 ? '*** 逻辑测试全部通过 ***' : '*** ' + fail + ' 项失败 ***');
process.exit(fail ? 1 : 0);
