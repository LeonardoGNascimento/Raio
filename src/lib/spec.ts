import type { SendSpec } from "../api";
import type { Environment, MultipartField, RequestDef } from "../types";
import { interpolate } from "./interpolate";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface HasBase {
  base_url: string;
  base_urls?: [string, string][];
}

/** {{@base}} é só o base da collection no ambiente: por-ambiente vence o default. */
export function resolveBase(coll: HasBase | null, envName: string): string {
  if (!coll) return "";
  return (coll.base_urls?.find(([e]) => e === envName)?.[1] ?? coll.base_url ?? "").trim();
}

/** Path acumulado das pastas ("/orders/v2") — entra visível na URL da request, não no {{@base}}. */
export function folderBasePath(folders: HasBase | HasBase[] | null): string {
  const chain = folders === null ? [] : Array.isArray(folders) ? folders : [folders];
  let path = "";
  for (const f of chain) {
    const p = (f.base_url || f.base_urls?.[0]?.[1] || "").trim();
    if (!p) continue;
    path += "/" + p.replace(/^\/+/, "").replace(/\/+$/, "");
  }
  return path;
}

/** Anexa a base resolvida como variável {{@base}} no ambiente. */
export function withBase(env: Environment | null, base: string): Environment | null {
  if (!base) return env;
  // sem barra final: a URL da request já traz o "/" ({{@base}}/orders/teste)
  return {
    name: env?.name ?? "",
    vars: [...(env?.vars ?? []), ["@base", base.replace(/\/+$/, "")]] as [string, string][],
  };
}

/** Nomes de path params na URL: {id} (fora de {{env}}) e /:id */
export function pathParamNames(url: string): string[] {
  const names: string[] = [];
  for (const m of url.matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)) names.push(m[1]);
  for (const m of url.matchAll(/\/:(\w+)(?=[/?#]|$)/g)) names.push(m[1]);
  return [...new Set(names)];
}

/** URL final: path params preenchidos, query anexada, ambiente interpolado. */
export function expandUrl(req: RequestDef, env: Environment | null): string {
  let url = req.url;

  for (const [k, raw] of req.path_params ?? []) {
    if (!k.trim()) continue;
    const v = interpolate(raw, env);
    if (!v) continue; // sem valor: deixa o placeholder visível na URL
    url = url.replace(new RegExp(`(?<!\\{)\\{${escapeRe(k)}\\}(?!\\})`, "g"), v);
    url = url.replace(new RegExp(`/:${escapeRe(k)}(?=[/?#]|$)`, "g"), "/" + v);
  }

  const qp = (req.query ?? []).filter(([k]) => k.trim());
  const authQuery = authQueryParam(req, env);
  const allQ = authQuery ? [...qp, authQuery] : qp;
  if (allQ.length > 0) {
    const qs = allQ
      .map(
        ([k, v]) =>
          encodeURIComponent(interpolate(k, env)) + "=" + encodeURIComponent(interpolate(v, env)),
      )
      .join("&");
    url += (url.includes("?") ? "&" : "?") + qs;
  }

  return interpolate(url, env);
}

function authQueryParam(req: RequestDef, env: Environment | null): [string, string] | null {
  const a = req.auth;
  if (a?.type === "apikey" && a.in === "query" && a.key)
    return [interpolate(a.key, env), interpolate(a.value ?? "", env)];
  return null;
}

/** Header de autenticação da rota, se configurado. */
export function authHeader(req: RequestDef, env: Environment | null): [string, string] | null {
  const a = req.auth;
  if (!a || a.type === "none") return null;
  if (a.type === "bearer" && a.token)
    return ["Authorization", "Bearer " + interpolate(a.token, env)];
  if (a.type === "basic") {
    const user = interpolate(a.username ?? "", env);
    const pass = interpolate(a.password ?? "", env);
    if (!user && !pass) return null;
    return ["Authorization", "Basic " + btoa(`${user}:${pass}`)];
  }
  if (a.type === "apikey" && a.in !== "query" && a.key)
    return [interpolate(a.key, env), interpolate(a.value ?? "", env)];
  return null;
}

/** Monta o payload de envio com params, auth, body e opções. */
export function buildSendSpec(req: RequestDef, env: Environment | null): SendSpec {
  const headers = (req.headers ?? [])
    .filter(([k]) => k.trim())
    .map(([k, v]) => [interpolate(k, env), interpolate(v, env)] as [string, string]);
  const ah = authHeader(req, env);
  if (ah && !headers.some(([k]) => k.toLowerCase() === ah[0].toLowerCase())) headers.push(ah);

  const bt = req.body_type === "form" ? "urlencoded" : req.body_type;
  const bodyKind = bt === "urlencoded" ? "urlencoded" : bt === "multipart" ? "multipart" : "raw";

  const opts = req.options ?? {};
  return {
    method: req.method,
    url: expandUrl(req, env),
    headers,
    body: bt === "none" || bodyKind !== "raw" ? null : interpolate(req.body, env),
    body_kind: bodyKind,
    form: (req.form ?? []).map(
      ([k, v]) => [interpolate(k, env), interpolate(v, env)] as [string, string],
    ),
    multipart: (req.multipart ?? []).map(
      (f): MultipartField => ({
        name: interpolate(f.name, env),
        kind: f.kind,
        value: f.kind === "text" ? interpolate(f.value, env) : f.value,
      }),
    ),
    timeout_ms: opts.timeout_ms ?? undefined,
    follow_redirects: opts.follow_redirects ?? true,
    insecure: opts.insecure ?? false,
  };
}
