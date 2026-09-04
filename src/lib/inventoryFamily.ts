/**
 * family head for vendor WIP / variant grouping.
 * one-level tree: variants point at a head with parentId NULL.
 * orphan (no parentId) is its own head until linked.
 */
export const familyHeadId = (item: {
  id: number;
  parentId?: number | null;
}): number => {
  const parent = item.parentId;
  if (parent != null && parent > 0) return parent;
  return item.id;
};
