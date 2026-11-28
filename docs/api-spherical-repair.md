# Extract spherical geometry repair into core

Opt-in spherical repair, with configurable limits; potentially lossy. A null ring result means repair failed. Retain atlas regression.

export { repairRing, repairGeometry } from "./spherical-repair.js";
export type { SphericalRepairOptions } from "./spherical-repair.js";
