import type { CharacterDefinition } from "../../domain/CharacterDefinition.js";
import { concussiveBlow, ironGuard, radiantMend, toxicStab } from "../skills/rosterSkills.js";

export const tank: CharacterDefinition = {
  id: "tank-bastion",
  name: "Bastion",
  role: "tank",
  aiProfile: "defensive",
  trait: "protector",
  passiveId: "reduce_incoming_damage_flat",
  baseStats: {
    hp: 36,
    attack: 6,
    defense: 5,
    speed: 7,
  },
  skillIds: [ironGuard.id],
};

export const assassin: CharacterDefinition = {
  id: "assassin-viper",
  name: "Viper",
  role: "assassin",
  aiProfile: "aggressive",
  trait: "aggressive",
  passiveId: "bonus_damage_vs_poisoned",
  baseStats: {
    hp: 21,
    attack: 8,
    defense: 2,
    speed: 13,
  },
  skillIds: [toxicStab.id],
};

export const support: CharacterDefinition = {
  id: "support-seraph",
  name: "Seraph",
  role: "support",
  aiProfile: "supportive",
  trait: "cautious",
  passiveId: "gain_extra_energy_on_basic",
  baseStats: {
    hp: 26,
    attack: 5,
    defense: 3,
    speed: 13,
  },
  skillIds: [radiantMend.id],
};

export const controller: CharacterDefinition = {
  id: "controller-warden",
  name: "Warden",
  role: "controller",
  aiProfile: "control",
  trait: "opportunist",
  passiveId: "heal_small_on_kill",
  baseStats: {
    hp: 26,
    attack: 6,
    defense: 3,
    speed: 8,
  },
  skillIds: [concussiveBlow.id],
};

export const starterRoster: CharacterDefinition[] = [tank, assassin, support, controller];

export const starterRosterMap = Object.fromEntries(starterRoster.map((character) => [character.id, character]));
