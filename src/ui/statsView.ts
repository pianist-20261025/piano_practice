import { CLEFS, CLEF_LABELS, staffRange, type Clef } from '../music/clef';
import { pitchFromDiatonic, pitchName, pitchToMidi, spellMidi } from '../music/pitch';
import {
  aggregateNoteStats,
  noteWeight,
  overallAvgCorrectMs,
  RECENT_WINDOW,
  statKey,
  type NoteStat,
} from '../stats/noteStats';
import { SHAPES, shapeById } from '../generator/shape';
import { summarize, type AnswerRecord } from '../stats/session';
import { aggregateShapeStats } from '../stats/shapeStats';

/** 誤答率の区切り。ヒートマップの色の段階（0〜4）に対応 */
const MISS_BINS = [0, 0.1, 0.25, 0.5];
const BIN_LABELS = ['0%', '〜10%', '〜25%', '〜50%', '50%〜'];
const PITCH_CLASS_LABELS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const WEAK_LIST_SIZE = 10;
const SHAPE_IDS = SHAPES.map((s) => s.id);

export function missBin(accuracy: number): number {
  const miss = 1 - accuracy;
  if (miss <= MISS_BINS[0]) return 0;
  for (let i = 1; i < MISS_BINS.length; i++) if (miss <= MISS_BINS[i]) return i;
  return MISS_BINS.length;
}

