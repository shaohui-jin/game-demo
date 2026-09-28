// 一键跑全部测试。
// 用法：
//   node tests/run-all.js
// 若 jsdom 不在当前解析路径下，可用环境变量指定：
//   JSDOM_PATH=<...>/node_modules/jsdom node tests/run-all.js
const { spawnSync } = require('child_process');
const path = require('path');

const suites = [
  ['纯逻辑（链结构 / 掉落 / 甲规则）', 'logic.test.js'],
  ['冒烟（启动 / 交互 / 自动合成循环）', 'smoke.test.js'],
  ['存档（重载 / 旧存档迁移）', 'save.test.js'],
];

let failed = 0;
for (const [name, file] of suites) {
  console.log('\n' + '='.repeat(62));
  console.log('▶ ' + name + '  (' + file + ')');
  console.log('='.repeat(62));
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) { failed++; console.log('✗ 该套件失败（exit ' + r.status + '）'); }
  else console.log('✓ 该套件通过');
}

console.log('\n' + '='.repeat(62));
console.log(failed === 0 ? '*** 全部套件通过 ***' : '*** ' + failed + ' 个套件失败 ***');
process.exit(failed ? 1 : 0);
