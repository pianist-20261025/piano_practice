import { describe, expect, it } from 'vitest';
import { staffRange } from '../music/clef';
import { keyAlter } from '../music/key';
import { diatonicIndex, pitchToMidi } from '../music/pitch';
import { SHAPES, generateShape, shapeById, type ShapeOptions, type ShapeQuestion } from './shape';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

const ranges = { treble: staffRange('treble', 1), bass: staffRange('bass', 1) };
const base: ShapeOptions = { clefs: ['treble'], ranges, key: { kind: 'none' }, shapes: SHAPES.map((s) => s.id), accidentals: false };

function many(options: ShapeOptions, n = 500): ShapeQuestion[] {
  const rng = seeded(7);
  const out: ShapeQuestion[] = [];
  let prev: ShapeQuestion | undefined;
  for (let i = 0; i < n; i++) out.push((prev = generateShape(options, rng, prev)));
  return out;
}

describe('generateShape', () => {
  it('形どおりの五線上の距離で積み、全音が音域内', () => {
    for (const q of many(base)) {
      const steps = shapeById(q.shape)!.steps;
      const ds = q.pitches.map(diatonicIndex);
      expect(ds.map((d) => d - ds[0])).toEqual([...steps]);
      for (const d of ds) {
        expect(d).toBeGreaterThanOrEqual(ranges.treble.low);
        expect(d).toBeLessThanOrEqual(ranges.treble.high);
      }
    }
  });

  it('選んだ形だけを出し、どの形も出る', () => {
    const qs = many({ ...base, shapes: ['3rd', 'triad-1st'] });
    expect(new Set(qs.map((q) => q.shape))).toEqual(new Set(['3rd', 'triad-1st']));
  });

  it('臨時記号なしなら全音が調号どおり', () => {
    for (const q of many({ ...base, key: { kind: 'fixed', fifths: -2 } })) {
      for (const p of q.pitches) expect(p.alter).toBe(keyAlter(-2, p.step));
    }
  });

  it('臨時記号ありなら、調号から外れる音は1問に1音まで', () => {
    const qs = many({ ...base, accidentals: true, accidentalRate: 1 });
    for (const q of qs) expect(q.pitches.filter((p) => p.alter !== 0).length).toBeLessThanOrEqual(1);
    expect(qs.some((q) => q.pitches.some((p) => p.alter !== 0))).toBe(true);
  });

  it('同じ鍵盤が重なる組み合わせと、直前と同じ組み合わせは出さない', () => {
    const qs = many({ ...base, accidentals: true, accidentalRate: 1, shapes: ['2nd', '3rd'] });
    for (let i = 0; i < qs.length; i++) {
      const midis = qs[i].pitches.map(pitchToMidi);
      expect(new Set(midis).size).toBe(midis.length);
      if (i) expect(midis.join()).not.toBe(qs[i - 1].pitches.map(pitchToMidi).join());
    }
  });

  it('音域が狭くて収まる形がなければ例外', () => {
    const narrow = { low: 30, high: 33 };
    expect(() => generateShape({ ...base, ranges: { treble: narrow, bass: narrow }, shapes: ['octave'] }, seeded(1))).toThrow();
    expect(generateShape({ ...base, ranges: { treble: narrow, bass: narrow }, shapes: ['octave', '3rd'] }, seeded(1)).shape).toBe('3rd');
  });
});
