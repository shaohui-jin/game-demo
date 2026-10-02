/**
 * 测试环境补丁。
 *
 * jsdom 没有实现 `<canvas>`：每次调用 `getContext('2d')` 都会往控制台吐一条
 * "Not implemented: HTMLCanvasElement's getContext() method"。
 * 我们的特效层本来就会在拿不到 ctx 时静默降级（见 useFx.attachCanvas），
 * 所以这里直接把 getContext 换掉 —— 让测试输出里只剩真正的报错。
 */

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as never
}
