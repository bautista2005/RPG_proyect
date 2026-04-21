import { initializeBattle } from "../battle/BattleEngine.js";
import type { InitializeBattleInput } from "../battle/BattleEngine.js";
import type { BattleState } from "../battle/BattleState.js";
import type { CharacterDefinition, CharacterStats } from "../domain/CharacterDefinition.js";
import type { SkillDefinition } from "../domain/SkillDefinition.js";

export interface BattleScenarioUnit {
  unitId: string;
  character: CharacterDefinition;
  overrides?: Partial<CharacterStats>;
}

export interface BattleScenarioTeam {
  teamId: string;
  units: BattleScenarioUnit[];
}

export interface BattleScenarioConfig {
  maxTurns?: number;
  seed?: number;
}

export interface BattleScenario {
  id: string;
  name: string;
  description?: string;
  teams: [BattleScenarioTeam, BattleScenarioTeam];
  skills: SkillDefinition[];
  config?: BattleScenarioConfig;
}

export function createBattleInputFromScenario(scenario: BattleScenario): InitializeBattleInput {
  return {
    battleId: scenario.id,
    skills: scenario.skills,
    seed: scenario.config?.seed,
    teams: scenario.teams.map((team) => ({
      teamId: team.teamId,
      members: team.units.map((unit) => ({
        unitId: unit.unitId,
        character: unit.overrides
          ? {
              ...unit.character,
              baseStats: {
                ...unit.character.baseStats,
                ...unit.overrides,
              },
            }
          : unit.character,
      })),
    })) as InitializeBattleInput["teams"],
  };
}

export function createBattleStateFromScenario(scenario: BattleScenario): BattleState {
  return initializeBattle(createBattleInputFromScenario(scenario));
}

export function isBattleScenario(input: BattleState | BattleScenario): input is BattleScenario {
  return "teams" in input && "skills" in input && "name" in input;
}
