import type { CharacterDefinition } from "../../domain/CharacterDefinition.js";
import { crushingSlam, tyrantRush } from "../skills/bossSkills.js";

export const ogreBoss: CharacterDefinition = {
  id: "boss-iron-ogre",
  name: "Iron Ogre",
  role: "boss",
  aiProfile: "aggressive",
  trait: "aggressive",
  passiveId: "reduce_incoming_damage_flat",
  baseStats: {
    hp: 92,
    attack: 15,
    defense: 6,
    speed: 9,
  },
  skillIds: [crushingSlam.id, tyrantRush.id],
};
