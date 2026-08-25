export interface RequestContract {
  type: "zod" | "json-schema";
  source: string;
}

export interface RequestAuth {
  type: "none" | "bearer" | "basic" | "apikey";
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  in?: "header" | "query";
}

export interface MultipartField {
  name: string;
  kind: "text" | "file";
  value: string; // texto ou caminho do arquivo
}

export interface RequestOptions {
  timeout_ms?: number | null;
  follow_redirects?: boolean;
  insecure?: boolean;
}

export type BodyType = "none" | "json" | "text" | "form" | "urlencoded" | "multipart";

export interface RequestDef {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
  body_type: BodyType;
  /** contrato da rota; ausente = herda a spec OpenAPI da collection */
  contract?: RequestContract | null;
  /** SLA de latência em ms; execução acima disso gera alerta */
  max_ms?: number | null;
  /** query params anexados à URL no envio */
  query?: [string, string][];
  /** valores dos path params ({id} ou :id na URL) */
  path_params?: [string, string][];
  auth?: RequestAuth | null;
  form?: [string, string][];
  multipart?: MultipartField[];
  options?: RequestOptions | null;
  /** checks declarativos, um por linha (ex.: status == 200) */
  checks?: string;
  /** extração pós-response: [variável, path] ex.: ["token", "$.data.token"] */
  extract?: [string, string][];
  /** vigia da rota: reexecuta no intervalo (no ambiente fixado) e notifica quebras */
  watch?: { env: string; minutes: number } | null;
}

/** Execução estourou o SLA vigente? */
export function slaBreached(totalMs: number, maxMs: number | null | undefined): boolean {
  return typeof maxMs === "number" && maxMs > 0 && totalMs > maxMs;
}

export interface Environment {
  name: string;
  vars: [string, string][];
}

export interface Folder {
  name: string;
  base_url: string;
  base_urls: [string, string][];
  requests: RequestDef[];
  folders: Folder[];
}

/** Cadeia de pastas para um path "a/b/c" dentro da collection. */
export function folderChain(coll: Collection, path: string | null | undefined): Folder[] {
  if (!path) return [];
  const chain: Folder[] = [];
  let list = coll.folders;
  for (const seg of path.split("/")) {
    const f = list.find((x) => x.name === seg);
    if (!f) break;
    chain.push(f);
    list = f.folders;
  }
  return chain;
}

/** Todas as requests da collection com o path da pasta. */
export function flattenRequests(
  coll: Collection,
): { folder: string | null; req: RequestDef }[] {
  const out: { folder: string | null; req: RequestDef }[] = coll.requests.map((req) => ({
    folder: null,
    req,
  }));
  const walk = (folders: Folder[], prefix: string) => {
    for (const f of folders) {
      const path = prefix ? prefix + "/" + f.name : f.name;
      for (const req of f.requests) out.push({ folder: path, req });
      walk(f.folders, path);
    }
  };
  walk(coll.folders, "");
  return out;
}

export interface Collection {
  name: string;
  base_url: string;
  base_urls: [string, string][];
  has_spec: boolean;
  requests: RequestDef[];
  folders: Folder[];
  /** ambientes próprios da collection */
  environments: Environment[];
}

export interface WorkspaceData {
  path: string;
  collections: Collection[];
}

export interface Snapshot {
  saved_at: string;
  env: string;
  status: number;
  body: string;
}

export interface HttpResponseData {
  status: number;
  status_text: string;
  headers: [string, string][];
  request_headers: [string, string][];
  body: string;
  body_truncated: boolean;
  is_binary: boolean;
  body_base64?: string | null;
  ttfb_ms: number;
  total_ms: number;
  size_bytes: number;
  http_version: string;
}

export interface TraceEvent {
  t: number;
  kind: string; // route | check | cache | query | error | response | ...
  label: string;
  dur?: number;
  data?: unknown;
  at?: string;
  stack?: string[];
}

export interface TraceData {
  events: TraceEvent[];
  source: string | null;
  runtime: string | null;
  done: boolean;
}

export interface HistoryContract {
  status: "ok" | "fail" | "none";
  type: "zod" | "json-schema" | "openapi" | "none";
  operation: string;
  violations: [string, string][]; // (path, mensagem)
  source: string;
}

export interface HistoryEntry {
  id: string;
  at: string;
  env: string;
  status: number;
  status_text: string;
  ttfb_ms: number;
  total_ms: number;
  size_bytes: number;
  http_version: string;
  body: string;
  headers: [string, string][];
  trace_error: boolean;
  method?: string;
  url?: string;
  request_body?: string;
  contract?: HistoryContract | null;
  max_ms?: number | null;
  checks_total?: number;
  checks_failed?: number;
}

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export const METHOD_CLASS: Record<string, string> = {
  GET: "c-ok",
  POST: "c-warn",
  PUT: "c-info",
  PATCH: "c-purple",
  DELETE: "c-err",
};

export function statusClass(status: number): string {
  if (status < 300) return "c-ok";
  if (status < 400) return "c-info";
  if (status < 500) return "c-warn";
  return "c-err";
}

export function envDotClass(name: string): string {
  if (name === "prod" || name === "production") return "c-err";
  if (name.startsWith("stag") || name.startsWith("hom")) return "c-warn";
  return "c-info";
}

export function newRequest(name = "/nova", url = ""): RequestDef {
  return {
    id: crypto.randomUUID(),
    name,
    method: "GET",
    url,
    headers: [],
    body: "",
    body_type: "none",
  };
}
