import { z } from "zod";
import {
  checkContract,
  validateSchemaValue,
  type ContractState,
  type Violation,
} from "./openapi";
import { expandUrl } from "./spec";
import type { Environment, HistoryContract, RequestDef } from "../types";

/** Compila código Zod do usuário: uma expressão que retorna um schema, com `z` no escopo. */
export function compileZod(
  source: string,
): { ok: true; schema: z.ZodType } | { ok: false; error: string } {
  try {
    const factory = new Function("z", `"use strict"; return (${source});`);
    const schema = factory(z) as unknown;
    // duck-typing não basta: o próprio namespace `z` tem safeParse() em v4
    if (!(schema instanceof z.ZodType)) {
      return { ok: false, error: "o código não retorna um schema Zod (esperado z.object(...) etc.)" };
    }
    return { ok: true, schema };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Valida sintaxe de um JSON Schema colado (JSON parseável + objeto). */
export function parseJsonSchema(
  source: string,
): { ok: true; schema: unknown } | { ok: false; error: string } {
  try {
    const schema = JSON.parse(source);
    if (typeof schema !== "object" || schema === null)
      return { ok: false, error: "schema precisa ser um objeto JSON" };
    return { ok: true, schema };
  } catch (e) {
    return { ok: false, error: "JSON inválido: " + String(e) };
  }
}

function parseBody(body: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

function zodPath(path: PropertyKey[]): string {
  return "$" + path.map((s) => (typeof s === "number" ? `[${s}]` : `.${String(s)}`)).join("");
}

function invalid(operation: string, message: string): ContractState {
  return { kind: "violations", operation, violations: [{ path: "$", message }] };
}

function runZod(source: string, body: string): ContractState {
  const op = "schema Zod da rota";
  const compiled = compileZod(source);
  if (!compiled.ok) return invalid(op, "schema inválido: " + compiled.error);
  const parsed = parseBody(body);
  if (!parsed.ok) return invalid(op, "body não é JSON válido");
  try {
    const result = compiled.schema.safeParse(parsed.value);
    if (result.success) return { kind: "ok", operation: op };
    const violations: Violation[] = result.error.issues.map((i) => ({
      path: zodPath(i.path),
      message: i.message,
    }));
    return { kind: "violations", operation: op, violations };
  } catch (e) {
    // refine/transform do usuário pode lançar qualquer coisa: nunca derruba o app
    return invalid(op, "schema lançou exception ao validar: " + String(e));
  }
}

function runJsonSchema(source: string, body: string): ContractState {
  const op = "JSON Schema da rota";
  const parsedSchema = parseJsonSchema(source);
  if (!parsedSchema.ok) return invalid(op, "schema inválido: " + parsedSchema.error);
  const parsed = parseBody(body);
  if (!parsed.ok) return invalid(op, "body não é JSON válido");
  const violations = validateSchemaValue(parsedSchema.schema, parsed.value);
  return violations.length === 0
    ? { kind: "ok", operation: op }
    : { kind: "violations", operation: op, violations };
}

/**
 * Contrato efetivo da rota: schema próprio (zod/json-schema) tem precedência;
 * sem schema próprio, cai na spec OpenAPI da collection.
 */
export function evaluateContract(
  req: RequestDef,
  spec: Record<string, unknown> | null,
  env: Environment | null,
  status: number,
  contentType: string | undefined,
  body: string,
): ContractState {
  try {
    const c = req.contract;
    if (c && c.source.trim()) {
      return c.type === "zod" ? runZod(c.source, body) : runJsonSchema(c.source, body);
    }
    return checkContract(spec, req.method, expandUrl(req, env), status, contentType, body);
  } catch (e) {
    return invalid("contrato", "erro ao avaliar contrato: " + String(e));
  }
}

/** Snapshot do resultado do contrato para gravar no histórico da execução. */
export function contractForHistory(
  req: RequestDef,
  spec: Record<string, unknown> | null,
  state: ContractState,
): HistoryContract {
  const c = req.contract;
  const hasOwn = !!(c && c.source.trim());
  const type = hasOwn ? c!.type : spec ? "openapi" : "none";
  if (type === "none")
    return { status: "none", type: "none", operation: "", violations: [], source: "" };
  const status =
    state.kind === "ok" ? "ok" : state.kind === "violations" ? "fail" : "none";
  return {
    status,
    type,
    operation: "operation" in state ? state.operation : "",
    violations:
      state.kind === "violations"
        ? state.violations.slice(0, 50).map((v) => [v.path, v.message] as [string, string])
        : [],
    source: hasOwn ? c!.source : "",
  };
}
