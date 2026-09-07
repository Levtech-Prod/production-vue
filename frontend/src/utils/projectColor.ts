/**
 * A colour per project, so the same project is recognisable at a glance
 * across all five board columns.
 *
 * Deliberately derived from the id rather than randomised or stored: the
 * colour has to be the same on every render, every reload and in every
 * session, or it identifies nothing. Nothing is persisted, so this can be
 * re-tuned freely — no migration, no column.
 *
 * `id % length` rather than a hash: project ids are sequential, so this
 * guarantees that any ten projects created in a row are ten different
 * colours, where a hash would let neighbours collide by chance.
 */
const PROJECT_COLORS = [
  '#2563eb', // blue-600
  '#c026d3', // fuchsia-600
  '#059669', // emerald-600
  '#ea580c', // orange-600
  '#7c3aed', // violet-600
  '#0891b2', // cyan-600
  '#e11d48', // rose-600
  '#65a30d', // lime-600
  '#0d9488', // teal-600
  '#ca8a04', // yellow-600
] as const;

/** Accent colour for a project, as a CSS colour. */
export function projectColor(projectId: number): string {
  return PROJECT_COLORS[Math.abs(projectId) % PROJECT_COLORS.length];
}
