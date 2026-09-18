export function withoutDismissedActivities<T extends { id: string }>(items: T[], dismissed: Iterable<string>) {
  const skip = dismissed instanceof Set ? dismissed : new Set(dismissed);
  if (!skip.size) return items;
  return items.filter(item => !skip.has(item.id));
}

export function rememberDismissedIds(dismissed: Iterable<string>, ids: Iterable<string>) {
  const next = dismissed instanceof Set ? new Set(dismissed) : new Set(dismissed);
  for (const id of ids) if (id) next.add(id);
  return next;
}

export function forgetDismissedIds(dismissed: Iterable<string>, ids: Iterable<string>) {
  const next = dismissed instanceof Set ? new Set(dismissed) : new Set(dismissed);
  for (const id of ids) next.delete(id);
  return next;
}

export type ActivityGroup<T extends { id: string; action: string; title: string; actorUserId: string | null }> = T & {
  items: T[];
};

export function groupActivities<T extends { id: string; action: string; title: string; actorUserId: string | null }>(items: T[]) {
  return items.reduce<ActivityGroup<T>[]>((groups, item) => {
    const last = groups[groups.length - 1];
    if (last && last.action === item.action && last.title === item.title && last.actorUserId === item.actorUserId) {
      last.items.push(item);
      return groups;
    }
    groups.push({ ...item, items: [item] });
    return groups;
  }, []);
}
