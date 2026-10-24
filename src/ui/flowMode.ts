import { BeatClock } from '../audio/beatClock';
import { Metronome } from '../audio/metronome';
import { generatePhrase, type Phrase, type PhraseOptions } from '../generator/phrase';
import type { JudgeOptions } from '../judge/judge';
import { TimedMatcher, summarizeTiming } from '../judge/timing';
import type { NoteEvent } from '../midi/types';
import { spellMidiInKey } from '../music/key';
import { diatonicIndex, pitchToMidi } from '../music/pitch';
import { PhraseRenderer } from '../render/phraseRenderer';
import type { StaffColors, StaffLayout } from '../render/staffRenderer';
import { makeTimeline } from '../render/timeline';
import type { AnswerRecord } from '../stats/session';

export interface FlowSettings {
  layout: StaffLayout;
  phrase: Omit<PhraseOptions, 'clefs'>;
  bpm: number;
  toleranceMs: number;
  metronome: boolean;
  judge: JudgeOptions;
}

/** 1音の結果 */
export interface FlowOutcome {
  index: number;
  hit: boolean;
  deviationMs: number | null;
  extras: number[];
}

export interface FlowResult {
  phrase: Phrase;
  settings: FlowSettings;
  outcomes: FlowOutcome[];
}

interface Callbacks {
  persist(record: AnswerRecord): void;
  finished(result: FlowResult): void;
  colors(): StaffColors;
  status(text: string): void;
  feedback(text: string, kind: 'ok' | 'ng' | ''): void;
}

/** 再生位置（縦線）を、表示幅のどこに置くか */
const PLAYHEAD = 0.3;
const COUNT_IN_BEATS = 4;

/**
 * 流れ読みモード。ランダムなフレーズを横に長い譜面に描き、メトロノームに合わせて右から左へ流す。
 * 間違えても止まらない。各音の正誤とタイミングのずれを記録する。
 */
export class FlowPractice {
  private readonly renderer: PhraseRenderer;
  private readonly metronome = new Metronome();
  private settings: FlowSettings | null = null;
  private phrase: Phrase | null = null;
  private matcher: TimedMatcher | null = null;
  private clock: BeatClock | null = null;
  private timeline: (beats: number) => number = () => 0;
  private noteTimes: number[] = [];
  private extras: number[][] = [];
  private outcomes: FlowOutcome[] = [];
  private finalized = 0;
  private origin = 0;
  private beatMs = 0;
  private endAt = 0;
  private session = 0;
  private running = false;
  private raf = 0;

  constructor(
    private readonly viewport: HTMLElement,
    private readonly strip: HTMLElement,
    private readonly cb: Callbacks,
  ) {
    this.renderer = new PhraseRenderer(strip);
  }

  start(settings: FlowSettings): void {
    this.settings = settings;
    const clefs = settings.layout === 'grand' ? (['treble', 'bass'] as const) : [settings.layout];
    const phrase = generatePhrase({ ...settings.phrase, clefs }, Math.random);
    this.phrase = phrase;
    const layout = this.renderer.render(phrase, settings.layout, this.cb.colors().ink);
    const total = phrase.measures * phrase.beatsPerMeasure;
    this.timeline = makeTimeline([
      ...phrase.notes.map((n, i) => ({ time: n.time, x: layout.noteX[i] })),
      { time: total, x: layout.endX },
    ]);

    this.beatMs = 60000 / settings.bpm;
    this.origin = performance.now() + 500 + COUNT_IN_BEATS * this.beatMs;
    this.noteTimes = phrase.notes.map((n) => this.origin + n.time * this.beatMs);
    // 8分音符の連打でも隣の音と取り違えないよう、窓は拍の長さに合わせる
    const windowMs = Math.min(300, Math.max(120, this.beatMs * 0.4));
    this.matcher = new TimedMatcher(
      phrase.notes.map((n, i) => ({ step: i, midi: pitchToMidi(n.pitch), time: this.noteTimes[i] })),
      windowMs,
      settings.judge,
    );
    this.endAt = this.origin + total * this.beatMs + windowMs + 300;
    this.clock = new BeatClock(this.metronome, this.origin, this.beatMs, phrase.beatsPerMeasure, COUNT_IN_BEATS, settings.metronome, this.endAt);
    this.extras = phrase.notes.map(() => []);
    this.outcomes = [];
    this.finalized = 0;
    this.session = Date.now();
    this.running = true;
    this.cb.feedback(`カウント ${COUNT_IN_BEATS} 拍のあと流れ始めます（♩=${settings.bpm}）`, '');
    this.loop();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.metronome.stop();
    // 途中で止めたときは、時刻を過ぎた音までを記録する
    this.finalize(performance.now());
    this.cb.finished({ phrase: this.phrase!, settings: this.settings!, outcomes: this.outcomes });
  }

