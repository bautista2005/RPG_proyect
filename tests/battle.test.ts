import { describe, expect, it } from "vitest";

import {
  applyStatusEffect,
  canUnitAct,
  checkVictoryCondition,
  executeBasicAttack,
  executeAction as executeResolvedAction,
  executeSkill,
  initializeBattle,
  processTurnStartEffects,
  validateAction,
} from "../src/battle/BattleEngine.js";
import {
  decideAction,
  executeAction,
  selectSkillTarget,
  simulateBattle,
} from "../src/battle/BattleSimulation.js";
import { buildBattleMetrics } from "../src/battle/BattleMetrics.js";
import type { BattleState } from "../src/battle/BattleState.js";
import { createEmptyBattleState } from "../src/battle/BattleState.js";
import { assassin, controller, starterRoster, support, tank } from "../src/data/characters/roster.js";
import {
  concussiveBlow,
  ironGuard,
  radiantMend,
  rosterSkillMap,
  rosterSkills,
  toxicStab,
} from "../src/data/skills/rosterSkills.js";
import { bash, shieldAlly, venomStrike } from "../src/data/testSkills.js";
import { ogreBoss } from "../src/data/characters/bosses.js";
import { balancedDuelScenario, bossFightScenario, bossPressureScenario, pveScenarios } from "../src/data/scenarios/pveScenarios.js";
import { createBattleStateFromScenario } from "../src/game/BattleScenario.js";
import { runScenario, runScenarioSeries, runScenarioSuite } from "../src/index.js";
import type { CharacterDefinition } from "../src/domain/CharacterDefinition.js";
import type { SkillDefinition } from "../src/domain/SkillDefinition.js";
import { StatusEffectType } from "../src/domain/StatusEffect.js";

function expectActionCore(
  action: {
    actionType: string;
    actorId: string;
    targetId: string;
    skillId?: string;
    source?: string;
    decisionNote?: string;
  },
  expected: {
    actionType: string;
    actorId: string;
    targetId: string;
    skillId?: string;
  },
) {
  expect(action).toEqual(expect.objectContaining(expected));
}

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

    expect(nextState.units.b1.currentHp).toBe(16);
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
    expect(state.units.b1.currentHp).toBe(13);
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

    expect(state.units.a1.currentHp).toBe(13);
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

