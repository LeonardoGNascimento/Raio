/** Variáveis globais do workspace: valem em todas as collections.
 *  Estado de módulo para o interpolate resolver em qualquer contexto (app, vigia, fluxo, CLI). */
let current: [string, string][] = [];

export function setGlobalVars(vars: [string, string][]) {
  current = vars.filter(([k]) => k.trim());
}

export function getGlobalVars(): [string, string][] {
  return current;
}

export function getGlobalVar(name: string): string | undefined {
  for (const [k, v] of current) if (k === name) return v;
  return undefined;
}
