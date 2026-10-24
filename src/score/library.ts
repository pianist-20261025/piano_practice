import { withStore } from '../storage/db';

/** ライブラリに入れた曲。data は MusicXML の文字列（.mxl はバイナリ文字列） */
export interface LibrarySong {
  id: number;
  name: string;
  data: string;
  addedAt: number;
}

/** アプリに同梱の曲（public/samples/index.json） */
export interface BundledSong {
  file: string;
  title: string;
}

/** 曲のライブラリ。ファイルから追加した曲を IndexedDB に保存し、次回以降も選べるようにする */
export class SongLibrary {
  async list(): Promise<LibrarySong[]> {
    const rows = (await withStore('songs', 'readonly', (s) => s.getAll() as IDBRequest<LibrarySong[]>)) ?? [];
    return rows.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  async add(name: string, data: string): Promise<number> {
    const id = await withStore('songs', 'readwrite', (s) => s.add({ name, data, addedAt: Date.now() }) as IDBRequest<number>);
    return id!;
  }

  async remove(id: number): Promise<void> {
    await withStore('songs', 'readwrite', (s) => {
      s.delete(id);
    });
  }
}

/** 同梱の曲の一覧を読む。読めなければ空 */
export async function loadBundledSongs(baseUrl: string): Promise<BundledSong[]> {
  try {
    const res = await fetch(`${baseUrl}samples/index.json`);
    if (!res.ok) return [];
    const list = (await res.json()) as unknown;
    return Array.isArray(list)
      ? list.filter((x): x is BundledSong => typeof x?.file === 'string' && typeof x?.title === 'string')
      : [];
  } catch {
    return [];
  }
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * 曲名を決める。MusicXML の movement-title → work-title → 最初の credit-words の順に探し、
 * なければファイル名（拡張子を除く）。.mxl（zip）は中を読まずにファイル名を使う。
 */
export function songTitle(fileName: string, data: string): string {
  const base = fileName.replace(/\.(musicxml|xml|mxl)$/i, '');
  if (/\.mxl$/i.test(fileName)) return base;
  for (const tag of ['movement-title', 'work-title', 'credit-words']) {
    const m = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`).exec(data);
    if (m && m[1].trim()) return unescapeXml(m[1].trim());
  }
  return base;
}

/** ファイルの中身を、OSMD に渡せる文字列にする（.mxl は zip なのでバイナリ文字列） */
export async function readSongFile(file: File): Promise<string> {
  if (!/\.mxl$/i.test(file.name)) return file.text();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
}
