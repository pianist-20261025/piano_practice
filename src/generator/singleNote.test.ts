import { describe, expect, it } from 'vitest';
import { staffRange, type Clef } from '../music/clef';
import { keyAlter } from '../music/key';
import { diatonicIndex, pitchToMidi } from '../music/pitch';
import { generateSingleNote, weightedPick, type SingleNoteOptions } from './singleNote';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

const ranges = { treble: staffRange('treble', 1), bass: staffRange('bass', 1) };
const base: SingleNoteOptions = { clefs: ['treble'], ranges, key: { kind: 'none' }, accidentals: false };

function many(options: SingleNoteOptions, n = 500, seed = 1) {
  const rng = seeded(seed);
  const out = [];
  let prev;
  for (let i = 0; i < n; i++) out.push((prev = generateSingleNote(options, rng, prev)));
  return out;
}

describe('generateSingleNote: 音域', () => {
  it('調号・臨時記号なしなら音域内の幹音だけを出す', () => {
    for (const q of many(base)) {
      expect(q.pitch.alter).toBe(0);
      expect(q.keyFifths).toBe(0);
      expect(diatonicIndex(q.pitch)).toBeGreaterThanOrEqual(ranges.treble.low);
      expect(diatonicIndex(q.pitch)).toBeLessThanOrEqual(ranges.treble.high);
    }
  });

  it('直前と同じ鍵盤の音は出さない', () => {
    const qs = many({ ...base, accidentals: true, key: { kind: 'random', maxAccidentals: 7 } });
    for (let i = 1; i < qs.length; i++) expect(pitchToMidi(qs[i].pitch)).not.toBe(pitchToMidi(qs[i - 1].pitch));
  });

  it('音域の両端も出る', () => {
    const seen = new Set(many(base, 1000).map((q) => diatonicIndex(q.pitch)));
    expect(seen.size).toBe(ranges.treble.high - ranges.treble.low + 1);
  });

  it('音域が1音だけでも止まらない', () => {
    const one = { low: 30, high: 30 };
    const qs = many({ ...base, ranges: { treble: one, bass: one } }, 5);
    expect(qs.every((q) => diatonicIndex(q.pitch) === 30)).toBe(true);
  });

  it('rng が 1 に近くても範囲外にならない', () => {
    const q = generateSingleNote(base, () => 0.9999999999);
    expect(diatonicIndex(q.pitch)).toBe(ranges.treble.high);
  });
});

describe('generateSingleNote: 譜表', () => {
  it('ヘ音記号ではヘ音記号の音域から出す', () => {
    for (const q of many({ ...base, clefs: ['bass'] })) {
      expect(q.clef).toBe('bass');
      expect(diatonicIndex(q.pitch)).toBeGreaterThanOrEqual(ranges.bass.low);
      expect(diatonicIndex(q.pitch)).toBeLessThanOrEqual(ranges.bass.high);
    }
  });

  it('大譜表では両方の段から、それぞれの音域で出す', () => {
    const qs = many({ ...base, clefs: ['treble', 'bass'] });
    const counts: Record<Clef, number> = { treble: 0, bass: 0 };
    for (const q of qs) {
      counts[q.clef]++;
      expect(diatonicIndex(q.pitch)).toBeGreaterThanOrEqual(ranges[q.clef].low);
      expect(diatonicIndex(q.pitch)).toBeLessThanOrEqual(ranges[q.clef].high);
    }
    expect(counts.treble).toBeGreaterThan(150);
    expect(counts.bass).toBeGreaterThan(150);
  });
});

describe('generateSingleNote: 調号・臨時記号', () => {
  it('調号指定・臨時記号なしなら、すべて調号どおりの音', () => {
    for (const q of many({ ...base, key: { kind: 'fixed', fifths: -3 } })) {
      expect(q.keyFifths).toBe(-3);
      expect(q.pitch.alter).toBe(keyAlter(-3, q.pitch.step));
    }
  });

  it('ランダムの調は指定した数以内で、いろいろな調が出る', () => {
    const keys = new Set(many({ ...base, key: { kind: 'random', maxAccidentals: 2 } }).map((q) => q.keyFifths));
    expect([...keys].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
  });

  it('臨時記号ありなら、調号から外れた音がある程度の割合で出る', () => {
    const qs = many({ ...base, key: { kind: 'fixed', fifths: 2 }, accidentals: true }, 1000);
    const chromatic = qs.filter((q) => q.pitch.alter !== keyAlter(2, q.pitch.step));
    expect(chromatic.length / qs.length).toBeGreaterThan(0.2);
    expect(chromatic.length / qs.length).toBeLessThan(0.4);
    // ニ長調で調号の付く F・C はナチュラル、それ以外は ♯ か ♭
    for (const q of chromatic) {
      if (q.pitch.step === 'F' || q.pitch.step === 'C') expect(q.pitch.alter).toBe(0);
      else expect(Math.abs(q.pitch.alter)).toBe(1);
    }
  });

  it('E♯・B♯・F♭・C♭ のような珍しい綴りは臨時記号で出さない', () => {
    const qs = many({ ...base, accidentals: true, accidentalRate: 1 }, 1000);
    const names = new Set(qs.map((q) => `${q.pitch.step}${q.pitch.alter}`));
    for (const rare of ['E1', 'B1', 'F-1', 'C-1']) expect(names.has(rare)).toBe(false);
  });
});

describe('generateSingleNote: 苦手音の重み付け', () => {
  it('重い音ほど多く出る', () => {
    const g4 = 67;
    const qs = many({ ...base, weight: (_clef, midi) => (midi === g4 ? 10 : 1) }, 2000);
    const share = qs.filter((q) => pitchToMidi(q.pitch) === g4).length / qs.length;
    // 均等なら 1/15。重み10なら約 10/24（直前と同じ音は避けるので実際はそれより少し下がる）
    expect(share).toBeGreaterThan(0.25);
  });

  it('重みが全部同じなら均等とほぼ同じ', () => {
    const qs = many({ ...base, weight: () => 3 }, 3000);
    const counts = new Map<number, number>();
    for (const q of qs) counts.set(diatonicIndex(q.pitch), (counts.get(diatonicIndex(q.pitch)) ?? 0) + 1);
    for (const c of counts.values()) expect(c).toBeGreaterThan(3000 / 15 / 2);
  });
});

describe('weightedPick', () => {
  it('重み0の要素は選ばない。全部0なら均等', () => {
    expect(weightedPick(['a', 'b'], [0, 1], () => 0)).toBe('b');
    expect(weightedPick(['a', 'b'], [0, 0], () => 0.6)).toBe('b');
  });
});
