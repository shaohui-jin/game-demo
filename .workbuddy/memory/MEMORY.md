# 《爪爪乐园》项目长期记忆

> 历史决策记录（技术栈选型、P0 踩坑、格子解锁决策等）还在 **`.workbuddy-ai/memory/MEMORY.md`**。
> 本文件是当前规范位置，只记**跨会话必须遵守的约定与架构事实**。两份并存待合并。

## 工程约定

- **技术栈**：Vue3 + TypeScript + Pinia + Vite（纯 Web，非游戏引擎）。玩法逻辑与 DOM 严格分离，`src/game/*.ts` 可单测。
- **文档格式**：分析与待裁定清单一律输出 **Markdown**，不再生成 HTML 文档。HTML 只作为**输入素材**保留（`docs/爪爪乐园-游戏设计方案.html`、`docs/肥鹅健身房-玩法机制拆解.html`）。
- **改完玩法逻辑必须跑 `npx vitest run`**。静态检查与纯逻辑仿真查不出 DOM 层与时序问题。
- 长命令必须显式给 `timeout` 并重定向到文件；`rm -rf` 在本沙箱会被 SIGTERM 掐断，改用 PowerShell `Remove-Item`。

## 协作偏好（用户明确要求，务必遵守）

- **视觉类任务先出「能看的成品」，再谈工程验证。** 用户原话：「我不需要你做什么截图、做什么类型检，我就要看设计图」。
  正确顺序：**先出 HTML 视觉稿 → 立刻 present 给用户 → 方向确认后再落地工程**。
  分片截图、jsdom 校验、typecheck/build 这些是**自己的验证手段，不要当成交付内容向用户汇报**，更不要因此拖延出图。
- 用户要的是**结果**，不是过程。汇报只说「做完了什么 / 在哪」，别复述验证步骤。
- **设计稿要单文件、自包含、浏览器直接打开**（内联造型，不依赖外部资源与构建）。

## 视觉规范（2026-10-02 定稿）

- **风格：手绘贴纸风**（模切白边 + 硬落影 + 暖米纸底噪点；**不加随机错位**，理由见下）。
  曾评估过「低饱和治愈系」，用户改选贴纸风，**以贴纸风为准**。
- **贴图架构**：`src/assets/sprites/**` 放造型文件，`src/ui/sprites.ts` 用 `import.meta.glob` 自动收集，
  **资源键 = 文件名**；换 `webp` 只需丢文件、删 `svg`，代码一行不改。
  `src/ui/SpriteIcon.vue` 三级降级：贴图 → 加载失败 → emoji 兜底。**emoji 字段永远保留**。
- 若将来要重新启用旋转，必须用 CSS **`rotate` 属性**而不是 `transform: rotate()`
  —— 拖拽直写 `style.transform`，挂在 transform 上的旋转会被擦掉。
- **模切白边必须用 `border`**（不是 box-shadow / outline），否则状态类覆盖阴影时白边会一起消失。
- 纸面噪点做 **body 静态背景层**，不要用全屏 `mix-blend-mode` 叠加层（每帧整屏合成，中低端安卓掉帧）。
- `style.css` 末尾的「贴纸风换肤层」**只覆盖视觉属性**，可整体删掉回滚。
- ★ **换肤规则永远写在 `style.css` 最末尾**。CSS 是后写的赢，任何在换肤层之后追加的组件样式
  都会盖掉换肤效果（背包抽屉、图鉴就踩过这个坑，已补「换肤层（续）」）。
  新增组件时要么复用已有类名，要么把换肤规则追加到文件最后。
- `.spr` 用 `display:inline-block`（不是 block）：在 flex 容器里会被自动块化、行为不变，
  但这样它在**行内文字**里也能用（图鉴的「图标 + 名字」就是这么写的）。
- **状态环一律用 `outline`，不要用 `box-shadow`** —— box-shadow 位要留给贴纸落影，
  覆盖它会连带丢掉投影。
- ★ **不要给功能性元素加随机旋转**。用户实测反馈原话：「现在有的地方歪歪扭扭的，不好看」。
  把 ±1~3° 铺到币条 / 按钮 / 卡片 / 列表行 / 棋盘物品上，观感不是"手作感"而是**像渲染坏了**；
  带文字的元素一歪就像出错，棋盘倾斜还会明显拖慢扫读。
  **口径：旋转只保留在「物理上就是一张纸」的元素上 —— 胶带标题、便利贴说明。其余一律对齐。**
  贴纸的身份靠**模切白边 + 硬落影**撑就够了（这两条不可让），旋转是可选项且默认关。
  `tiltOf()` 已全项目停用，函数保留给纯展示的造型总览页。
