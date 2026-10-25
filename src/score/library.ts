import { openDb, withStore } from '../storage/db';

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

const LOCAL_KEY = 'sight-reader:songs';

/**
 * 曲のライブラリ。ファイルから追加した曲を IndexedDB に保存し、次回以降も選べるようにする。
 * IndexedDB が使えないブラウザ（iPad の一部のアプリ内ブラウザなど）では localStorage に保存する（容量は数MBまで）
 */
export class SongLibrary {
  private idb: Promise<boolean> | null = null;

  /** 保存先。'local' のときは容量が小さい */
  async storage(): Promise<'indexeddb' | 'local'> {
    return (await this.useIdb()) ? 'indexeddb' : 'local';
  }

  private useIdb(): Promise<boolean> {
    this.idb ??= openDb().then(
      () => true,
      () => false,
    );
    return this.idb;
  }

  async list(): Promise<LibrarySong[]> {
    const rows = (await this.useIdb())
      ? ((await withStore('songs', 'readonly', (s) => s.getAll() as IDBRequest<LibrarySong[]>)) ?? [])
      : readLocal();
    return rows.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  async add(name: string, data: string): Promise<number> {
    if (await this.useIdb()) {
      const id = await withStore('songs', 'readwrite', (s) => s.add({ name, data, addedAt: Date.now() }) as IDBRequest<number>);
      return id!;
    }
    const rows = readLocal();
    const id = rows.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    writeLocal([...rows, { id, name, data, addedAt: Date.now() }]);
    return id;
  }

  async remove(id: number): Promise<void> {
    if (await this.useIdb()) {
      await withStore('songs', 'readwrite', (s) => {
        s.delete(id);
      });
      return;
    }
    writeLocal(readLocal().filter((x) => x.id !== id));
  }
}

function readLocal(): LibrarySong[] {
  try {
    const rows = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as unknown;
    return Array.isArray(rows) ? (rows as LibrarySong[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(rows: LibrarySong[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
  } catch {
    throw new Error('このブラウザに保存できる容量を超えました');
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

/** .mxl（zip）の中身か。zip はファイルの先頭が "PK" */
const isZip = (data: string) => data.startsWith('PK');

/**
 * 曲名を決める。MusicXML の movement-title → work-title → 最初の credit-words の順に探し、
 * なければファイル名（拡張子を除く）。.mxl（zip）は中を読まずにファイル名を使う。
 */
export function songTitle(fileName: string, data: string): string {
  const base = fileName.replace(/\.(musicxml|xml|mxl)$/i, '');
  if (isZip(data)) return base;
  for (const tag of ['movement-title', 'work-title', 'credit-words']) {
    const m = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`).exec(data);
    if (m && m[1].trim()) return unescapeXml(m[1].trim());
  }
  return base;
}

/**
 * ファイルの中身を、OSMD に渡せる文字列にする（.mxl は zip なのでバイナリ文字列）。
 * 拡張子ではなく中身で見分ける（iPad ではファイル名の拡張子が変わっていることがあるため）。
 * 楽譜でなければ、理由を書いたエラーにする
 */
export async function readSongFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return out;
  }
  const text = new TextDecoder().decode(bytes);
  return checkMusicXml(text);
}

/** MusicXML の文字列か確かめる。違えば理由つきのエラー */
export function checkMusicXml(text: string): string {
  if (/<score-(partwise|timewise)[\s>]/.test(text)) return text;
  if (text.startsWith('%PDF')) throw new Error('PDF は読めません（MusicXML に変換してください）');
  throw new Error('MusicXML（.musicxml / .mxl）ではありません');
}
