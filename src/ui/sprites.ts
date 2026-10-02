/**
 * 贴图资源映射 —— 全项目唯一的「资源键 → 贴图 URL」入口。
 *
 * 设计取舍：
 *  ① 用 `import.meta.glob` 自动收集，而不是手写 28 条 import。
 *     好处有两个：新增/删除贴图不用改代码；**写错资源键会在构建期直接暴露**（spriteOf 返回 null）。
 *  ② 资源键 = 文件名（不含扩展名）。所以命名规则本身就是接口契约：
 *     `src/assets/sprites/items/toy-1.svg`  → 键 `toy-1`。
 *  ③ 切到正式位图贴图时，只需要把同名 `.webp` 丢进对应目录、删掉 `.svg`，**一行代码都不用改**
 *     （glob 的扩展名列表里已经同时包含 svg / webp / png）。
 *
 * ⚠️ 不要出现同名不同格式的两个文件（如 toy-1.svg 与 toy-1.webp 并存），
 *    键会撞车且取到哪个不确定。
 */

const mods = import.meta.glob('../assets/sprites/**/*.{svg,webp,png}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** 从 glob 路径里推出资源键：取文件名、去掉扩展名 */
function keyOf(path: string): string {
  const file = path.split('/').pop() ?? ''
  return file.replace(/\.(svg|webp|png)$/i, '')
}

export const SPRITE: Record<string, string> = {}
for (const [path, url] of Object.entries(mods)) {
  SPRITE[keyOf(path)] = url
}

/**
 * 资源键 → 贴图地址。
 *
 * 查不到时返回 null 而不是抛错 —— 与 `defOf()` 同一条铁律：
 * 资源缺失绝不能让渲染层炸掉，由调用方降级到 emoji 兜底。
 */
export function spriteOf(key?: string | null): string | null {
  if (!key) return null
  return SPRITE[key] ?? null
}

/** 某个资源键是否有贴图（给需要判断的场景用） */
export function hasSprite(key?: string | null): boolean {
  return !!key && key in SPRITE
}

/**
 * 贴纸错位角度。
 *
 * ⚠️ **当前全项目已停用**，保留此函数是为了「造型总览页」这类纯展示场景还能用。
 *
 * 为什么停用（用户实测反馈）：把随机旋转应用在**带文字、要扫读**的元素上
 * （币条 / 按钮 / 卡片 / 列表行 / 棋盘物品），观感不是"手作感"而是"渲染坏了"。
 * 棋盘尤其严重 —— 合并棋盘需要一眼扫读，倾斜会显著降低可读性。
 *
 * 结论：**贴纸的身份靠模切白边 + 硬落影撑就够了**，旋转是最不必要、最容易做过头的一条。
 * 旋转只保留在"物理上就是一张纸"的元素上：胶带标题、便利贴说明。
 *
 * 若将来要重新启用，记得用**独立的 `rotate` 属性**而不是 `transform: rotate()` ——
 * useDrag 直接写 `el.style.transform` 做拖拽位移，挂在 transform 上会被擦掉。
 */
export function tiltOf(i: number, max = 1.4): string {
  const r = Math.sin((i + 1) * 12.9898) * 43758.5453
  return (((r - Math.floor(r)) - 0.5) * 2 * max).toFixed(2) + 'deg'
}
