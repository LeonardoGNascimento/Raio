import { newRequest, type RequestDef } from "../types";

/** Tokeniza respeitando aspas simples/duplas e continuação de linha com \ */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  const src = input.replace(/\\\r?\n/g, " ");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < src.length) {
        cur += src[++i];
      } else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur || has) tokens.push(cur);
      cur = "";
      has = false;
      continue;
    }
    cur += c;
  }
  if (cur || has) tokens.push(cur);
  return tokens;
}

/** Converte um comando curl em RequestDef. Suporta -X, -H, -d/--data*, -u, --url, -L. */
export function parseCurl(command: string): RequestDef | null {
  const tokens = tokenize(command.trim());
  if (tokens.length === 0 || !tokens[0].includes("curl")) return null;

  const req = newRequest("Import curl");
  let methodExplicit = false;
  let hasData = false;

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    const next = () => tokens[++i] ?? "";
    switch (true) {
      case t === "-X" || t === "--request":
        req.method = next().toUpperCase();
        methodExplicit = true;
        break;
      case t.startsWith("-X") && t.length > 2:
        req.method = t.slice(2).toUpperCase();
        methodExplicit = true;
        break;
      case t === "-H" || t === "--header": {
        const raw = next();
        const idx = raw.indexOf(":");
        if (idx > 0) req.headers.push([raw.slice(0, idx).trim(), raw.slice(idx + 1).trim()]);
        break;
      }
      case t === "-d" ||
        t === "--data" ||
        t === "--data-raw" ||
        t === "--data-binary" ||
        t === "--data-ascii":
        req.body = next();
        hasData = true;
        break;
      case t === "-u" || t === "--user":
        req.headers.push(["Authorization", "Basic " + btoa(next())]);
        break;
      case t === "--url":
        req.url = next();
        break;
      case t === "-L" || t === "--location":
        break; // segue redirect: default do app cobre
      case t === "-F" || t === "--form":
        next(); // multipart não suportado no MVP: descarta valor
        break;
      case t === "-b" || t === "--cookie":
        req.headers.push(["Cookie", next()]);
        break;
      case t === "-A" || t === "--user-agent":
        req.headers.push(["User-Agent", next()]);
        break;
      case t === "-e" || t === "--referer":
        req.headers.push(["Referer", next()]);
        break;
      case t === "-o" || t === "--output" || t === "--max-time" || t === "--connect-timeout":
        next(); // opção com valor, irrelevante aqui
        break;
      case t.startsWith("-"):
        break; // flag desconhecida sem valor: ignora
      default:
        if (!req.url) req.url = t;
    }
  }

  if (!req.url) return null;
  if (hasData && !methodExplicit) req.method = "POST";
  if (hasData) {
    const ct = req.headers.find(([k]) => k.toLowerCase() === "content-type");
    req.body_type = ct && ct[1].includes("json") ? "json" : "text";
    if (!ct) {
      const trimmed = req.body.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        req.body_type = "json";
        req.headers.push(["Content-Type", "application/json"]);
      }
    }
  }
  try {
    const u = new URL(req.url);
    req.name = `${req.method} ${u.pathname}`;
  } catch {
    req.name = `${req.method} ${req.url.slice(0, 40)}`;
  }
  return req;
}
