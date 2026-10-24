import type { AnswerRecord } from './session';

export interface FlowSessionStat {
  session: number;
  bpm: number | null;
  notes: number;
  correct: number;
  accuracy: number;
  /** 押せた音のずれの絶対値の平均 */
  meanAbsTimingMs: number | null;
  /** 押せた音のずれの平均（正なら遅れ気味） */
  meanTimingMs: number | null;
}

/** 流れ読みの記録を1回の練習ごとにまとめる（新しい順） */
export function aggregateFlowSessions(records: readonly AnswerRecord[], limit = 10): FlowSessionStat[] {
  const groups = new Map<number, AnswerRecord[]>();
  for (const r of records) {
    if (r.mode !== 'flow') continue;
    const key = r.session ?? r.timestamp;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups]
    .sort((a, b) => b[0] - a[0])
    .slice(0, limit)
    .map(([session, rs]) => {
      const timings = rs.map((r) => r.timingMs).filter((t): t is number => typeof t === 'number');
      const correct = rs.filter((r) => r.correct).length;
      return {
        session,
        bpm: rs[0].bpm ?? null,
        notes: rs.length,
        correct,
        accuracy: correct / rs.length,
        meanAbsTimingMs: timings.length ? timings.reduce((s, t) => s + Math.abs(t), 0) / timings.length : null,
        meanTimingMs: timings.length ? timings.reduce((s, t) => s + t, 0) / timings.length : null,
      };
    });
}
