// jsdom 启动 + 交互冒烟测试
// 覆盖：启动 / 渲染 / 链树面板 / 发射器 CD / 拖拽合成 / 母体产出 / 礼包链产货币 /
//       甲规则 / 蛛网（金币清除 + 牺牲清除）/ 存档往返 / 体力与冷却拦截 / 重置
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'paw-park-p0.html'), 'utf8');
const errors = [];
const MAXLV = { toy: 4, care: 4, food: 4, supply: 2 };

function fakeCtx() {
  const noop = function () {};
  return new Proxy({}, {
    get(t, p) { if (p in t) return t[p]; if (p === 'canvas') return { width: 100, height: 100 }; return noop; },
    set(t, p, v) { t[p] = v; return true; }
  });
}

// 存档注入必须发生在应用脚本之前、且在文档自身的 storage 上，
// 所以直接往 HTML 里插一段内联脚本（beforeParse 里 setItem 不可靠）
function makePage(seedSave) {
  if (!seedSave) return html;
  // 注意：必须注入成「字符串字面量」。直接 JSON.stringify 一个对象会得到对象字面量，
  // setItem 会把它强制转成 "[object Object]" 存进去，页面再读就解析失败。
  const json = (typeof seedSave === 'string') ? seedSave : JSON.stringify(seedSave);
  const inject = '<script>try{localStorage.setItem("pawpark_p0_save",' +
    JSON.stringify(json) + ')}catch(e){window.__seedErr=String(e)}<\/script>\n<script>';
  // 用函数式替换，避免 $& / $1 之类的替换模式被意外展开
  return html.replace('<script>', () => inject);
}

