import { describe, expect, it } from 'vitest';
import { codeToNote } from './pcKeyboard';

describe('codeToNote', () => {
  it('A が基準音、W が半音上、K が1オクターブ上', () => {
    expect(codeToNote('KeyA', 60)).toBe(60);
    expect(codeToNote('KeyW', 60)).toBe(61);
    expect(codeToNote('KeyK', 60)).toBe(72);
  });

  it('割り当てのないキーは null', () => {
    expect(codeToNote('KeyQ', 60)).toBeNull();
  });
});
