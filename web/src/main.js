import { createApp } from 'vue';
import 'virtual:uno.css';
import '@talex-touch/tuffex/base.css';
import App from './App.vue';

// TuffEx 的 base.css 不重置 body margin，全屏外壳前必须补上
const reset = document.createElement('style');
reset.textContent = 'body { margin: 0; }';
document.head.append(reset);

createApp(App).mount('#app');
