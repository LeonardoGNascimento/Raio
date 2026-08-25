import type { Environment } from "../types";

/** Variáveis dinâmicas geradas no momento do envio. */
function dynamicVar(name: string): string | null {
  switch (name) {
    case "$uuid":
      return crypto.randomUUID();
    case "$timestamp":
      return String(Date.now());
    case "$isodate":
      return new Date().toISOString();
    case "$random":
      return String(Math.floor(Math.random() * 1_000_000));
    default:
      return null;
  }
}

const VAR_RE = /\{\{\s*([$@]?[\w.-]+)\s*\}\}/g;

/** Substitui {{var}} pelos valores do ambiente e {{$dinâmicas}}. Variável ausente fica intacta. */
export function interpolate(text: string, env: Environment | null): string {
  if (!text) return text;
  const map = new Map(env?.vars ?? []);
  return text.replace(VAR_RE, (full, name: string) => {
    if (name.startsWith("$")) return dynamicVar(name) ?? full;
    const val = map.get(name);
    return val !== undefined ? val : full;
  });
}

/** Lista variáveis usadas no texto que não existem no ambiente (dinâmicas não contam). */
export function missingVars(text: string, env: Environment | null): string[] {
  const found = new Set<string>();
  const known = new Set(env ? env.vars.map(([k]) => k) : []);
  for (const m of text.matchAll(VAR_RE)) {
    const name = m[1];
    if (name.startsWith("$")) {
      if (dynamicVar(name) === null) found.add(name); // dinâmica desconhecida
      continue;
    }
    if (!known.has(name)) found.add(name);
  }
  return [...found];
}
