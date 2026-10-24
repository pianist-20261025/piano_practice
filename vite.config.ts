import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相対パスにしておくと、localhost でも GitHub Pages などのサブディレクトリでもそのまま動く
  base: './',
  server: { host: 'localhost', port: 5173 },
  preview: { host: 'localhost', port: 4173 },
  plugins: [
    VitePWA({
      // 新しい版をビルドしたら、次に開いたときに自動で入れ替える
      registerType: 'autoUpdate',
      manifest: {
        name: '読譜トレーニング',
        short_name: '読譜',
        description: '電子ピアノをMIDIでつないで、読譜と初見演奏を鍛える練習アプリ',
        lang: 'ja',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#f6f4ef',
        theme_color: '#2f5d8a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // アプリ本体と同梱の曲をすべて最初に保存しておき、ネットにつながっていなくても動くようにする
        globPatterns: ['**/*.{js,css,html,svg,png,json,musicxml,mxl}'],
        // 楽譜表示のライブラリを含むので、1ファイルの上限を広げる
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
