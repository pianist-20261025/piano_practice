import { describe, expect, it } from 'vitest';
import { buildSteps, type RawEntry, type RawNote } from './steps';

const n = (midi: number, hand: 'right' | 'left' = 'right', extra: Partial<RawNote> = {}): RawNote => ({
  midi, hand, rest: false, grace: false, tieContinuation: false, ...extra,
});
let idx = 0;
const e = (time: number, notes: RawNote[], measureIndex = Math.floor(time / 3)): RawEntry => ({
  index: idx++, measureIndex, measureNumber: measureIndex + 1, time, notes,
});

describe('buildSteps', () => {
  it('両手の音を1ステップにまとめ、低い順に並べる', () => {
    const steps = buildSteps([e(0, [n(74), n(55, 'left'), n(59, 'left')])]);
    expect(steps).toHaveLength(1);
    expect(steps[0].notes.map((x) => x.midi)).toEqual([55, 59, 74]);
    expect(steps[0].notes.map((x) => x.rawIndex)).toEqual([1, 2, 0]);
  });

  it('休符・装飾音・タイの後ろ側は判定しない。残らない位置はステップにしない', () => {
    const steps = buildSteps([
      e(0, [n(60), n(48, 'left')]),
      e(1, [n(60, 'right', { tieContinuation: true }), n(0, 'left', { rest: true })]),
      e(1.5, [n(62, 'right', { grace: true }), n(64)]),
    ]);
    expect(steps.map((s) => s.time)).toEqual([0, 1.5]);
    expect(steps[1].notes.map((x) => x.midi)).toEqual([64]);
  });

  it('片手モードでは判定しない手の音を除く', () => {
    const entries = [e(0, [n(74), n(55, 'left')]), e(1, [n(67)]), e(2, [n(48, 'left')])];
    expect(buildSteps(entries, 'right').map((s) => s.notes.map((x) => x.midi))).toEqual([[74], [67]]);
    expect(buildSteps(entries, 'left').map((s) => s.notes.map((x) => x.midi))).toEqual([[55], [48]]);
  });

  it('反復でカーソルが戻っても、書かれた順に1回だけ進む', () => {
    const entries = [e(0, [n(60)]), e(3, [n(62)]), e(0, [n(60)]), e(3, [n(62)]), e(6, [n(64)])];
    const steps = buildSteps(entries);
    expect(steps.map((s) => s.time)).toEqual([0, 3, 6]);
    expect(steps.map((s) => s.entryIndex)).toEqual([entries[0].index, entries[1].index, entries[4].index]);
  });

  it('同じ鍵盤が2声で重なったら1回だけ判定する', () => {
    expect(buildSteps([e(0, [n(67), n(67)])])[0].notes).toHaveLength(1);
  });
});
