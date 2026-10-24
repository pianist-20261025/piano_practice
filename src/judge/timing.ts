import { DEFAULT_JUDGE_OPTIONS, type JudgeOptions } from './judge';

/** テンポモードで、決まった時刻に押すべき音 */
export interface TimedTarget {
  step: number;
  midi: number;
  /** 押すべき時刻（performance.now() 基準） */
  time: number;
}

export interface TargetResult {
  hit: boolean;
  /** 押した時刻 − 押すべき時刻（ms）。負なら早い */
  deviationMs: number | null;
}

export type TimedPress = { kind: 'hit'; target: number; deviationMs: number } | { kind: 'extra'; step: number | null };

const pitchClass = (n: number) => ((n % 12) + 12) % 12;

/**
 * テンポモードの判定。押鍵を、同じ音で時刻が ±windowMs 以内のまだ押されていない目標に
 * 結び付ける（いちばん近いもの）。結び付かない押鍵は「余計な音」で、時刻が最も近いステップに数える。
 * 時刻は引数で受け取るので、テストでは実時間を使わずに確かめられる。
 */
export class TimedMatcher {
  private readonly results: TargetResult[];
  private expiredUpTo = 0;

  constructor(
    readonly targets: readonly TimedTarget[],
    readonly windowMs: number,
    private readonly options: JudgeOptions = DEFAULT_JUDGE_OPTIONS,
  ) {
    this.results = targets.map(() => ({ hit: false, deviationMs: null }));
  }

  press(midi: number, time: number): TimedPress {
    const same = this.options.octaveEquivalent
      ? (a: number) => pitchClass(a) === pitchClass(midi)
      : (a: number) => a === midi;
    let best = -1;
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      if (this.results[i].hit || !same(t.midi)) continue;
      const d = Math.abs(time - t.time);
      if (d <= this.windowMs && (best < 0 || d < Math.abs(time - this.targets[best].time))) best = i;
    }
    if (best >= 0) {
      const deviationMs = time - this.targets[best].time;
      this.results[best] = { hit: true, deviationMs };
      return { kind: 'hit', target: best, deviationMs };
    }
    return { kind: 'extra', step: this.nearestStep(time) };
  }

  /**
   * 押鍵なしで当たりにする（押さえたままの鍵盤がその音のとき）。ずれは測れないので null のまま
   * （タイミングの集計には入らない）
   */
  credit(target: number): boolean {
    if (this.results[target]?.hit !== false) return false;
    this.results[target] = { hit: true, deviationMs: null };
    return true;
  }

  /** now の時点で押す時間を過ぎた（もう押しても間に合わない）目標の番号。各目標は1回だけ返す */
  expire(now: number): number[] {
    const out: number[] = [];
    while (this.expiredUpTo < this.targets.length && this.targets[this.expiredUpTo].time + this.windowMs < now) {
      if (!this.results[this.expiredUpTo].hit) out.push(this.expiredUpTo);
      this.expiredUpTo++;
    }
    return out;
  }

  result(target: number): TargetResult {
    return this.results[target];
  }

  private nearestStep(time: number): number | null {
    let best: TimedTarget | null = null;
    for (const t of this.targets) if (!best || Math.abs(time - t.time) < Math.abs(time - best.time)) best = t;
    return best ? best.step : null;
  }
}

/** タイミングのずれの集計（押せた音だけ） */
export function summarizeTiming(deviations: readonly number[], toleranceMs: number) {
  if (!deviations.length) return { count: 0, onTimeRate: 0, meanAbsMs: null, meanMs: null };
  const onTime = deviations.filter((d) => Math.abs(d) <= toleranceMs).length;
  return {
    count: deviations.length,
    onTimeRate: onTime / deviations.length,
    meanAbsMs: deviations.reduce((s, d) => s + Math.abs(d), 0) / deviations.length,
    /** 正なら全体に遅れ気味、負なら走り気味 */
    meanMs: deviations.reduce((s, d) => s + d, 0) / deviations.length,
  };
}
