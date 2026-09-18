import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import UnoCSS from 'unocss/vite';
import { presetIcons } from 'unocss';
import { tuffexOnDemandStylePlugin } from '@talex-touch/tuffex/vite';

export default defineConfig({
  root: 'web',
  plugins: [
    vue(),
    // TuffEx 的 iconClass 走 `i-carbon-*` 约定，需要一个图标运行时把它变成真图标。
    // 只开 icons preset —— 外观全部交给组件库，这里不引入任何原子类。
    UnoCSS({
      presets: [presetIcons({ scale: 1.15, extraProperties: { display: 'inline-block' } })],
      content: { pipeline: { include: [/\.(vue|js)($|\?)/] } },
    }),
    // 子路径导入（`@talex-touch/tuffex/card`）本身不带 style.css，
    // 必须靠这个插件按 style-deps.json 展开样式闭包，否则产物只有骨架没有外观。
    tuffexOnDemandStylePlugin(),
  ],
  build: {
    outDir: '../web-dist',
    emptyOutDir: true,
  },
  server: {
    port: 5178,
    proxy: {
      // 开发模式下把 API 打到 algo web 起的 bun 服务
      '/api': 'http://localhost:5177',
    },
  },
});
