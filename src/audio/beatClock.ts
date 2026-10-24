import type { Metronome } from './metronome';

/** 予約を先に入れておく時間（ms）。描画が少し遅れてもクリックが途切れないように */
const LOOKAHEAD_MS = 150;

/**
 * カウントと演奏中のメトロノームを、拍の時刻どおりに予約する。tick() を描画ループから呼ぶ。
 * origin が1拍目（カウントの直後）。カウントは常に鳴らし、演奏中は clickWhilePlaying のときだけ鳴らす。
 */
export class BeatClock {
  private next: number;

  constructor(
    private readonly metronome: Metronome,
    readonly origin: number,
    readonly beatMs: number,
    private readonly beatsPerBar: number,
    countInBeats: number,
    private readonly clickWhilePlaying: boolean,
    private readonly endAt: number,
  ) {
    this.next = origin - countInBeats * beatMs;
  }

  tick(now: number): void {
    while (this.next < now + LOOKAHEAD_MS && this.next < this.endAt) {
      if (this.next < this.origin || this.clickWhilePlaying) {
        const beat = Math.round((this.next - this.origin) / this.beatMs);
        this.metronome.click(this.next, ((beat % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar === 0);
      }
      this.next += this.beatMs;
    }
  }
}
