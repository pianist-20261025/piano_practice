import { RECENT_WINDOW } from './noteStats';
import type { AnswerRecord } from './session';

export interface ShapeStat {
  shape: string;
  /** 集計した回答数（直近 RECENT_WINDOW 回まで） */
  count: number;
  correct: number;
  accuracy: number;
  avgCorrectReactionMs: number | null;
  totalCount: number;
}

/** 形で読むモードの記録を形ごとに集計する（直近 window 回） */
export function aggregateShapeStats(records: readonly AnswerRecord[], window = RECENT_WINDOW): ShapeStat[] {
  const groups = new Map<string, AnswerRecord[]>();
  for (const r of records) {
    if (r.mode !== 'shape' || !r.shape) continue;
    groups.set(r.shape, [...(groups.get(r.shape) ?? []), r]);
  }
  return [...groups].map(([shape, all]) => {
    const recent = [...all].sort((a, b) => a.timestamp - b.timestamp).slice(-window);
    const correct = recent.filter((r) => r.correct);
    return {
      shape,
      count: recent.length,
      correct: correct.length,
      accuracy: correct.length / recent.length,
      avgCorrectReactionMs: correct.length ? correct.reduce((s, r) => s + r.reactionMs, 0) / correct.length : null,
      totalCount: all.length,
    };
  });
}
