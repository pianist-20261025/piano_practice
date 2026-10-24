import { registerSW } from 'virtual:pwa-register';
import './style.css';
import { App } from './ui/app';

const app = new App();
app.start();
// 開発中のみ、コンソールや自動テストから状態を見られるようにする
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;

// オフラインで使えるよう、アプリ本体と同梱の曲をブラウザに保存する（ビルドした版のみ）
const offline = document.querySelector<HTMLElement>('#offline-status')!;
registerSW({
  immediate: true,
  onOfflineReady() {
    offline.textContent = 'オフラインでも使えます';
    offline.hidden = false;
  },
  onRegisteredSW(_url, registration) {
    // すでに保存済みなら、起動のたびに表示する
    if (registration?.active) {
      offline.textContent = 'オフライン対応';
      offline.hidden = false;
    }
  },
});
