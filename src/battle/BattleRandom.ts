import type { BattleState } from "./BattleState.js";

const DEFAULT_SEED = 1337;
const UINT32_MODULO = 0x1_0000_0000;

export interface BattleRandomState {
  initialSeed: number;
  state: number;
}

export function createBattleRandomState(seed?: number): BattleRandomState {
  const normalizedSeed = normalizeSeed(seed);

  return {
    initialSeed: normalizedSeed,
    state: normalizedSeed,
  };
}

export function normalizeSeed(seed?: number): number {
  const value = Number.isFinite(seed) ? Math.trunc(seed as number) : DEFAULT_SEED;
  const normalized = value >>> 0;

  return normalized === 0 ? DEFAULT_SEED : normalized;
}

export function rollRandom(state: BattleState): [BattleState, number] {
  const current = state.random.state || DEFAULT_SEED;
  const next = (current * 1664525 + 1013904223) >>> 0;

  return [
    {
      ...state,
      random: {
        ...state.random,
        state: next,
      },
    },
    next / UINT32_MODULO,
  ];
}

export function deterministicTieBreak(seed: number, ...parts: string[]): number {
  let hash = normalizeSeed(seed);

  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash = Math.imul(hash ^ part.charCodeAt(index), 16777619) >>> 0;
    }
  }

  return hash >>> 0;
}
