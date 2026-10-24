import './style.css';
import { App } from './ui/app';

const app = new App();
app.start();
// 開発中のみ、コンソールや自動テストから状態を見られるようにする
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;