describe("BattleEngine v3", () => {
  function createRosterBattle() {
    return initializeBattle({
      battleId: "battle-v3",
      skills: rosterSkills,
      teams: [
        {
          teamId: "alpha",
          members: [
            { unitId: "alpha-tank", character: tank },
            { unitId: "alpha-support", character: support },
          ],
        },
        {
          teamId: "beta",
          members: [
            { unitId: "beta-assassin", character: assassin },
            { unitId: "beta-controller", character: controller },
          ],
        },
      ],
    });
  }

  it("heal restores hp correctly", () => {
    let state = createRosterBattle();
    state = {
      ...state,
      units: {
        ...state.units,
        "alpha-support": {
          ...state.units["alpha-support"],
          energy: 1,
        },
        "alpha-tank": {
          ...state.units["alpha-tank"],
          currentHp: 20,
        },
      },
      currentUnitId: "alpha-support",
      turn: 20,
    };

    const healedState = executeSkill(state, "alpha-support", radiantMend.id, "alpha-tank");

    expect(healedState.units["alpha-tank"].currentHp).toBe(30);
    expect(healedState.logs.some((log) => log.message.includes("Bastion recovers 10 HP from Radiant Mend"))).toBe(
      true,
    );
  });

  it("heal does not exceed max hp", () => {
    let state = createRosterBattle();
    state = {
      ...state,
      units: {
        ...state.units,
        "alpha-support": {
          ...state.units["alpha-support"],
          energy: 1,
        },
        "alpha-tank": {
          ...state.units["alpha-tank"],
          currentHp: 32,
        },
      },
      currentUnitId: "alpha-support",
      turn: 21,
    };

    const healedState = executeSkill(state, "alpha-support", radiantMend.id, "alpha-tank");

    expect(healedState.units["alpha-tank"].currentHp).toBe(36);
    expect(healedState.logs.some((log) => log.message.includes("Bastion recovers 4 HP from Radiant Mend"))).toBe(
      true,
    );
  });

  it("basic attack generates energy", () => {
    const state = createRosterBattle();
    const nextState = executeBasicAttack(state, "beta-assassin", "alpha-tank");

    expect(nextState.units["beta-assassin"].energy).toBe(1);
  });

  it("using a skill consumes energy", () => {
    let state = createRosterBattle();
    state = {
      ...state,
      units: {
        ...state.units,
        "beta-assassin": {
          ...state.units["beta-assassin"],
          energy: 1,
        },
      },
    };

    const nextState = executeSkill(state, "beta-assassin", toxicStab.id, "alpha-tank");

    expect(nextState.units["beta-assassin"].energy).toBe(0);
  });

  it("a skill cannot be used without enough energy", () => {
    const state = createRosterBattle();
    const nextState = executeSkill(state, "beta-assassin", toxicStab.id, "alpha-tank");

    expect(nextState.units["alpha-tank"].currentHp).toBe(36);
    expect(
      nextState.logs.some((log) => log.message.includes("Viper cannot use Toxic Stab because they need 1 energy")),
    ).toBe(true);
  });

  it("using a skill activates cooldown", () => {
    let state = createRosterBattle();
    state = {
      ...state,
      units: {
        ...state.units,
        "alpha-support": {
          ...state.units["alpha-support"],
          energy: 1,
        },
        "alpha-tank": {
          ...state.units["alpha-tank"],
          currentHp: 20,
        },
      },
      currentUnitId: "alpha-support",
      turn: 30,
    };

    const nextState = executeSkill(state, "alpha-support", radiantMend.id, "alpha-tank");

    expect(nextState.units["alpha-support"].cooldowns[radiantMend.id]).toBe(1);
  });

  it("a skill cannot be used while on cooldown", () => {
    let state = createRosterBattle();
    state = {
      ...state,
      units: {
        ...state.units,
        "alpha-support": {
          ...state.units["alpha-support"],
          energy: 2,
          cooldowns: {
            [radiantMend.id]: 1,
          },
        },
      },
      currentUnitId: "alpha-support",
      turn: 31,
    };

    const nextState = executeSkill(state, "alpha-support", radiantMend.id, "alpha-support");

    expect(
      nextState.logs.some((log) =>
        log.message.includes("Seraph cannot use Radiant Mend because it is on cooldown for 1 more turns"),
      ),
    ).toBe(true);
  });

  it("cooldown is reduced at the start of the unit turn", () => {
    const state = processTurnStartEffects({
      ...createRosterBattle(),
      currentUnitId: "alpha-support",
      turn: 40,
      units: {
        ...createRosterBattle().units,
        "alpha-support": {
          ...createRosterBattle().units["alpha-support"],
          cooldowns: {
            [radiantMend.id]: 1,
          },
        },
      },
    });

    expect(state.units["alpha-support"].cooldowns[radiantMend.id]).toBeUndefined();
  });

  it("the starter roster loads correctly", () => {
    expect(starterRoster).toHaveLength(4);
    expect(starterRoster.map((character) => character.role)).toEqual([
      "tank",
      "assassin",
      "support",
      "controller",
    ]);
    expect(starterRoster.map((character) => character.aiProfile)).toEqual([
      "defensive",
      "aggressive",
      "supportive",
      "control",
    ]);
    expect(
      starterRoster.every((character) => character.skillIds.every((skillId) => Boolean(rosterSkillMap[skillId]))),
    ).toBe(true);
  });

  it("the scenario runner executes and produces logs", () => {
    const simulation = runScenario(balancedDuelScenario);

    expect(simulation.finalState.logs.length).toBeGreaterThan(0);
    expect(simulation.finalState.logs.some((log) => log.message.includes("Battle initialized"))).toBe(true);
  });
});