/** 統計画面。記録全体から、音ごとの正答率・反応時間のヒートマップと苦手な音の一覧を描く */
export function renderStats(container: HTMLElement, records: readonly AnswerRecord[]): void {
  const stats = aggregateNoteStats(records);
  const overall = overallAvgCorrectMs(stats.values());
  const all = summarize(records);
  const shapeStats = aggregateShapeStats(records);

  const tiles = `
    <div class="summary">
      <div class="stat"><span class="label">記録した回答</span><span class="value">${all.total}<small>問</small></span><span class="sub">${countDays(records)} 日分</span></div>
      <div class="stat"><span class="label">正答率（全期間）</span><span class="value">${all.total ? Math.round(all.accuracy * 100) : 0}<small>%</small></span><span class="sub">${all.correct} / ${all.total} 問</span></div>
      <div class="stat"><span class="label">正解時の平均反応</span><span class="value">${fmtMs(all.avgCorrectReactionMs)}</span><span class="sub">全期間</span></div>
    </div>`;

  if (!stats.size && !shapeStats.length) {
    container.innerHTML = `${tiles}<p class="empty">まだ記録がありません。練習すると、音ごとの正答率と反応時間がここに出ます。</p>`;
    return;
  }

  const shapeOrder = (id: string) => SHAPE_IDS.indexOf(id);
  const shapeSection = shapeStats.length
    ? `<h3>形ごとの正答率（形で読むモード）</h3>
    <p class="note-text">各形の直近${RECENT_WINDOW}回で計算。</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>形</th><th class="num">直近の回答</th><th class="num">正答率</th><th class="num">正解時の反応</th><th class="num">全回答</th></tr></thead>
        <tbody>${[...shapeStats]
          .sort((a, b) => shapeOrder(a.shape) - shapeOrder(b.shape))
          .map(
            (x) => `<tr><td class="note">${shapeById(x.shape)?.label ?? x.shape}</td><td class="num">${x.count}</td><td class="num">${Math.round(x.accuracy * 100)}%</td><td class="num">${fmtMs(x.avgCorrectReactionMs)}</td><td class="num">${x.totalCount}</td></tr>`,
          )
          .join('')}</tbody>
      </table>
    </div>`
    : '';
  if (!stats.size) {
    container.innerHTML = `${tiles}${shapeSection}`;
    return;
  }

  const heatmaps = CLEFS.filter((clef) => [...stats.values()].some((s) => s.clef === clef))
    .map((clef) => heatmap(clef, stats, overall))
    .join('');

  const weak = [...stats.values()]
    .map((s) => ({ s, w: noteWeight(s, overall) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, WEAK_LIST_SIZE);
  const weakRows = weak
    .map(
      ({ s, w }) => `<tr>
        <td>${CLEF_LABELS[s.clef].slice(0, 2)}</td>
        <td class="note">${pitchName(spellMidi(s.midi))}</td>
        <td class="num">${s.count}</td>
        <td class="num">${Math.round(s.accuracy * 100)}%</td>
        <td class="num">${fmtMs(s.avgCorrectReactionMs)}</td>
        <td>${confusionText(s) || '—'}</td>
        <td class="num">×${w.toFixed(1)}</td>
      </tr>`,
    )
    .join('');

  container.innerHTML = `${tiles}
    <h3>音ごとの正答率（反射モード）</h3>
    <p class="note-text">凡例の右側の色ほど間違えやすい音です（各音の直近${RECENT_WINDOW}回で計算。「遅」は正解時の反応が全体平均より3割以上遅い音）。マスにカーソルを合わせると詳細が出ます。</p>
    <div class="heat-legend" aria-label="凡例">
      <span>誤答率</span>
      ${BIN_LABELS.map((l, i) => `<span class="heat-key"><i class="heat-${i}"></i>${l}</span>`).join('')}
      <span class="heat-key"><i class="heat-none"></i>未出題</span>
    </div>
    ${heatmaps}
    <h3>苦手な音 トップ${WEAK_LIST_SIZE}</h3>
    <p class="note-text">「出やすさ」は苦手音の重点出題での重み（正答率100%で速い音が ×1.0）。</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>段</th><th>音</th><th class="num">直近の回答</th><th class="num">正答率</th><th class="num">正解時の反応</th><th>よく押し間違える音</th><th class="num">出やすさ</th></tr></thead>
        <tbody>${weakRows}</tbody>
      </table>
    </div>
    ${shapeSection}`;

  attachTooltip(container, stats, overall);
}

function heatmap(clef: Clef, stats: Map<string, NoteStat>, overall: number | null): string {
  const range = staffRange(clef, 4);
  const low = pitchToMidi(pitchFromDiatonic(range.low));
  const high = pitchToMidi(pitchFromDiatonic(range.high));
  const octaves: number[] = [];
  for (let o = Math.floor(high / 12) - 1; o >= Math.floor(low / 12) - 1; o--) octaves.push(o);

  const header = `<div class="heat-corner"></div>${PITCH_CLASS_LABELS.map((l) => `<div class="heat-col">${l}</div>`).join('')}`;
  const rows = octaves
    .map((o) => {
      const cells = PITCH_CLASS_LABELS.map((_, pc) => {
        const midi = (o + 1) * 12 + pc;
        if (midi < low || midi > high) return '<div class="heat-cell out"></div>';
        const s = stats.get(statKey(clef, midi));
        const name = pitchName(spellMidi(midi));
        if (!s) return `<div class="heat-cell heat-none" data-key="${statKey(clef, midi)}" data-name="${name}"></div>`;
        const slow = noteWeight(s, overall) - noteWeight({ ...s, avgCorrectReactionMs: null }, overall) > 0.6;
        return `<div class="heat-cell heat-${missBin(s.accuracy)}" data-key="${statKey(clef, midi)}" data-name="${name}">
          <span class="pct">${Math.round(s.accuracy * 100)}</span><span class="ms">${s.avgCorrectReactionMs === null ? '' : `${(s.avgCorrectReactionMs / 1000).toFixed(1)}s`}${slow ? ' 遅' : ''}</span></div>`;
      }).join('');
      return `<div class="heat-row-label">${o}</div>${cells}`;
    })
    .join('');
  return `<div class="heat-block"><div class="heat-title">${CLEF_LABELS[clef]}</div><div class="heatmap">${header}${rows}</div></div>`;
}

function attachTooltip(container: HTMLElement, stats: Map<string, NoteStat>, overall: number | null): void {
  const tip = document.createElement('div');
  tip.className = 'heat-tip';
  tip.hidden = true;
  container.append(tip);
  container.querySelectorAll<HTMLElement>('.heat-cell[data-key]').forEach((cell) => {
    cell.addEventListener('pointerenter', () => {
      const s = stats.get(cell.dataset.key!);
      const [clef] = cell.dataset.key!.split(':') as [Clef];
      tip.innerHTML = s
        ? `<b>${cell.dataset.name}</b>（${CLEF_LABELS[clef]}）<br>
           正答率 ${Math.round(s.accuracy * 100)}%（直近 ${s.correct}/${s.count}、全 ${s.totalCount} 回）<br>
           正解時の平均反応 ${fmtMs(s.avgCorrectReactionMs)}<br>
           ${s.confusions.length ? `押し間違えた音: ${confusionText(s)}<br>` : ''}
           出やすさ ×${noteWeight(s, overall).toFixed(1)}`
        : `<b>${cell.dataset.name}</b>（${CLEF_LABELS[clef]}）<br>まだ出題されていません`;
      tip.hidden = false;
      const c = container.getBoundingClientRect();
      const r = cell.getBoundingClientRect();
      tip.style.left = `${Math.min(r.left - c.left, c.width - 260)}px`;
      tip.style.top = `${r.bottom - c.top + 6}px`;
    });
    cell.addEventListener('pointerleave', () => (tip.hidden = true));
  });
}

function confusionText(s: NoteStat): string {
  return s.confusions
    .slice(0, 3)
    .map((c) => `${pitchName(spellMidi(c.midi, undefined))}×${c.count}`)
    .join('、');
}

function countDays(records: readonly AnswerRecord[]): number {
  return new Set(records.map((r) => new Date(r.timestamp).toDateString())).size;
}

function fmtMs(ms: number | null): string {
  if (ms === null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} 秒` : `${Math.round(ms)} ms`;
}
