import { describe, expect, it } from 'vitest';
import { diatonicIndex, pitchFromDiatonic, pitchName, pitchToMidi, spellMidi, toVexKey } from './pitch';

describe('pitch', () => {
  it('中央ドは MIDI 60', () => {
    expect(pitchToMidi({ step: 'C', alter: 0, octave: 4 })).toBe(60);
    expect(pitchToMidi({ step: 'A', alter: 0, octave: 4 })).toBe(69);
  });

  it('幹音の位置と相互変換できる', () => {
    for (let d = 14; d < 60; d++) expect(diatonicIndex(pitchFromDiatonic(d))).toBe(d);
  });

  it('白鍵は幹音に、黒鍵は既定で ♯ に綴る', () => {
    expect(pitchName(spellMidi(64))).toBe('E4');
    expect(pitchName(spellMidi(61))).toBe('C♯4');
    expect(pitchName(spellMidi(59))).toBe('B3');
  });

  it('黒鍵は近い位置の綴りを選ぶ', () => {
    const e4 = diatonicIndex({ step: 'E', alter: 0, octave: 4 });
    expect(pitchName(spellMidi(63, e4))).toBe('E♭4');
    const d4 = diatonicIndex({ step: 'D', alter: 0, octave: 4 });
    expect(pitchName(spellMidi(63, d4))).toBe('D♯4');
  });

  it('綴りを MIDI に戻すと元の番号になる', () => {
    for (let n = 21; n <= 108; n++) {
      expect(pitchToMidi(spellMidi(n))).toBe(n);
      expect(pitchToMidi(spellMidi(n, 0))).toBe(n);
      expect(pitchToMidi(spellMidi(n, 100))).toBe(n);
    }
  });

  it('VexFlow の key 文字列', () => {
    expect(toVexKey({ step: 'F', alter: 1, octave: 4 })).toBe('f#/4');
    expect(toVexKey({ step: 'B', alter: -1, octave: 3 })).toBe('bb/3');
  });
});