describe("BattleSimulation v5", () => {
  function createAutoBattle() {
    return initializeBattle({
      battleId: "battle-v5",
      skills: rosterSkills,
      teams: [
        {
          teamId: "alpha",
          members: [
            { unitId: "alpha-tank", character: tank },
            { unitId: "alpha-support", character: support },
          ],
        },
        {
          teamId: "beta",
          members: [
            { unitId: "beta-assassin", character: assassin },
            { unitId: "beta-controller", character: controller },
          ],
        },
      ],
    });
  }

  function createBehaviorBattle(input: {
    alphaLeader: CharacterDefinition;
    alphaPartner: CharacterDefinition;
    betaLeader: CharacterDefinition;
    betaPartner: CharacterDefinition;
    skills: SkillDefinition[];
  }) {
    return initializeBattle({
      battleId: "battle-v5-behavior",
      skills: input.skills,
      teams: [
        {
          teamId: "alpha",
          members: [
            { unitId: "alpha-leader", character: input.alphaLeader },
            { unitId: "alpha-partner", character: input.alphaPartner },
          ],
        },
        {
          teamId: "beta",
          members: [
            { unitId: "beta-leader", character: input.betaLeader },
            { unitId: "beta-partner", character: input.betaPartner },
          ],
        },
      ],
    });
  }

  it("an aggressive character prioritizes a usable offensive skill", () => {
    const baseState = createAutoBattle();
    const state: BattleState = {
      ...baseState,
      units: {
        ...baseState.units,
        "beta-assassin": {
          ...baseState.units["beta-assassin"],
          energy: 1,
        },
      },
      currentUnitId: "beta-assassin",
    };

    const action = decideAction(state, "beta-assassin");

    expectActionCore(action, {
      actionType: "skill",
      actorId: "beta-assassin",
      targetId: "alpha-support",
      skillId: toxicStab.id,
    });
    expect(action.source).toBe("auto");
  });

  it("a supportive character prioritizes heal when an ally is injured", () => {
    const baseState = createAutoBattle();
    const state: BattleState = {
      ...baseState,
      units: {
        ...baseState.units,
        "alpha-support": {
          ...baseState.units["alpha-support"],
          energy: 1,
        },
        "alpha-tank": {
          ...baseState.units["alpha-tank"],
          currentHp: 20,
        },
      },
      currentUnitId: "alpha-support",
    };

    const action = decideAction(state, "alpha-support");

    expectActionCore(action, {
      actionType: "skill",
      actorId: "alpha-support",
      targetId: "alpha-tank",
      skillId: radiantMend.id,
    });
  });

  it("a supportive character prioritizes self-heal when under direct pressure", () => {
    const baseState = createAutoBattle();
    const state: BattleState = {
      ...baseState,
      units: {
        ...baseState.units,
        "alpha-support": {
          ...baseState.units["alpha-support"],
          energy: 1,
          currentHp: 14,
        },
        "alpha-tank": {
          ...baseState.units["alpha-tank"],
          currentHp: 24,
        },
      },
      currentUnitId: "alpha-support",
    };

    const action = decideAction(state, "alpha-support");

    expectActionCore(action, {
      actionType: "skill",
      actorId: "alpha-support",
      targetId: "alpha-support",
      skillId: radiantMend.id,
    });
  });

  it("a supportive character uses shield when no heal is available and an ally is vulnerable", () => {
    const supportShield: CharacterDefinition = {
      id: "support-shielder",
      name: "Shielder",
      aiProfile: "supportive",
      baseStats: {
        hp: 24,
        attack: 4,
        defense: 2,
        speed: 10,
      },
      skillIds: [shieldAlly.id],
    };
    const ally: CharacterDefinition = {
      id: "ally-frontliner",
      name: "Frontliner",
      aiProfile: "defensive",
      baseStats: {
        hp: 30,
        attack: 6,
        defense: 4,
        speed: 8,
      },
      skillIds: [],
    };
    const enemy: CharacterDefinition = {
      id: "enemy-striker",
      name: "Enemy Striker",
      aiProfile: "aggressive",
      baseStats: {
        hp: 22,
        attack: 8,
        defense: 2,
        speed: 9,
      },
      skillIds: [],
    };

    const baseState = createBehaviorBattle({
      alphaLeader: supportShield,
      alphaPartner: ally,
      betaLeader: enemy,
      betaPartner: enemy,
      skills: [shieldAlly],
    });
    const state: BattleState = {
      ...baseState,
      units: {
        ...baseState.units,
        "alpha-leader": {
          ...baseState.units["alpha-leader"],
          energy: 1,
        },
        "alpha-partner": {
          ...baseState.units["alpha-partner"],
          currentHp: 18,
        },
      },
      currentUnitId: "alpha-leader",
    };

    const action = decideAction(state, "alpha-leader");

    expectActionCore(action, {
      actionType: "skill",
      actorId: "alpha-leader",
      targetId: "alpha-partner",
      skillId: shieldAlly.id,
    });
  });

  it("a defensive character makes a valid deterministic decision", () => {
    const baseState = createAutoBattle();
    const state: BattleState = {
      ...baseState,
      units: {
        ...baseState.units,
        "alpha-tank": {
          ...baseState.units["alpha-tank"],
          energy: 1,
        },
        "alpha-support": {
          ...baseState.units["alpha-support"],
          currentHp: 12,
        },
      },
      currentUnitId: "alpha-tank",
    };

    const action = decideAction(state, "alpha-tank");

    expectActionCore(action, {
      actionType: "skill",
      actorId: "alpha-tank",
      targetId: "alpha-support",
      skillId: ironGuard.id,
    });
  });

  it("a control character prioritizes stun when it is available", () => {
    const baseState = createAutoBattle();
    const state: BattleState = {
      ...baseState,
      units: {
        ...baseState.units,
        "beta-controller": {
          ...baseState.units["beta-controller"],
          energy: 1,
        },
      },
      currentUnitId: "beta-controller",
    };

    const action = decideAction(state, "beta-controller");

    expectActionCore(action, {
      actionType: "skill",
      actorId: "beta-controller",
      targetId: "alpha-support",
      skillId: concussiveBlow.id,
    });
  });

  it("decideAction returns basic attack if no skill is usable", () => {
    const state = createAutoBattle();

    const action = decideAction(state, "beta-assassin");

    expectActionCore(action, {
      actionType: "basic_attack",
      actorId: "beta-assassin",
      targetId: "alpha-support",
    });
  });

  it("offensive target selection chooses a valid living enemy", () => {
    const baseState = createAutoBattle();
    const state: BattleState = {
      ...baseState,
      units: {
        ...baseState.units,
        "alpha-tank": {
          ...baseState.units["alpha-tank"],
          currentHp: 12,
        },
        "alpha-support": {
          ...baseState.units["alpha-support"],
          currentHp: 8,
        },
      },
    };

    const target = selectSkillTarget(state, state.units["beta-controller"], concussiveBlow);

    expect(target?.unitId).toBe("alpha-support");
  });

  it("heal target selection chooses a wounded ally", () => {
    const baseState = createAutoBattle();
    const state: BattleState = {
      ...baseState,
      units: {
        ...baseState.units,
        "alpha-tank": {
          ...baseState.units["alpha-tank"],
          currentHp: 28,
        },
        "alpha-support": {
          ...baseState.units["alpha-support"],
          energy: 1,
          currentHp: 10,
        },
      },
    };

    const target = selectSkillTarget(state, state.units["alpha-support"], radiantMend);

    expect(target?.unitId).toBe("alpha-support");
  });

  it("falls back safely when there is no ideal support target", () => {
    const healer: CharacterDefinition = {
      id: "healer",
      name: "Healer",
      aiProfile: "supportive",
      baseStats: {
        hp: 20,
        attack: 3,
        defense: 2,
        speed: 9,
      },
      skillIds: [radiantMend.id],
    };
    const ally: CharacterDefinition = {
      id: "ally",
      name: "Ally",
      aiProfile: "defensive",
      baseStats: {
        hp: 28,
        attack: 5,
        defense: 3,
        speed: 6,
      },
      skillIds: [],
    };
    const enemy: CharacterDefinition = {
      id: "enemy",
      name: "Enemy",
      aiProfile: "aggressive",
      baseStats: {
        hp: 16,
        attack: 7,
        defense: 1,
        speed: 8,
      },
      skillIds: [],
    };

    const baseState = createBehaviorBattle({
      alphaLeader: healer,
      alphaPartner: ally,
      betaLeader: enemy,
      betaPartner: enemy,
      skills: [radiantMend],
    });
    const state: BattleState = {
      ...baseState,
      units: {
        ...baseState.units,
        "alpha-leader": {
          ...baseState.units["alpha-leader"],
          energy: 1,
        },
      },
      currentUnitId: "alpha-leader",
    };

    const action = decideAction(state, "alpha-leader");

    expectActionCore(action, {
      actionType: "basic_attack",
      actorId: "alpha-leader",
      targetId: "beta-leader",
    });
  });

  it("executeAction dispatches a basic attack correctly", () => {
    const state = createAutoBattle();

    const nextState = executeAction(state, {
      actionType: "basic_attack",
      actorId: "beta-assassin",
      targetId: "alpha-support",
    });

    expect(nextState.units["alpha-support"].currentHp).toBeLessThan(state.units["alpha-support"].currentHp);
    expect(nextState.logs.some((log) => log.message.includes("Viper uses Basic Attack on Seraph"))).toBe(true);
  });

  it("executeAction dispatches a skill correctly", () => {
    const baseState = createAutoBattle();
    const state = {
      ...baseState,
      units: {
        ...baseState.units,
        "alpha-support": {
          ...baseState.units["alpha-support"],
          energy: 1,
        },
        "alpha-tank": {
          ...baseState.units["alpha-tank"],
          currentHp: 20,
        },
      },
      currentUnitId: "alpha-support",
    };

    const nextState = executeAction(state, {
      actionType: "skill",
      actorId: "alpha-support",
      targetId: "alpha-tank",
      skillId: radiantMend.id,
    });

    expect(nextState.units["alpha-tank"].currentHp).toBe(30);
    expect(nextState.logs.some((log) => log.message.includes("Seraph uses Radiant Mend on Bastion"))).toBe(true);
  });

  it("simulateBattle ends with a winner or a valid finished state", () => {
    const simulation = simulateBattle(createAutoBattle());

    expect(simulation.finalState.lifecycle).toBe("finished");
    expect(simulation.finalState.logs.length).toBeGreaterThan(0);
    expect(simulation.finalState.winnerTeamId === "alpha" || simulation.finalState.winnerTeamId === "beta").toBe(
      true,
    );
  });

  it("simulateBattle respects the safety turn limit", () => {
    const simulation = simulateBattle(createAutoBattle(), {
      maxTurns: 1,
    });

    expect(simulation.abortedDueToTurnLimit).toBe(true);
    expect(
      simulation.finalState.logs.some((log) => log.message.includes("Battle simulation stopped after reaching")),
    ).toBe(true);
  });

  it("the scenario runner remains build-safe and returns a finished state", () => {
    const simulation = runScenario(balancedDuelScenario);

    expect(simulation.finalState.lifecycle).toBe("finished");
    expect(typeof simulation.finalState.logs[0]?.message).toBe("string");
    expect(Object.values(simulation.finalState.units).length).toBeGreaterThan(0);
  });
});

