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

// ---------- globais padrão: {{global.*}} ----------

const MOCK_FIRST = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Felipe", "Gabriela", "Heitor", "Isabela", "João", "Larissa", "Marcos", "Natália", "Otávio", "Paula", "Rafael", "Sofia", "Thiago", "Valentina", "William"];
const MOCK_LAST = ["Almeida", "Barbosa", "Cardoso", "Duarte", "Ferreira", "Gomes", "Lima", "Martins", "Nascimento", "Oliveira", "Pereira", "Ribeiro", "Santos", "Souza", "Teixeira", "Vieira"];
const MOCK_WORDS = ["lorem", "ipsum", "dolor", "amet", "raio", "trovao", "faisca", "nuvem", "vento", "chuva"];
const MOCK_CITIES = ["Curitiba", "São Paulo", "Rio de Janeiro", "Belo Horizonte", "Porto Alegre", "Florianópolis", "Salvador", "Recife", "Fortaleza", "Manaus"];
const MOCK_COMPANIES = ["Acme LTDA", "Raio Tech", "Trovão Sistemas", "Faísca Digital", "Nuvem Azul SA", "Vento Norte ME"];

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const digits = (n: number): string =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

/** CPF aleatório válido (só dígitos). */
function mockCpf(): string {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (nums: number[]) => {
    const sum = nums.reduce((acc, v, i) => acc + v * (nums.length + 1 - i), 0);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(d);
  const d2 = dv([...d, d1]);
  return [...d, d1, d2].join("");
}

const GLOBALS: Record<string, () => string> = {
  "global.timestamp": () => String(Date.now()),
  "global.isodate": () => new Date().toISOString(),
  "global.date": () => new Date().toISOString().slice(0, 10),
  "global.uuid": () => crypto.randomUUID(),
  "global.random": () => String(Math.floor(Math.random() * 1_000_000)),
  "global.mock.name": () => pick(MOCK_FIRST) + " " + pick(MOCK_LAST),
  "global.mock.firstName": () => pick(MOCK_FIRST),
  "global.mock.lastName": () => pick(MOCK_LAST),
  "global.mock.email": () => {
    const f = pick(MOCK_FIRST).toLowerCase();
    const l = pick(MOCK_LAST).toLowerCase();
    return `${f}.${l}${digits(2)}@exemplo.com`;
  },
  "global.mock.phone": () => `+55${digits(2)}9${digits(8)}`,
  "global.mock.cpf": mockCpf,
  "global.mock.int": () => String(Math.floor(Math.random() * 1000)),
  "global.mock.word": () => pick(MOCK_WORDS),
  "global.mock.city": () => pick(MOCK_CITIES),
  "global.mock.company": () => pick(MOCK_COMPANIES),
};

/** Nomes das globais padrão disponíveis (autocomplete/validação). */
export const GLOBAL_VAR_NAMES = Object.keys(GLOBALS);

export function isGlobalVar(name: string): boolean {
  return name in GLOBALS;
}

const VAR_RE = /\{\{\s*([$@]?[\w.-]+)\s*\}\}/g;

/** Substitui {{var}} pelos valores do ambiente e {{$dinâmicas}}. Variável ausente fica intacta. */
export function interpolate(text: string, env: Environment | null): string {
  if (!text) return text;
  const map = new Map(env?.vars ?? []);
  return text.replace(VAR_RE, (full, name: string) => {
    if (name.startsWith("$")) return dynamicVar(name) ?? full;
    const val = map.get(name);
    if (val !== undefined) return val; // ambiente vence uma global de mesmo nome
    const gen = GLOBALS[name];
    return gen ? gen() : full;
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
    if (!known.has(name) && !(name in GLOBALS)) found.add(name);
  }
  return [...found];
}
