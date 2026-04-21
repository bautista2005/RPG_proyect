# Core Combat

## Reglas básicas

### Turnos

- El combate ocurre por turnos
- Cada unidad actúa cuando le corresponde según el orden definido por el battle engine
- El motor debe poder soportar en el futuro modos manual, automático e híbrido

### Stats iniciales

- `hp`: vida máxima y actual
- `attack`: poder ofensivo base
- `defense`: mitigación base
- `speed`: referencia para orden o prioridad de turnos

### Acciones básicas

- Ataque básico
- Uso de skill simple
- Aplicación de estados
- Generación de logs del combate

### Estados

- `poison`: daño periódico
- `stun`: impide actuar temporalmente
- `shield`: absorbe daño
- `burn`: daño periódico o modificación ofensiva según diseño futuro

### Condición de victoria

- Gana el equipo que deja a todas las unidades rivales fuera de combate
