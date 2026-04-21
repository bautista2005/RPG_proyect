import { describe, expect, it } from "vitest";

import {
  applyStatusEffect,
  canUnitAct,
  checkVictoryCondition,
  executeBasicAttack,
  executeSkill,
  initializeBattle,
  processTurnStartEffects,
} from "../src/battle/BattleEngine.js";
import { createEmptyBattleState } from "../src/battle/BattleState.js";
import { bash, shieldAlly, venomStrike } from "../src/data/testSkills.js";
import type { CharacterDefinition } from "../src/domain/CharacterDefinition.js";
import { StatusEffectType } from "../src/domain/StatusEffect.js";

describe("BattleState", () => {
  it("creates an empty battle state with the expected defaults", () => {
    const state = createEmptyBattleState();

    expect(state.lifecycle).toBe("setup");
    expect(state.turn).toBe(0);
    expect(state.unitOrder).toEqual([]);
    expect(state.logs).toEqual([]);
    expect(state.skills).toEqual({});
  });
});

describe("BattleEngine v2", () => {
  const rogue: CharacterDefinition = {
    id: "rogue",
    name: "Rogue",
    baseStats: {
      hp: 20,
      attack: 8,
      defense: 2,
      speed: 14,
    },
    skillIds: [venomStrike.id],
  };

  const guardian: CharacterDefinition = {
    id: "guardian",
    name: "Guardian",
    baseStats: {
      hp: 30,
      attack: 6,
      defense: 4,
      speed: 11,
    },
    skillIds: [shieldAlly.id],
  };

  const bruiser: CharacterDefinition = {
    id: "bruiser",
    name: "Bruiser",
    baseStats: {
      hp: 24,
      attack: 9,
      defense: 3,
      speed: 10,
    },
    skillIds: [bash.id],
  };

  const striker: CharacterDefinition = {
    id: "striker",
    name: "Striker",
    baseStats: {
      hp: 18,
      attack: 7,
      defense: 1,
      speed: 12,
    },
    skillIds: [],
  };

  function createBattle() {
    return initializeBattle({
      battleId: "battle-v2",
      skills: [venomStrike, shieldAlly, bash],
      teams: [
        {
          teamId: "alpha",
          members: [
            { unitId: "a1", character: rogue },
            { unitId: "a2", character: guardian },
          ],
        },
        {
          teamId: "beta",
          members: [
            { unitId: "b1", character: bruiser },
            { unitId: "b2", character: striker },
          ],
        },
      ],
    });
  }

  it("keeps skill ids on runtime units and catalog in battle state", () => {
    const state = createBattle();

    expect(state.units.a1.skillIds).toEqual([venomStrike.id]);
    expect(state.skills[shieldAlly.id]?.name).toBe("Shield Ally");
  });

  it("a damage skill reduces hp", () => {
    const state = createBattle();
    const nextState = executeSkill(state, "a1", venomStrike.id, "b1");

    expect(nextState.units.b1.currentHp).toBe(17);
    expect(nextState.logs.some((log) => log.message.includes("Rogue uses Venom Strike on Bruiser"))).toBe(true);
  });

  it("poison is applied correctly", () => {
    const state = createBattle();
    const nextState = executeSkill(state, "a1", venomStrike.id, "b1");

    expect(nextState.units.b1.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: StatusEffectType.Poison,
          remainingTurns: 2,
          potency: 3,
        }),
      ]),
    );
  });

  it("poison deals damage on turn start", () => {
    let state = createBattle();
    state = executeSkill(state, "a1", venomStrike.id, "b1");
    state = executeBasicAttack(state, "b2", "a1");
    state = executeSkill(state, "a2", shieldAlly.id, "a1");

    expect(state.currentUnitId).toBe("b1");
    expect(state.units.b1.currentHp).toBe(14);
    expect(state.logs.some((log) => log.message.includes("Bruiser takes 3 poison damage"))).toBe(true);
  });

  it("poison expires correctly after the affected turn", () => {
    let state = createBattle();
    state = executeSkill(state, "a1", venomStrike.id, "b1");
    state = executeBasicAttack(state, "b2", "a1");
    state = executeSkill(state, "a2", shieldAlly.id, "a1");
    state = executeBasicAttack(state, "b1", "a1");
    state = executeBasicAttack(state, "a1", "b2");
    state = executeBasicAttack(state, "b2", "a1");
    state = executeBasicAttack(state, "a2", "b2");

    expect(state.units.b1.statuses).toEqual([]);
  });

  it("stun makes a unit lose its turn", () => {
    let state = createBattle();
    state = executeSkill(state, "a1", venomStrike.id, "b1");
    state = executeBasicAttack(state, "b2", "a1");
    state = executeSkill(state, "a2", shieldAlly.id, "a1");
    state = executeSkill(state, "b1", bash.id, "a1");

    expect(state.currentUnitId).toBe("b2");
    expect(canUnitAct(state, "a1")).toBe(true);
    expect(state.logs.some((log) => log.message.includes("Rogue is stunned and skips the turn"))).toBe(true);
  });

  it("shield absorbs damage before hp", () => {
    let state = createBattle();
    state = executeSkill(state, "a1", venomStrike.id, "b1");
    state = executeBasicAttack(state, "b2", "a1");
    state = executeSkill(state, "a2", shieldAlly.id, "a1");
    state = executeSkill(state, "b1", bash.id, "a1");

    expect(state.units.a1.currentHp).toBe(12);
    expect(state.logs.some((log) => log.message.includes("Rogue's shield absorbed 8 damage"))).toBe(true);
  });

  it("shield is consumed correctly", () => {
    let state = createBattle();
    state = executeSkill(state, "a1", venomStrike.id, "b1");
    state = executeBasicAttack(state, "b2", "a1");
    state = executeSkill(state, "a2", shieldAlly.id, "a1");
    state = executeSkill(state, "b1", bash.id, "a1");

    expect(
      state.units.a1.statuses.some((status) => status.type === StatusEffectType.Shield),
    ).toBe(false);
    expect(state.logs.some((log) => log.message.includes("shield was depleted"))).toBe(true);
  });

  it("a unit can die from poison", () => {
    let state = createBattle();
    state = {
      ...state,
      units: {
        ...state.units,
        b1: {
          ...state.units.b1,
          currentHp: 3,
        },
      },
    };
    state = executeSkill(state, "a1", venomStrike.id, "b1");
    state = executeBasicAttack(state, "b2", "a1");
    state = executeSkill(state, "a2", shieldAlly.id, "a1");

    expect(state.units.b1.isDefeated).toBe(true);
    expect(state.logs.some((log) => log.message.includes("Bruiser was defeated"))).toBe(true);
  });

  it("the battle ends if a team loses all units from effects", () => {
    let state = createBattle();
    state = {
      ...state,
      units: {
        ...state.units,
        b1: {
          ...state.units.b1,
          currentHp: 3,
        },
        b2: {
          ...state.units.b2,
          currentHp: 0,
          isDefeated: true,
        },
      },
    };
    state = executeSkill(state, "a1", venomStrike.id, "b1");
    state = executeBasicAttack(state, "b2", "a1");
    state = executeSkill(state, "a2", shieldAlly.id, "a1");

    expect(state.lifecycle).toBe("finished");
    expect(state.winnerTeamId).toBe("alpha");
    expect(checkVictoryCondition(state)).toBe("alpha");
  });

  it("logs the main events clearly", () => {
    const state = executeSkill(createBattle(), "a1", venomStrike.id, "b1");
    const messages = state.logs.map((log) => log.message);

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Rogue uses Venom Strike on Bruiser"),
        expect.stringContaining("Bruiser is poisoned for 2 turns"),
      ]),
    );
  });

  it("supports isolated start-of-turn processing for statuses", () => {
    const battle = createBattle();
    const seeded = applyStatusEffect(battle, "a1", "b1", {
      type: StatusEffectType.Poison,
      durationTurns: 1,
      potency: 3,
    });

    const processed = processTurnStartEffects({
      ...seeded,
      currentUnitId: "b1",
      turn: 99,
    });

    expect(processed.units.b1.currentHp).toBe(21);
    expect(processed.units.b1.statuses).toEqual([]);
  });
});
