import type { Hand } from '../score/steps';

/** 押さえている鍵盤が、楽譜のどちらの手の音として押されたか（押した時刻つき） */
export interface KeyOwner {
  hand: Hand;
  pressedAt: number;
}

/**
 * その鍵盤を、反対の手が前から押さえているか。
 * 同じ鍵盤は同時に2回押せないので、反対の手が押さえたままだと、こちらの手は打鍵できない
 * （例: 左手が伸ばしている F4 を、右手の旋律がすぐ後に弾く）。この場合は押鍵なしで弾けたとみなしてよい。
 * owner は押鍵が楽譜の音に当たったときに記録したもの。押し直されていたら（heldSince が違う）無効。
 */
export function heldByOtherHand(hand: Hand, owner: KeyOwner | undefined, heldSince: number | undefined, before: number): boolean {
  return owner !== undefined && heldSince !== undefined && owner.pressedAt === heldSince && heldSince < before && owner.hand !== hand;
}

/**
 * その鍵盤を、この位置が来る前から押さえたままか（どちらの手かは問わない）。
 * 同じ手でも、前の音から続けて同じ鍵盤を使うとき、和音の中で押さえたまま弾き直さないことがある
 * （例: 小節の終わりの F4 を押さえたまま、次の小節頭の和音を弾く）。
 */
export function heldFromBefore(heldSince: number | undefined, before: number): boolean {
  return heldSince !== undefined && heldSince < before;
}