describe("BattleEngine v6", () => {
  function createPassiveBattle() {
    return initializeBattle({
      battleId: "battle-v6",
      skills: rosterSkills,
      teams: [
        {
          teamId: "alpha",
          members: [
            { unitId: "alpha-assassin", character: assassin },
            { unitId: "alpha-support", character: support },
          ],
        },
        {
          teamId: "beta",
          members: [
            { unitId: "beta-tank", character: tank },
            { unitId: "beta-controller", character: controller },
          ],
        },
      ],
    });
  }

  it("aggressive trait keeps offensive skill priority consistent", () => {
    const baseState = createPassiveBattle();
    const state: BattleState = {
      ...baseState,
      units: {
        ...baseState.units,
        "alpha-assassin": {
          ...baseState.units["alpha-assassin"],
          energy: 1,
        },
      },
      currentUnitId: "alpha-assassin",
    };

    const action = decideAction(state, "alpha-assassin");

    expectActionCore(action, {
      actionType: "skill",
      actorId: "alpha-assassin",
      targetId: "beta-controller",
      skillId: toxicStab.id,
    });
    expect(action.decisionNote).toContain("aggressive trait");
  });

  it("protector trait favors defensive actions when an ally is vulnerable", () => {
    const baseState = createPassiveBattle();
    const state: BattleState = {
      ...baseState,
      units: {
        ...baseState.units,
        "beta-tank": {
          ...baseState.units["beta-tank"],
          energy: 1,
        },
        "beta-controller": {
          ...baseState.units["beta-controller"],
          currentHp: 10,
        },
      },
      currentUnitId: "beta-tank",
    };

    const action = decideAction(state, "beta-tank");

    expectActionCore(action, {
      actionType: "skill",
      actorId: "beta-tank",
      targetId: "beta-controller",
      skillId: ironGuard.id,
    });
  });

  it("bonus damage vs poisoned passive works", () => {
    let state = createPassiveBattle();
    state = {
      ...state,
      units: {
        ...state.units,
        "alpha-assassin": {
          ...state.units["alpha-assassin"],
          energy: 1,
        },
      },
      currentUnitId: "alpha-assassin",
    };

    state = executeSkill(state, "alpha-assassin", toxicStab.id, "beta-controller");
    state = executeBasicAttack(state, "beta-tank", "alpha-support");
    state = executeBasicAttack(state, "alpha-support", "beta-tank");
    state = {
      ...state,
      currentUnitId: "alpha-assassin",
    };
    state = executeBasicAttack(state, "alpha-assassin", "beta-controller");

    expect(state.units["beta-controller"].currentHp).toBe(8);
    expect(state.logs.some((log) => log.message.includes("adds 2 damage against Warden"))).toBe(true);
  });

  it("gain extra energy on basic passive works", () => {
    const state = createPassiveBattle();
    const nextState = executeBasicAttack(
      {
        ...state,
        currentUnitId: "alpha-support",
      },
      "alpha-support",
      "beta-controller",
    );

    expect(nextState.units["alpha-support"].energy).toBe(2);
    expect(nextState.logs.some((log) => log.message.includes("grants +1 extra energy"))).toBe(true);
  });

  it("reduce incoming damage flat passive works", () => {
    const state = executeBasicAttack(
      {
        ...createPassiveBattle(),
        currentUnitId: "alpha-assassin",
      },
      "alpha-assassin",
      "beta-tank",
    );

    expect(state.units["beta-tank"].currentHp).toBe(33);
    expect(state.logs.some((log) => log.message.includes("reduces incoming damage by 1"))).toBe(true);
  });

  it("a valid manual action executes correctly", () => {
    const baseState = createPassiveBattle();
    const state: BattleState = {
      ...baseState,
      units: {
        ...baseState.units,
        "alpha-assassin": {
          ...baseState.units["alpha-assassin"],
          energy: 1,
        },
      },
      currentUnitId: "alpha-assassin",
    };
    const action = {
      actionType: "skill" as const,
      actorId: "alpha-assassin",
      targetId: "beta-controller",
      skillId: toxicStab.id,
      source: "manual" as const,
    };

    expect(validateAction(state, action)).toEqual({ isValid: true });

    const nextState = executeResolvedAction(state, action);

    expect(nextState.units["beta-controller"].currentHp).toBeLessThan(state.units["beta-controller"].currentHp);
    expect(nextState.logs.some((log) => log.message.includes("Viper uses Toxic Stab on Warden"))).toBe(true);
  });

  it("an invalid manual action is rejected safely", () => {
    const state = {
      ...createPassiveBattle(),
      currentUnitId: "alpha-assassin",
    };
    const action = {
      actionType: "skill" as const,
      actorId: "alpha-assassin",
      targetId: "beta-controller",
      skillId: toxicStab.id,
      source: "manual" as const,
    };

    expect(validateAction(state, action)).toEqual({
      isValid: false,
      reason: "Viper cannot use Toxic Stab because they need 1 energy.",
    });

    const nextState = executeResolvedAction(state, action);

    expect(nextState.units["beta-controller"].currentHp).toBe(state.units["beta-controller"].currentHp);
    expect(nextState.logs.at(-1)?.message).toContain("Manual action rejected");
  });

  it("decideAction keeps a safe fallback", () => {
    const cautiousStriker: CharacterDefinition = {
      id: "cautious-striker",
      name: "Cautious Striker",
      aiProfile: "aggressive",
      trait: "cautious",
      baseStats: {
        hp: 20,
        attack: 8,
        defense: 2,
        speed: 12,
      },
      skillIds: [venomStrike.id],
    };
    const target: CharacterDefinition = {
      id: "fragile-target",
      name: "Fragile Target",
      aiProfile: "aggressive",
      baseStats: {
        hp: 6,
        attack: 6,
        defense: 1,
        speed: 8,
      },
      skillIds: [],
    };

    const baseState = initializeBattle({
      battleId: "battle-v6-cautious",
      skills: [venomStrike],
      teams: [
        {
          teamId: "alpha",
          members: [{ unitId: "alpha-cautious", character: cautiousStriker }],
        },
        {
          teamId: "beta",
          members: [{ unitId: "beta-target", character: target }],
        },
      ],
    });
    const state: BattleState = {
      ...baseState,
      currentUnitId: "alpha-cautious",
    };

    const action = decideAction(state, "alpha-cautious");

    expectActionCore(action, {
      actionType: "basic_attack",
      actorId: "alpha-cautious",
      targetId: "beta-target",
    });
  });

  it("simulateBattle still finishes correctly with traits and passives", () => {
    const simulation = simulateBattle(createPassiveBattle());

    expect(simulation.finalState.lifecycle).toBe("finished");
    expect(simulation.executedActions).toBeGreaterThan(0);
    expect(simulation.finalState.logs.some((log) => log.message.includes("chooses"))).toBe(true);
  });
});

