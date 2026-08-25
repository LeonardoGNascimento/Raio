import type { HistoryEntry } from "../types";
import { slaBreached } from "../types";

const MAX_BODY_CHARS = 1500;

function trunc(s: string, max = MAX_BODY_CHARS): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + `\n… (truncado, ${s.length} chars no total)` : s;
}

function fmtEntry(h: HistoryEntry): string {
  const lines: string[] = [];
  lines.push(`### ${h.at} · ambiente: ${h.env || "(nenhum)"}`);
  const sla =
    typeof h.max_ms === "number" && h.max_ms > 0
      ? slaBreached(h.total_ms, h.max_ms)
        ? ` · ACIMA DO SLA de ${h.max_ms}ms`
        : ` · dentro do SLA de ${h.max_ms}ms`
      : "";
  lines.push(
    `- status: ${h.status} ${h.status_text} · TTFB ${h.ttfb_ms}ms · total ${h.total_ms}ms · ${h.size_bytes} bytes · ${h.http_version}${sla}`,
  );
  const c = h.contract;
  if (c && c.type !== "none") {
    if (c.status === "ok") lines.push(`- contrato (${c.type}${c.operation ? " · " + c.operation : ""}): passou`);
    else if (c.status === "fail") {
      lines.push(`- contrato (${c.type}${c.operation ? " · " + c.operation : ""}): FALHOU com ${c.violations.length} violações:`);
      for (const [path, msg] of c.violations.slice(0, 20)) lines.push(`  - ${path}: ${msg}`);
    } else lines.push(`- contrato (${c.type}): não validado`);
  } else {
    lines.push("- contrato: nenhum configurado");
  }
  if (h.trace_error) lines.push("- trace: EXCEPTION INTERNA no servidor durante esta execução");
  if (h.method || h.url) lines.push(`- request: ${h.method ?? "?"} ${h.url ?? ""}`);
  if (h.request_body) lines.push("- body enviado:\n```json\n" + trunc(h.request_body, 600) + "\n```");
  lines.push("- response body:\n```json\n" + trunc(h.body) + "\n```");
  return lines.join("\n");
}

/** Prompt pronto para colar numa IA gerar relatório da rota a partir do histórico. */
export function buildReportPrompt(entries: HistoryEntry[], maxMs?: number | null): string {
  const newestFirst = [...entries].reverse();
  const latest = newestFirst[0];
  const route = latest ? `${latest.method ?? "?"} ${latest.url ?? "(url não gravada)"}` : "(sem execuções)";
  const times = entries.map((e) => e.total_ms);
  const header = [
    "Você é um engenheiro sênior de qualidade de APIs. Analise o histórico de execuções da rota abaixo e gere um relatório em português com:",
    "1. Resumo executivo (a rota está saudável? dá para confiar nela?)",
    "2. Análise de latência: tendência, outliers, comparação com o SLA quando houver",
    "3. Contrato: quando passou/falhou, o que as violações indicam, se há breaking change",
    "4. Erros internos (trace) e status HTTP fora do esperado",
    "5. Mudanças de comportamento entre execuções (campos que apareceram/sumiram/mudaram nos bodies)",
    "6. Recomendações objetivas de correção/prevenção, em ordem de prioridade",
    "",
    "## Rota",
    `- ${route}`,
    typeof maxMs === "number" && maxMs > 0 ? `- SLA de latência: ${maxMs}ms` : "- SLA de latência: não configurado",
    entries.length
      ? `- ${entries.length} execuções registradas · latência min ${Math.min(...times)}ms · max ${Math.max(...times)}ms`
      : "",
    "",
    "## Execuções (mais recente primeiro)",
  ];
  return [...header, ...newestFirst.map(fmtEntry)].join("\n") + "\n";
}
