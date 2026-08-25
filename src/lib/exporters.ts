export type ExportFmt = "curl" | "fetch" | "axios" | "ts" | "python";

export const EXPORT_FMTS: { id: ExportFmt; label: string; file: string }[] = [
  { id: "curl", label: "cURL", file: "request.sh" },
  { id: "fetch", label: "fetch", file: "request.js" },
  { id: "axios", label: "axios", file: "request.js" },
  { id: "ts", label: "TypeScript", file: "request.ts" },
  { id: "python", label: "Python", file: "request.py" },
];

export interface ExportInput {
  method: string;
  url: string;
  headers: [string, string][];
  body: string | null; // já interpolado; null quando body_type = none
}

function bodyParts(body: string | null): { pretty: string | null; inline: string | null } {
  if (!body || !body.trim()) return { pretty: null, inline: null };
  try {
    const parsed = JSON.parse(body);
    return { pretty: JSON.stringify(parsed, null, 2), inline: JSON.stringify(parsed) };
  } catch {
    return { pretty: null, inline: body };
  }
}

export function genExport(fmt: ExportFmt, r: ExportInput): string {
  const H = r.headers.filter(([k]) => k.trim());
  const { pretty, inline } = bodyParts(r.body);
  const m = r.method;
  const hj = (pad: string) => H.map(([k, v]) => `${pad}'${k}': '${v}'`).join(",\n");

  if (fmt === "curl") {
    let o = `curl -X ${m} '${r.url}'`;
    for (const [k, v] of H) o += ` \\\n  -H '${k}: ${v}'`;
    if (inline) o += ` \\\n  -d '${inline}'`;
    return o;
  }
  if (fmt === "fetch" || fmt === "ts") {
    const typed = fmt === "ts";
    let o = `const res${typed ? ": Response" : ""} = await fetch('${r.url}', {\n  method: '${m}'`;
    if (H.length) o += `,\n  headers: {\n${hj("    ")}\n  }`;
    if (pretty) o += `,\n  body: JSON.stringify(${pretty.replace(/\n/g, "\n  ")})`;
    else if (inline) o += `,\n  body: ${JSON.stringify(inline)}`;
    o += "\n});\n";
    if (typed) o += "if (!res.ok) throw new Error(`HTTP ${res.status}`);\n";
    o += "const data = await res.json();";
    return o;
  }
  if (fmt === "axios") {
    let o = `const { data } = await axios({\n  method: '${m.toLowerCase()}',\n  url: '${r.url}'`;
    if (H.length) o += `,\n  headers: {\n${hj("    ")}\n  }`;
    if (pretty) o += `,\n  data: ${pretty.replace(/\n/g, "\n  ")}`;
    else if (inline) o += `,\n  data: ${JSON.stringify(inline)}`;
    o += "\n});";
    return o;
  }
  if (fmt === "python") {
    let o = `import requests\n\nres = requests.request(\n  '${m}', '${r.url}'`;
    if (H.length) o += `,\n  headers={\n${H.map(([k, v]) => `    '${k}': '${v}'`).join(",\n")}\n  }`;
    if (pretty) o += `,\n  json=${pretty.replace(/\n/g, "\n  ")}`;
    else if (inline) o += `,\n  data=${JSON.stringify(inline)}`;
    o += "\n)\ndata = res.json()";
    return o;
  }
  return "";
}
