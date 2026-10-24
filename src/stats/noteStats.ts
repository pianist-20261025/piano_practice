import type { Clef } from '../music/clef';
import type { AnswerRecord } from './session';

/** 苦手度の計算に使う、音ごとの直近の回答数 */
export const RECENT_WINDOW = 20;

export interface NoteStat {
  clef: Clef;
  midi: number;
  /** 集計した回答数（直近 RECENT_WINDOW 回まで） */
  count: number;
  correct: number;
  /** 0–1 */
  accuracy: number;
  /** 正解した回答の平均反応時間。正解がなければ null */
  avgCorrectReactionMs: number | null;
  /** 間違えたときに押した音と回数（多い順） */
  confusions: { midi: number; count: number }[];
  /** これまでの全回答数 */
  totalCount: number;
}

export const statKey = (clef: Clef, midi: number) => `${clef}:${midi}`;

/**
 * 単音の記録を「音部記号 × ノート番号」ごとに集計する。
 * 上達が反映されるよう、正答率・反応時間は各音の直近 window 回だけで計算する。
 */
export function aggregateNoteStats(records: readonly AnswerRecord[], window = RECENT_WINDOW): Map<string, NoteStat> {
  const groups = new Map<string, AnswerRecord[]>();
  for (const r of records) {
    if (r.expected.length !== 1) continue;
    const key = statKey(r.clef, r.expected[0]);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const stats = new Map<string, NoteStat>();
  for (const [key, all] of groups) {
    const recent = [...all].sort((a, b) => a.timestamp - b.timestamp).slice(-window);
    const correct = recent.filter((r) => r.correct);
    const confusions = new Map<number, number>();
    for (const r of recent) {
      if (!r.correct) for (const p of r.played) confusions.set(p, (confusions.get(p) ?? 0) + 1);
    }
    stats.set(key, {
      clef: all[0].clef,
      midi: all[0].expected[0],
      count: recent.length,
      correct: correct.length,
      accuracy: correct.length / recent.length,
      avgCorrectReactionMs: correct.length ? correct.reduce((s, r) => s + r.reactionMs, 0) / correct.length : null,
      confusions: [...confusions].map(([midi, count]) => ({ midi, count })).sort((a, b) => b.count - a.count || a.midi - b.midi),
      totalCount: all.length,
    });
  }
  return stats;
}

export interface WeightParams {
  /** 誤答率にかける重み */
  errorWeight: number;
  /** 遅さにかける重み */
  slowWeight: number;
  /** 回答が少ない音の誤答率を、この値に向けて縮める（事前分布） */
  priorErrorRate: number;
  /** 事前分布の強さ（仮想的な回答数） */
  priorCount: number;
}

export const DEFAULT_WEIGHT_PARAMS: WeightParams = { errorWeight: 6, slowWeight: 2, priorErrorRate: 0.2, priorCount: 2 };

/**
 * 出題の重み。1 が基準で、間違えやすい・反応が遅い音ほど大きい（最大で 1 + errorWeight + slowWeight）。
 * - 誤答率は回答数が少ないうちは priorErrorRate に寄せる（1回間違えただけで極端に偏らない）。
 *   まだ出ていない音も priorErrorRate 扱いなので、少し出やすい。
 * - 遅さは、正解時の平均反応時間が全体平均の何倍か（1倍で0、2倍以上で1）。
 */
export function noteWeight(stat: NoteStat | undefined, overallAvgMs: number | null, params = DEFAULT_WEIGHT_PARAMS): number {
  const n = stat?.count ?? 0;
  const wrong = n - (stat?.correct ?? 0);
  const errorRate = (wrong + params.priorErrorRate * params.priorCount) / (n + params.priorCount);
  let slowness = 0;
  if (stat?.avgCorrectReactionMs != null && overallAvgMs) {
    slowness = Math.min(1, Math.max(0, stat.avgCorrectReactionMs / overallAvgMs - 1));
  }
  return 1 + params.errorWeight * errorRate + params.slowWeight * slowness;
}

/** 全体の正解時平均反応時間（各音の平均を回答数で重み付け） */
export function overallAvgCorrectMs(stats: Iterable<NoteStat>): number | null {
  let sum = 0;
  let n = 0;
  for (const s of stats) {
    if (s.avgCorrectReactionMs === null) continue;
    sum += s.avgCorrectReactionMs * s.correct;
    n += s.correct;
  }
  return n ? sum / n : null;
}

/** 記録から「音部記号・ノート番号 → 出題の重み」の関数を作る */
export function makeWeightFn(records: readonly AnswerRecord[], params = DEFAULT_WEIGHT_PARAMS): (clef: Clef, midi: number) => number {
  const stats = aggregateNoteStats(records);
  const overall = overallAvgCorrectMs(stats.values());
  return (clef, midi) => noteWeight(stats.get(statKey(clef, midi)), overall, params);
}