  noteOn(ev: NoteEvent): void {
    if (!this.running) return;
    const r = this.matcher!.press(ev.note, ev.time);
    const colors = this.cb.colors();
    if (r.kind === 'hit') {
      this.renderer.colorNote(r.target, colors.correct);
      const d = Math.round(r.deviationMs);
      const ok = Math.abs(d) <= this.settings!.toleranceMs;
      this.cb.feedback(`${ok ? 'OK' : d < 0 ? '早い' : '遅い'} ${d > 0 ? '+' : ''}${d} ms`, ok ? 'ok' : 'ng');
    } else if (r.step !== null) {
      const n = this.phrase!.notes[r.step];
      this.extras[r.step].push(ev.note);
      this.renderer.markWrong(r.step, spellMidiInKey(ev.note, this.phrase!.keyFifths, diatonicIndex(n.pitch)), colors.wrong);
      this.cb.feedback(`押した音が違います`, 'ng');
    }
  }

  private loop(): void {
    const now = performance.now();
    this.clock!.tick(now);
    const beats = (now - this.origin) / this.beatMs;
    const x = this.timeline(beats);
    this.strip.style.transform = `translateX(${this.viewport.clientWidth * PLAYHEAD - x}px)`;
    for (const t of this.matcher!.expire(now)) this.renderer.colorNote(t, this.cb.colors().missing);
    this.finalize(now);
    const ph = this.phrase!;
    const measure = Math.min(ph.measures, Math.max(1, Math.floor(beats / ph.beatsPerMeasure) + 1));
    const ok = this.outcomes.filter((o) => o.hit && !o.extras.length).length;
    this.cb.status(`小節 ${measure} / ${ph.measures}　正解 ${ok} / ${this.outcomes.length}`);
    if (now > this.endAt) {
      this.stop();
      return;
    }
    if (this.running) this.raf = requestAnimationFrame(() => this.loop());
  }

  /** 判定の窓を過ぎた音から順に結果を確定して記録する */
  private finalize(now: number): void {
    const m = this.matcher!;
    const ph = this.phrase!;
    while (this.finalized < ph.notes.length && this.noteTimes[this.finalized] + m.windowMs < now) {
      const i = this.finalized++;
      const n = ph.notes[i];
      const r = m.result(i);
      const outcome: FlowOutcome = { index: i, hit: r.hit, deviationMs: r.deviationMs, extras: this.extras[i] };
      this.outcomes.push(outcome);
      const midi = pitchToMidi(n.pitch);
      this.cb.persist({
        timestamp: Date.now(),
        mode: 'flow',
        session: this.session,
        bpm: this.settings!.bpm,
        clef: n.clef,
        keyFifths: ph.keyFifths,
        measure: n.measure + 1,
        expected: [midi],
        played: [...(r.hit ? [midi] : []), ...outcome.extras],
        correct: r.hit && !outcome.extras.length,
        reactionMs: r.deviationMs ?? 0,
        attempts: 1 + outcome.extras.length,
        ...(r.deviationMs === null ? {} : { timingMs: r.deviationMs }),
      });
    }
  }
}

/** 結果画面用の集計 */
export function summarizeFlow(result: FlowResult) {
  const n = result.outcomes.length;
  const correct = result.outcomes.filter((o) => o.hit && !o.extras.length).length;
  return {
    played: n,
    correct,
    accuracy: n ? correct / n : 0,
    timing: summarizeTiming(
      result.outcomes.flatMap((o) => (o.deviationMs === null ? [] : [o.deviationMs])),
      result.settings.toleranceMs,
    ),
  };
}
