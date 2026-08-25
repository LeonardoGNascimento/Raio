#!/usr/bin/env tsx
/**
 * raio run — executa uma collection no terminal/CI validando contrato, checks e SLA.
 *
 *   npm run raio-run -- <collection> [--env <nome>] [--workspace <dir>]
 *
 * Exit code 0 = tudo passou; 1 = alguma rota falhou (5xx, contrato, checks, SLA, rede).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildSendSpec, resolveBase, withBase } from "../src/lib/spec";
import { evaluateContract } from "../src/lib/contract";
import { runChecks } from "../src/lib/checks";
import { slaBreached, type Environment, type HttpResponseData, type RequestDef } from "../src/types";

const G = "\x1b[32m";
const R = "\x1b[31m";
const Y = "\x1b[33m";
const D = "\x1b[2m";
const B = "\x1b[1m";
const X = "\x1b[0m";

function fail(msg: string): never {
  console.error(R + "erro: " + msg + X);
  process.exit(2);
}

// ---- args ----
const args = process.argv.slice(2);
const collectionName = args.find((a) => !a.startsWith("--"));
const flag = (name: string) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!collectionName) fail("uso: raio-run <collection> [--env nome] [--workspace dir]");
const workspace = flag("workspace") ?? path.join(os.homedir(), "raio-collections");
const envName = flag("env") ?? "";

// ---- carrega workspace ----
const collDir = path.join(workspace, collectionName);
if (!fs.existsSync(collDir)) fail(`collection "${collectionName}" não existe em ${workspace}`);

// ambientes são da collection; environments.json na raiz vale como legado
const collEnvFile = path.join(collDir, "environments.json");
const legacyEnvFile = path.join(workspace, "environments.json");
const envFile = fs.existsSync(collEnvFile) ? collEnvFile : legacyEnvFile;
const environments: Environment[] = fs.existsSync(envFile)
  ? JSON.parse(fs.readFileSync(envFile, "utf8"))
  : [];
const env = environments.find((e) => e.name === envName) ?? null;
if (envName && !env) fail(`ambiente "${envName}" não existe (tem: ${environments.map((e) => e.name).join(", ")})`);

const specFile = path.join(collDir, ".openapi.json");
const spec: Record<string, unknown> | null = fs.existsSync(specFile)
  ? JSON.parse(fs.readFileSync(specFile, "utf8"))
  : null;

function readRequests(dir: string): RequestDef[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith(".") && f !== "environments.json")
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as unknown;
      } catch {
        return null;
      }
    })
    .filter(
      (r): r is RequestDef =>
        !!r &&
        typeof r === "object" &&
        !Array.isArray(r) &&
        typeof (r as RequestDef).method === "string" &&
        typeof (r as RequestDef).url === "string",
    );
}

interface DirCfg {
  base_url: string;
  base_urls?: [string, string][];
}
function readCfg(dir: string): DirCfg {
  const p = path.join(dir, ".config.json");
  if (!fs.existsSync(p)) return { base_url: "" };
  try {
    return { base_url: "", ...JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch {
    return { base_url: "" };
  }
}

const collCfg = readCfg(collDir);
interface Target {
  folder: string | null;
  cfgChain: DirCfg[]; // configs das pastas do caminho, na ordem
  req: RequestDef;
}
const targets: Target[] = readRequests(collDir).map((req) => ({
  folder: null,
  cfgChain: [],
  req,
}));
function walkDirs(dir: string, rel: string | null, chain: DirCfg[]) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry.startsWith(".") || !fs.statSync(full).isDirectory()) continue;
    const relPath = rel ? rel + "/" + entry : entry;
    const nextChain = [...chain, readCfg(full)];
    for (const req of readRequests(full)) targets.push({ folder: relPath, cfgChain: nextChain, req });
    walkDirs(full, relPath, nextChain);
  }
}
walkDirs(collDir, null, []);
if (targets.length === 0) fail("collection vazia");

// ---- execução ----
async function runOne(
  req: RequestDef,
  cfgChain: DirCfg[],
): Promise<{ ok: boolean; line: string; details: string[] }> {
  const reqEnv = withBase(env, resolveBase(collCfg, cfgChain, envName));
  const sendSpec = buildSendSpec(req, reqEnv);
  const route = `${req.method.padEnd(6)} ${req.name}`;
  const details: string[] = [];

  if (sendSpec.body_kind === "multipart") {
    return { ok: false, line: `${Y}? ${route}${X}`, details: ["multipart não suportado no CLI ainda — pulado como falha"] };
  }
  if (sendSpec.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  let resp: HttpResponseData;
  try {
    const t0 = Date.now();
    const body =
      sendSpec.body_kind === "urlencoded"
        ? new URLSearchParams(Object.fromEntries(sendSpec.form ?? [])).toString()
        : (sendSpec.body ?? undefined);
    const headers = Object.fromEntries(sendSpec.headers);
    if (sendSpec.body_kind === "urlencoded")
      headers["content-type"] = "application/x-www-form-urlencoded";
    const r = await fetch(sendSpec.url, {
      method: sendSpec.method,
      headers,
      body,
      redirect: sendSpec.follow_redirects ? "follow" : "manual",
      signal: AbortSignal.timeout(sendSpec.timeout_ms ?? 30_000),
    });
    const ttfb = Date.now() - t0;
    const text = await r.text();
    resp = {
      status: r.status,
      status_text: r.statusText,
      headers: [...r.headers.entries()],
      request_headers: sendSpec.headers,
      body: text,
      body_truncated: false,
      is_binary: false,
      ttfb_ms: ttfb,
      total_ms: Date.now() - t0,
      size_bytes: Buffer.byteLength(text),
      http_version: "HTTP",
    };
  } catch (e) {
    return { ok: false, line: `${R}✕ ${route}${X}`, details: ["rede: " + String(e)] };
  }

  let ok = true;
  if (resp.status >= 500) {
    ok = false;
    details.push(`status ${resp.status}`);
  }
  const contentType = resp.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1];
  const contract = evaluateContract(req, spec, reqEnv, resp.status, contentType, resp.body);
  if (contract.kind === "violations") {
    ok = false;
    details.push(
      `contrato: ${contract.violations.length} violações — ` +
        contract.violations.slice(0, 3).map((v) => `${v.path}: ${v.message}`).join("; "),
    );
  }
  const checkResults = runChecks(req.checks ?? "", resp);
  for (const c of checkResults.filter((c) => !c.ok)) {
    ok = false;
    details.push(`check falhou: ${c.expr} (observado: ${c.actual})`);
  }
  if (slaBreached(resp.total_ms, req.max_ms)) {
    ok = false;
    details.push(`SLA: ${resp.total_ms}ms > ${req.max_ms}ms`);
  }

  const timing = `${D}${resp.status} · ${resp.total_ms}ms${X}`;
  const line = ok ? `${G}✓ ${route}${X}  ${timing}` : `${R}✕ ${route}${X}  ${timing}`;
  return { ok, line, details };
}

(async () => {
  console.log(`${B}raio run${X} · ${collectionName} · env: ${envName || "(nenhum)"} · ${targets.length} rotas\n`);
  let failed = 0;
  for (const target of targets) {
    const req = target.req;
    const result = await runOne(req, target.cfgChain);
    console.log(result.line);
    for (const d of result.details) console.log(`  ${D}└${X} ${d}`);
    if (!result.ok) failed++;
  }
  console.log(
    failed === 0
      ? `\n${G}${B}✓ ${targets.length}/${targets.length} rotas passaram${X}`
      : `\n${R}${B}✕ ${failed} de ${targets.length} rotas falharam${X}`,
  );
  process.exit(failed === 0 ? 0 : 1);
})();
