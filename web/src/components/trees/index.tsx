// Plant visuals for the Focus page. Public API:
//   TREE_SPECIES / TreeSpeciesKey – species catalogue (keys are persisted in the DB)
//   TreeComponent – one plant at a given growth stage
//   PlantScene    – hero diorama growing a single plant
//   Meadow        – a garden of finished plants
export { TREE_SPECIES, type TreeSpeciesKey } from './species';
export { TreeComponent } from './Plant';
export { PlantScene, Meadow } from './Scene';
