import { describe, expect, it } from 'vitest';
import { buildSteps, type RawEntry, type RawNote } from './steps';

const n = (midi: number, hand: 'right' | 'left' = 'right', extra: Partial<RawNote> = {}): RawNote => ({
  midi, hand, rest: false, grace: false, tieContinuation: false, duration: 1, ...extra,
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

  it('同じ鍵盤が2声で重なったら1回だけ判定し、色付け用に元の音符を両方覚えておく', () => {
    const entry = e(0, [n(67), n(67, 'right', { duration: 3 })]);
    const [step] = buildSteps([entry]);
    expect(step.notes).toHaveLength(1);
    expect(step.notes[0].refs).toEqual([{ entryIndex: entry.index, rawIndex: 0 }, { entryIndex: entry.index, rawIndex: 1 }]);
  });
});

describe('buildSteps: 同じ音の持続', () => {
  const sustainedOf = (steps: ReturnType<typeof buildSteps>) => steps.map((s) => s.notes.filter((n) => n.sustained).map((n) => n.midi));

  it('別の声部の長い音が鳴っている高さに書かれた音は sustained（押さえたままでよい）', () => {
    // 声部1: C4 の2分音符、声部2: 2拍目に同じ C4
    const steps = buildSteps([e(0, [n(60, 'left', { duration: 2 }), n(64)]), e(1, [n(60, 'left'), n(67)])]);
    expect(sustainedOf(steps)).toEqual([[], [60]]);
  });

  it('タイが続いている位置で、別の声部が同じ高さを書いた音も sustained', () => {
    const steps = buildSteps([e(0, [n(67)]), e(1, [n(67, 'right', { tieContinuation: true }), n(67, 'left'), n(48, 'left')])]);
    expect(steps[1].notes.map((x) => x.midi)).toEqual([48, 67]);
    expect(sustainedOf(steps)).toEqual([[], [67]]);
  });

  it('前の音が終わってから同じ高さを弾く（ふつうの連打）は sustained にしない', () => {
    const steps = buildSteps([e(0, [n(67)]), e(1, [n(67, 'right', { duration: 0.5 })]), e(1.5, [n(67, 'right', { duration: 0.5 })]), e(2, [n(67)])]);
    expect(sustainedOf(steps)).toEqual([[], [], [], []]);
  });

  it('タイでつながった長い音のあとに同じ高さを弾き直すのも、ふつうの連打', () => {
    const steps = buildSteps([e(0, [n(60)]), e(1, [n(60, 'right', { tieContinuation: true })]), e(2, [n(60)])]);
    expect(steps.map((s) => s.time)).toEqual([0, 2]);
    expect(sustainedOf(steps)).toEqual([[], []]);
  });

  it('装飾音は持続に数えない', () => {
    const steps = buildSteps([e(0, [n(62, 'right', { grace: true, duration: 0 }), n(60)]), e(1, [n(62)])]);
    expect(sustainedOf(steps)).toEqual([[], []]);
  });
});

describe('buildSteps: 連符の端数', () => {
  it('前の音が終わる時刻と次の音の時刻が端数でずれても、ふつうの連打として扱う（押し直しが必要）', () => {
    // 3連符 3つ（1/3 拍ずつ）のあとに同じ高さの音。足し合わせると 0.99999... になる
    const third = 1 / 3;
    const steps = buildSteps([
      e(0, [n(60, 'right', { duration: third })]),
      e(third, [n(62, 'right', { duration: third })]),
      e(third * 2, [n(64, 'right', { duration: third })]),
      e(1.0000001, [n(64)]),
    ]);
    expect(steps.map((s) => s.notes[0].sustained)).toEqual([false, false, false, false]);
  });

  it('端数のずれで別のカーソル位置に分かれた同じ時刻の音は、1つの位置にまとめる', () => {
    const a = e(1, [n(60)]);
    const b = e(1.0000004, [n(67, 'left')]);
    const steps = buildSteps([e(0, [n(55)]), a, b, e(2, [n(62)])]);
    expect(steps.map((s) => s.notes.map((x) => x.midi))).toEqual([[55], [60, 67], [62]]);
    // 色付けのため、どのカーソル位置の音かは音ごとに覚えている
    expect(steps[1].notes.map((x) => x.entryIndex)).toEqual([a.index, b.index]);
    expect(steps[1].entryIndex).toBe(a.index);
  });
});
