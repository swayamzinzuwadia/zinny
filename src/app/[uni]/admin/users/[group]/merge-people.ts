/**
 * Several lists of people as one. Someone on more than one list (a head of department who is
 * also an Institute Admin) is one person in the result, holding all their roles, and `kinds`
 * says which lists they came from. Sorted by name.
 */
export function mergePeople<K extends string, P extends { id: string; name: string; roles: unknown[] }>(lists: readonly (readonly [K, P[]])[]): (P & { kinds: Set<K> })[] {
  const merged = new Map<string, P & { kinds: Set<K> }>();
  for (const [kind, list] of lists) {
    for (const p of list) {
      const seen = merged.get(p.id);
      if (seen) {
        seen.roles = [...seen.roles, ...p.roles];
        seen.kinds.add(kind);
      } else merged.set(p.id, { ...p, roles: [...p.roles], kinds: new Set([kind]) });
    }
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}
