import type { AnswerRecord } from './session';

export interface SongStat {
  song: string;
  count: number;
  correct: number;
  accuracy: number;
  /** 間違えた回数が多い小節（多い順、最大3つ） */
  weakMeasures: { measure: number; errors: number }[];
  /** テンポモードでのずれの絶対値の平均（記録がなければ null） */
  meanAbsTimingMs: number | null;
  lastPracticed: number;
}

const WEAK_MEASURES = 3;

/** 曲モードの記録を曲ごとに集計する（全期間） */
export function aggregateSongStats(records: readonly AnswerRecord[]): SongStat[] {
  const groups = new Map<string, AnswerRecord[]>();
  for (const r of records) {
    if (r.mode !== 'song' || !r.song) continue;
    groups.set(r.song, [...(groups.get(r.song) ?? []), r]);
  }
  return [...groups]
    .map(([song, rs]) => {
      const errors = new Map<number, number>();
      for (const r of rs) if (!r.correct && r.measure !== undefined) errors.set(r.measure, (errors.get(r.measure) ?? 0) + 1);
      const timings = rs.map((r) => r.timingMs).filter((t): t is number => typeof t === 'number');
      const correct = rs.filter((r) => r.correct).length;
      return {
        song,
        count: rs.length,
        correct,
        accuracy: correct / rs.length,
        weakMeasures: [...errors]
          .map(([measure, n]) => ({ measure, errors: n }))
          .sort((a, b) => b.errors - a.errors || a.measure - b.measure)
          .slice(0, WEAK_MEASURES),
        meanAbsTimingMs: timings.length ? timings.reduce((s, t) => s + Math.abs(t), 0) / timings.length : null,
        lastPracticed: Math.max(...rs.map((r) => r.timestamp)),
      };
    })
    .sort((a, b) => b.lastPracticed - a.lastPracticed);
}

/** 小節の苦手度の計算に使う、小節ごとの直近の記録数（1か所＝1記録なので、数回弾いたぶん） */
export const MEASURE_RECENT_WINDOW = 40;

export interface MeasureWeightParams {
  /** 間違えた割合にかける重み */
  errorWeight: number;
  /** 記録が少ない小節の間違えた割合を、この値に向けて縮める（まだ弾いていない小節も少し出やすい） */
  priorErrorRate: number;
  /** 事前分布の強さ（仮想的な記録数） */
  priorCount: number;
}

export const DEFAULT_MEASURE_WEIGHT_PARAMS: MeasureWeightParams = { errorWeight: 12, priorErrorRate: 0.1, priorCount: 4 };

/**
 * 抜粋で、間違えやすい小節を多めに出すための重み（小節番号 → 1 以上）。
 * 曲と判定する手が同じ記録の、小節ごとの直近 MEASURE_RECENT_WINDOW か所で、間違えた割合から計算する。
 * 重み = 1 + errorWeight × 間違えた割合（記録が少ないうちは priorErrorRate に寄せる）。
 * 例: まだ弾いていない小節は 2.2、8か所中1か所を1回間違えた小節は 2.4、ずっと弾けている小節は 1 に近づく
 */
export function makeMeasureWeightFn(
  records: readonly AnswerRecord[],
  song: string,
  hands: 'right' | 'left' | 'both',
  params = DEFAULT_MEASURE_WEIGHT_PARAMS,
): (measureNumber: number) => number {
  const groups = new Map<number, AnswerRecord[]>();
  for (const r of records) {
    if (r.mode !== 'song' || r.song !== song || r.measure === undefined || (r.hands ?? 'both') !== hands) continue;
    groups.set(r.measure, [...(groups.get(r.measure) ?? []), r]);
  }
  const rates = new Map<number, number>();
  for (const [measure, rs] of groups) {
    const recent = [...rs].sort((a, b) => a.timestamp - b.timestamp).slice(-MEASURE_RECENT_WINDOW);
    const wrong = recent.filter((r) => !r.correct).length;
    rates.set(measure, (wrong + params.priorErrorRate * params.priorCount) / (recent.length + params.priorCount));
  }
  return (measure) => 1 + params.errorWeight * (rates.get(measure) ?? params.priorErrorRate);
}
