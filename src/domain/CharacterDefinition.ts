/**
 * Define el contrato de un personaje fuera del estado de batalla.
 * Sirve como fuente de datos estáticos para crear unidades en combate.
 */
export interface CharacterStats {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
}

export interface CharacterDefinition {
  id: string;
  name: string;
  baseStats: CharacterStats;
  skillIds: string[];
}
