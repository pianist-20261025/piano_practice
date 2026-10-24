import type { AnswerRecord } from './session';

/** 回答記録の保存先 */
export interface RecordStore {
  add(record: AnswerRecord): Promise<void>;
  addMany(records: readonly AnswerRecord[]): Promise<void>;
  all(): Promise<AnswerRecord[]>;
  clear(): Promise<void>;
}

const DB_NAME = 'sight-reader';
const DB_VERSION = 1;
const STORE = 'answers';

/** IndexedDB に保存する。ブラウザ（このPCのこのChrome）の中だけに残る */
export class IndexedDbRecordStore implements RecordStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async add(record: AnswerRecord): Promise<void> {
    await this.addMany([record]);
  }

  async addMany(records: readonly AnswerRecord[]): Promise<void> {
    await this.tx('readwrite', (store) => {
      // 読み込んだファイルの id はこのDBの id と関係ないので外す
      for (const r of records) store.add(stripId(r));
    });
  }

  async all(): Promise<AnswerRecord[]> {
    const rows = (await this.tx('readonly', (store) => store.getAll() as IDBRequest<AnswerRecord[]>)) ?? [];
    return rows.map(stripId);
  }

  async clear(): Promise<void> {
    await this.tx('readwrite', (store) => {
      store.clear();
    });
  }
}

/** テストや IndexedDB が使えないとき用 */
export class MemoryRecordStore implements RecordStore {
  private records: AnswerRecord[] = [];
  async add(record: AnswerRecord) {
    this.records.push({ ...record });
  }
  async addMany(records: readonly AnswerRecord[]) {
    this.records.push(...records.map((r) => ({ ...r })));
  }
  async all() {
    return this.records.map((r) => ({ ...r }));
  }
  async clear() {
    this.records = [];
  }
}

function stripId(r: AnswerRecord): AnswerRecord {
  const { id: _id, ...rest } = r as AnswerRecord & { id?: number };
  return rest;
}

// ---- 書き出し・読み込み ----

const EXPORT_FORMAT = 'sight-reader-records';

export function exportRecords(records: readonly AnswerRecord[]): string {
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), records }, null, 1);
}

/** 書き出したJSONを読み込む。形式が違えば例外 */
export function parseExportedRecords(json: string): AnswerRecord[] {
  const data = JSON.parse(json);
  if (data?.format !== EXPORT_FORMAT || !Array.isArray(data.records)) throw new Error('このアプリで書き出した記録ファイルではありません');
  return data.records.filter(isAnswerRecord).map((r: AnswerRecord) => ({ ...r, keyFifths: r.keyFifths ?? 0 }));
}

function isAnswerRecord(r: unknown): r is AnswerRecord {
  const x = r as Partial<AnswerRecord>;
  return (
    typeof x?.timestamp === 'number' &&
    (x.clef === 'treble' || x.clef === 'bass') &&
    Array.isArray(x.expected) &&
    Array.isArray(x.played) &&
    typeof x.correct === 'boolean' &&
    typeof x.reactionMs === 'number'
  );
}

/** 同じ回答（同時刻・同じ出題）を重ねて読み込まないよう、既存にないものだけ返す */
export function newRecordsOnly(existing: readonly AnswerRecord[], incoming: readonly AnswerRecord[]): AnswerRecord[] {
  const seen = new Set(existing.map(recordIdentity));
  return incoming.filter((r) => {
    const id = recordIdentity(r);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const recordIdentity = (r: AnswerRecord) => `${r.timestamp}|${r.clef}|${r.expected.join(',')}`;
