import { getByPath } from "./jsonpath";
import type { HttpResponseData } from "../types";

export interface CheckResult {
  expr: string;
  ok: boolean;
  /** valor observado, para a mensagem de falha */
  actual: string;
}

/**
 * Grammar de uma linha:
 *   <lhs> <op> <valor>   |   <lhs> exists
 * lhs: status | time | size | body.<path> | headers.<nome>
 * op:  == != > >= < <= contains
 * valor: número, "string", true/false, null ou texto simples
 */
const LINE_RE = /^(\S+)\s+(==|!=|>=|<=|>|<|contains|exists)\s*(.*)$/;

function resolveLhs(lhs: string, resp: HttpResponseData, body: unknown): unknown {
  if (lhs === "status") return resp.status;
  if (lhs === "time") return resp.total_ms;
  if (lhs === "size") return resp.size_bytes;
  if (lhs.startsWith("headers.")) {
    const name = lhs.slice(8).toLowerCase();
    return resp.headers.find(([k]) => k.toLowerCase() === name)?.[1];
  }
  if (lhs === "body") return body;
  if (lhs.startsWith("body.") || lhs.startsWith("body[")) {
    return getByPath(body, "$" + lhs.slice(4));
  }
  return undefined;
}

function parseValue(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return "";
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = /^"(.*)"$/.exec(t) ?? /^'(.*)'$/.exec(t);
  return m ? m[1] : t;
}

function show(v: unknown): string {
  if (v === undefined) return "undefined";
  const s = JSON.stringify(v);
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}

function evalLine(line: string, resp: HttpResponseData, body: unknown): CheckResult {
  const m = LINE_RE.exec(line);
  if (!m) return { expr: line, ok: false, actual: "sintaxe inválida (use: lhs op valor)" };
  const [, lhs, op, rawVal] = m;
  const actual = resolveLhs(lhs, resp, body);

  if (op === "exists")
    return { expr: line, ok: actual !== undefined && actual !== null, actual: show(actual) };

  const expected = parseValue(rawVal);
  let ok = false;
  switch (op) {
    case "==":
      ok = actual == expected; // eslint-disable-line eqeqeq -- comparação frouxa proposital ("200" == 200)
      break;
    case "!=":
      ok = actual != expected; // eslint-disable-line eqeqeq
      break;
    case ">":
    case ">=":
    case "<":
    case "<=": {
      const a = Number(actual);
      const b = Number(expected);
      if (Number.isNaN(a) || Number.isNaN(b)) return { expr: line, ok: false, actual: show(actual) };
      ok = op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : a <= b;
      break;
    }
    case "contains":
      ok =
        typeof actual === "string"
          ? actual.includes(String(expected))
          : Array.isArray(actual)
            ? actual.some((v) => v == expected) // eslint-disable-line eqeqeq
            : false;
      break;
  }
  return { expr: line, ok, actual: show(actual) };
}

/** Avalia o bloco de checks (uma expressão por linha; vazias e # ignoradas). */
export function runChecks(source: string, resp: HttpResponseData): CheckResult[] {
  const lines = source
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (lines.length === 0) return [];
  let body: unknown;
  try {
    body = JSON.parse(resp.body);
  } catch {
    body = undefined;
  }
  return lines.map((line) => evalLine(line, resp, body));
}
