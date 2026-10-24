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
