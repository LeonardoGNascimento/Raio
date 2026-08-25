import type { Collection, Folder, MultipartField, RequestAuth, RequestDef } from "../types";
import { newRequest } from "../types";
import { parseSpec } from "./openapi";

export interface ImportedFolder {
  name: string;
  requests: RequestDef[];
}
export interface ImportedCollection {
  name: string;
  requests: RequestDef[];
  folders: ImportedFolder[];
  /** spec OpenAPI (JSON) para salvar na collection */
  openapi?: string;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/* ---------------- Postman v2.1 ---------------- */

function pmUrl(url: unknown): string {
  if (typeof url === "string") return url;
  if (isObj(url) && typeof url.raw === "string") return url.raw;
  return "";
}

function pmAuth(auth: unknown): RequestAuth | null {
  if (!isObj(auth) || typeof auth.type !== "string") return null;
  const grab = (list: unknown, key: string): string => {
    if (!Array.isArray(list)) return "";
    const item = list.find((i) => isObj(i) && i.key === key) as Json | undefined;
    return typeof item?.value === "string" ? item.value : "";
  };
  switch (auth.type) {
    case "bearer":
      return { type: "bearer", token: grab(auth.bearer, "token") };
    case "basic":
      return {
        type: "basic",
        username: grab(auth.basic, "username"),
        password: grab(auth.basic, "password"),
      };
    case "apikey":
      return {
        type: "apikey",
        key: grab(auth.apikey, "key"),
        value: grab(auth.apikey, "value"),
        in: grab(auth.apikey, "in") === "query" ? "query" : "header",
      };
    default:
      return null;
  }
}

function pmRequest(item: Json): RequestDef | null {
  const r = item.request;
  if (!isObj(r) && typeof r !== "string") return null;
  const req = newRequest(typeof item.name === "string" ? item.name : "importada");
  if (typeof r === "string") {
    req.url = r;
    return req;
  }
  req.method = typeof r.method === "string" ? r.method.toUpperCase() : "GET";
  req.url = pmUrl(r.url);
  if (Array.isArray(r.header)) {
    req.headers = r.header
      .filter((h): h is Json => isObj(h) && h.disabled !== true && typeof h.key === "string")
      .map((h) => [String(h.key), typeof h.value === "string" ? h.value : ""] as [string, string]);
  }
  req.auth = pmAuth(r.auth);
  const body = r.body;
  if (isObj(body)) {
    if (body.mode === "raw" && typeof body.raw === "string") {
      req.body = body.raw;
      const lang = isObj(body.options) && isObj(body.options.raw) ? body.options.raw.language : "";
      req.body_type =
        lang === "json" || /^\s*[[{]/.test(body.raw) ? "json" : "text";
    } else if (body.mode === "urlencoded" && Array.isArray(body.urlencoded)) {
      req.body_type = "urlencoded";
      req.form = body.urlencoded
        .filter((p): p is Json => isObj(p) && p.disabled !== true)
        .map((p) => [String(p.key ?? ""), String(p.value ?? "")] as [string, string]);
    } else if (body.mode === "formdata" && Array.isArray(body.formdata)) {
      req.body_type = "multipart";
      req.multipart = body.formdata
        .filter((p): p is Json => isObj(p) && p.disabled !== true)
        .map(
          (p): MultipartField => ({
            name: String(p.key ?? ""),
            kind: p.type === "file" ? "file" : "text",
            value: p.type === "file" ? String(p.src ?? "") : String(p.value ?? ""),
          }),
        );
    }
  }
  return req;
}

function importPostman(data: Json): ImportedCollection {
  const info = isObj(data.info) ? data.info : {};
  const out: ImportedCollection = {
    name: typeof info.name === "string" ? info.name : "postman-import",
    requests: [],
    folders: [],
  };
  const folderByPath = new Map<string, ImportedFolder>();
  const folderFor = (p: string): ImportedFolder => {
    let f = folderByPath.get(p);
    if (!f) {
      f = { name: p, requests: [] };
      folderByPath.set(p, f);
      out.folders.push(f);
    }
    return f;
  };
  const walk = (items: unknown, prefix: string) => {
    if (!Array.isArray(items)) return;
    for (const raw of items) {
      if (!isObj(raw)) continue;
      if (Array.isArray(raw.item)) {
        // pasta: níveis viram subpastas reais (path "a/b")
        const seg = String(raw.name ?? "pasta").replace(/\//g, "-");
        walk(raw.item, prefix ? prefix + "/" + seg : seg);
      } else {
        const req = pmRequest(raw);
        if (!req) continue;
        (prefix ? folderFor(prefix).requests : out.requests).push(req);
      }
    }
  };
  walk(data.item, "");
  out.folders = out.folders.filter((f) => f.requests.length > 0);
  return out;
}

/* ---------------- OpenAPI ---------------- */

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

function importOpenApi(spec: Json): ImportedCollection {
  const info = isObj(spec.info) ? spec.info : {};
  const servers = Array.isArray(spec.servers) ? spec.servers : [];
  const server0 = isObj(servers[0]) && typeof servers[0].url === "string" ? servers[0].url : "";
  const base = server0.replace(/\/$/, "") || "{{base}}";

  const out: ImportedCollection = {
    name: typeof info.title === "string" ? info.title : "openapi-import",
    requests: [],
    folders: [],
    openapi: JSON.stringify(spec, null, 2),
  };
  const paths = isObj(spec.paths) ? spec.paths : {};
  for (const [path, item] of Object.entries(paths)) {
    if (!isObj(item)) continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!isObj(op)) continue;
      const req = newRequest(path, base + path);
      req.method = method.toUpperCase();
      if (isObj(op.requestBody)) {
        req.body_type = "json";
        req.body = "{}";
        req.headers = [["Content-Type", "application/json"]];
      }
      out.requests.push(req);
    }
  }
  return out;
}

/* ---------------- detecção ---------------- */

export function importAny(
  raw: string,
): { ok: true; kind: "postman" | "openapi"; coll: ImportedCollection } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // OpenAPI pode vir em YAML: parseSpec cobre
    const spec = parseSpec(raw);
    if (spec.ok) return { ok: true, kind: "openapi", coll: importOpenApi(spec.spec as Json) };
    return { ok: false, error: "não reconheci: nem JSON válido nem OpenAPI YAML" };
  }
  if (!isObj(data)) return { ok: false, error: "arquivo vazio" };
  if (isObj(data.info) && Array.isArray(data.item))
    return { ok: true, kind: "postman", coll: importPostman(data) };
  if ((data.openapi || data.swagger) && isObj(data.paths))
    return { ok: true, kind: "openapi", coll: importOpenApi(data) };
  return {
    ok: false,
    error: "formato não reconhecido — aceito Postman collection v2.x e OpenAPI 3.x (JSON/YAML)",
  };
}

