import { generateSingleNote, type DiatonicRange, type KeySetting, type SingleNoteQuestion } from '../generator/singleNote';
import { InputHub } from '../input/hub';
import { PcKeyboardInput } from '../input/pcKeyboard';
import { VirtualKeyboard } from '../input/virtualKeyboard';
import { judgeAttempt, type JudgeOptions } from '../judge/judge';
import { MidiInput, type MidiStatus } from '../midi/midiInput';
import type { NoteEvent } from '../midi/types';
import { CLEFS, CLEF_LABELS, ledgerLinesAt, staffRange, type Clef } from '../music/clef';
import { KEY_FIFTHS_RANGE, keyLabel, spellMidiInKey } from '../music/key';
import { diatonicIndex, pitchFromDiatonic, pitchName, pitchToMidi, type Pitch } from '../music/pitch';
import { StaffRenderer, type StaffColors, type StaffLayout } from '../render/staffRenderer';
import { makeWeightFn } from '../stats/noteStats';
import { summarize, type AnswerRecord } from '../stats/session';
import {
  IndexedDbRecordStore,
  MemoryRecordStore,
  exportRecords,
  newRecordsOnly,
  parseExportedRecords,
  type RecordStore,
} from '../stats/store';
import { renderStats } from './statsView';

interface Settings {
  limitKind: 'count' | 'time';
  count: number;
  seconds: number;
  layout: StaffLayout;
  ranges: Record<Clef, DiatonicRange>;
  keyKind: KeySetting['kind'];
  keyFifths: number;
  keyMaxAccidentals: number;
  accidentals: boolean;
  octaveEquivalent: boolean;
  /** 苦手な音を多めに出す */
  focusWeak: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  limitKind: 'count',
  count: 20,
  seconds: 60,
  layout: 'treble',
  ranges: { treble: staffRange('treble', 1), bass: staffRange('bass', 1) },
  keyKind: 'none',
  keyFifths: 0,
  keyMaxAccidentals: 4,
  accidentals: false,
  octaveEquivalent: false,
  focusWeak: true,
};
const SETTINGS_KEY = 'sight-reader:settings';
/** 音域の選択肢として出す加線の最大本数 */
const MAX_LEDGER_LINES = 4;
/** 正解してから次の問題を出すまでの間 */
const NEXT_DELAY_MS = 350;

const LAYOUT_LABELS: Record<StaffLayout, string> = { treble: 'ト音記号', bass: 'ヘ音記号', grand: '大譜表' };

interface Question extends SingleNoteQuestion {
  midi: number;
  shownAt: number;
  attempts: number;
  record: AnswerRecord | null;
  /** 最初に押した音（譜面上の綴り） */
  firstPlayed: Pitch | null;
  saved: boolean;
}