describe("BattleEngine v7", () => {
  it("loads a scenario correctly", () => {
    const state = createBattleStateFromScenario(balancedDuelScenario);

    expect(state.battleId).toBe(balancedDuelScenario.id);
    expect(Object.keys(state.units)).toHaveLength(4);
    expect(state.skills[toxicStab.id]?.name).toBe("Toxic Stab");
  });

  it("simulateBattle works directly with scenarios", () => {
    const simulation = simulateBattle(balancedDuelScenario);

    expect(simulation.scenarioId).toBe(balancedDuelScenario.id);
    expect(simulation.logs.length).toBeGreaterThan(0);
    expect(simulation.metrics.turnCount).toBeGreaterThan(0);
  });

  it("the boss prioritizes backline pressure over the tank line", () => {
    const battle = createBattleStateFromScenario(bossFightScenario);
    const action = decideAction(
      {
        ...battle,
        units: {
          ...battle.units,
          "boss-ogre": {
            ...battle.units["boss-ogre"],
            energy: 1,
          },
        },
        currentUnitId: "boss-ogre",
      },
      "boss-ogre",
    );

    expectActionCore(action, {
      actionType: "skill",
      actorId: "boss-ogre",
      targetId: "party-support",
      skillId: "tyrant-rush",
    });
  });

  it("the boss definition does not break the system", () => {
    expect(ogreBoss.role).toBe("boss");
    expect(ogreBoss.skillIds.length).toBe(2);

    const simulation = simulateBattle(bossFightScenario);

    expect(simulation.finalState.lifecycle).toBe("finished");
    expect(Object.keys(simulation.metrics.unitMetrics)).toContain("boss-ogre");
  });

  it("calculates combat metrics correctly for a simple scenario", () => {
    const striker: CharacterDefinition = {
      id: "metric-striker",
      name: "Metric Striker",
      aiProfile: "aggressive",
      baseStats: {
        hp: 10,
        attack: 5,
        defense: 0,
        speed: 10,
      },
      skillIds: [],
    };
    const dummy: CharacterDefinition = {
      id: "metric-dummy",
      name: "Metric Dummy",
      aiProfile: "aggressive",
      baseStats: {
        hp: 4,
        attack: 1,
        defense: 0,
        speed: 5,
      },
      skillIds: [],
    };

    const simulation = simulateBattle({
      id: "metrics-scenario",
      name: "Metrics Scenario",
      skills: [],
      teams: [
        {
          teamId: "alpha",
          units: [{ unitId: "alpha-striker", character: striker }],
        },
        {
          teamId: "beta",
          units: [{ unitId: "beta-dummy", character: dummy }],
        },
      ],
    });

    expect(simulation.metrics.turnCount).toBe(1);
    expect(simulation.metrics.winnerTeamId).toBe("alpha");
    expect(simulation.metrics.unitMetrics["alpha-striker"].damageDealt).toBe(4);
    expect(simulation.metrics.unitMetrics["alpha-striker"].actionsTaken).toBe(1);
    expect(simulation.metrics.unitMetrics["alpha-striker"].basicAttacks).toBe(1);
    expect(simulation.metrics.unitMetrics["alpha-striker"].skillUsage).toEqual({});
    expect(simulation.metrics.unitMetrics["alpha-striker"].shieldApplied).toBe(0);
    expect(simulation.metrics.unitMetrics["alpha-striker"].damageMitigated).toBe(0);
    expect(simulation.metrics.unitMetrics["alpha-striker"].kills).toBe(1);
  });

  it("tracks shielding, mitigation, skill usage and wasted support actions", () => {
    let state = initializeBattle({
      battleId: "metrics-details",
      skills: rosterSkills,
      teams: [
        {
          teamId: "alpha",
          members: [
            { unitId: "alpha-tank", character: tank },
            { unitId: "alpha-support", character: support },
          ],
        },
        {
          teamId: "beta",
          members: [{ unitId: "beta-assassin", character: assassin }],
        },
      ],
    });

    state = {
      ...state,
      units: {
        ...state.units,
        "alpha-tank": {
          ...state.units["alpha-tank"],
          energy: 1,
        },
      },
      currentUnitId: "alpha-tank",
    };
    state = executeSkill(state, "alpha-tank", ironGuard.id, "alpha-support");
    state = {
      ...state,
      currentUnitId: "beta-assassin",
    };
    state = executeBasicAttack(state, "beta-assassin", "alpha-support");
    state = {
      ...state,
      units: {
        ...state.units,
        "alpha-support": {
          ...state.units["alpha-support"],
          energy: 1,
        },
      },
      currentUnitId: "alpha-support",
    };
    state = executeSkill(state, "alpha-support", radiantMend.id, "alpha-support");

    const metrics = buildBattleMetrics(state);

    expect(metrics.unitMetrics["alpha-tank"]).toEqual(
      expect.objectContaining({
        shieldApplied: 10,
        damageMitigated: 6,
        actionsTaken: 1,
        basicAttacks: 0,
        skillUsage: {
          [ironGuard.id]: 1,
        },
      }),
    );
    expect(metrics.unitMetrics["alpha-support"].wastedSupportActions).toBe(1);
    expect(metrics.unitMetrics["beta-assassin"].basicAttacks).toBe(1);
    expect(metrics.unitMetrics["alpha-support"].damageTaken).toBe(0);
  });

  it("uses seeds to keep variation reproducible while allowing different outcomes", () => {
    const first = runScenario(balancedDuelScenario, { seed: 900 });
    const second = runScenario(balancedDuelScenario, { seed: 900 });
    const third = runScenario(balancedDuelScenario, { seed: 901 });

    expect(first.metrics.turnCount).toBe(second.metrics.turnCount);
    expect(first.finalState.winnerTeamId).toBe(second.finalState.winnerTeamId);
    expect(first.metrics.unitMetrics["heroes-controller"].damageDealt).toBe(
      second.metrics.unitMetrics["heroes-controller"].damageDealt,
    );
    expect(
      first.metrics.turnCount !== third.metrics.turnCount ||
        first.metrics.unitMetrics["heroes-controller"].damageDealt !==
          third.metrics.unitMetrics["heroes-controller"].damageDealt,
    ).toBe(true);
  });

  it("defensive ai falls back to offense when shielding has no real value", () => {
    const baseState = initializeBattle({
      battleId: "defense-fallback",
      skills: rosterSkills,
      teams: [
        {
          teamId: "alpha",
          members: [
            { unitId: "alpha-tank", character: tank },
            { unitId: "alpha-support", character: support },
          ],
        },
        {
          teamId: "beta",
          members: [{ unitId: "beta-controller", character: controller }],
        },
      ],
      seed: 77,
    });
    const state: BattleState = {
      ...baseState,
      units: {
        ...baseState.units,
        "alpha-tank": {
          ...baseState.units["alpha-tank"],
          energy: 1,
        },
        "alpha-support": {
          ...baseState.units["alpha-support"],
          currentHp: 24,
          statuses: [
            {
              type: StatusEffectType.Shield,
              durationTurns: 2,
              remainingTurns: 2,
              potency: 12,
              sourceUnitId: "alpha-tank",
            },
          ],
        },
      },
      currentUnitId: "alpha-tank",
    };

    const action = decideAction(state, "alpha-tank");

    expectActionCore(action, {
      actionType: "basic_attack",
      actorId: "alpha-tank",
      targetId: "beta-controller",
    });
  });

  it("the updated boss can use its defining chase skill without breaking validation", () => {
    const battle = createBattleStateFromScenario(bossFightScenario);
    const action = decideAction(
      {
        ...battle,
        turn: 10,
        units: {
          ...battle.units,
          "boss-ogre": {
            ...battle.units["boss-ogre"],
            energy: 2,
          },
          "party-support": {
            ...battle.units["party-support"],
            currentHp: 12,
          },
        },
        currentUnitId: "boss-ogre",
      },
      "boss-ogre",
    );

    expectActionCore(action, {
      actionType: "skill",
      actorId: "boss-ogre",
      targetId: "party-support",
      skillId: "tyrant-rush",
    });
  });

  it("tyrant rush adds deterministic pressure against backline targets in long fights", () => {
    let state = createBattleStateFromScenario(bossFightScenario);
    state = {
      ...state,
      turn: 10,
      currentUnitId: "boss-ogre",
      units: {
        ...state.units,
        "boss-ogre": {
          ...state.units["boss-ogre"],
          energy: 1,
        },
        "party-support": {
          ...state.units["party-support"],
          currentHp: 26,
          statuses: [
            {
              type: StatusEffectType.Shield,
              durationTurns: 2,
              remainingTurns: 2,
              potency: 15,
              sourceUnitId: "party-tank",
            },
          ],
        },
      },
    };

    const nextState = executeSkill(state, "boss-ogre", "tyrant-rush", "party-support");

    expect(nextState.logs.some((log) => log.message.includes("Seraph takes 5 Tyrant Rush pressure damage"))).toBe(
      true,
    );
    expect(nextState.units["party-support"].currentHp).toBe(14);
  });

  it("includes a focused boss pressure scenario for tuning", () => {
    const simulation = simulateBattle(bossPressureScenario, { seed: 1400 });

    expect(simulation.finalState.lifecycle).toBe("finished");
    expect(Object.keys(simulation.metrics.unitMetrics)).toContain("boss-ogre");
    expect(simulation.metrics.turnCount).toBeGreaterThan(0);
  });

  it("simulateBattle always terminates for all starter scenarios", () => {
    for (const scenario of pveScenarios) {
      const simulation = simulateBattle(scenario);

      expect(simulation.finalState.lifecycle).toBe("finished");
      expect(simulation.metrics.turnCount).toBeGreaterThan(0);
    }
  });

  it("multiple scenario executions do not leak state", () => {
    const first = runScenarioSeries(balancedDuelScenario, 2, 500);
    const second = runScenarioSeries(balancedDuelScenario, 2, 500);
    const suite = runScenarioSuite(1);

    expect(first.runs[0].metrics.turnCount).toBe(second.runs[0].metrics.turnCount);
    expect(first.runs[1].finalState.winnerTeamId).toBe(second.runs[1].finalState.winnerTeamId);
    expect(first.seeds).toEqual([500, 501]);
    expect(suite).toHaveLength(pveScenarios.length);
  });
});
