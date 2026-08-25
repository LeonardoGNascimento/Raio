/** Temas do raio: 11 cores-chave editáveis; tokens derivados são calculados. */

export const THEME_KEYS = [
  "ground",
  "panel",
  "input",
  "text",
  "dim",
  "accent",
  "ok",
  "warn",
  "err",
  "info",
  "purple",
] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

export const THEME_LABELS: Record<ThemeKey, string> = {
  ground: "fundo",
  panel: "painéis",
  input: "campos",
  text: "texto",
  dim: "texto secundário",
  accent: "destaque",
  ok: "sucesso",
  warn: "aviso",
  err: "erro",
  info: "informação",
  purple: "realce extra",
};

export interface Theme {
  name: string;
  colors: Record<ThemeKey, string>;
}

export const DEFAULT_THEME: Theme = {
  name: "raio",
  colors: {
    ground: "#17140f",
    panel: "#201c16",
    input: "#24201a",
    text: "#ece6db",
    dim: "#a79d8e",
    accent: "#e0a63a",
    ok: "#5cba86",
    warn: "#f0bd57",
    err: "#e07a63",
    info: "#6b9fd4",
    purple: "#c98a63",
  },
};

export const PRESETS: Theme[] = [
  DEFAULT_THEME,
  {
    name: "meia-noite",
    colors: {
      ground: "#0e1118",
      panel: "#151a24",
      input: "#1a2030",
      text: "#dde4f0",
      dim: "#8d99b0",
      accent: "#5ea2f0",
      ok: "#57c99a",
      warn: "#e8c268",
      err: "#e57373",
      info: "#8fb8e8",
      purple: "#b48ce0",
    },
  },
  {
    name: "carvão",
    colors: {
      ground: "#121212",
      panel: "#1a1a1a",
      input: "#202020",
      text: "#e6e4e0",
      dim: "#9a9791",
      accent: "#d4b060",
      ok: "#6dbd8f",
      warn: "#dcb35c",
      err: "#d97b6c",
      info: "#7fa8c9",
      purple: "#b08faf",
    },
  },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}

/** mistura com branco (amount>0) ou preto (amount<0), amount em 0..1 */
function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  return rgbToHex(r + (target - r) * t, g + (target - g) * t, b + (target - b) * t);
}

function rgbTriplet(hex: string): string {
  return hexToRgb(hex).join(", ");
}

/** Aplica o tema como CSS custom properties no :root. */
export function applyTheme(theme: Theme): void {
  const c = theme.colors;
  const root = document.documentElement;
  const set = (k: string, v: string) => root.style.setProperty("--" + k, v);

  set("ground", c.ground);
  set("ground-2", shade(c.ground, 0.05));
  set("panel", c.panel);
  set("panel-2", shade(c.panel, 0.015));
  set("input", c.input);
  set("input-2", shade(c.input, 0.03));
  set("menu", shade(c.input, 0.03));
  set("btn", shade(c.input, -0.03));
  set("text", c.text);
  set("mid", shade(c.text, -0.1));
  set("dim", c.dim);
  set("faint", shade(c.dim, -0.28));
  set("gutter", shade(c.dim, -0.45));
  set("accent", c.accent);
  set("accent-2", shade(c.accent, 0.16));
  set("ok", c.ok);
  set("warn", c.warn);
  set("warn-2", shade(c.warn, -0.14));
  set("err", c.err);
  set("info", c.info);
  set("purple", c.purple);
  set("rgb-panel", rgbTriplet(c.panel));
  set("rgb-ground", rgbTriplet(c.ground));
  set("code-bg", shade(c.panel, -0.12));
  set("scroll", shade(c.input, 0.1));
  set("scroll-hover", shade(c.input, 0.16));
  set("placeholder", shade(c.dim, -0.4));
  set("rgb-accent", rgbTriplet(c.accent));
  set("rgb-ok", rgbTriplet(c.ok));
  set("rgb-warn", rgbTriplet(shade(c.warn, -0.14)));
  set("rgb-err", rgbTriplet(c.err));
  set("rgb-info", rgbTriplet(c.info));
}

/** Valida JSON de tema importado. */
export function parseTheme(
  raw: string,
): { ok: true; theme: Theme } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: "JSON inválido: " + String(e) };
  }
  if (typeof data !== "object" || data === null) return { ok: false, error: "tema vazio" };
  const obj = data as { name?: unknown; colors?: unknown };
  const colors = obj.colors;
  if (typeof colors !== "object" || colors === null)
    return { ok: false, error: 'faltou o objeto "colors"' };
  const out = { ...DEFAULT_THEME.colors };
  for (const key of THEME_KEYS) {
    const v = (colors as Record<string, unknown>)[key];
    if (v === undefined) continue; // ausente: usa o padrão
    if (typeof v !== "string" || !HEX.test(v))
      return { ok: false, error: `"${key}" precisa ser hex #rrggbb (recebi ${JSON.stringify(v)})` };
    out[key] = v.toLowerCase();
  }
  return {
    ok: true,
    theme: { name: typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : "importado", colors: out },
  };
}

const STORAGE_KEY = "raio.theme";

export function loadSavedTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = parseTheme(raw);
    return parsed.ok ? parsed.theme : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
}