/* ---------------- export Postman v2.1 ---------------- */

function pmExportRequest(req: RequestDef): Json {
  const r: Json = {
    method: req.method,
    header: req.headers.map(([key, value]) => ({ key, value })),
    url: { raw: req.url },
  };
  const a = req.auth;
  if (a && a.type !== "none") {
    if (a.type === "bearer") r.auth = { type: "bearer", bearer: [{ key: "token", value: a.token ?? "", type: "string" }] };
    if (a.type === "basic")
      r.auth = {
        type: "basic",
        basic: [
          { key: "username", value: a.username ?? "", type: "string" },
          { key: "password", value: a.password ?? "", type: "string" },
        ],
      };
    if (a.type === "apikey")
      r.auth = {
        type: "apikey",
        apikey: [
          { key: "key", value: a.key ?? "", type: "string" },
          { key: "value", value: a.value ?? "", type: "string" },
          { key: "in", value: a.in ?? "header", type: "string" },
        ],
      };
  }
  const bt = req.body_type === "form" ? "urlencoded" : req.body_type;
  if (bt === "json" || bt === "text") {
    r.body = {
      mode: "raw",
      raw: req.body,
      options: { raw: { language: bt === "json" ? "json" : "text" } },
    };
  } else if (bt === "urlencoded") {
    r.body = { mode: "urlencoded", urlencoded: (req.form ?? []).map(([key, value]) => ({ key, value })) };
  } else if (bt === "multipart") {
    r.body = {
      mode: "formdata",
      formdata: (req.multipart ?? []).map((p) =>
        p.kind === "file" ? { key: p.name, type: "file", src: p.value } : { key: p.name, type: "text", value: p.value },
      ),
    };
  }
  return r;
}

export function exportPostman(coll: Collection): string {
  const folderItem = (f: Folder): Json => ({
    name: f.name,
    item: [
      ...f.requests.map((req) => ({ name: req.name, request: pmExportRequest(req) })),
      ...f.folders.map(folderItem),
    ],
  });
  const item: Json[] = [
    ...coll.requests.map((req) => ({ name: req.name, request: pmExportRequest(req) })),
    ...coll.folders.map(folderItem),
  ];
  return JSON.stringify(
    {
      info: {
        name: coll.name,
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      item,
    },
    null,
    2,
  );
}

/** texto UTF-8 → base64 (para salvar via save_body) */
export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
