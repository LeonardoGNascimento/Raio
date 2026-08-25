/** Resolve um path simples num valor JSON: $.a.b[0].c — com .length em array/string. */
export function getByPath(value: unknown, path: string): unknown {
  let cur = value;
  const trimmed = path.trim().replace(/^\$\.?/, "");
  if (!trimmed) return cur;
  const parts = trimmed.match(/[^.[\]]+/g) ?? [];
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (part === "length") {
      if (Array.isArray(cur) || typeof cur === "string") {
        cur = cur.length;
        continue;
      }
      return undefined;
    }
    if (/^\d+$/.test(part)) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(part)];
      continue;
    }
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
