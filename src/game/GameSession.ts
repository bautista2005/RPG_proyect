import type { BattleSimulationResult } from "../battle/BattleSimulation.js";
import { simulateBattle } from "../battle/BattleSimulation.js";
import type { CharacterDefinition } from "../domain/CharacterDefinition.js";
import type { SkillDefinition } from "../domain/SkillDefinition.js";
import { starterRosterMap } from "../data/characters/roster.js";
import { balancedDuelScenario, backlineExposureScenario, bossFightScenario } from "../data/scenarios/pveScenarios.js";
import type { BattleScenario, BattleScenarioConfig, BattleScenarioTeam } from "./BattleScenario.js";

export type GameSessionStatus = "setup" | "in_progress" | "lost" | "completed";

export interface PartyOption {
  id: string;
  label: string;
  members: CharacterDefinition[];
}

export interface CampaignEncounterTemplate {
  id: string;
  name: string;
  description?: string;
  enemyTeam: BattleScenarioTeam;
  skills: SkillDefinition[];
  config?: BattleScenarioConfig;
}

export interface PartyMemberBattleState {
  unitId: string;
  characterId: string;
  name: string;
  currentHp: number;
  maxHp: number;
  energy: number;
  isDefeated: boolean;
}

export interface GameBattleSummary {
  encounterId: string;
  encounterName: string;
  encounterNumber: number;
  totalEncounters: number;
  scenario: BattleScenario;
  result: BattleSimulationResult;
  playerWon: boolean;
  rewardApplied?: string;
  partyState: PartyMemberBattleState[];
}

export interface PartyUpgradeOption {
  id: string;
  label: string;
  description: string;
  stat: "hp" | "attack" | "defense";
  amount: number;
}

export interface AppliedPartyUpgrade {
  optionId: string;
  label: string;
  description: string;
}

export interface GameSessionConfig {
  partyOptions?: PartyOption[];
  campaign?: CampaignEncounterTemplate[];
  playerTeamId?: string;
  baseSeed?: number;
  hpRewardPerVictory?: number;
}

export interface RunSnapshot {
  status: GameSessionStatus;
  selectedPartyOptionId?: string;
  selectedPreBossUpgrade?: AppliedPartyUpgrade;
  pendingPreBossUpgrade: boolean;
  currentEncounterIndex: number;
  totalEncounters: number;
  completedEncounters: number;
  remainingEncounters: number;
  party: CharacterDefinition[];
  history: GameBattleSummary[];
}

const DEFAULT_PLAYER_TEAM_ID = "party";
const DEFAULT_BASE_SEED = 7000;
const DEFAULT_HP_REWARD_PER_VICTORY = 4;
const PRE_BOSS_UPGRADE_OPTIONS: PartyUpgradeOption[] = [
  {
    id: "pre-boss-hp",
    label: "Fortified Vitality",
    description: "+8 max HP to the whole party",
    stat: "hp",
    amount: 8,
  },
  {
    id: "pre-boss-attack",
    label: "Sharpened Blades",
    description: "+2 ATK to the whole party",
    stat: "attack",
    amount: 2,
  },
  {
    id: "pre-boss-defense",
    label: "Iron Wall",
    description: "+1 DEF to the whole party",
    stat: "defense",
    amount: 1,
  },
];

function cloneCharacter(character: CharacterDefinition): CharacterDefinition {
  return {
    ...character,
    baseStats: {
      ...character.baseStats,
    },
    skillIds: [...character.skillIds],
  };
}

function cloneTeam(team: BattleScenarioTeam): BattleScenarioTeam {
  return {
    teamId: team.teamId,
    units: team.units.map((unit) => ({
      unitId: unit.unitId,
      character: cloneCharacter(unit.character),
      overrides: unit.overrides ? { ...unit.overrides } : undefined,
    })),
  };
}

function createEncounterTemplate(scenario: BattleScenario): CampaignEncounterTemplate {
  return {
    id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    enemyTeam: cloneTeam(scenario.teams[1]),
    skills: [...scenario.skills],
    config: scenario.config ? { ...scenario.config } : undefined,
  };
}