function boot(seedSave) {
  const errs = [];
  const dom = new JSDOM(makePage(seedSave), {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); };
      window.navigator.vibrate = function () { return true; };
      window.addEventListener('error', e => errs.push('window.onerror: ' + (e.message || e.error)));
    }
  });
  if (dom.window.__seedErr) errs.push('seed failed: ' + dom.window.__seedErr);
  return { w: dom.window, d: dom.window.document, errors: errs };
}

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('FAIL ' + m); fail++; } else console.log('ok   ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const A = boot(null);
  const w = A.w, d = A.d;
  const $ = id => d.getElementById(id);
  const cells = () => [...d.querySelectorAll('.cell')];
  const items = () => cells().map((c, i) => ({ i, el: c.querySelector('.item') })).filter(x => x.el);
  const webs = () => cells().map((c, i) => ({ i, el: c.querySelector('.web') })).filter(x => x.el);
  const stamina = () => parseInt($('vStamina').textContent, 10);
  const gold = () => parseInt($('vGold').textContent, 10);
  const key = el => (el.dataset.k || '').split(':').slice(0, 2).join(':');
  const use = el => { if (!el) return null; const u = el.querySelector('.use'); return u ? parseInt(u.textContent, 10) : null; };
  const toastText = () => $('toast').textContent;
  const webPriceShown = () => { const p = d.querySelector('.web .wp'); return p ? parseInt(p.textContent, 10) : null; };

  function pointer(el, type, x, y) {
    const e = new w.Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { pointerType: 'mouse', button: 0, clientX: x, clientY: y });
    (type === 'pointerdown' ? el : d).dispatchEvent(e);
  }
  function tapEl(el, idx) {
    if (!el) return false;
    d.elementFromPoint = () => cells()[idx];
    pointer(el, 'pointerdown', 500, 500);
    pointer(el, 'pointerup', 500, 500);
    return true;
  }
  const tap = idx => tapEl(cells()[idx].querySelector('.item'), idx);
  const tapWeb = idx => tapEl(cells()[idx].querySelector('.web'), idx);
  function drag(from, to) {
    const el = cells()[from].querySelector('.item');
    if (!el) return false;
    d.elementFromPoint = () => cells()[to];
    pointer(el, 'pointerdown', 100, 100);
    pointer(el, 'pointermove', 160, 160);
    pointer(el, 'pointerup', 160, 160);
    return true;
  }

  try {
    await sleep(600);
    console.log('=== A. 启动无错误 ===');
    ok(A.errors.length === 0, '启动期无 JS 错误' + (A.errors.length ? ' -> ' + A.errors.join(' | ') : ''));

    console.log('=== B. 基础渲染 ===');
    ok(cells().length === 63, '棋盘 63 格');
    ok(d.querySelectorAll('.cell.locked').length === 28, '锁定 28 格 (4行×7)');
    ok(webs().length === 0, '开局无蛛网');
    const sps = [...d.querySelectorAll('#spawners .spawner')];
    ok(sps.length === 2, '主要发射器 2 个');
    console.log('     文案: ' + sps.map(s => s.querySelector('.nm').textContent + ' → ' +
      s.querySelector('.cost').textContent + ' [' + s.querySelector('.cdchip').textContent + ']').join('  ||  '));
    ok(/毛线球/.test(sps[0].textContent), '发射器显示主掉落物 毛线球');
    ok(sps[0].querySelector('.cdchip').textContent === '4s', '玩具架冷却徽标 4s');
    ok(sps[1].querySelector('.cdchip').textContent === '10s', '玩具箱冷却徽标 10s');
    ok(/38%/.test(sps[1].title), '玩具箱 title 显示礼包率 38%（差异化）');
    ok($('vGem').textContent === '60', '初始钻石 60');
    ok(items().length === 4, '初始 4 个种子');

    console.log('=== C. 链树面板 ===');
    $('btnTree').click();
    const tree = $('treeBody').textContent;
    ok(/玩具链/.test(tree) && /护理链/.test(tree) && /食物链/.test(tree) && /礼包链/.test(tree), '四条链全部展示');
    ok(/中段发射器/.test(tree), '礼包链标为「中段发射器」');
    ok(/顶端母体/.test(tree), '玩具链标为「顶端母体」');
    ok(/顶级任务/.test(tree), '食物链标为「顶级任务」');
    ok(/重置为满/.test(tree), '面板说明包含「重置为满」');
    ok(/⚡/.test(tree), '可点击等级带 ⚡ 标记');
    ok(/掉落表/.test(tree), '母体说明含掉落表');
    ok(!/两个同级母体可合成升级/.test($('tree').textContent), '弹窗副标题已删除旧的错误描述');
    $('btnTreeClose').click();
    ok(!$('tree').classList.contains('on'), '链树面板可关闭');

    console.log('=== D. 主要发射器 CD ===');
    const st0 = stamina(), f0 = items().length;
    sps[0].click();
    ok(stamina() === st0 - 1, '点击玩具架消耗 1 体力 ' + st0 + ' -> ' + stamina());
    ok(items().length === f0 + 1, '棋盘物品 +1 (' + f0 + ' -> ' + items().length + ')');
    ok(sps[0].classList.contains('cooling'), '玩具架进入冷却状态');
    ok(!sps[1].classList.contains('cooling'), '玩具箱不受影响（各自独立 CD）');
    const cdt = sps[0].querySelector('.cdmask .cdt').textContent;
    ok(/^\d+\.\ds$/.test(cdt), '冷却遮罩显示倒计时 "' + cdt + '"');
    const bar = sps[0].querySelector('.cdmask').style.getPropertyValue('--p');
    ok(bar !== '' && parseFloat(bar) >= 0 && parseFloat(bar) <= 100, '冷却进度条 --p=' + bar);

    const st1 = stamina(), f1 = items().length;
    sps[0].click();
    ok(stamina() === st1 && items().length === f1, '冷却中再次点击被拦截（体力与物品都没变）');
    ok(/冷却中/.test(toastText()), '提示「冷却中」 -> "' + toastText() + '"');

    sps[1].click();
    ok(stamina() === st1 - 1, '冷却中仍可点击另一个发射器（玩具箱）');
    ok(items().length === f1 + 1, '玩具箱正常产出');
    ok(sps[1].classList.contains('cooling'), '玩具箱进入冷却');

    await sleep(4300);
    ok(!sps[0].classList.contains('cooling'), '4 秒后玩具架冷却结束');
    const st2 = stamina();
    sps[0].click();
    ok(stamina() === st2 - 1, '冷却结束后可再次点击');

    console.log('=== E. 拖拽合成出母体 ===');
    $('btnFill').click();
    const f2 = items().length;
    $('btnDebug').click();
    ok(items().length === f2 + 4, '调试按钮放入 4 个素材 (' + f2 + ' -> ' + items().length + ')');
    ok(webs().length === 1, '调试按钮同时落下一张蛛网');
    const toy3 = items().filter(x => key(x.el) === 'toy:3');
    ok(toy3.length === 2, '玩具链顶级 ×2');
    drag(toy3[0].i, toy3[1].i);
    const catCell = toy3[1].i;
    const cat = cells()[catCell].querySelector('.item');
    ok(cat && cat.textContent.includes('🏰'), '合成出猫城堡 🏰');
    ok(cat && cat.classList.contains('gen') && cat.classList.contains('ready'), '母体带 gen+ready 类');
    ok(use(cat) === 8, '母体耐久徽标 8');
    ok(!cells()[toy3[0].i].querySelector('.item'), '源格已清空');

    console.log('=== F. 母体点击 → 产出下一条链 ===');
    const care0 = items().filter(x => /🪮|✂️|🛁/.test(x.el.textContent)).length;
    tap(catCell);
    await sleep(320);
    const cat2 = cells()[catCell].querySelector('.item');
    ok(use(cat2) === 7, '耐久 8 -> 7 (实测 ' + use(cat2) + ')');
    const care1 = items().filter(x => /🪮|✂️|🛁/.test(x.el.textContent)).length;
    ok(care1 > care0, '产出护理链物品 ' + care0 + ' -> ' + care1);
    ok(/护理链/.test(toastText()), '解锁提示出现 -> "' + toastText() + '"');
    ok(!cells()[catCell].classList.contains('cooling'), '母体没有 CD（只有主要发射器有）');

    console.log('=== G. 礼包链：中段发射器点击产货币 ===');
    let sup = items().filter(x => /🎁/.test(x.el.textContent));
    if (sup.length < 2) { $('btnDebug').click(); sup = items().filter(x => /🎁/.test(x.el.textContent)); }
    ok(sup.length >= 2, '伴手礼 ≥2 (实测 ' + sup.length + ')');
    const g0 = gold(), u0 = use(sup[0].el);
    tap(sup[0].i);
    const g1 = gold();
    ok(g1 > g0, '金币增加 ' + g0 + ' -> ' + g1 + ' (增量 ' + (g1 - g0) + ')');
    ok(g1 - g0 >= 15 && g1 - g0 <= 40, '增量落在 15~40 区间');
    const s0el = cells()[sup[0].i].querySelector('.item');
    ok(use(s0el) === u0 - 1, '★ 耐久徽标实时刷新 ' + u0 + ' -> ' + use(s0el));
    ok(s0el.classList.contains('mid'), '中段发射器带 mid 类（虚线边框）');
    ok($('stGold').textContent.indexOf(String(g1)) >= 0, 'HUD 金币数值同步');

    console.log('=== H. 甲规则：合并后耐久重置为满 ===');
    sup = items().filter(x => /🎁/.test(x.el.textContent)).slice(0, 2);
    for (const s of sup) {
      let guard = 0;
      while (guard++ < 20) {
        const el = cells()[s.i].querySelector('.item');
        if (!el || use(el) <= 1) break;
        tap(s.i);
      }
    }
    const uA = use(cells()[sup[0].i].querySelector('.item'));
    const uB = use(cells()[sup[1].i].querySelector('.item'));
    ok(uA === 1 && uB === 1, '两件都点剩 1 次 (实测 ' + uA + ' / ' + uB + ')');
    drag(sup[0].i, sup[1].i);
    const box = cells()[sup[1].i].querySelector('.item');
    ok(box && box.textContent.includes('🎀'), '合成出豪华礼盒 🎀');
    ok(use(box) === 18, '★ 甲规则生效：耐久重置为满 18（而非 1+1=2）实测 ' + use(box));
    await sleep(520);
    ok(/白赚/.test(toastText()), '弹出「白赚」隐藏福利提示');
    ok(/14/.test(toastText()), '白赚次数正确显示为 14');

    console.log('=== I. 蛛网障碍 ===');
    let ws = webs();
    if (!ws.length) { $('btnDebug').click(); ws = webs(); }
    ok(ws.length >= 1, '棋盘上有蛛网 (实测 ' + ws.length + ')');
    const wi = ws[0].i;
    ok(webPriceShown() !== null, '蛛网显示清除价 ' + webPriceShown() + ' 🪙');
    const price0 = webPriceShown();
    ok(price0 === 20, '首张蛛网价格 = 基础价 20');
    ok(cells()[wi].querySelector('.item') === null, '蛛网格上没有物品');
    ok(cells()[wi].classList.contains('webbed'), '蛛网格带 webbed 类');

    // 攒够清除所需金币（点礼包链）
    if (gold() < price0) {
      const gift = items().find(x => /🎁|🎀/.test(x.el.textContent));
      if (gift) { let k = 0; while (gold() < price0 && k++ < 12) tap(gift.i); }
    }
    ok(gold() >= price0, '已攒够清除所需金币 (' + gold() + ' ≥ ' + price0 + ')');

    // 方式一：轻点蛛网 → 花金币清除
    const gBefore = gold(), wsBefore = webs().length;
    tapWeb(wi);
    ok(webs().length === wsBefore - 1, '★ 轻点蛛网 → 蛛网被清除 (' + wsBefore + ' -> ' + webs().length + ')');
    ok(gold() === gBefore - price0, '★ 扣除金币 ' + gBefore + ' -> ' + gold() + '（- ' + price0 + '）');
    ok(!cells()[wi].classList.contains('webbed'), '格子恢复可用');
    ok(webPriceShown() === price0 + 15, '★ 清除价递增：' + price0 + ' -> ' + webPriceShown());

    // 方式二：拖物品到蛛网上 → 牺牲物品清除
    $('btnDebug').click();
    const ws2 = webs();
    ok(ws2.length >= 1, '再次落下蛛网 (实测 ' + ws2.length + ')');
    const wi2 = ws2[0].i;
    const victim = items().find(x => !x.el.classList.contains('gen'));
    ok(!!victim, '找到可用于牺牲的普通物品');
    const itemsBefore = items().length, goldBefore = gold();
    drag(victim.i, wi2);
    ok(webs().length === ws2.length - 1, '★ 拖物品上蛛网 → 蛛网被清除');
    ok(!cells()[victim.i].querySelector('.item'), '★ 该物品被牺牲（源格已空）');
    ok(items().length === itemsBefore - 1, '棋盘物品数 -1 (' + itemsBefore + ' -> ' + items().length + ')');
    ok(gold() === goldBefore, '牺牲路径不花金币（' + goldBefore + ' 未变）');

    console.log('=== J. 存档往返 ===');
    const sv = JSON.parse(w.localStorage.getItem('pawpark_p0_save'));
    ok(sv.v === 3, '存档版本 v=3');
    ok(sv.unlocked.supply === true, '存档中礼包链已解锁');
    ok(Array.isArray(sv.spawnCd) && sv.spawnCd.length === 2, '存档记录发射器 CD');
    ok(Array.isArray(sv.web) && sv.web.length === 63, '存档记录蛛网');
    ok(sv.websCleared === 2, '存档记录已清除蛛网数 = 2 (实测 ' + sv.websCleared + ')');
    ok(typeof sv.produces === 'number' && sv.produces > 0, '存档记录累计产出数 ' + sv.produces);
    ok(sv.gold > 0, '存档记录金币 ' + sv.gold);
    ok(sv.board.some(it => it && it.u === 18), '存档记录耐久 18 的发射器');
    ok(!sv.board.some(it => it && it.c === 'toy' && it.l === 1 && it.u !== undefined), '普通物品不写耐久字段');
    ok(!sv.board.some((it, i) => it && sv.web[i]), '存档中不存在"有物品又被盖网"的矛盾状态');

    console.log('=== K. 重置 ===');
    w.confirm = () => true;
    $('btnReset').click();
    const sv2 = JSON.parse(w.localStorage.getItem('pawpark_p0_save'));
    ok(sv2.gold === 0 && sv2.gem === 60, '重置后货币归零 (金币 ' + sv2.gold + ' / 钻石 ' + sv2.gem + ')');
    ok(items().length === 4, '重置后只剩 4 个初始种子');
    ok(webs().length === 0, '重置后无蛛网');
    ok(sv2.websCleared === 0 && sv2.produces === 0, '重置后计数归零');
    ok(sv2.unlocked.supply === true, '重置后礼包链仍可用');
    ok(!d.querySelector('#spawners .spawner.cooling'), '重置后发射器无冷却');
  } catch (e) {
    console.log('EXCEPTION: ' + (e && e.stack || e));
    fail++;
  }

  // ---------- 体力拦截：用注入存档把体力设为 0 ----------
  console.log('=== L. 体力为 0 时的拦截（注入存档） ===');
  try {
    const B = boot({
      v: 3, board: new Array(63).fill(null), stamina: 0, regenAt: Date.now(), bonusClaimed: {},
      gold: 0, gem: 60, exp: 0, level: 1,
      unlocked: { toy: true, care: false, food: false, supply: true },
      orders: [], merges: 0, gensMade: 0, spawnCd: [0, 0],
      web: new Array(63).fill(false), websCleared: 0, produces: 0
    });
    await sleep(500);
    ok(B.errors.length === 0, '注入存档启动无错误');
    const d2 = B.d, w2 = B.w;
    ok(d2.getElementById('vStamina').textContent === '0/100', '体力已注入为 0');
    const sp = d2.querySelector('#spawners .spawner');
    ok(!sp.classList.contains('cooling'), '该发射器不在冷却（隔离变量）');
    const before = d2.querySelectorAll('.cell .item').length;
    sp.click();
    const after = d2.querySelectorAll('.cell .item').length;
    ok(after === before, '体力为 0 时点击被拦截，未产出物品');
    ok(/体力不足/.test(d2.getElementById('toast').textContent),
       '提示「体力不足」 -> "' + d2.getElementById('toast').textContent + '"');
    ok(w2.localStorage.getItem('pawpark_p0_save') !== null, '存档已写入');
  } catch (e) {
    console.log('EXCEPTION(L): ' + (e && e.stack || e));
    fail++;
  }

  console.log('');
  console.log('=== 运行期错误汇总 ===');
  if (errors.length) { errors.forEach(e => console.log('  ' + e)); fail++; }
  else console.log('  无');
  console.log('');
  console.log(fail === 0 ? '*** 冒烟测试全部通过 ***' : '*** ' + fail + ' 项失败 ***');
  process.exit(fail ? 1 : 0);
})();
