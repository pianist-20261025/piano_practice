// 楽譜（OSMD のカーソル位置の列）から、判定に使う「ステップ」の列を作る。
// OSMD に依存しない純粋な関数にして、テストで確かめられるようにしている。

export type Hand = 'right' | 'left';
export type HandSetting = Hand | 'both';

export interface RawNote {
  midi: number;
  hand: Hand;
  rest: boolean;
  grace: boolean;
  /** タイでつながった後ろ側の音（押し直し不要） */
  tieContinuation: boolean;
}

/** カーソル位置1つぶん。index は先頭から何番目のカーソル位置か */
export interface RawEntry {
  index: number;
  /** 0 始まりの小節の通し番号（反復しても書かれた位置のまま） */
  measureIndex: number;
  /** 楽譜に書かれた小節番号 */
  measureNumber: number;
  /** 曲頭からの位置（4分音符単位、書かれた順） */
  time: number;
  notes: RawNote[];
}

export interface StepNote {
  midi: number;
  hand: Hand;
  /** RawEntry.notes の何番目か（色付けで使う） */
  rawIndex: number;
}

export interface Step {
  /** 対応するカーソル位置 */
  entryIndex: number;
  measureIndex: number;
  measureNumber: number;
  time: number;
  /** その位置で新しく鳴り始める、判定対象の音（低い順、同じ鍵盤は1つ） */
  notes: StepNote[];
}

/**
 * 判定対象のステップ列を作る。
 * - 休符・装飾音（前打音など）・タイの後ろ側の音は除く。前から伸ばしている音はそもそもカーソル位置に現れない
 * - 片手モードでは、判定しない手の音を除く
 * - 反復記号でカーソルが戻ったときは、すでに通った位置を飛ばす（書かれた順に1回だけ進む）
 * - 判定対象の音が残らない位置はステップにしない（カーソルはそこを通り過ぎる）
 */
export function buildSteps(entries: readonly RawEntry[], hands: HandSetting = 'both'): Step[] {
  const steps: Step[] = [];
  let lastTime = -Infinity;
  for (const entry of entries) {
    if (entry.time <= lastTime) continue;
    lastTime = entry.time;
    const notes: StepNote[] = [];
    entry.notes.forEach((n, rawIndex) => {
      if (n.rest || n.grace || n.tieContinuation) return;
      if (hands !== 'both' && n.hand !== hands) return;
      if (notes.some((x) => x.midi === n.midi)) return;
      notes.push({ midi: n.midi, hand: n.hand, rawIndex });
    });
    if (!notes.length) continue;
    notes.sort((a, b) => a.midi - b.midi);
    steps.push({ entryIndex: entry.index, measureIndex: entry.measureIndex, measureNumber: entry.measureNumber, time: entry.time, notes });
  }
  return steps;
}
