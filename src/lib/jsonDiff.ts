export type DiffKind = "added" | "removed" | "changed";

export interface DiffEntry {
  path: string;
  kind: DiffKind;
  left?: unknown;
  right?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Diff estrutural entre dois valores JSON. Retorna lista plana de mudanças por path. */
export function jsonDiff(left: unknown, right: unknown, path = "$"): DiffEntry[] {
  if (Object.is(left, right)) return [];

  if (isObject(left) && isObject(right)) {
    const out: DiffEntry[] = [];
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      const p = `${path}.${key}`;
      if (!(key in left)) out.push({ path: p, kind: "added", right: right[key] });
      else if (!(key in right)) out.push({ path: p, kind: "removed", left: left[key] });
      else out.push(...jsonDiff(left[key], right[key], p));
    }
    return out;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const out: DiffEntry[] = [];
    const len = Math.max(left.length, right.length);
    for (let i = 0; i < len; i++) {
      const p = `${path}[${i}]`;
      if (i >= left.length) out.push({ path: p, kind: "added", right: right[i] });
      else if (i >= right.length) out.push({ path: p, kind: "removed", left: left[i] });
      else out.push(...jsonDiff(left[i], right[i], p));
    }
    return out;
  }

  // tipos diferentes ou primitivos diferentes
  if (left === right) return [];
  return [{ path, kind: "changed", left, right }];
}

export function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
