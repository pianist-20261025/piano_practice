import { generateSingleNote } from '../generator/singleNote';
import { InputHub } from '../input/hub';
import { PcKeyboardInput } from '../input/pcKeyboard';
import { VirtualKeyboard } from '../input/virtualKeyboard';
import { judgeAttempt, type JudgeOptions } from '../judge/judge';
import { MidiInput, type MidiStatus } from '../midi/midiInput';
import type { NoteEvent } from '../midi/types';
import type { Clef } from '../music/clef';
import { pitchName, pitchToMidi, spellMidi, diatonicIndex, type Pitch } from '../music/pitch';
import { StaffRenderer, type StaffColors } from '../render/staffRenderer';
import { summarize, type AnswerRecord } from '../stats/session';

interface Settings {
  limitKind: 'count' | 'time';
  count: number;
  seconds: number;
  ledgerLines: number;
  octaveEquivalent: boolean;
}

const DEFAULT_SETTINGS: Settings = { limitKind: 'count', count: 20, seconds: 60, ledgerLines: 1, octaveEquivalent: false };
const SETTINGS_KEY = 'sight-reader:settings';
/** 正解してから次の問題を出すまでの間 */
const NEXT_DELAY_MS = 350;

interface Question {
  pitch: Pitch;
  midi: number;
  shownAt: number;
  attempts: number;
  record: AnswerRecord | null;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class App {
  private hub = new InputHub();
  private settings = loadSettings();
  private clef: Clef = 'treble';
  private records: AnswerRecord[] = [];
  private question: Question | null = null;
  private running = false;
  private advancing = false;
  private deadline = 0;
  private tickTimer: number | undefined;
  private staff = new StaffRenderer($('#staff'), readColors);
  private keyboard!: VirtualKeyboard;

  start(): void {
    this.keyboard = new VirtualKeyboard($('#keyboard'), this.hub.emit);
    this.keyboard.scrollToNote(72);
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
    this.showView('setup');
  }

  // ---- セッション ----

  private startSession(): void {
    this.records = [];
    this.question = null;
    this.running = true;
    this.advancing = false;
    this.showView('practice');
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
    const pitch = generateSingleNote({ clef: this.clef, ledgerLines: this.settings.ledgerLines }, Math.random, this.question?.pitch);
    this.staff.render({ clef: this.clef, expected: pitch, status: 'pending' });
    this.question = { pitch, midi: pitchToMidi(pitch), shownAt: performance.now(), attempts: 0, record: null };
    $('#feedback').textContent = '';
    $('#feedback').className = '';
    this.updateProgress();
  }

  private handleNoteOn(ev: NoteEvent): void {
    const q = this.question;
    if (!this.running || this.advancing || !q) return;
    const judgeOptions: JudgeOptions = { octaveEquivalent: this.settings.octaveEquivalent };
    const result = judgeAttempt([q.midi], { notes: [ev.note], time: ev.time }, q.shownAt, judgeOptions);
    q.attempts++;
    if (!q.record) {
      q.record = {
        timestamp: Date.now(),
        mode: 'reflex',
        clef: this.clef,
        expected: [q.midi],
        played: [ev.note],
        correct: result.isCorrect,
        reactionMs: result.reactionMs,
        attempts: 1,
      };
      this.records.push(q.record);
      $('#reaction').textContent = `反応時間 ${formatMs(result.reactionMs)}`;
    } else {
      q.record.attempts = q.attempts;
    }

    const feedback = $('#feedback');
    if (result.isCorrect) {
      this.staff.render({ clef: this.clef, expected: q.pitch, status: 'correct' });
      feedback.textContent = q.attempts === 1 ? '正解' : '正解（やり直し）';
      feedback.className = 'ok';
      this.advancing = true;
      this.updateProgress();
      window.setTimeout(() => this.running && this.nextQuestion(), NEXT_DELAY_MS);
    } else {
      const played = spellMidi(ev.note, diatonicIndex(q.pitch));
      this.staff.render({ clef: this.clef, expected: q.pitch, status: 'wrong', played });
      feedback.textContent = `押した音: ${pitchName(played)}`;
      feedback.className = 'ng';
      this.updateProgress();
    }
  }

  private finishSession(): void {
    if (!this.running) return;
    this.running = false;
    window.clearInterval(this.tickTimer);
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
    const rows = this.records.map((r, i) => {
      const expected = spellMidi(r.expected[0]);
      const played = spellMidi(r.played[0], diatonicIndex(expected));
      return `<tr class="${r.correct ? 'ok' : 'ng'}"><td>${i + 1}</td><td>${pitchName(expected)}</td><td>${r.correct ? '○' : pitchName(played)}</td><td>${formatMs(r.reactionMs)}</td><td>${r.attempts}</td></tr>`;
    });
    $('#answers').innerHTML = rows.join('') || '<tr><td colspan="5">回答なし</td></tr>';
  }

  private showView(view: 'setup' | 'practice' | 'result'): void {
    for (const v of ['setup', 'practice', 'result']) $(`#${v}`).hidden = v !== view;
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
    const s = this.settings;
    (form.elements.namedItem('limitKind') as RadioNodeList).value = s.limitKind;
    $<HTMLInputElement>('#count').value = String(s.count);
    $<HTMLInputElement>('#seconds').value = String(s.seconds);
    $<HTMLSelectElement>('#ledger').value = String(s.ledgerLines);
    $<HTMLInputElement>('#octave-eq').checked = s.octaveEquivalent;
    const sync = () => {
      this.settings = {
        limitKind: (form.elements.namedItem('limitKind') as RadioNodeList).value === 'time' ? 'time' : 'count',
        count: clampInt($<HTMLInputElement>('#count').value, 1, 500, DEFAULT_SETTINGS.count),
        seconds: clampInt($<HTMLInputElement>('#seconds').value, 10, 3600, DEFAULT_SETTINGS.seconds),
        ledgerLines: clampInt($<HTMLSelectElement>('#ledger').value, 0, 4, DEFAULT_SETTINGS.ledgerLines),
        octaveEquivalent: $<HTMLInputElement>('#octave-eq').checked,
      };
      $('#count').closest('label')!.classList.toggle('dim', this.settings.limitKind !== 'count');
      $('#seconds').closest('label')!.classList.toggle('dim', this.settings.limitKind !== 'time');
      saveSettings(this.settings);
    };
    form.addEventListener('input', sync);
    form.addEventListener('submit', (e) => e.preventDefault());
    sync();
  }
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* 保存領域が使えなくても既定値で動く */
  }
  return { ...DEFAULT_SETTINGS };
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
