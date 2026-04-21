export type PassiveId =
  | "bonus_damage_vs_poisoned"
  | "gain_extra_energy_on_basic"
  | "reduce_incoming_damage_flat"
  | "heal_small_on_kill";

export interface PassiveDefinition {
  id: PassiveId;
  name: string;
  description: string;
}
