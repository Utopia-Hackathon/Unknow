import { defineConfig } from 'vite';
import { existsSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';

const STORES_JSON = resolve(process.cwd(), 'data/stores.json');

// B-01 的 data/stores.json 在项目根目录、不在 public/ 下，
// vite build 不会自动把它拷进 dist —— 上线后 fetch 会 404。
// 这里在构建结束时把 data/ 一起拷进 dist/data/，契约里的路径因此保持不变。
function copyDataDir() {
  return {
    name: 'copy-data-dir',
    apply: 'build',
    closeBundle() {
      const src = resolve(process.cwd(), 'data');
      if (existsSync(src)) {
        cpSync(src, resolve(process.cwd(), 'dist/data'), { recursive: true });
      }
    },
  };
}

// E-02: 把体积固定的 three 依赖从业务代码里拆出来。
// Vite 8 走 rolldown，分包字段是 build.rolldownOptions.output.codeSplitting，
// 不是老版本的 build.rollupOptions.output.manualChunks。
export default defineConfig({
  base: './',
  // 构建期告知前端「数据文件在不在」：不存在就不 fetch，
  // 否则线上会留一条 404（浏览器记的 console 错误无法被 catch 吞掉）。
  define: {
    __HAS_STORES_DATA__: JSON.stringify(existsSync(STORES_JSON)),
  },
  plugins: [copyDataDir()],
  build: {
    target: 'es2019',
    outDir: 'dist',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // three 数学/几何内核（1.47MB 源码）：单独成块，业务改动不影响其哈希。
            {
              name: 'three-core',
              test: /node_modules[\\/]three[\\/]build[\\/]three[.]core[.]js/,
            },
            // three WebGL 渲染层（658KB 源码）：与内核分开，避免单块超 500kB 告警线。
            {
              name: 'three-webgl',
              test: /node_modules[\\/]three[\\/]build[\\/]/,
            },
            // three 附加模块（OrbitControls 等）：版本升级频率与核心不同，独立成块。
            {
              name: 'three-addons',
              test: /node_modules[\\/]three[\\/]examples[\\/]/,
            },
          ],
        },
      },
    },
  },
});
