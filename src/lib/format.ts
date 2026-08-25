export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function prettyBody(body: string, contentType?: string): string {
  const looksJson =
    contentType?.includes("json") || /^\s*[[{]/.test(body);
  if (looksJson) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Highlight simples de JSON já formatado. Retorna HTML escapado com spans. */
export function highlightJson(pretty: string): string {
  const esc = escapeHtml(pretty);
  const colored = esc.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g,
    (match, str, colon, bool) => {
      if (str) {
        return colon
          ? `<span class="j-key">${str}</span>${colon}`
          : `<span class="j-str">${str}</span>`;
      }
      if (bool) return `<span class="j-bool">${match}</span>`;
      if (match === "null") return `<span class="j-null">${match}</span>`;
      return `<span class="j-num">${match}</span>`;
    },
  );
  // {{variáveis}} ganham destaque próprio por cima da cor da string
  return colored.replace(
    /\{\{\s*[$@]?[\w.-]+\s*\}\}/g,
    (m) => `<span class="v-ok">${m}</span>`,
  );
}

export function stringifyShort(v: unknown, max = 120): string {
  const s = v === undefined ? "undefined" : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}
