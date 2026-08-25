/** Gera interfaces TypeScript a partir de um valor JSON (body de response). */

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MAX_DEPTH = 12;

function pascal(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) =>
    c ? c.toUpperCase() : "",
  );
  const base = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return /^[A-Za-z]/.test(base) ? base : "T" + base;
}

function singular(name: string): string {
  if (name.endsWith("ies")) return name.slice(0, -3) + "y";
  if (name.endsWith("s") && !name.endsWith("ss")) return name.slice(0, -1);
  return name;
}

interface Ctx {
  interfaces: { name: string; body: string }[];
  used: Set<string>;
}

function uniqueName(ctx: Ctx, hint: string): string {
  let name = pascal(hint) || "Nested";
  if (!ctx.used.has(name)) {
    ctx.used.add(name);
    return name;
  }
  for (let i = 2; ; i++) {
    if (!ctx.used.has(name + i)) {
      ctx.used.add(name + i);
      return name + i;
    }
  }
}

/** Amostra unificada de vários objetos: chave → { types, presentes em quantos } */
function mergeObjects(objs: Record<string, unknown>[]): {
  keys: string[];
  optional: Set<string>;
  samples: Map<string, unknown[]>;
} {
  const samples = new Map<string, unknown[]>();
  const counts = new Map<string, number>();
  for (const o of objs) {
    for (const [k, v] of Object.entries(o)) {
      if (!samples.has(k)) samples.set(k, []);
      samples.get(k)!.push(v);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const optional = new Set<string>();
  for (const [k, n] of counts) if (n < objs.length) optional.add(k);
  return { keys: [...samples.keys()], optional, samples };
}

function typeOfMany(values: unknown[], hint: string, ctx: Ctx, depth: number): string {
  const parts = new Set<string>();
  const objects: Record<string, unknown>[] = [];
  for (const v of values) {
    if (v === null) parts.add("null");
    else if (Array.isArray(v)) parts.add(typeOfArray(v, hint, ctx, depth));
    else if (typeof v === "object") objects.push(v as Record<string, unknown>);
    else parts.add(typeof v === "bigint" ? "number" : typeof v);
  }
  if (objects.length > 0) parts.add(emitInterface(objects, hint, ctx, depth));
  if (parts.size === 0) return "unknown";
  return [...parts].join(" | ");
}

function typeOfArray(arr: unknown[], hint: string, ctx: Ctx, depth: number): string {
  if (depth > MAX_DEPTH) return "unknown[]";
  if (arr.length === 0) return "unknown[]";
  const inner = typeOfMany(arr.slice(0, 50), singular(hint), ctx, depth + 1);
  return inner.includes("|") ? `(${inner})[]` : `${inner}[]`;
}

function emitInterface(
  objs: Record<string, unknown>[],
  hint: string,
  ctx: Ctx,
  depth: number,
): string {
  if (depth > MAX_DEPTH) return "Record<string, unknown>";
  const name = uniqueName(ctx, hint);
  const { keys, optional, samples } = mergeObjects(objs);
  const lines = keys.map((k) => {
    const t = typeOfMany(samples.get(k)!, k, ctx, depth + 1);
    const key = IDENT.test(k) ? k : JSON.stringify(k);
    return `  ${key}${optional.has(k) ? "?" : ""}: ${t};`;
  });
  ctx.interfaces.push({
    name,
    body: `export interface ${name} {\n${lines.join("\n") || "  // objeto vazio"}\n}`,
  });
  return name;
}

/** value já parseado → código TS. Raiz vira interface (objeto) ou type alias. */
export function jsonToTs(value: unknown, rootName = "ApiResponse"): string {
  const ctx: Ctx = { interfaces: [], used: new Set() };
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    emitInterface([value as Record<string, unknown>], rootName, ctx, 0);
  } else {
    const t = typeOfMany([value], rootName + "Item", ctx, 0);
    ctx.interfaces.push({
      name: rootName,
      body: `export type ${pascal(rootName)} = ${t};`,
    });
  }
  // raiz primeiro, tipos aninhados na sequência
  return ctx.interfaces
    .map((i) => i.body)
    .reverse()
    .join("\n\n");
}