export function createDefaultPartyOptions(): PartyOption[] {
  const { tank, assassin, support, controller } = requireRoster();

  return [
    {
      id: "balanced-core",
      label: "Bastion + Viper + Seraph",
      members: [tank, assassin, support].map(cloneCharacter),
    },
    {
      id: "pressure-control",
      label: "Bastion + Warden + Viper",
      members: [tank, controller, assassin].map(cloneCharacter),
    },
    {
      id: "tempo-sustain",
      label: "Warden + Viper + Seraph",
      members: [controller, assassin, support].map(cloneCharacter),
    },
  ];
}

export function createDefaultCampaign(): CampaignEncounterTemplate[] {
  return [
    createEncounterTemplate(balancedDuelScenario),
    createEncounterTemplate(backlineExposureScenario),
    createEncounterTemplate(bossFightScenario),
  ];
}

function requireRoster() {
  return {
    tank: getRosterCharacter("tank-bastion"),
    assassin: getRosterCharacter("assassin-viper"),
    support: getRosterCharacter("support-seraph"),
    controller: getRosterCharacter("controller-warden"),
  };
}

function getRosterCharacter(characterId: string): CharacterDefinition {
  const character = starterRosterMap[characterId];

  if (!character) {
    throw new Error(`Roster character ${characterId} was not found.`);
  }

  return character;
}

export class GameSession {
  readonly partyOptions: PartyOption[];
  readonly campaign: CampaignEncounterTemplate[];
  readonly playerTeamId: string;
  readonly baseSeed: number;
  readonly hpRewardPerVictory: number;
  readonly preBossUpgradeOptions: PartyUpgradeOption[];

  private selectedPartyOptionId?: string;
  private selectedPreBossUpgrade?: AppliedPartyUpgrade;
  private party: CharacterDefinition[] = [];
  private history: GameBattleSummary[] = [];
  private currentEncounterIndex = 0;
  private status: GameSessionStatus = "setup";

  constructor(config: GameSessionConfig = {}) {
    this.partyOptions = config.partyOptions ?? createDefaultPartyOptions();
    this.campaign = config.campaign ?? createDefaultCampaign();
    this.playerTeamId = config.playerTeamId ?? DEFAULT_PLAYER_TEAM_ID;
    this.baseSeed = config.baseSeed ?? DEFAULT_BASE_SEED;
    this.hpRewardPerVictory = config.hpRewardPerVictory ?? DEFAULT_HP_REWARD_PER_VICTORY;
    this.preBossUpgradeOptions = PRE_BOSS_UPGRADE_OPTIONS.map((option) => ({ ...option }));
  }

  getStatus(): GameSessionStatus {
    return this.status;
  }

  getSelectedPartyOption(): PartyOption | undefined {
    return this.partyOptions.find((option) => option.id === this.selectedPartyOptionId);
  }

  getParty(): CharacterDefinition[] {
    return this.party.map(cloneCharacter);
  }

  getHistory(): GameBattleSummary[] {
    return [...this.history];
  }

  getSelectedPreBossUpgrade(): AppliedPartyUpgrade | undefined {
    return this.selectedPreBossUpgrade ? { ...this.selectedPreBossUpgrade } : undefined;
  }

  getCurrentEncounterTemplate(): CampaignEncounterTemplate | null {
    return this.campaign[this.currentEncounterIndex] ?? null;
  }

  hasPendingPreBossUpgrade(): boolean {
    return (
      this.status === "in_progress" &&
      this.currentEncounterIndex === this.campaign.length - 1 &&
      this.campaign.length > 1 &&
      !this.selectedPreBossUpgrade
    );
  }

  getSnapshot(): RunSnapshot {
    return {
      status: this.status,
      selectedPartyOptionId: this.selectedPartyOptionId,
      selectedPreBossUpgrade: this.getSelectedPreBossUpgrade(),
      pendingPreBossUpgrade: this.hasPendingPreBossUpgrade(),
      currentEncounterIndex: this.currentEncounterIndex,
      totalEncounters: this.campaign.length,
      completedEncounters: this.history.length,
      remainingEncounters: Math.max(this.campaign.length - this.history.length, 0),
      party: this.getParty(),
      history: this.getHistory(),
    };
  }

