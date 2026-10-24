// public/samples にある MusicXML から、アプリの「同梱の曲」一覧（index.json）を作り直す。
//   npm run songs:index
// すでに index.json にある曲は、書いてある曲名をそのまま残す（手で日本語名に直した場合など）。
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'public', 'samples');
const indexPath = join(dir, 'index.json');
const previous = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : [];
const known = new Map(previous.map((s) => [s.file, s.title]));

const unescape = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function titleOf(name) {
  const base = name.replace(/\.(musicxml|xml|mxl)$/i, '');
  if (/\.mxl$/i.test(name)) return base;
  const xml = readFileSync(join(dir, name), 'utf8');
  for (const tag of ['movement-title', 'work-title', 'credit-words']) {
    const m = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`).exec(xml);
    if (m && m[1].trim()) return unescape(m[1].trim());
  }
  return base;
}

const files = readdirSync(dir)
  .filter((f) => /\.(musicxml|xml|mxl)$/i.test(f))
  .sort((a, b) => a.localeCompare(b));
const songs = files.map((f) => {
  const file = `samples/${f}`;
  return { file, title: known.get(file) ?? titleOf(f) };
});
writeFileSync(indexPath, JSON.stringify(songs, null, 2) + '\n');
console.log(`${songs.length} 曲を ${indexPath} に書きました`);
