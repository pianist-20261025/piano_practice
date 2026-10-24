import { describe, expect, it } from 'vitest';
import { pitchToMidi } from '../music/pitch';
import { judgeAttempt, judgeNotes } from './judge';

const midi = (s: string) => {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(s)!;
  return pitchToMidi({ step: m[1] as 'C', alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: Number(m[3]) });
};

describe('judgeNotes: 単音', () => {
  it('同じ音なら正解', () => {
    const r = judgeNotes([midi('G4')], [midi('G4')]);
    expect(r).toEqual({ correct: [67], missing: [], extra: [], isCorrect: true });
  });

  it('違う音なら不正解で、押した音は extra・期待音は missing', () => {
    const r = judgeNotes([midi('G4')], [midi('F4')]);
    expect(r.isCorrect).toBe(false);
    expect(r.extra).toEqual([65]);
    expect(r.missing).toEqual([67]);
  });
});

describe('judgeNotes: オクターブ違い', () => {
  it('設定 OFF（初期値）では不正解', () => {
    expect(judgeNotes([midi('C5')], [midi('C4')]).isCorrect).toBe(false);
    expect(judgeNotes([midi('C5')], [midi('C4')], { octaveEquivalent: false }).isCorrect).toBe(false);
  });

  it('設定 ON では正解', () => {
    expect(judgeNotes([midi('C5')], [midi('C4')], { octaveEquivalent: true }).isCorrect).toBe(true);
    expect(judgeNotes([midi('C5')], [midi('C3')], { octaveEquivalent: true }).isCorrect).toBe(true);
  });

  it('設定 ON でも音名が違えば不正解', () => {
    expect(judgeNotes([midi('C5')], [midi('D4')], { octaveEquivalent: true }).isCorrect).toBe(false);
  });
});

describe('judgeNotes: 異名同音', () => {
  it('F♯4 と G♭4 は同じ鍵盤なので正解', () => {
    expect(midi('F#4')).toBe(midi('Gb4'));
    expect(judgeNotes([midi('F#4')], [midi('Gb4')]).isCorrect).toBe(true);
  });

  it('E♯4 は F4、C♭5 は B4 と同じ', () => {
    expect(pitchToMidi({ step: 'E', alter: 1, octave: 4 })).toBe(midi('F4'));
    expect(pitchToMidi({ step: 'C', alter: -1, octave: 5 })).toBe(midi('B4'));
  });
});

describe('judgeNotes: 和音', () => {
  const cMajor = [midi('C4'), midi('E4'), midi('G4')];

  it('全部押せば正解', () => {
    expect(judgeNotes(cMajor, [midi('G4'), midi('C4'), midi('E4')]).isCorrect).toBe(true);
  });

  it('足りない音と余計な音を分ける', () => {
    const r = judgeNotes(cMajor, [midi('C4'), midi('F4'), midi('G4')]);
    expect(r.correct).toEqual([midi('C4'), midi('G4')]);
    expect(r.missing).toEqual([midi('E4')]);
    expect(r.extra).toEqual([midi('F4')]);
    expect(r.isCorrect).toBe(false);
  });

  it('重複した入力は1回として扱う', () => {
    expect(judgeNotes([60], [60, 60]).correct).toEqual([60]);
  });
});

describe('judgeAttempt', () => {
  it('出題表示から押鍵までの反応時間を含める', () => {
    const r = judgeAttempt([60], { notes: [60], time: 1650 }, 1000);
    expect(r.isCorrect).toBe(true);
    expect(r.reactionMs).toBe(650);
  });
});
