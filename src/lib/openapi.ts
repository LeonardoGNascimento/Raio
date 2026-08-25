import YAML from "yaml";

export interface Violation {
  path: string;
  message: string;
}

export type ContractState =
  | { kind: "no-spec" }
  | { kind: "no-match" } // spec existe, mas rota/método não está nela
  | { kind: "no-schema"; operation: string } // operação existe, sem schema para esse status
  | { kind: "not-json"; operation: string }
  | { kind: "ok"; operation: string }
  | { kind: "violations"; operation: string; violations: Violation[] };

type Json = Record<string, unknown>;

/** Aceita JSON ou YAML. Retorna objeto da spec ou erro descritivo. */
export function parseSpec(text: string): { ok: true; spec: Json } | { ok: false; error: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    try {
      doc = YAML.parse(text);
    } catch (e) {
      return { ok: false, error: "Não é JSON nem YAML válido: " + String(e) };
    }
  }
  if (typeof doc !== "object" || doc === null) return { ok: false, error: "Spec vazia" };
  const spec = doc as Json;
  if (!spec.openapi && !spec.swagger) return { ok: false, error: "Falta campo openapi/swagger" };
  if (typeof spec.paths !== "object" || spec.paths === null)
    return { ok: false, error: "Spec sem paths" };
  return { ok: true, spec };
}

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deref(root: Json, node: unknown, depth = 0): unknown {
  if (depth > 30 || !isObj(node)) return node;
  const ref = node.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/")) return node;
  let cur: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    if (!isObj(cur)) return node;
    cur = cur[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return deref(root, cur, depth + 1);
}

/** Converte path da spec (/users/{id}) em regex de sufixo. */
function specPathRegex(specPath: string): RegExp {
  const pattern = specPath
    .split("/")
    .filter(Boolean)
    .map((seg) =>
      /^\{.+\}$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`(?:^|/)${pattern}/?$`);
}

export interface MatchedOperation {
  specPath: string;
  method: string;
  op: Json;
}

/** Casa método+pathname da request com uma operação da spec. Prefere path mais específico (mais segmentos literais). */
export function findOperation(spec: Json, method: string, url: string): MatchedOperation | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split("?")[0];
  }
  const paths = spec.paths as Json;
  const m = method.toLowerCase();
  let best: MatchedOperation | null = null;
  let bestScore = -1;
  for (const [specPath, item] of Object.entries(paths)) {
    if (!isObj(item)) continue;
    const resolved = deref(spec, item);
    if (!isObj(resolved)) continue;
    const op = resolved[m];
    if (!isObj(op)) continue;
    if (!specPathRegex(specPath).test(pathname)) continue;
    const literals = specPath.split("/").filter((s) => s && !s.startsWith("{")).length;
    const total = specPath.split("/").filter(Boolean).length;
    const score = total * 100 + literals;
    if (score > bestScore) {
      bestScore = score;
      best = { specPath, method: method.toUpperCase(), op };
    }
  }
  return best;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v; // object | string | number | boolean
}

