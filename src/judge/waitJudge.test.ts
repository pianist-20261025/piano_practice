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
    j.press(60);
    expect(j.press(65)).toBe('extra');
    expect(j.press(64)).toBe('hit');
    expect(j.done).toBe(true);
    expect(j.extras).toEqual([65]);
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
