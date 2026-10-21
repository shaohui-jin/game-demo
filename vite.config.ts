import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  /**
   * GitHub Pages 部署用的 base 路径注入（2026-10-02）。
   * 项目页地址是 `https://<user>.github.io/<repo>/` —— 资源必须带 `/game-demo/` 前缀，
   * 否则白屏。**只有 CI 工作流会设 `VITE_BASE`**：
   *   - 本地 dev / build / preview：不设 → 用 '/'，行为不变；
   *   - GitHub Actions：设为 `/${{ github.event.repository.name }}/`（动态取仓库名，
   *     改名或 fork 都不用改配置）。
   */
  base: process.env.VITE_BASE || '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    /**
     * 整机冒烟要反复 `mount(App)`（现在 100+ 次挂载），每个 jsdom 实例都很吃内存，
     * **文件级并行会直接把堆撑爆**（踩过 `Fatal process out of memory`）。
     * 所以改成"一个一个文件顺序跑、最多一个 worker"：峰值内存只算一份 jsdom 环境。
     *
     * ★ pool 必须是 `vmThreads`（2026-10-02 定）。默认的 `forks` 池与 `threads` 池
     *   在本机（vitest 5.0.3 + vite 8.3.1）有 runner 状态丢失问题：任何测试在
     *   describe() 调用处就报 `Cannot read properties of undefined (reading 'config')`
     *   （forks 池则报 `Vitest failed to find the runner`），连最小空测试都复现，
     *   与 node 版本（22/24）、jsdom、配置文件均无关；vmThreads 池完全正常。
     *   另外 forks 池是独立子进程，本机 3.89 GB 内存下经常直接被 OOM 杀掉。
     */
    fileParallelism: false,
    maxWorkers: 1,
    pool: 'vmThreads',
  },
})
