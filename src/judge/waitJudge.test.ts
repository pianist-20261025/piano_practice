import { describe, expect, it } from 'vitest';
import { WaitStepJudge } from './waitJudge';

describe('WaitStepJudge', () => {
  it('和音の音を順番に押しても、全部押せたら完了', () => {
    const j = new WaitStepJudge([55, 59, 74]);
    expect(j.press(74)).toBe('hit');
    expect(j.done).toBe(false);
    expect(j.press(55)).toBe('hit');
    expect(j.missing).toEqual([59]);
    expect(j.press(59)).toBe('hit');
    expect(j.done).toBe(true);
  });

  it('余計な音は記録するが、押せた音は覚えている', () => {
    const j = new WaitStepJudge([60, 64]);
    j.press(60, 0);
    expect(j.press(65, 400)).toBe('extra');
    expect(j.press(64, 900)).toBe('hit');
    expect(j.done).toBe(true);
    expect(j.extras).toEqual([65]);
    // 間違えてから間をおいて弾き直したので、和音に混ざった音ではない
    expect(j.chordExtras(120)).toEqual([]);
  });

  it('和音と同時に押した余計な音（ド・ミにドレミ）は、和音に混ざった音として分かる', () => {
    const j = new WaitStepJudge([60, 64]);
    j.press(60, 1000);
    j.press(62, 1030);
    j.press(64, 1050);
    expect(j.done).toBe(true);
    expect(j.chordExtras(120)).toEqual([62]);
  });

  it('ignored の音（装飾音）は余計な音に数えない', () => {
    const j = new WaitStepJudge([64], undefined, [65]);
    expect(j.press(65, 0)).toBe('repeat');
    expect(j.press(64, 40)).toBe('hit');
    expect(j.extras).toEqual([]);
    expect(j.chordExtras(120)).toEqual([]);
  });

  it('restart で弾けた音を取り消し、余計な音の記録は残す', () => {
    const j = new WaitStepJudge([60, 64]);
    j.press(60, 0);
    j.press(62, 10);
    j.restart();
    expect(j.missing).toEqual([60, 64]);
    expect(j.chordExtras(120)).toEqual([]);
    expect(j.attemptExtraNotes).toEqual([]);
    expect(j.press(60, 500)).toBe('hit');
    expect(j.press(64, 510)).toBe('hit');
    expect(j.done).toBe(true);
    expect(j.extras).toEqual([62]);
  });

  it('同じ音を押し直しても余計な音にはしない', () => {
    const j = new WaitStepJudge([60, 64]);
    j.press(60);
    expect(j.press(60)).toBe('repeat');
    expect(j.extras).toEqual([]);
  });

  it('オクターブ違いを正解とみなす設定', () => {
    const j = new WaitStepJudge([60, 72], { octaveEquivalent: true });
    expect(j.press(48)).toBe('hit');
    expect(j.press(84)).toBe('hit');
    expect(j.done).toBe(true);
    expect(j.press(60)).toBe('repeat');
  });
});

describe('WaitStepJudge.credit', () => {
  it('押さえたままの音を押鍵なしで弾けたことにする', () => {
    const j = new WaitStepJudge([60, 64]);
    expect(j.credit(60)).toBe(true);
    expect(j.press(64)).toBe('hit');
    expect(j.done).toBe(true);
    expect(j.extras).toEqual([]);
  });

  it('期待音でない音や、すでに弾けた音は何もしない', () => {
    const j = new WaitStepJudge([60]);
    expect(j.credit(62)).toBe(false);
    j.press(60);
    expect(j.credit(60)).toBe(false);
  });
});