function validateNode(
  root: Json,
  schema: unknown,
  value: unknown,
  path: string,
  out: Violation[],
  depth: number,
): void {
  if (depth > 40 || out.length > 200) return;
  const s = deref(root, schema);
  if (!isObj(s)) return;

  if (value === null) {
    // OpenAPI 3.0: nullable; 3.1: type pode ser array incluindo "null"
    const t = s.type;
    const nullOk =
      s.nullable === true ||
      t === "null" ||
      (Array.isArray(t) && t.includes("null")) ||
      (!t && !s.allOf && !s.oneOf && !s.anyOf && !s.enum);
    if (!nullOk) out.push({ path, message: `null não permitido (esperado ${JSON.stringify(t)})` });
    return;
  }

  if (Array.isArray(s.allOf)) {
    for (const sub of s.allOf) validateNode(root, sub, value, path, out, depth + 1);
  }
  for (const key of ["oneOf", "anyOf"] as const) {
    const subs = s[key];
    if (Array.isArray(subs) && subs.length > 0) {
      const passes = subs.some((sub) => {
        const tmp: Violation[] = [];
        validateNode(root, sub, value, path, tmp, depth + 1);
        return tmp.length === 0;
      });
      if (!passes)
        out.push({ path, message: `não casa com nenhuma variante de ${key}` });
    }
  }

  if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    out.push({
      path,
      message: `valor ${JSON.stringify(value)} fora do enum ${JSON.stringify(s.enum).slice(0, 80)}`,
    });
    return;
  }

  const declared = s.type;
  const actual = typeOf(value);
  if (typeof declared === "string" || Array.isArray(declared)) {
    const allowed = (Array.isArray(declared) ? declared : [declared]).map(String);
    const okType =
      allowed.includes(actual) ||
      (actual === "number" && allowed.includes("integer") && Number.isInteger(value));
    if (!okType) {
      out.push({ path, message: `tipo ${actual}, esperado ${allowed.join("|")}` });
      return;
    }
    if (allowed.includes("integer") && !allowed.includes("number") && actual === "number" && !Number.isInteger(value)) {
      out.push({ path, message: `esperado integer, veio ${value}` });
    }
  }

  if (actual === "object" && isObj(value)) {
    const props = isObj(s.properties) ? s.properties : {};
    if (Array.isArray(s.required)) {
      for (const req of s.required) {
        if (typeof req === "string" && !(req in value))
          out.push({ path: `${path}.${req}`, message: "campo obrigatório ausente" });
      }
    }
    for (const [k, v] of Object.entries(value)) {
      if (k in props) validateNode(root, props[k], v, `${path}.${k}`, out, depth + 1);
      else if (s.additionalProperties === false)
        out.push({ path: `${path}.${k}`, message: "campo não previsto no schema" });
      else if (isObj(s.additionalProperties))
        validateNode(root, s.additionalProperties, v, `${path}.${k}`, out, depth + 1);
    }
  }

  if (actual === "array" && Array.isArray(value) && s.items !== undefined) {
    value.forEach((item, i) =>
      validateNode(root, s.items, item, `${path}[${i}]`, out, depth + 1),
    );
  }
}

/** Valida body da response contra o schema da operação para o status recebido. */
export function validateResponse(
  spec: Json,
  matched: MatchedOperation,
  status: number,
  contentType: string | undefined,
  body: string,
): ContractState {
  const opLabel = `${matched.method} ${matched.specPath}`;
  const responses = isObj(matched.op.responses) ? matched.op.responses : null;
  if (!responses) return { kind: "no-schema", operation: opLabel };

  const respDef = deref(
    spec,
    responses[String(status)] ??
      responses[`${Math.floor(status / 100)}XX`] ??
      responses.default,
  );
  if (!isObj(respDef)) {
    // status não documentado na spec = violação de contrato
    return {
      kind: "violations",
      operation: opLabel,
      violations: [{ path: "$", message: `status ${status} não documentado na spec` }],
    };
  }

  const content = isObj(respDef.content) ? respDef.content : null;
  if (!content) return { kind: "no-schema", operation: opLabel };
  const mediaKey =
    Object.keys(content).find((k) => k.includes("json")) ?? Object.keys(content)[0];
  const media = deref(spec, content[mediaKey]);
  if (!isObj(media) || media.schema === undefined)
    return { kind: "no-schema", operation: opLabel };

  if (contentType && !contentType.includes("json"))
    return { kind: "not-json", operation: opLabel };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      kind: "violations",
      operation: opLabel,
      violations: [{ path: "$", message: "body não é JSON válido, mas spec define schema JSON" }],
    };
  }

  const out: Violation[] = [];
  validateNode(spec, media.schema, parsed, "$", out, 0);
  return out.length === 0
    ? { kind: "ok", operation: opLabel }
    : { kind: "violations", operation: opLabel, violations: out };
}

/** Valida um valor contra um JSON Schema avulso ($ref resolve dentro do próprio schema). */
export function validateSchemaValue(schemaRoot: unknown, value: unknown): Violation[] {
  const out: Violation[] = [];
  const root = (isObj(schemaRoot) ? schemaRoot : {}) as Json;
  validateNode(root, schemaRoot, value, "$", out, 0);
  return out;
}

/** Pipeline completo: spec? operação? valida. */
export function checkContract(
  spec: Json | null,
  method: string,
  url: string,
  status: number,
  contentType: string | undefined,
  body: string,
): ContractState {
  if (!spec) return { kind: "no-spec" };
  const matched = findOperation(spec, method, url);
  if (!matched) return { kind: "no-match" };
  return validateResponse(spec, matched, status, contentType, body);
}