- 唯一的例外：飞行中的物品（`useFx` 的 flyer）保留飞行期自旋 —— 那是 300~410ms 的动画，
  不是静态倾斜，去掉会让连续产出显得机械。
- **造型已全覆盖**：合成链物品 / 母体 / 设施 / 特殊道具 / 顾客 8 只 / 区域 9 个 / 装饰 11 件 / 货币状态图标
  —— 共 **59 个**，全在 `src/assets/sprites/{items,gen,spawn,tools,customers,regions,decors,icons}/`。
  `business.ts` 的 `CustomerDef` / `RegionDef` / `DecorDef` 与 `chains.ts` / `tools.ts` 一样带 `sprite` 键。
- **造型总览页**由 `node scripts/build-sprite-sheet.mjs` 生成（以文件系统为唯一事实来源，会自己扫目录），
  产出 `docs/爪爪乐园-全造型一览.html`。**加完新造型重跑一次即可同步**，不要手写这份 HTML。

## 不可违反的铁律

1. **`defOf()` / `maxLv()` / `countFacilities()` 等一切会被存档归一化流程调用的函数，对未知值或残缺 state 必须安全降级，绝不抛错** —— 异常会冒到 `load()` 外面 → **整份存档加载失败**。本项目最贵的一类故障。
2. **旧存档里"合法的 0"不能被当成"数据缺失"去补满**。典型：`charges === 0` 表示冷却型对象正在补充，读档时补满就等于"刷新页面跳过冷却"。
3. **存档单条坏数据只清它自己**，不能连累整份存档。新增字段一律按"可加字段 + 默认值"处理，**不轻易升 `SAVE_VERSION`**（升版 = 丢老玩家进度）。
4. **体力上限一律走 `staminaMax(s)`**，不要直接读 `STAMINA_MAX`（区域加成会失效）。
5. **装饰不产生任何数值收益**（设计文档 6.2 硬约束，有单测锁定）。它的价值是把审美投入变成沉没成本。
6. **区域顺序解锁**；解锁后**立刻重抽订单**（否则新档位要等最长 8h 才可见）。
7. **常驻宠物离线结算**：未达上限 `petAt += 已结算小时数`；**已达上限直接推到 now**。混用会导致同一段时间被反复结算。
8. **主场景没有锁定格**；"花金币解锁格子"只属于背包。格子压力靠「设施常驻占格 + 蛛网」。
9. **点击的节奏阀是「储备 `buffer` + 一次性冷却 `refillMs`」，不是"点一次冷却一次"**。储备归零才进冷却，由每秒 tick 的 `tickGenerators()` 补满。
10. **背包内一切冻结，冷却必须一起挂起**（`suspendCooldown` / `resumeCooldown`）。只搬不挂起 = 背包变成跳过冷却的漏洞。
11. **设施不可被销毁**（禁止蛛网牺牲 + `ensureFacilities()` 兜底），它是唯一产能源头，归零即死局。
12. **渲染性能**：拖拽位移直写 DOM `style.transform`，不走响应式；`BoardCell` 刻意不绑 `transform`（旋转走独立的 `rotate` 属性）。
13. **store 的 `board` / `web` computed 必须返回定长数组**，否则未 init 前 `web[i]` 是 `undefined`，触发 prop 警告。
14. **布局相关的 CSS 变量要挂在组件自己的容器上**（App 的 `.screen`），不要 `getElementById('app')` 去写 index.html 提供的节点 —— 测试环境里没有它，缺失即静默失效。
15. **改动链条等级 / 名字时，必须同时处理"同等级换身份"的存档迁移**：给 `GameState.depthV` 打版本、写映射函数、在读档的**物品校验之前**跑。链加深会静默把玩家的母体变成普通物品。
16. **道具要区分"需不需要目标"**（`ToolDef.target`）：`target: 'none'` 的在背包点一下直接结算，不进待用态。所有道具都"先校验再扣除"。
17. **加深合成链不能只加等级名**，必须同时重算产出速率（设施掉落表随等级上移），否则 Lv8 需要 128 个 Lv1、加速比陡到不可玩。

## 测试环境（本机内存很小，注意）

- **测试配置必须是单 worker**：`vite.config.ts` 里用 **`fileParallelism: false` + `maxWorkers: 1`**。
  整机冒烟要挂载 App 100+ 次，文件级并行会 OOM（`Fatal process out of memory`）。
  ★ `poolOptions` / `singleFork` 在 Vitest 4 之后**已被移除**，写了会报 DEPRECATED 并崩溃。
- ★ **pool 必须是 `vmThreads`**（2026-10-02 定，已写入 vite.config.ts）：本机 vitest 5.0.3 + vite 8.3.1 下，
  默认 `forks` 池报 `Vitest failed to find the runner`、`threads` 池报
  `Cannot read properties of undefined (reading 'config')`（describe 调用处即崩，最小空测试复现，
  与 node 22/24、jsdom、配置文件无关）。`vmThreads` 池完全正常，185 测试 18s 跑完。
