// 存档重载 + 旧存档迁移测试
const fs = require('fs');
const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'paw-park-p0.html'), 'utf8');

let fail = 0;
function ok(c, m) { if (!c) { console.log('FAIL ' + m); fail++; } else console.log('ok   ' + m); }

function fakeCtx() {
  const noop = function () {};
  return new Proxy({}, {
    get(t, p) { if (p in t) return t[p]; if (p === 'canvas') return { width: 100, height: 100 }; return noop; },
    set(t, p, v) { t[p] = v; return true; }
  });
}
function boot(seedSave) {
  const errors = [];
  // 存档注入必须发生在应用脚本之前、且在文档自身的 storage 上，
  // 所以直接往 HTML 里插一段内联脚本（beforeParse 里 setItem 不可靠）
  let page = html;
  if (seedSave) {
    const inject = '<script>try{localStorage.setItem("pawpark_p0_save",' +
      JSON.stringify(seedSave) + ')}catch(e){window.__seedErr=String(e)}<\/script>\n<script>';
    page = html.replace('<script>', inject);
  }
  const dom = new JSDOM(page, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => fakeCtx();
      window.navigator.vibrate = () => true;
      window.addEventListener('error', e => errors.push(String(e.message || e.error)));
    }
  });
  if (dom.window.__seedErr) errors.push('seed failed: ' + dom.window.__seedErr);
  return { w: dom.window, d: dom.window.document, errors };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  try {
    // ---------- 第一轮：玩一会，产出存档 ----------
    console.log('=== 第一轮：产生存档 ===');
    const A = boot(null);
    await sleep(500);
    const cellsA = () => [...A.d.querySelectorAll('.cell')];
    const itemsA = () => cellsA().map((c, i) => ({ i, el: c.querySelector('.item') })).filter(x => x.el);
    A.d.getElementById('btnDebug').click();          // 玩具链顶级×2 + 伴手礼×2
    const t3 = itemsA().filter(x => x.el.dataset.k.startsWith('toy:3'));
    ok(t3.length === 2, '第一轮：放入 2 个玩具链顶级');
    // 拖拽合成
    function dragA(from, to) {
      const el = cellsA()[from].querySelector('.item');
      A.d.elementFromPoint = () => cellsA()[to];
      const mk = t => { const e = new A.w.Event(t, { bubbles: true, cancelable: true }); Object.assign(e, { pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 }); return e; };
      el.dispatchEvent(mk('pointerdown'));
      const e2 = mk('pointermove'); e2.clientX = 90; e2.clientY = 90; A.d.dispatchEvent(e2);
      const e3 = mk('pointerup'); e3.clientX = 90; e3.clientY = 90; A.d.dispatchEvent(e3);
    }
    dragA(t3[0].i, t3[1].i);
    const catA = cellsA()[t3[1].i].querySelector('.item');
    ok(catA && catA.querySelector('.use').textContent === '8', '第一轮：合成出母体（耐久8）');
    // 点母体一次 → 耐久 7
    A.d.elementFromPoint = () => cellsA()[t3[1].i];
    const mkA = t => { const e = new A.w.Event(t, { bubbles: true, cancelable: true }); Object.assign(e, { pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 }); return e; };
    catA.dispatchEvent(mkA('pointerdown')); A.d.dispatchEvent(mkA('pointerup'));
    // 点伴手礼一次 → 金币
    const gift = itemsA().find(x => x.el.textContent.includes('🎁'));
    const gEl = cellsA()[gift.i].querySelector('.item');
    A.d.elementFromPoint = () => cellsA()[gift.i];
    gEl.dispatchEvent(mkA('pointerdown')); A.d.dispatchEvent(mkA('pointerup'));
    const saveA = A.w.localStorage.getItem('pawpark_p0_save');
    const parsedA = JSON.parse(saveA);
    ok(parsedA.gold > 0, '第一轮：已产生金币 ' + parsedA.gold);
    ok(parsedA.board.some(it => it && it.u === 7), '第一轮：存档有耐久 7 的母体');
    ok(A.errors.length === 0, '第一轮：无错误');
    console.log('     存档大小 ' + saveA.length + ' 字节');

    // ---------- 第二轮：用该存档重载 ----------
    console.log('=== 第二轮：重载存档 ===');
    const B = boot(saveA);
    await sleep(500);
    const cellsB = () => [...B.d.querySelectorAll('.cell')];
    const itemsB = () => cellsB().map((c, i) => ({ i, el: c.querySelector('.item') })).filter(x => x.el);
    ok(B.errors.length === 0, '重载无错误' + (B.errors.length ? ' -> ' + B.errors.join('|') : ''));
    ok(itemsB().length === parsedA.board.filter(Boolean).length, '棋盘物品数恢复一致 (' + itemsB().length + ')');
    ok(B.d.getElementById('vGold').textContent === String(parsedA.gold), '金币恢复 ' + B.d.getElementById('vGold').textContent);
    ok(B.d.getElementById('vGem').textContent === String(parsedA.gem), '钻石恢复 ' + B.d.getElementById('vGem').textContent);
    const catB = itemsB().find(x => x.el.textContent.includes('🏰'));
    ok(!!catB, '母体被恢复');
    ok(catB && catB.el.querySelector('.use').textContent === '7', '★ 母体耐久 7 精确保留');
    const giftB = itemsB().find(x => x.el.textContent.includes('🎁'));
    ok(!!giftB, '伴手礼被恢复');
    ok(giftB && giftB.el.classList.contains('mid'), '重载后仍带 mid 类');
    ok(B.d.getElementById('staminaSub').textContent.length > 0, '体力副行已渲染');

    // ---------- 第三轮：旧存档迁移（缺 u + 孤儿物品 + 缺 supply）----------
    console.log('=== 第三轮：旧存档迁移 ===');
    const legacy = {
      v: 3,
      board: new Array(63).fill(null),
      stamina: 50, regenAt: Date.now(), bonusClaimed: {},
      gold: 999, gem: 5, exp: 0, level: 1,
      unlocked: { toy: true, care: true, food: false },   // 故意缺 supply
      orders: [], merges: 0, gensMade: 0
    };
    legacy.board[0] = { c: 'toy', l: 4 };                  // 母体但缺 u
    legacy.board[1] = { c: 'supply', l: 2 };               // 中段发射器但缺 u
    legacy.board[2] = { c: 'ghost', l: 9 };                // 孤儿物品（链已不存在）
    legacy.board[3] = { c: 'toy', l: 1, u: 99 };           // 普通物品带着脏 u
    legacy.board[4] = { c: 'toy', l: 2 };
    const C = boot(JSON.stringify(legacy));
    await sleep(500);
    console.log('     [debug] vGold=' + C.d.getElementById('vGold').textContent +
                ' vGem=' + C.d.getElementById('vGem').textContent +
                ' 棋盘=' + JSON.stringify([...C.d.querySelectorAll('.cell')].map((c, i) => c.querySelector('.item') ? i + ':' + c.querySelector('.item').dataset.k : null).filter(Boolean)));
    ok(C.errors.length === 0, '迁移无错误' + (C.errors.length ? ' -> ' + C.errors.join('|') : ''));
    const cellsC = () => [...C.d.querySelectorAll('.cell')];
    const itC = i => cellsC()[i].querySelector('.item');
    ok(!!itC(0) && itC(0).querySelector('.use').textContent === '8', '缺 u 的母体被补满为 8');
    ok(!!itC(1) && itC(1).querySelector('.use').textContent === '18', '缺 u 的中段发射器被补满为 18');
    ok(!itC(2), '孤儿物品 ghost:9 已被清除');
    ok(!!itC(3) && !itC(3).querySelector('.use'), '普通物品的脏 u=99 已被清掉（无耐久徽标）');
    ok(!!itC(4), '正常物品保留');
    ok(C.d.getElementById('vGold').textContent === '999', '旧存档金币保留 999');
    C.d.getElementById('btnTree').click();
    ok(/礼包链[\s\S]*已解锁/.test(C.d.getElementById('treeBody').textContent), '缺失的 supply 解锁标记被补为「已解锁」');
    const svC = JSON.parse(C.w.localStorage.getItem('pawpark_p0_save'));
    ok(svC.unlocked.supply === true, '回写存档含 supply:true');

    console.log('');
    console.log(fail === 0 ? '*** 存档测试全部通过 ***' : '*** ' + fail + ' 项失败 ***');
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.log('EXCEPTION: ' + (e && e.stack || e));
    process.exit(2);
  }
})();
