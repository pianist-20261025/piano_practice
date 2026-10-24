import { describe, expect, it } from 'vitest';
import type { AnswerRecord } from './session';
import { MemoryRecordStore, exportRecords, newRecordsOnly, parseExportedRecords } from './store';

const rec = (timestamp: number, midi = 60): AnswerRecord => ({
  timestamp, mode: 'reflex', clef: 'treble', keyFifths: 0, expected: [midi], played: [midi], correct: true, reactionMs: 400, attempts: 1,
});

describe('記録の書き出し・読み込み', () => {
  it('書き出したものを読み込むと元に戻る', () => {
    const records = [rec(1), rec(2, 62)];
    expect(parseExportedRecords(exportRecords(records))).toEqual(records);
  });

  it('別の形式のファイルは読み込まない', () => {
    expect(() => parseExportedRecords('{"records": []}')).toThrow();
    expect(() => parseExportedRecords('not json')).toThrow();
  });

  it('壊れた行は捨て、keyFifths がない古い記録は 0 で補う', () => {
    const { keyFifths: _k, ...old } = rec(5);
    const json = JSON.stringify({ format: 'sight-reader-records', records: [old, { timestamp: 'x' }] });
    expect(parseExportedRecords(json)).toEqual([rec(5)]);
  });

  it('すでにある記録は重ねて読み込まない', () => {
    expect(newRecordsOnly([rec(1)], [rec(1), rec(2), rec(2)])).toEqual([rec(2)]);
  });
});

describe('MemoryRecordStore', () => {
  it('追加・取得・全消去', async () => {
    const store = new MemoryRecordStore();
    await store.add(rec(1));
    await store.addMany([rec(2), rec(3)]);
    expect((await store.all()).map((r) => r.timestamp)).toEqual([1, 2, 3]);
    await store.clear();
    expect(await store.all()).toEqual([]);
  });
});