- 这台机器只有 **3.89 GB 总内存**（free 常年 <1 GB），跑测试前建议先停掉 dev server。
  `npm run build` 与 `vitest` 不要同时跑。内存紧张时 worker 会被 SIGTERM 静默杀掉（无任何输出）。
- 本沙箱 `wmic`/`tasklist /FO CSV` 等部分系统命令被安全策略拦截；查内存用
  `node -e "console.log(require('os').freemem())"`。

## 有外部改动并存（重要）

项目里已有**我未参与的改动**（写在同一个日志文件里）：`src/assets/sprites/**`（整套 SVG 贴图）、
`src/ui/`（`SpriteIcon.vue` / `sprites.ts`）、`docs/爪爪乐园-UI视觉稿.html`、`docs/爪爪乐园-UI视觉稿.html`。
渲染层是"**贴图优先、emoji 兜底**"（`SpriteIcon` 查不到贴图时降级 emoji）。
贴图命名规则 = **链名-等级**（`toy-1` = 玩具链 Lv1），新等级必须补同名文件，否则会出现"贴图 + emoji"混排。
**开工前先看 src 树与当天日志，不要假定只有自己的改动。**

## 当前功能覆盖（2026-10-02）

- 已有：棋盘（7×9=63 格，**整块可用、无锁定格**）、**设施链**（玩具架 → 玩具箱 → 玩具仓库，主场景常驻、可拖进背包、可合成升级、储备+冷却永不消失）、**三条主链各 7 级 + 顶端 = Lv8**（toy/care/food，Lv1–3 与 Lv6 各留中段发射器）、礼包链 4 级（货币线）、**三种母体耗尽行为**（冷却型 / 转化型 / 消失型）、**链路图鉴** + 每日设施补给、体力（2min/点 + 12/18/24 补贴）、订单（2 槽 + 4 档位区间互不重叠 + 倒计时 + 顾客）、蛛网、存档（含 P0 迁移与**链深迁移**）、背包 5×5 + 金币扩容（底部抽屉，支持从棋盘拖入）、**特殊道具 5 种**（剪刀/升级卡/充能器/加速沙漏/能量球）、经营层三件套（9 区域 / 11 装饰 / 8 顾客 + 常驻宠物）
- 缺失：**自动型发射器**、商城、模拟充值、收集图鉴、卡牌、造型、限时活动、存档备份与导出、装饰摆放

## 已知结构性短板

原本的"链只有 3 级导致订单档位失去区分度"已在第三批解决（现在区间两两不重叠）。
当前最大缺口换成：**存档没有备份与导出**（设计文档 16 章明确"存档安全应排在玩法之前"，要分享给朋友）。

## 交互定案（2026-10-02 第六批，跨会话必须遵守）

- **背包是摆在棋盘上的道具**：`s.bagAt`（默认 TOTAL-1 右下角），占格但不进 board 数组、
  不是 BoardItem；-1 = 暂不上盘（走 InfoBar 兜底入口）。BackpackDrawer 已删，点开是
  **居中悬浮弹窗**（BackpackModal），主场景永不挤压；`--bag-h`/bag-open 那套已整体拆除。
- **一切"空位"语义必须排除背包格**：pickRandomEmpty（第 4 参 bagAt）/ countEmpty / addWeb /
  findDisplaceCell / reconcileWebs / seedBoard / ensureFacilities / tickAuto。
  新增产格逻辑时漏掉这条 = 物品叠到背包上。
- **拖到占用格 = 挤出/换位**（findDisplaceCell）：环1 随机空位 → 环2 → swap；
  蛛网格与背包格不算空位；挤出提示环用 `.cell.displace`（outline，橙色虚线）。
- **拖拽落点判定"先特殊后普通"**：`data-bag-cell` 优先于 `data-i`（useDrag.targetFromPoint）。
- **状态提示环一律 outline**（ok/merge/websac/displace/bagstore 已全部迁移），
  box-shadow 位留给贴纸落影。
- 拿起手势 = `scale(1.12) rotate(-2.5deg)` 固定角度（DRAG_LIFT）+ `.item.dragging` 加深落影；
  固定角度不是随机倾斜——那是手势动画（与 flyer 自旋同类豁免），不是静态造型。
- 全局隐藏滚动条（内容仍可滚）+ `html,body overflow:hidden`（移动端单屏）。
- 存档新字段 `bagAt`：旧档 normalize 里 placeBag 兜底（被占挤走/全满 -1），未升 SAVE_VERSION。
