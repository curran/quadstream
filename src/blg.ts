/** Ordered min-Cartesian tree over vertex priorities; inorder restores exact input order. */
export interface BlgNode {
  position: number;
  level: number;
  random: number;
  left: BlgNode | null;
  right: BlgNode | null;
}
export interface BlgTree {
  root: BlgNode | null;
  count: number;
}
export function stableBlgRandom(key: number): number {
  let hash = Math.imul(key + 1, 0x9e3779b1);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  return (hash >>> 0) / 0x100000000;
}
export function buildBlgTree(
  levels: readonly number[],
  randomValues?: readonly number[],
): BlgTree {
  if (randomValues && randomValues.length !== levels.length)
    throw new Error("BLG random values must match priorities");
  const stack: BlgNode[] = [];
  for (let position = 0; position < levels.length; position++) {
    const level = levels[position]!;
    if (!Number.isFinite(level) || level < 0)
      throw new Error("BLG priorities must be nonnegative and finite");
    const node: BlgNode = {
      position,
      level,
      random: randomValues?.[position] ?? stableBlgRandom(position),
      left: null,
      right: null,
    };
    let last: BlgNode | null = null;
    while (stack.length && stack[stack.length - 1]!.level > level)
      last = stack.pop()!;
    node.left = last;
    if (stack.length) stack[stack.length - 1]!.right = node;
    stack.push(node);
  }
  return { root: stack[0] ?? null, count: levels.length };
}
/** Iterative inorder traversal: no recursion depth limitation. */
export function selectBlgPositions(tree: BlgTree, maxLevel: number): number[] {
  if (!Number.isFinite(maxLevel) && maxLevel !== Infinity)
    throw new Error("Invalid selection level");
  if (maxLevel < 0) throw new Error("Invalid selection level");
  if (maxLevel === Infinity) maxLevel = Number.MAX_SAFE_INTEGER;
  const wholeLevel = Math.floor(maxLevel),
    fraction = maxLevel - wholeLevel,
    partialLevel = wholeLevel + 1,
    traversalLevel = fraction === 0 ? wholeLevel : partialLevel;
  const selected: number[] = [],
    stack: BlgNode[] = [];
  let current = tree.root;
  while (current || stack.length) {
    while (current && current.level <= traversalLevel) {
      stack.push(current);
      current = current.left;
    }
    if (!stack.length) break;
    const node = stack.pop()!;
    if (
      node.level <= wholeLevel ||
      (fraction > 0 &&
        node.level === partialLevel &&
        (node.level === 0 || node.random >= 1 - fraction))
    )
      selected.push(node.position);
    current = node.right;
  }
  return selected;
}
export function assertBlgInvariants(tree: BlgTree): void {
  const stack: Array<{ node: BlgNode; parentLevel: number }> = [];
  if (tree.root) stack.push({ node: tree.root, parentLevel: -Infinity });
  const seen = new Set<number>();
  while (stack.length) {
    const { node, parentLevel } = stack.pop()!;
    if (node.level < parentLevel)
      throw new Error("BLG heap invariant violated");
    if (seen.has(node.position)) throw new Error("BLG duplicate position");
    seen.add(node.position);
    if (node.left) stack.push({ node: node.left, parentLevel: node.level });
    if (node.right) stack.push({ node: node.right, parentLevel: node.level });
  }
  if (seen.size !== tree.count)
    throw new Error("BLG vertex accounting mismatch");
  const all = selectBlgPositions(tree, Infinity);
  if (all.some((position, i) => position !== i))
    throw new Error("BLG inorder invariant violated");
}
