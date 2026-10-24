import { describe, expect, it } from 'vitest';
import { staffRange } from '../music/clef';
import { keyAlter } from '../music/key';
import { diatonicIndex } from '../music/pitch';
import { BEATS_PER_MEASURE, generatePhrase, leaps, type PhraseOptions } from './phrase';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

const ranges = { treble: staffRange('treble', 1), bass: staffRange('bass', 1) };
const base: PhraseOptions = { clefs: ['treble'], ranges, key: { kind: 'none' }, accidentals: false, measures: 8, rhythm: 'mixed', maxLeap: 5 };

describe('generatePhrase', () => {
  it('各小節がちょうど4拍で埋まり、最後は全音符', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const ph = generatePhrase(base, seeded(seed));
      for (let m = 0; m < ph.measures; m++) {
        const inMeasure = ph.notes.filter((n) => n.measure === m);
        expect(inMeasure.reduce((s, n) => s + n.duration, 0)).toBe(BEATS_PER_MEASURE);
        expect(inMeasure[0].time).toBe(m * BEATS_PER_MEASURE);
      }
      expect(ph.notes.at(-1)!.duration).toBe(4);
    }
  });

  it('跳躍は上限以内で、音域の中', () => {
    for (const maxLeap of [1, 2, 4, 7]) {
      for (let seed = 1; seed <= 20; seed++) {
        const ph = generatePhrase({ ...base, maxLeap, measures: 16 }, seeded(seed));
        expect(Math.max(...leaps(ph))).toBeLessThanOrEqual(maxLeap);
        for (const n of ph.notes) {
          expect(diatonicIndex(n.pitch)).toBeGreaterThanOrEqual(ranges.treble.low);
          expect(diatonicIndex(n.pitch)).toBeLessThanOrEqual(ranges.treble.high);
        }
      }
    }
  });

  it('順次進行が多く、大きな跳躍が続かない', () => {
    const all = Array.from({ length: 30 }, (_, i) => leaps(generatePhrase({ ...base, measures: 16 }, seeded(i + 1)))).flat();
    const steps = all.filter((l) => l <= 1).length / all.length;
    expect(steps).toBeGreaterThan(0.4);
    let consecutive = 0;
    let pairs = 0;
    for (let i = 1; i < all.length; i++) {
      if (all[i - 1] >= 3) {
        pairs++;
        if (all[i] >= 3) consecutive++;
      }
    }
    // 4度以上の跳躍の直後にもう一度4度以上跳ぶのはまれ
    expect(consecutive / pairs).toBeLessThan(0.15);
  });

  it('臨時記号なしなら調号どおり。4分音符のみも選べる', () => {
    const ph = generatePhrase({ ...base, key: { kind: 'fixed', fifths: -3 }, rhythm: 'quarter' }, seeded(5));
    expect(ph.keyFifths).toBe(-3);
    for (const n of ph.notes) expect(n.pitch.alter).toBe(keyAlter(-3, n.pitch.step));
    expect(ph.notes.slice(0, -1).every((n) => n.duration === 1)).toBe(true);
  });

  it('大譜表では小節ごとに段を選び、それぞれの音域で書く', () => {
    const ph = generatePhrase({ ...base, clefs: ['treble', 'bass'], measures: 24 }, seeded(9));
    const clefs = new Set(ph.notes.map((n) => n.clef));
    expect(clefs).toEqual(new Set(['treble', 'bass']));
    for (const n of ph.notes) {
      expect(diatonicIndex(n.pitch)).toBeGreaterThanOrEqual(ranges[n.clef].low);
      expect(diatonicIndex(n.pitch)).toBeLessThanOrEqual(ranges[n.clef].high);
      expect(ph.notes.filter((x) => x.measure === n.measure).every((x) => x.clef === n.clef)).toBe(true);
    }
  });
});
