import { describe, expect, it } from 'vitest';
import { displayedAccidental, keyAlter, keyLabel, spellMidiInKey, vexKeyName } from './key';
import { pitchName, type Pitch } from './pitch';

describe('keyAlter', () => {
  it('ニ長調（♯2）は F と C に ♯', () => {
    expect(keyAlter(2, 'F')).toBe(1);
    expect(keyAlter(2, 'C')).toBe(1);
    expect(keyAlter(2, 'G')).toBe(0);
  });

  it('変ホ長調（♭3）は B・E・A に ♭', () => {
    expect(['B', 'E', 'A', 'D'].map((s) => keyAlter(-3, s as 'B'))).toEqual([-1, -1, -1, 0]);
  });

  it('調号なしは全部ナチュラル', () => {
    expect(keyAlter(0, 'F')).toBe(0);
  });
});

describe('displayedAccidental', () => {
  const p = (step: Pitch['step'], alter: number): Pitch => ({ step, alter, octave: 4 });

  it('調号どおりなら記号なし', () => {
    expect(displayedAccidental(p('F', 1), 2)).toBeNull();
    expect(displayedAccidental(p('G', 0), 2)).toBeNull();
  });

  it('調号の ♯ を打ち消すとナチュラル', () => {
    expect(displayedAccidental(p('F', 0), 2)).toBe(0);
  });

  it('調号にない変化はその記号', () => {
    expect(displayedAccidental(p('G', 1), 2)).toBe(1);
    expect(displayedAccidental(p('B', -1), 0)).toBe(-1);
  });
});

describe('spellMidiInKey', () => {
  it('調号どおりの綴りを優先する', () => {
    expect(pitchName(spellMidiInKey(66, 2))).toBe('F♯4');
    expect(pitchName(spellMidiInKey(66, -6))).toBe('G♭4');
    expect(pitchName(spellMidiInKey(71, -7))).toBe('C♭5');
    expect(pitchName(spellMidiInKey(65, 6))).toBe('E♯4');
  });

  it('調号にない音は近い位置の綴り', () => {
    expect(pitchName(spellMidiInKey(65, 2))).toBe('F4');
    expect(pitchName(spellMidiInKey(63, 0, 30 /* E4 */))).toBe('E♭4');
  });
});

describe('調の名前', () => {
  it('VexFlow 用と表示用', () => {
    expect(vexKeyName(0)).toBe('C');
    expect(vexKeyName(-2)).toBe('Bb');
    expect(vexKeyName(6)).toBe('F#');
    expect(keyLabel(3)).toBe('♯3 イ長調／嬰ヘ短調');
    expect(keyLabel(0)).toBe('調号なし ハ長調／イ短調');
  });
});