type View = 'setup' | 'practice' | 'result' | 'stats';
const VIEWS: readonly View[] = ['setup', 'practice', 'result', 'stats'];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class App {
  private hub = new InputHub();
  private settings = loadSettings();
  private records: AnswerRecord[] = [];
  private answered: Question[] = [];
  private question: Question | null = null;
  private running = false;
  private advancing = false;
  private deadline = 0;
  private tickTimer: number | undefined;
  private staff = new StaffRenderer($('#staff'), readColors);
  private keyboard!: VirtualKeyboard;
  private store: RecordStore = new IndexedDbRecordStore();
  /** 保存済みの全記録（苦手音の重み付けと統計に使う） */
  private history: AnswerRecord[] = [];
  private view: View = 'setup';
  private viewBeforeStats: View = 'setup';

  start(): void {
    this.keyboard = new VirtualKeyboard($('#keyboard'), this.hub.emit);
    const pc = new PcKeyboardInput(this.hub.emit, (base) => this.showOctave(base));
    pc.attach();
    this.showOctave(pc.base);
    new MidiInput(this.hub.emit, (s) => this.showMidiStatus(s)).start();

    this.hub.subscribe((ev) => {
      this.keyboard.setHeld(ev.note, ev.type === 'on');
      if (ev.type === 'on') this.handleNoteOn(ev);
    });

    this.bindSettingsForm();
    $('#start').addEventListener('click', () => this.startSession());
    $('#stop').addEventListener('click', () => this.finishSession());
    $('#again').addEventListener('click', () => this.startSession());
    $('#back').addEventListener('click', () => this.showView('setup'));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && !this.running && !isFormControl(e.target)) this.startSession();
      if (e.code === 'Escape' && this.running) this.finishSession();
    });
    $('#show-stats').addEventListener('click', () => this.openStats());
    $('#result-stats').addEventListener('click', () => this.openStats());
    $('#stats-back').addEventListener('click', () => this.showView(this.viewBeforeStats));
    $('#export-records').addEventListener('click', () => this.exportHistory());
    $<HTMLInputElement>('#import-records').addEventListener('change', (e) => this.importHistory(e.target as HTMLInputElement));
    $('#clear-records').addEventListener('click', () => this.clearHistory());
    this.showView('setup');
    this.scrollKeyboardToRange();
    this.loadHistory();
  }

  // ---- 記録 ----

  private async loadHistory(): Promise<void> {
    try {
      this.history = await this.store.all();
    } catch (e) {
      console.error(e);
      this.store = new MemoryRecordStore();
      this.showStorageWarning('記録を保存できません（このブラウザでは IndexedDB が使えないため、記録はタブを閉じると消えます）');
    }
    this.updateHistoryCount();
  }

  /** 1問ぶんの記録を保存する。やり直しの回数を含めたいので、正解したとき（または終了時）に保存する */
  private persist(q: Question): void {
    if (!q.record || q.saved) return;
    q.saved = true;
    const record = { ...q.record };
    this.history.push(record);
    this.updateHistoryCount();
    this.store.add(record).catch((e) => {
      console.error(e);
      this.showStorageWarning('記録の保存に失敗しました');
    });
  }

  private updateHistoryCount(): void {
    $('#history-count').textContent = this.history.length ? `これまでの記録 ${this.history.length} 問` : 'まだ記録はありません';
  }

  private showStorageWarning(message: string): void {
    const el = $('#storage-warning');
    el.textContent = message;
    el.hidden = false;
  }

  private openStats(): void {
    if (this.view !== 'stats') this.viewBeforeStats = this.view;
    renderStats($('#stats-body'), this.history);
    this.showView('stats');
  }

  private exportHistory(): void {
    const blob = new Blob([exportRecords(this.history)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sight-reader-records-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private async importHistory(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const incoming = newRecordsOnly(this.history, parseExportedRecords(await file.text()));
      await this.store.addMany(incoming);
      this.history.push(...incoming);
      this.updateHistoryCount();
      renderStats($('#stats-body'), this.history);
      alert(`${incoming.length} 問ぶんの記録を読み込みました`);
    } catch (e) {
      alert(`読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async clearHistory(): Promise<void> {
    if (!confirm(`これまでの記録 ${this.history.length} 問をすべて消します。元に戻せません。よろしいですか？`)) return;
    await this.store.clear();
    this.history = [];
    this.updateHistoryCount();
    renderStats($('#stats-body'), this.history);
  }

  // ---- セッション ----

  private startSession(): void {
    this.records = [];
    this.answered = [];
    this.question = null;
    this.running = true;
    this.advancing = false;
    this.showView('practice');
    this.scrollKeyboardToRange();
    $('#feedback').textContent = '';
    $('#reaction').textContent = '';
    if (this.settings.limitKind === 'time') {
      this.deadline = performance.now() + this.settings.seconds * 1000;
      this.tickTimer = window.setInterval(() => this.tick(), 200);
    }
    this.nextQuestion();
  }

  private tick(): void {
    if (performance.now() >= this.deadline) this.finishSession();
    else this.updateProgress();
  }

  private nextQuestion(): void {
    this.advancing = false;
    if (this.settings.limitKind === 'count' && this.records.length >= this.settings.count) {
      this.finishSession();
      return;
    }
    const s = this.settings;
    const generated = generateSingleNote(
      {
        clefs: s.layout === 'grand' ? CLEFS : [s.layout],
        ranges: s.ranges,
        key: keySetting(s),
        accidentals: s.accidentals,
        weight: s.focusWeak ? makeWeightFn(this.history) : undefined,
      },
      Math.random,
      this.question ?? undefined,
    );
    this.question = {
      ...generated,
      midi: pitchToMidi(generated.pitch),
      shownAt: 0,
      attempts: 0,
      record: null,
      firstPlayed: null,
      saved: false,
    };
    this.renderQuestion('pending');
    this.question.shownAt = performance.now();
    $('#feedback').textContent = '';
    $('#feedback').className = '';
    $('#key-name').textContent = generated.keyFifths !== 0 || s.keyKind !== 'none' ? keyLabel(generated.keyFifths) : '';
    this.updateProgress();
  }

  private renderQuestion(status: 'pending' | 'correct' | 'wrong', played?: Pitch): void {
    const q = this.question!;
    this.staff.render({
      layout: this.settings.layout,
      clef: q.clef,
      keyFifths: q.keyFifths,
      expected: q.pitch,
      status,
      played,
    });
  }

  private handleNoteOn(ev: NoteEvent): void {
    const q = this.question;
    if (!this.running || this.advancing || !q) return;
    const judgeOptions: JudgeOptions = { octaveEquivalent: this.settings.octaveEquivalent };
    const result = judgeAttempt([q.midi], { notes: [ev.note], time: ev.time }, q.shownAt, judgeOptions);
    const played = spellMidiInKey(ev.note, q.keyFifths, diatonicIndex(q.pitch));
    q.attempts++;
    if (!q.record) {
      q.record = {
        timestamp: Date.now(),
        mode: 'reflex',
        clef: q.clef,
        keyFifths: q.keyFifths,
        expected: [q.midi],
        played: [ev.note],
        correct: result.isCorrect,
        reactionMs: result.reactionMs,
        attempts: 1,
      };
      q.firstPlayed = played;
      this.records.push(q.record);
      this.answered.push(q);
      $('#reaction').textContent = `反応時間 ${formatMs(result.reactionMs)}`;
    } else {
      q.record.attempts = q.attempts;
    }

    const feedback = $('#feedback');
    if (result.isCorrect) {
      this.renderQuestion('correct');
      feedback.textContent = q.attempts === 1 ? '正解' : '正解（やり直し）';
      feedback.className = 'ok';
      this.advancing = true;
      this.persist(q);
      this.updateProgress();
      window.setTimeout(() => this.running && this.nextQuestion(), NEXT_DELAY_MS);
    } else {
      this.renderQuestion('wrong', played);
      feedback.textContent = `押した音: ${pitchName(played)}`;
      feedback.className = 'ng';
      this.updateProgress();
    }
  }

  private finishSession(): void {
    if (!this.running) return;
    this.running = false;
    window.clearInterval(this.tickTimer);
    if (this.question) this.persist(this.question);
    this.renderResult();
    this.showView('result');
  }

  // ---- 表示 ----

  private updateProgress(): void {
    const s = summarize(this.records);
    const left =
      this.settings.limitKind === 'count'
        ? `${Math.min(this.records.length + (this.question?.record ? 0 : 1), this.settings.count)} / ${this.settings.count} 問`
        : `残り ${Math.max(0, Math.ceil((this.deadline - performance.now()) / 1000))} 秒`;
    $('#progress').textContent = `${left}　正解 ${s.correct} / ${s.total}`;
  }

  private renderResult(): void {
    const s = summarize(this.records);
    $('#summary').innerHTML = `
      <div class="stat"><span class="label">正答率</span><span class="value">${s.total ? Math.round(s.accuracy * 100) : 0}<small>%</small></span><span class="sub">${s.correct} / ${s.total} 問</span></div>
      <div class="stat"><span class="label">平均反応時間</span><span class="value">${s.avgReactionMs === null ? '—' : formatMs(s.avgReactionMs)}</span><span class="sub">全問の最初の押鍵まで</span></div>
      <div class="stat"><span class="label">正解時の平均</span><span class="value">${s.avgCorrectReactionMs === null ? '—' : formatMs(s.avgCorrectReactionMs)}</span><span class="sub">1回目で正解した問題</span></div>`;
    const showKey = this.settings.keyKind !== 'none';
    $('#col-key').hidden = !showKey;
    const rows = this.answered.map((q, i) => {
      const r = q.record!;
      const key = showKey ? `<td>${keyShort(q.keyFifths)}</td>` : '';
      return `<tr class="${r.correct ? 'ok' : 'ng'}"><td>${i + 1}</td>${key}<td>${CLEF_LABELS[q.clef].slice(0, 2)}</td><td>${pitchName(q.pitch)}</td><td class="played">${r.correct ? '○' : pitchName(q.firstPlayed!)}</td><td>${formatMs(r.reactionMs)}</td><td>${r.attempts}</td></tr>`;
    });
    $('#answers').innerHTML = rows.join('') || '<tr><td colspan="7">回答なし</td></tr>';
  }

  private showView(view: View): void {
    this.view = view;
    for (const v of VIEWS) $(`#${v}`).hidden = v !== view;
  }

  private scrollKeyboardToRange(): void {
    const s = this.settings;
    const clefs = s.layout === 'grand' ? CLEFS : [s.layout];
    const lows = clefs.map((c) => Math.min(s.ranges[c].low, s.ranges[c].high));
    const highs = clefs.map((c) => Math.max(s.ranges[c].low, s.ranges[c].high));
    const mid = Math.round((Math.min(...lows) + Math.max(...highs)) / 2);
    this.keyboard.scrollToNote(pitchToMidi(pitchFromDiatonic(mid)));
  }

  private showMidiStatus(status: MidiStatus): void {
    const el = $('#midi-status');
    el.className = 'midi-status';
    if (status.kind === 'unsupported') {
      el.textContent = 'このブラウザは Web MIDI 非対応（Chrome を使ってください）';
      el.classList.add('warn');
    } else if (status.kind === 'denied') {
      el.textContent = `MIDI を使えません: ${status.message}`;
      el.classList.add('warn');
    } else if (status.devices.length === 0) {
      el.textContent = 'MIDI デバイス未接続（仮想鍵盤・PCキーボードで入力できます）';
    } else {
      el.textContent = `MIDI: ${status.devices.join(', ')}`;
      el.classList.add('connected');
    }
  }

  private showOctave(base: number): void {
    $('#octave').textContent = `PCキーボード: A = C${base / 12 - 1}（Z / X でオクターブ移動）`;
  }

  // ---- 設定 ----

  private bindSettingsForm(): void {
    const form = $<HTMLFormElement>('#settings');
    const radio = (name: string) => form.elements.namedItem(name) as RadioNodeList;
    const s = this.settings;

    for (const clef of CLEFS) {
      for (const end of ['low', 'high'] as const) {
        const select = $<HTMLSelectElement>(`#range-${clef}-${end}`);
        select.innerHTML = rangeOptions(clef);
        select.value = String(s.ranges[clef][end]);
      }
    }
    $<HTMLSelectElement>('#key-fifths').innerHTML = Array.from(
      { length: KEY_FIFTHS_RANGE.max - KEY_FIFTHS_RANGE.min + 1 },
      (_, i) => KEY_FIFTHS_RANGE.min + i,
    )
      .map((f) => `<option value="${f}">${keyLabel(f)}</option>`)
      .join('');

    radio('limitKind').value = s.limitKind;
    radio('layout').value = s.layout;
    radio('keyKind').value = s.keyKind;
    $<HTMLInputElement>('#count').value = String(s.count);
    $<HTMLInputElement>('#seconds').value = String(s.seconds);
    $<HTMLSelectElement>('#key-fifths').value = String(s.keyFifths);
    $<HTMLSelectElement>('#key-max').value = String(s.keyMaxAccidentals);
    $<HTMLInputElement>('#accidentals').checked = s.accidentals;
    $<HTMLInputElement>('#octave-eq').checked = s.octaveEquivalent;
    $<HTMLInputElement>('#focus-weak').checked = s.focusWeak;

    const sync = () => {
      const range = (clef: Clef): DiatonicRange => {
        const a = Number($<HTMLSelectElement>(`#range-${clef}-low`).value);
        const b = Number($<HTMLSelectElement>(`#range-${clef}-high`).value);
        return { low: Math.min(a, b), high: Math.max(a, b) };
      };
      const layout = radio('layout').value as StaffLayout;
      const keyKind = radio('keyKind').value as Settings['keyKind'];
      this.settings = {
        limitKind: radio('limitKind').value === 'time' ? 'time' : 'count',
        count: clampInt($<HTMLInputElement>('#count').value, 1, 500, DEFAULT_SETTINGS.count),
        seconds: clampInt($<HTMLInputElement>('#seconds').value, 10, 3600, DEFAULT_SETTINGS.seconds),
        layout,
        ranges: { treble: range('treble'), bass: range('bass') },
        keyKind,
        keyFifths: clampInt($<HTMLSelectElement>('#key-fifths').value, -7, 7, 0),
        keyMaxAccidentals: clampInt($<HTMLSelectElement>('#key-max').value, 1, 7, DEFAULT_SETTINGS.keyMaxAccidentals),
        accidentals: $<HTMLInputElement>('#accidentals').checked,
        octaveEquivalent: $<HTMLInputElement>('#octave-eq').checked,
        focusWeak: $<HTMLInputElement>('#focus-weak').checked,
      };
      const dim = (sel: string, off: boolean) => $(sel).classList.toggle('dim', off);
      dim('#count-label', this.settings.limitKind !== 'count');
      dim('#seconds-label', this.settings.limitKind !== 'time');
      dim('#range-treble', layout === 'bass');
      dim('#range-bass', layout === 'treble');
      dim('#key-fifths-label', keyKind !== 'fixed');
      dim('#key-max-label', keyKind !== 'random');
      $('#mode-label').textContent = `反射モード・${LAYOUT_LABELS[layout]}`;
      saveSettings(this.settings);
    };
    form.addEventListener('input', () => {
      sync();
      this.scrollKeyboardToRange();
    });
    form.addEventListener('submit', (e) => e.preventDefault());
    sync();
  }
}

function keySetting(s: Settings): KeySetting {
  if (s.keyKind === 'fixed') return { kind: 'fixed', fifths: s.keyFifths };
  if (s.keyKind === 'random') return { kind: 'random', maxAccidentals: s.keyMaxAccidentals };
  return { kind: 'none' };
}

/** 音域のセレクトの選択肢（高い音が上） */
function rangeOptions(clef: Clef): string {
  const { low, high } = staffRange(clef, MAX_LEDGER_LINES);
  const options: string[] = [];
  for (let d = high; d >= low; d--) {
    const n = ledgerLinesAt(clef, d);
    options.push(`<option value="${d}">${pitchName(pitchFromDiatonic(d))}${n ? `（加線${n}本）` : ''}</option>`);
  }
  return options.join('');
}

function keyShort(fifths: number): string {
  return fifths === 0 ? '—' : fifths > 0 ? `♯${fifths}` : `♭${-fifths}`;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...saved, ranges: { ...DEFAULT_SETTINGS.ranges, ...saved.ranges } };
    }
  } catch {
    /* 保存領域が使えなくても既定値で動く */
  }
  return structuredClone(DEFAULT_SETTINGS);
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 無視 */
  }
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} 秒` : `${Math.round(ms)} ms`;
}

function isFormControl(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName);
}

function readColors(): StaffColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { ink: v('--ink'), correct: v('--correct'), wrong: v('--wrong') };
}
