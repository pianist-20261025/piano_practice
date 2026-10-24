/** 時刻（4分音符単位）→ 楽譜上の x 座標。音符の位置の間を直線でつなぐ（スクロール用） */
export function makeTimeline(points: readonly { time: number; x: number }[]): (time: number) => number {
  // 同じ時刻の点は1つにする（0 で割らないため）
  const ps = [...points].sort((a, b) => a.time - b.time).filter((p, i, all) => i === 0 || p.time > all[i - 1].time);
  if (!ps.length) return () => 0;
  if (ps.length === 1) return () => ps[0].x;
  return (time) => {
    // 範囲外は両端の傾きで延ばす（カウント中も一定の速さで流れてくるように）
    let i = ps.findIndex((p) => p.time > time);
    if (i <= 0) i = i === 0 ? 1 : ps.length - 1;
    const a = ps[i - 1];
    const b = ps[i];
    return a.x + ((time - a.time) / (b.time - a.time)) * (b.x - a.x);
  };
}
