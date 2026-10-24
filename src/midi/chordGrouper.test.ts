import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChordGrouper, type Chord } from './chordGrouper';
import type { NoteEvent } from './types';

const on = (note: number, time: number): NoteEvent => ({ type: 'on', note, velocity: 80, time, source: 'midi' });

describe('ChordGrouper', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('窓の中で押した音を1つの和音にまとめる', () => {
    const chords: Chord[] = [];
    const g = new ChordGrouper(80, (c) => chords.push(c));
    g.push(on(67, 1000));
    g.push(on(60, 1030));
    g.push(on(64, 1070));
    expect(chords).toEqual([]);
    vi.advanceTimersByTime(80);
    expect(chords).toEqual([{ notes: [60, 64, 67], time: 1000 }]);
  });

  it('窓を過ぎた押鍵は次の和音になる', () => {
    const chords: Chord[] = [];
    const g = new ChordGrouper(80, (c) => chords.push(c));
    g.push(on(60, 1000));
    g.push(on(62, 1100));
    expect(chords).toEqual([{ notes: [60], time: 1000 }]);
    vi.advanceTimersByTime(80);
    expect(chords[1]).toEqual({ notes: [62], time: 1100 });
  });

  it('離鍵は無視する', () => {
    const chords: Chord[] = [];
    const g = new ChordGrouper(80, (c) => chords.push(c));
    g.push({ ...on(60, 0), type: 'off' });
    vi.advanceTimersByTime(200);
    expect(chords).toEqual([]);
  });

  it('窓は 30–150ms に収める', () => {
    const chords: Chord[] = [];
    const g = new ChordGrouper(80, (c) => chords.push(c));
    g.setWindow(500);
    g.push(on(60, 0));
    vi.advanceTimersByTime(150);
    expect(chords).toHaveLength(1);
  });
});
