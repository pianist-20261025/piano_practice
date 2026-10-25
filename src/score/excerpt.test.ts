import { describe, expect, it } from 'vitest';
import { excerptEntries, excerptLabel, pickExcerpt } from './excerpt';
import { buildSteps, type RawEntry, type RawNote } from './steps';

const n = (midi: number, extra: Partial<RawNote> = {}): RawNote => ({
  midi, hand: 'right', rest: false, grace: false, tieContinuation: false, duration: 1, ...extra,
});
let idx = 0;
const e = (time: number, notes: RawNote[], measureIndex = Math.floor(time / 3)): RawEntry => ({
  index: idx++, measureIndex, measureNumber: measureIndex + 1, time, notes,
});
/** 決まった値を順に返す乱数 */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

// 3/4 拍子で5小節。3小節目（measureIndex 2）は休符だけ
const entries = [
  e(0, [n(60)]), e(1, [n(62)]), e(2, [n(64)]),
  e(3, [n(65)]),
  e(6, [n(0, { rest: true })]),
  e(9, [n(67)]),
  e(12, [n(69)]),
];
const steps = buildSteps(entries);

describe('pickExcerpt', () => {
  it('判定する音がある小節から始め、指定した長さの範囲を選ぶ', () => {
    // 始まりの候補は 0,1,3,4。0.5 → 3 番目（measureIndex 3）、長さは 1 + floor(0.99 * 3) = 3
    expect(pickExcerpt(steps, 1, 3, null, seq(0.5, 0.99))).toEqual({ from: 3, to: 4 });
    expect(pickExcerpt(steps, 1, 3, null, seq(0, 0))).toEqual({ from: 0, to: 0 });
    expect(pickExcerpt(steps, 2, 2, null, seq(0.3, 0))).toEqual({ from: 1, to: 2 });
  });

  it('曲の終わりを越えるときは短くする', () => {
    expect(pickExcerpt(steps, 3, 3, null, seq(0.9, 0))).toEqual({ from: 4, to: 4 });
  });

  it('直前と同じ範囲は避ける', () => {
    expect(pickExcerpt(steps, 1, 1, { from: 0, to: 0 }, seq(0, 0, 0.3, 0))).toEqual({ from: 1, to: 1 });
  });

  it('判定する音がなければ null', () => {
    expect(pickExcerpt([], 1, 3)).toBeNull();
  });
});

describe('excerptEntries', () => {
  it('範囲の小節だけを取り出す', () => {
    const out = excerptEntries(entries, { from: 1, to: 3 });
    expect(out.map((x) => x.time)).toEqual([3, 6, 9]);
  });

  it('範囲の最初の位置のタイの後ろ側は、弾き始める音として判定する', () => {
    const tied = [e(0, [n(60, { duration: 3 })]), e(3, [n(60, { tieContinuation: true }), n(64)]), e(4, [n(65)]), e(5, [n(65, { tieContinuation: true })])];
    const out = buildSteps(excerptEntries(tied, { from: 1, to: 1 }));
    expect(out.map((s) => s.notes.map((x) => x.midi))).toEqual([[60, 64], [65]]);
    // 前の小節から鳴っている音とはみなさない（抜粋の頭から弾き始めるため）
    expect(out[0].notes.every((x) => !x.sustained)).toBe(true);
  });
});

describe('excerptLabel', () => {
  it('楽譜に書かれた小節番号で表す', () => {
    expect(excerptLabel(steps, entries, { from: 1, to: 3 })).toBe('小節 2〜4');
    expect(excerptLabel(steps, entries, { from: 4, to: 4 })).toBe('小節 5');
  });
});
