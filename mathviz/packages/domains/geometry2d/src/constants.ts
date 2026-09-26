// Frozen constants — dependency-free so compile/evaluate/assert can import
// them without creating import cycles with the adapter facade.

export const GEOMETRY2D_ADAPTER_VERSION = "0.1.0";

/** The ONE numeric policy constant for the whole domain (P2 frozen).
 *  Normalized comparisons only; no private epsilons anywhere else. */
export const GEOMETRY_EPS = 1e-9;

export const GEOMETRY_NUMERIC_POLICY = `epsilon=${GEOMETRY_EPS}@geometry2d/${GEOMETRY2D_ADAPTER_VERSION}`;

/** P2 frozen implementation set — a strict subset of the registry's
 *  geometry2d ids (25). Unlisted-but-registered ids (ray, arc, polygon,
 *  locus, derive_length) are deliberately NOT implemented in P2. */
export const P2_CAPABILITIES: ReadonlySet<string> = new Set([
  "geometry2d.point",
  "geometry2d.segment",
  "geometry2d.line",
  "geometry2d.circle",
  "geometry2d.midpoint",
  "geometry2d.intersection_point",
  "geometry2d.projection_point",
  "geometry2d.rotate_point",
  "geometry2d.translate_point",
  "geometry2d.reflect_point",
  "geometry2d.parallel",
  "geometry2d.perpendicular",
  "geometry2d.equal_length",
  "geometry2d.collinear",
  "geometry2d.on_circle",
  "geometry2d.distance_equal",
  "geometry2d.right_angle_mark",
  "geometry2d.equal_mark",
  "geometry2d.parallel_mark",
  "geometry2d.angle_mark"
]);
