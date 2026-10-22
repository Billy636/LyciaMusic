interface ShuffleCycleSnapshot {
  members: string[];
  remaining: string[];
  recent: string[];
}

const RECENT_LIMIT = 256;

const readPaths = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((path): path is string => typeof path === 'string' && !!path))]
  : [];

const shufflePaths = (paths: string[]): string[] => {
  const result = [...paths];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};

/** A path-only shuffle cycle. Browsing and metadata reloads do not reset it. */
export function createShuffleCycle(saved?: unknown) {
  const snapshot = saved as Partial<ShuffleCycleSnapshot> | null | undefined;
  let members = readPaths(snapshot?.members);
  const restoredMembers = new Set(members);
  let remaining = readPaths(snapshot?.remaining).filter(path => restoredMembers.has(path));
  let recent = readPaths(snapshot?.recent).slice(-RECENT_LIMIT);

  const newRound = (paths: string[], currentPath?: string): string[] => {
    // Keep recent tracks out of the opening portion, while leaving the rest
    // shuffled so the same group does not remain at the end of every round.
    const cooldown = Math.min(20, Math.floor(paths.length / 3));
    const avoid = new Set(cooldown > 0 ? recent.slice(-cooldown) : []);
    if (currentPath) avoid.add(currentPath);
    const shuffled = shufflePaths(paths);
    for (let index = 0; index < cooldown; index += 1) {
      if (!avoid.has(shuffled[index])) continue;
      const freshIndex = shuffled.findIndex((path, position) => position >= cooldown && !avoid.has(path));
      if (freshIndex >= 0) {
        [shuffled[index], shuffled[freshIndex]] = [shuffled[freshIndex], shuffled[index]];
      }
    }
    if (shuffled.length > 1 && shuffled[0] === currentPath) {
      const other = 1 + Math.floor(Math.random() * (shuffled.length - 1));
      [shuffled[0], shuffled[other]] = [shuffled[other], shuffled[0]];
    }
    return shuffled;
  };

  const reconcile = (paths: string[], currentPath?: string) => {
    const nextMembers = [...new Set(paths.filter(Boolean))];
    const previousSet = new Set(members);
    const nextSet = new Set(nextMembers);
    if (members.length === nextMembers.length && members.every(path => nextSet.has(path))) return;

    remaining = remaining.filter(path => nextSet.has(path));
    const additions = nextMembers.filter(path => !previousSet.has(path) && path !== currentPath);
    if (additions.length > 0) {
      // Membership changes may reorder the unplayed portion, never reintroduce
      // already selected tracks. Reordering the queue alone leaves it untouched.
      remaining = newRound([...remaining, ...additions], currentPath);
    }
    members = nextMembers;
  };

  const remember = (path: string) => {
    recent = [...recent.filter(candidate => candidate !== path), path].slice(-RECENT_LIMIT);
  };

  return {
    peekNext(paths: string[], currentPath?: string): string | undefined {
      reconcile(paths, currentPath);
      if (remaining.length === 0) remaining = newRound(members, currentPath);
      return remaining[0];
    },
    record(path: string, paths: string[], currentPath?: string) {
      reconcile(paths, currentPath);
      remaining = remaining.filter(candidate => candidate !== path);
      remember(path);
    },
    remember,
    discard(path: string) {
      remaining = remaining.filter(candidate => candidate !== path);
    },
    reset() {
      members = [];
      remaining = [];
    },
    snapshot(): ShuffleCycleSnapshot {
      return { members: [...members], remaining: [...remaining], recent: [...recent] };
    },
  };
}
