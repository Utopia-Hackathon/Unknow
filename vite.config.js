import { defineConfig } from 'vite';

// E-02: 把体积固定的 three 依赖从业务代码里拆出来。
// Vite 8 走 rolldown，分包字段是 build.rolldownOptions.output.codeSplitting，
// 不是老版本的 build.rollupOptions.output.manualChunks。
export default defineConfig({
  base: './',
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
