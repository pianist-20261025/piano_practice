import type { NoteEvent } from './types';

export interface Chord {
  notes: number[];
  /** 最初の押鍵の時刻 */
  time: number;
}

export const DEFAULT_CHORD_WINDOW_MS = 80;
export const CHORD_WINDOW_RANGE = { min: 30, max: 150 } as const;

interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** 最初の押鍵から windowMs 以内に押された音を1つの和音にまとめる。 */
export class ChordGrouper {
  private pending: Chord | null = null;
  private timer: unknown = null;

  constructor(
    private windowMs: number,
    private readonly onChord: (chord: Chord) => void,
    private readonly timers: Timers = realTimers,
  ) {}

  setWindow(ms: number): void {
    this.windowMs = Math.min(CHORD_WINDOW_RANGE.max, Math.max(CHORD_WINDOW_RANGE.min, ms));
  }

  push(ev: NoteEvent): void {
    if (ev.type !== 'on') return;
    if (this.pending && ev.time - this.pending.time > this.windowMs) this.flush();
    if (!this.pending) {
      this.pending = { notes: [ev.note], time: ev.time };
      this.timer = this.timers.set(() => this.flush(), this.windowMs);
    } else if (!this.pending.notes.includes(ev.note)) {
      this.pending.notes.push(ev.note);
    }
  }

  flush(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    const chord = this.pending;
    this.pending = null;
    if (chord) this.onChord({ notes: [...chord.notes].sort((a, b) => a - b), time: chord.time });
  }
}
