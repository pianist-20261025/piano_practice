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
  /** 書かれた長さ（4分音符単位）。タイの後ろ側はその音符ぶんだけ */
  duration: number;
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
  /** どのカーソル位置の、RawEntry.notes の何番目の音か（色付けで使う） */
  entryIndex: number;
  rawIndex: number;
  /**
   * 同じ鍵盤の音が複数の声部に重なって書かれているとき（1つにまとめて判定する）の、元の音符すべて。
   * 色付けは全部に行う（片方だけタイが付いていることがあるため）
   */
  refs: { entryIndex: number; rawIndex: number }[];
  /**
   * 同じ高さの音がまだ鳴っている（別の声部の長い音やタイが続いている）ところに書かれた音。
   * ピアノでは鍵盤を押したままのことが多く、押し直しが起きないので、押さえたままなら弾けたとみなす
   */
  sustained: boolean;
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
/**
 * 時刻の比較に使う許容幅（4分音符単位）。MusicXML の連符の長さは割り切れないことがあり
 * （例: 3連符の 1/3 拍が 0.33333 で書かれる）、足し合わせた時刻にわずかな端数が出るため。
 */
export const TIME_EPS = 1e-3;

export function buildSteps(entries: readonly RawEntry[], hands: HandSetting = 'both'): Step[] {
  const steps: Step[] = [];
  let lastTime = -Infinity;
  /** これまでに鳴り始めた音の、鳴っている区間（両手とも。片手モードでも楽譜上の持続は同じ） */
  let sounding: { midi: number; start: number; end: number }[] = [];
  /** 端数のずれで別のカーソル位置に分かれた、同じ時刻の音をまとめるための直前の位置 */
  let group: { time: number; notes: StepNote[]; entry: RawEntry; held: Set<number> } | null = null;

  const flush = () => {
    if (group?.notes.length) {
      group.notes.sort((a, b) => a.midi - b.midi);
      const e = group.entry;
      steps.push({ entryIndex: e.index, measureIndex: e.measureIndex, measureNumber: e.measureNumber, time: e.time, notes: group.notes });
    }
    group = null;
  };

  for (const entry of entries) {
    const t = entry.time;
    // 反復記号でカーソルが戻った位置は飛ばす
    if (t < lastTime - TIME_EPS) continue;
    if (!group || t > group.time + TIME_EPS) {
      flush();
      sounding = sounding.filter((x) => x.end > t + TIME_EPS);
      // この位置より前から鳴り続けている音
      const held = new Set(sounding.filter((x) => x.start < t - TIME_EPS).map((x) => x.midi));
      group = { time: t, notes: [], entry, held };
    }
    lastTime = Math.max(lastTime, t);
    const g = group;
    // この位置でタイが続いている音も、鳴り続けている音
    for (const n of entry.notes) if (n.tieContinuation && !n.rest) g.held.add(n.midi);
    entry.notes.forEach((n, rawIndex) => {
      if (n.rest || n.grace || n.tieContinuation) return;
      if (hands !== 'both' && n.hand !== hands) return;
      const ref = { entryIndex: entry.index, rawIndex };
      const same = g.notes.find((x) => x.midi === n.midi);
      if (same) {
        same.refs.push(ref);
        return;
      }
      g.notes.push({ midi: n.midi, hand: n.hand, ...ref, refs: [ref], sustained: false });
    });
    for (const n of entry.notes) {
      if (!n.rest && !n.grace && n.duration > 0) sounding.push({ midi: n.midi, start: g.time, end: g.time + n.duration });
    }
    for (const n of g.notes) n.sustained = g.held.has(n.midi);
  }
  flush();
  return steps;
}
