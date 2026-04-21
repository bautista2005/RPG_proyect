import type { PassiveDefinition, PassiveId } from "../domain/PassiveDefinition.js";

export const passiveDefinitions: PassiveDefinition[] = [
  {
    id: "bonus_damage_vs_poisoned",
    name: "Toxic Exploiter",
    description: "Deals +2 damage to poisoned targets.",
  },
  {
    id: "gain_extra_energy_on_basic",
    name: "Steady Flow",
    description: "Gains +1 extra energy on basic attack.",
  },
  {
    id: "reduce_incoming_damage_flat",
    name: "Stoneguard",
    description: "Reduces incoming damage by 1.",
  },
  {
    id: "heal_small_on_kill",
    name: "Blood Rush",
    description: "Recovers 3 HP after defeating an enemy.",
  },
];

export const passiveDefinitionMap: Record<PassiveId, PassiveDefinition> = Object.fromEntries(
  passiveDefinitions.map((passive) => [passive.id, passive]),
) as Record<PassiveId, PassiveDefinition>;

export function getPassiveDefinition(passiveId?: PassiveId): PassiveDefinition | undefined {
  if (!passiveId) {
    return undefined;
  }

  return passiveDefinitionMap[passiveId];
}
