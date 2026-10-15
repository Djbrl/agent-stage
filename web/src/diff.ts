// Minimal line diff (LCS). Files the agent touches are small, so O(n·m) is fine.
export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string; a?: number; b?: number };

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before ? before.replace(/\n$/, '').split('\n') : [];
  const b = after ? after.replace(/\n$/, '').split('\n') : [];
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) out.push({ kind: 'same', text: a[i], a: ++i, b: ++j });
    else if (j < b.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) out.push({ kind: 'add', text: b[j], b: ++j });
    else out.push({ kind: 'del', text: a[i], a: ++i });
  }
  return out;
}

export function diffStats(lines: DiffLine[]) {
  return { add: lines.filter((l) => l.kind === 'add').length, del: lines.filter((l) => l.kind === 'del').length };
}