  selectParty(optionId: string) {
    if (this.status !== "setup") {
      throw new Error("Party selection is only allowed before the run starts.");
    }

    const option = this.partyOptions.find((candidate) => candidate.id === optionId);

    if (!option) {
      throw new Error(`Party option ${optionId} was not found.`);
    }

    this.selectedPartyOptionId = option.id;
    this.party = option.members.map(cloneCharacter);
    this.selectedPreBossUpgrade = undefined;
    this.status = "in_progress";
    this.currentEncounterIndex = 0;
    this.history = [];
  }

  applyPreBossUpgrade(optionId: string): AppliedPartyUpgrade {
    if (!this.hasPendingPreBossUpgrade()) {
      throw new Error("Pre-boss upgrade is not available right now.");
    }

    const option = this.preBossUpgradeOptions.find((candidate) => candidate.id === optionId);

    if (!option) {
      throw new Error(`Pre-boss upgrade ${optionId} was not found.`);
    }

    this.party = this.party.map((character) => ({
      ...character,
      baseStats: {
        ...character.baseStats,
        [option.stat]: character.baseStats[option.stat] + option.amount,
      },
    }));
    this.selectedPreBossUpgrade = {
      optionId: option.id,
      label: option.label,
      description: option.description,
    };

    return { ...this.selectedPreBossUpgrade };
  }

  createCurrentScenario(): BattleScenario {
    if (this.status === "setup" || !this.selectedPartyOptionId || this.party.length === 0) {
      throw new Error("The session has no selected party.");
    }

    const encounter = this.getCurrentEncounterTemplate();

    if (!encounter) {
      throw new Error("The campaign has no remaining encounters.");
    }

    return {
      id: `${encounter.id}-run-${this.currentEncounterIndex + 1}`,
      name: encounter.name,
      description: encounter.description,
      skills: [...encounter.skills],
      config: encounter.config ? { ...encounter.config } : undefined,
      teams: [
        {
          teamId: this.playerTeamId,
          units: this.party.map((character, index) => ({
            unitId: `${this.playerTeamId}-${index + 1}-${character.id}`,
            character: cloneCharacter(character),
          })),
        },
        cloneTeam(encounter.enemyTeam),
      ],
    };
  }

  playNextEncounter(): GameBattleSummary {
    if (this.status !== "in_progress") {
      throw new Error(`Cannot play encounter while the run is ${this.status}.`);
    }

    if (this.hasPendingPreBossUpgrade()) {
      throw new Error("Pre-boss upgrade must be chosen before the final encounter.");
    }

    const encounterNumber = this.currentEncounterIndex + 1;
    const scenario = this.createCurrentScenario();
    const result = simulateBattle(scenario, {
      seed: this.baseSeed + this.currentEncounterIndex,
    });
    const playerWon = result.finalState.winnerTeamId === this.playerTeamId;
    const rewardApplied =
      playerWon && encounterNumber < this.campaign.length ? this.applyVictoryReward() : undefined;
    const summary: GameBattleSummary = {
      encounterId: scenario.id,
      encounterName: scenario.name,
      encounterNumber,
      totalEncounters: this.campaign.length,
      scenario,
      result,
      playerWon,
      rewardApplied,
      partyState: Object.values(result.finalState.units)
        .filter((unit) => unit.teamId === this.playerTeamId)
        .map((unit) => ({
          unitId: unit.unitId,
          characterId: unit.characterId,
          name: unit.name,
          currentHp: unit.currentHp,
          maxHp: unit.maxHp,
          energy: unit.energy,
          isDefeated: unit.isDefeated,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };

    this.history.push(summary);

    if (!playerWon) {
      this.status = "lost";
      return summary;
    }

    this.currentEncounterIndex += 1;

    if (this.currentEncounterIndex >= this.campaign.length) {
      this.status = "completed";
    }

    return summary;
  }

  private applyVictoryReward(): string {
    if (this.hpRewardPerVictory <= 0) {
      return "";
    }

    this.party = this.party.map((character) => ({
      ...character,
      baseStats: {
        ...character.baseStats,
        hp: character.baseStats.hp + this.hpRewardPerVictory,
      },
    }));

    return `Victory reward: +${this.hpRewardPerVictory} HP to the whole party for the rest of the run.`;
  }
}
