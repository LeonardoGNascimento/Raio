import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { buildSendSpec, resolveBase, withBase } from "./lib/spec";
import {
  envDotClass,
  folderChain,
  newRequest,
  type Environment,
  type HistoryEntry,
  type HttpResponseData,
  type RequestDef,
  type Snapshot,
  type TraceData,
  type WorkspaceData,
} from "./types";
import { prettyBody } from "./lib/format";
import type { ContractState } from "./lib/openapi";
import { contractForHistory, evaluateContract } from "./lib/contract";
import { runChecks, type CheckResult } from "./lib/checks";
import { getByPath } from "./lib/jsonpath";
import type { ExportInput } from "./lib/exporters";
import { Sidebar } from "./components/Sidebar";
import { RequestEditor } from "./components/RequestEditor";
import { ResponseViewer } from "./components/ResponseViewer";
import { DiffView, type DiffResult } from "./components/DiffView";
import { Dropdown } from "./components/Dropdown";
import { EnvModal } from "./components/EnvModal";
import { CurlModal } from "./components/CurlModal";
import { OpenApiModal } from "./components/OpenApiModal";
import { ExportModal } from "./components/ExportModal";
import { ConfigModal, type ConfigTarget } from "./components/ConfigModal";
import { DashboardView } from "./components/DashboardView";
import { NewRequestModal } from "./components/NewRequestModal";
import { ThemeModal } from "./components/ThemeModal";
import { ImportModal } from "./components/ImportModal";
import { CookiesModal } from "./components/CookiesModal";
import { CommandPalette } from "./components/CommandPalette";
import { runRoute } from "./lib/runner";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { ImportedCollection } from "./lib/importers";
import { applyTheme, loadSavedTheme, type Theme } from "./lib/theme";
import { Symbol } from "./components/Logo";
import "./App.css";

type SpecJson = Record<string, unknown>;
type ModalKind = "env" | "curl" | "openapi" | "export" | "theme" | "import" | "cookies" | null;

interface ActiveReq {
  collection: string;
  folder: string | null;
  request: RequestDef;
  savedName: string;
  dirty: boolean;
}

export default function App() {
  const [ws, setWs] = useState<WorkspaceData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveReq | null>(null);
  const [envName, setEnvName] = useState<string>("");
  const [response, setResponse] = useState<HttpResponseData | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffRunning, setDiffRunning] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [specs, setSpecs] = useState<Record<string, SpecJson | null>>({});
  const [modal, setModal] = useState<ModalKind>(null);
  const [configTarget, setConfigTarget] = useState<ConfigTarget | null>(null);
  const [trace, setTrace] = useState<TraceData | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [errDots, setErrDots] = useState<Record<string, boolean>>({});
  const [tracePort, setTracePort] = useState(7741);
  const [restoredFrom, setRestoredFrom] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<string | null>(null);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // vigia por rota: cada request com watch configurado roda no próprio intervalo/ambiente
  const [watchCount, setWatchCount] = useState(0);
  const [watchStatus, setWatchStatus] = useState<string>("");
  const wsRef = useRef<WorkspaceData | null>(null);
  const watchTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const watchLast = useRef<Map<string, string>>(new Map());
  const prevWatchIds = useRef<Set<string>>(new Set());

  const notify = async (title: string, body: string) => {
    try {
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === "granted";
      if (ok) sendNotification({ title, body });
    } catch {
      /* sem suporte a notificação */
    }
  };

  const watchRouteTick = async (reqId: string) => {
    const data = wsRef.current;
    if (!data) return;
    let found: { coll: (typeof data.collections)[number]; folder: string | null; req: RequestDef } | null = null;
    for (const c of data.collections) {
      const root = c.requests.find((r) => r.id === reqId);
      if (root) { found = { coll: c, folder: null, req: root }; break; }
      for (const f of c.folders) {
        const r = f.requests.find((r) => r.id === reqId);
        if (r) { found = { coll: c, folder: f.name, req: r }; break; }
      }
      if (found) break;
    }
    if (!found?.req.watch) return;
    const { coll, folder, req } = found;
    const watchCfg = found.req.watch;
    const rawSpec = await api.loadOpenapi(coll.name).catch(() => null);
    const spec = rawSpec ? (JSON.parse(rawSpec) as Record<string, unknown>) : null;
    const result = await runRoute(coll, folder, req, spec, watchCfg.env);
    const route = `${req.method} ${req.name}`;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    setWatchStatus(`${hhmm} · ${route} · ${result.ok ? "ok" : result.problems.join(", ")}`);
    const summary = result.problems.join("\n");
    const prev = watchLast.current.get(reqId) ?? "";
    if (summary !== prev) {
      watchLast.current.set(reqId, summary);
      if (summary) notify(`raio · ${route} (${coll.name} · ${watchCfg.env})`, summary);
      else if (prev) notify(`raio · ${route} normalizou`, `${coll.name} · ${watchCfg.env}`);
    }
  };

  // reconcilia timers com as rotas vigiadas do workspace
  useEffect(() => {
    wsRef.current = ws;
    const wanted = new Map<string, number>(); // id -> minutos
    ws?.collections.forEach((c) => {
      const scan = (reqs: RequestDef[]) =>
        reqs.forEach((r) => {
          if (r.watch && r.watch.minutes > 0) wanted.set(r.id, r.watch.minutes);
        });
      scan(c.requests);
      c.folders.forEach((f) => scan(f.requests));
    });
    for (const t of watchTimers.current.values()) clearInterval(t);
    watchTimers.current.clear();
    for (const [id, minutes] of wanted) {
      if (!prevWatchIds.current.has(id)) void watchRouteTick(id); // primeira vez roda já
      watchTimers.current.set(
        id,
        setInterval(() => void watchRouteTick(id), minutes * 60_000),
      );
    }
    prevWatchIds.current = new Set(wanted.keys());
    setWatchCount(wanted.size);
    if (wanted.size === 0) setWatchStatus("");
    return () => {
      for (const t of watchTimers.current.values()) clearInterval(t);
      watchTimers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  const [theme, setTheme] = useState<Theme>(() => loadSavedTheme());

  useEffect(() => {
    api.tracePort().then(setTracePort).catch(() => {});
    applyTheme(loadSavedTheme());
  }, []);

  const reload = useCallback(async () => {
    try {
      const data = await api.getWorkspace();
      setWs(data);
      return data;
    } catch (e) {
      setLoadError(String(e));
      return null;
    }
  }, []);

  const restoredSession = useRef(false);

  useEffect(() => {
    reload().then((data) => {
      // reabre a última request da sessão anterior
      if (!data || restoredSession.current) return;
      restoredSession.current = true;
      try {
        const saved = JSON.parse(localStorage.getItem("raio.lastReq") ?? "null") as {
          collection: string;
          folder: string | null;
          id: string;
        } | null;
        if (!saved) return;
        const coll = data.collections.find((c) => c.name === saved.collection);
        if (!coll) return;
        const pool = saved.folder
          ? coll.folders.find((f) => f.name === saved.folder)?.requests
          : coll.requests;
        const req = pool?.find((r) => r.id === saved.id);
        if (req) focusRequest(saved.collection, saved.folder, req);
      } catch {
        /* localStorage corrompido: ignora */
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  /** collection em contexto (request ativa ou dashboard) */
  const curColl = active?.collection ?? dashboard ?? null;
  const envsOf = (collection: string | null): Environment[] =>
    collection
      ? (ws?.collections.find((c) => c.name === collection)?.environments ?? [])
      : [];

  const pickEnv = (name: string) => {
    setEnvName(name);
    if (curColl) localStorage.setItem("raio.lastEnv." + curColl, name);
  };
  /** ao trocar de collection, restaura o ambiente dela */
  useEffect(() => {
    if (!curColl) return;
    const envs = envsOf(curColl);
    if (envs.some((e) => e.name === envName)) return;
    const saved = localStorage.getItem("raio.lastEnv." + curColl);
    setEnvName(saved && envs.some((e) => e.name === saved) ? saved : (envs[0]?.name ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curColl, ws]);

  // variáveis extraídas de responses nesta sessão (chain) — nunca vão para o disco
  const [sessionVars, setSessionVars] = useState<Record<string, string>>({});
  const curEnvs = envsOf(curColl);
  const baseEnv: Environment | null = curEnvs.find((e) => e.name === envName) ?? null;
  const env: Environment | null = useMemo(() => {
    const overlay = Object.entries(sessionVars);
    if (overlay.length === 0) return baseEnv;
    return {
      name: baseEnv?.name ?? "(sessão)",
      vars: [...(baseEnv?.vars ?? []), ...overlay] as [string, string][],
    };
  }, [baseEnv, sessionVars]);

  /** ambiente + variável {{@base}} resolvida para a collection/pasta (por ambiente). */
  const envFor = (
    collection: string,
    folder: string | null,
    overrideEnv?: Environment | null,
  ): Environment | null => {
    const e = overrideEnv === undefined ? env : overrideEnv;
    const coll = ws?.collections.find((c) => c.name === collection) ?? null;
    const chain = coll ? folderChain(coll, folder) : [];
    return withBase(e, resolveBase(coll, chain, e?.name ?? envName));
  };

  const ensureSpec = useCallback(
    async (collection: string) => {
      if (collection in specs) return;
      try {
        const raw = await api.loadOpenapi(collection);
        setSpecs((s) => ({ ...s, [collection]: raw ? JSON.parse(raw) : null }));
      } catch {
        setSpecs((s) => ({ ...s, [collection]: null }));
      }
    },
    [specs],
  );

  const focusRequest = (collection: string, folder: string | null, request: RequestDef) => {
    if (
      active?.dirty &&
      active.request.id !== request.id &&
      !confirm(`"${active.request.name}" tem edições não salvas. Descartar e trocar de request?`)
    )
      return;
    localStorage.setItem(
      "raio.lastReq",
      JSON.stringify({ collection, folder, id: request.id }),
    );
    setRestoredFrom(null);
    setDashboard(null);
    setActive({ collection, folder, request: structuredClone(request), savedName: request.name, dirty: false });
    setResponse(null);
    setSendError(null);
    setDiff(null);
    setSnapshot(null);
    setTrace(null);
    setChecks([]);
    setHistory([]);
    focusedReqId.current = request.id;
    api.loadSnapshot(collection, folder, request.name).then(setSnapshot).catch(() => {});
    api
      .loadHistory(collection, folder, request.name)
      .then((h) => {
        if (focusedReqId.current !== request.id) return; // usuário já trocou de request
        setHistory(h);
        const last = h[h.length - 1];
        if (last) {
          setErrDots((m) => ({ ...m, [request.id]: last.trace_error }));
          // abre já mostrando a última response executada
          restoreHistory(last, request.checks ?? "");
        }
      })
      .catch(() => {});
    ensureSpec(collection);
  };
  const focusedReqId = useRef<string | null>(null);

  // ---------- envio ----------
  const buildSpec = buildSendSpec;

  /** Busca o trace com pequenas re-tentativas (a lib posta os eventos em paralelo). */
  const fetchTraceFinal = async (traceId: string): Promise<TraceData | null> => {
    for (const delay of [150, 400, 700]) {
      await new Promise((r) => setTimeout(r, delay));
      const t = await api.getTrace(traceId).catch(() => null);
      if (t?.done) return t;
      if (t && delay === 700) return t;
    }
    return api.getTrace(traceId).catch(() => null);
  };

  const send = async () => {
    if (!active) return;
    const { collection, folder, request } = active;
    const traceId = crypto.randomUUID();
    setSending(true);
    setSendError(null);
    setDiff(null);
    setTrace(null);
    setChecks([]);
    setRestoredFrom(null);

    // live: enquanto envia, mostra eventos que a lib já postou
    const poll = setInterval(async () => {
      const t = await api.getTrace(traceId).catch(() => null);
      if (t) setTrace(t);
    }, 250);

    const effEnv = envFor(collection, folder);
    const spec = buildSpec(request, effEnv);
    spec.headers = [...spec.headers, ["x-raio-trace", traceId]];
    cancelIdRef.current = traceId;

    let resp: HttpResponseData | null = null;
    try {
      resp = await api.sendRequest(spec, traceId);
      setResponse(resp);
    } catch (e) {
      setResponse(null);
      setSendError(String(e));
    } finally {
      setSending(false);
    }

    const finalTrace = await fetchTraceFinal(traceId);
    clearInterval(poll);
    setTrace(finalTrace);
    const traceError = !!finalTrace?.events.some((ev) => ev.kind === "error");
    setErrDots((m) => ({ ...m, [request.id]: traceError }));

    if (resp) {
      // chain: extrai variáveis da response para a sessão
      if (request.extract?.length && !resp.is_binary) {
        try {
          const parsed = JSON.parse(resp.body);
          const extracted: Record<string, string> = {};
          for (const [varName, path] of request.extract) {
            if (!varName.trim()) continue;
            const v = getByPath(parsed, path);
            if (v !== undefined && v !== null)
              extracted[varName.trim()] = typeof v === "string" ? v : JSON.stringify(v);
          }
          if (Object.keys(extracted).length)
            setSessionVars((s) => ({ ...s, ...extracted }));
        } catch {
          /* body não-JSON: extração ignorada */
        }
      }

      const checkResults = runChecks(request.checks ?? "", resp);
      setChecks(checkResults);

      const contentType = resp.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1];
      const collSpec = specs[collection] ?? null;
      const cState = evaluateContract(request, collSpec, effEnv, resp.status, contentType, resp.body);
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        env: envName,
        status: resp.status,
        status_text: resp.status_text,
        ttfb_ms: resp.ttfb_ms,
        total_ms: resp.total_ms,
        size_bytes: resp.size_bytes,
        http_version: resp.http_version,
        body: resp.body,
        headers: resp.headers,
        trace_error: traceError,
        method: request.method,
        url: spec.url,
        request_body: spec.body ?? "",
        contract: contractForHistory(request, collSpec, cState),
        max_ms: request.max_ms ?? null,
        checks_total: checkResults.length,
        checks_failed: checkResults.filter((c) => !c.ok).length,
      };
      try {
        setHistory(await api.appendHistory(collection, folder, request.name, entry));
      } catch {
        /* histórico é best-effort */
      }
    }
  };

  const cancelIdRef = useRef<string | null>(null);
  const cancelSend = () => {
    if (cancelIdRef.current) void api.cancelRequest(cancelIdRef.current);
  };

  const duplicateRequest = async (
    collection: string,
    folder: string | null,
    request: RequestDef,
  ) => {
    const coll = ws?.collections.find((c) => c.name === collection);
    const pool =
      (folder && coll ? folderChain(coll, folder).slice(-1)[0]?.requests : coll?.requests) ?? [];
    const names = new Set(pool.map((r) => r.name));
    let name = `${request.name} copy`;
    for (let i = 2; names.has(name); i++) name = `${request.name} copy ${i}`;
    const dup: RequestDef = { ...structuredClone(request), id: crypto.randomUUID(), name };
    await api.saveRequest(collection, folder, dup);
    await reload();
    focusRequest(collection, folder, dup);
  };

  const moveRequest = async (
    from: { collection: string; folder: string | null; name: string; id: string },
    to: { collection: string; folder: string | null },
  ) => {
    if (from.collection === to.collection && (from.folder ?? null) === (to.folder ?? null)) return;
    try {
      await api.moveRequest(from.collection, from.folder, from.name, to.collection, to.folder);
    } catch (e) {
      alert(String(e));
      return;
    }
    if (active?.request.id === from.id)
      setActive({ ...active, collection: to.collection, folder: to.folder });
    reload();
  };

  // atalhos: Ctrl+S salva, Ctrl+Enter envia (sempre com a request ativa)
  const actionsRef = useRef({ send: () => {}, save: () => {} });
  actionsRef.current = { send: () => void send(), save: () => void saveActive() };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      // dentro de modal os atalhos globais não valem
      if ((e.target as HTMLElement | null)?.closest?.(".modal-backdrop")) return;
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        actionsRef.current.save();
      } else if (e.key === "Enter") {
        e.preventDefault();
        actionsRef.current.send();
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const restoreHistory = (entry: HistoryEntry, checksSource?: string) => {
    const restored: HttpResponseData = {
      status: entry.status,
      status_text: entry.status_text,
      headers: entry.headers,
      request_headers: [],
      is_binary: false,
      body: entry.body,
      body_truncated: false,
      ttfb_ms: entry.ttfb_ms,
      total_ms: entry.total_ms,
      size_bytes: entry.size_bytes,
      http_version: entry.http_version,
    };
    setChecks(runChecks(checksSource ?? active?.request.checks ?? "", restored));
    setResponse(restored);
    setTrace(null);
    setSendError(null);
    const d = new Date(entry.at);
    setRestoredFrom(
      `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    );
  };

  const runDiff = async (leftEnv: string, rightEnv: string) => {
    if (!active || !ws) return;
    const find = (n: string) => envsOf(active.collection).find((e) => e.name === n) ?? null;
    setDiff({ leftEnv, rightEnv, left: null, right: null });
    setDiffRunning(true);
    const leftId = crypto.randomUUID();
    const rightId = crypto.randomUUID();
    const shoot = (e: Environment | null, traceId: string) => {
      const spec = buildSpec(active.request, e);
      spec.headers = [...spec.headers, ["x-raio-trace", traceId]];
      return api
        .sendRequest(spec)
        .then((r): HttpResponseData | { error: string } => r)
        .catch((err) => ({ error: String(err) }));
    };
    const [left, right] = await Promise.all([
      shoot(find(leftEnv), leftId),
      shoot(find(rightEnv), rightId),
    ]);
    setDiff({ leftEnv, rightEnv, left, right });
    setDiffRunning(false);
    // traces chegam por POST da lib; busca depois de uma folga
    await new Promise((r) => setTimeout(r, 600));
    const [leftTrace, rightTrace] = await Promise.all([
      api.getTrace(leftId).catch(() => null),
      api.getTrace(rightId).catch(() => null),
    ]);
    setDiff((d) =>
      d && d.leftEnv === leftEnv && d.rightEnv === rightEnv
        ? { ...d, leftTrace, rightTrace }
        : d,
    );
  };

  const toggleDiff = () => {
    if (diff) {
      setDiff(null);
      return;
    }
    const envs = active ? envsOf(active.collection) : [];
    if (envs.length < 2) return;
    const others = envs.filter((e) => e.name !== envName);
    runDiff(others[0]?.name ?? envs[0].name, envName || envs[1].name);
  };

  // ---------- CRUD ----------
  const saveActive = async () => {
    if (!active) return;
    await api.saveRequest(active.collection, active.folder, active.request, active.savedName);
    setActive({ ...active, savedName: active.request.name, dirty: false });
    reload();
  };

  const [newReqIn, setNewReqIn] = useState<{ collection: string; folder: string | null } | null>(
    null,
  );
  const createRequest = (collection: string, folder: string | null) =>
    setNewReqIn({ collection, folder });

  /** existe alguma base (padrão ou por ambiente) configurada? */
  const hasAnyBase = (collection: string, folder: string | null): boolean => {
    const coll = ws?.collections.find((c) => c.name === collection);
    if (!coll) return false;
    const nodes = [coll, ...folderChain(coll, folder)];
    return nodes.some((n) => !!n.base_url || (n.base_urls?.length ?? 0) > 0);
  };

  /** base resolvida para o ambiente atual (preview) */
  const baseUrlOf = (collection: string, folder: string | null): string => {
    const coll = ws?.collections.find((c) => c.name === collection) ?? null;
    return resolveBase(coll, coll ? folderChain(coll, folder) : [], envName);
  };

  const confirmNewRequest = async (name: string) => {
    if (!newReqIn) return;
    const { collection, folder } = newReqIn;
    const req = newRequest(name, hasAnyBase(collection, folder) ? "{{@base}}" + name : "");
    try {
      await api.saveRequest(collection, folder, req);
    } catch (e) {
      alert(String(e));
      return;
    }
    setNewReqIn(null);
    await reload();
    focusRequest(collection, folder, req);
  };

  const [newFolderIn, setNewFolderIn] = useState<{ collection: string; parent: string | null } | null>(null);
  const createFolder = (collection: string, parent: string | null = null) =>
    setNewFolderIn({ collection, parent });
  const [newCollOpen, setNewCollOpen] = useState(false);

  const createCollectionFull = async (name: string, baseUrls: [string, string][]) => {
    try {
      await api.createCollection(name);
    } catch (e) {
      alert(String(e));
      return;
    }
    try {
      if (baseUrls.length) await api.saveConfig(name, null, name, "", baseUrls);
      const envNames = [...new Set(baseUrls.map(([e]) => e.trim()).filter(Boolean))];
      if (envNames.length)
        await api.saveEnvironments(
          name,
          envNames.map((n) => ({ name: n, vars: [] as [string, string][] })),
        );
    } catch (e) {
      alert(String(e));
    }
    setNewCollOpen(false);
    reload();
  };

  /** cria automaticamente ambientes citados em bases por ambiente que ainda não existem */
  const ensureEnvironments = async (collection: string, names: string[]) => {
    const envs = envsOf(collection);
    const missing = [...new Set(names.map((n) => n.trim()).filter(Boolean))].filter(
      (n) => !envs.some((e) => e.name === n),
    );
    if (missing.length === 0) return;
    await api
      .saveEnvironments(collection, [
        ...envs,
        ...missing.map((name) => ({ name, vars: [] as [string, string][] })),
      ])
      .catch(() => {});
  };

  // ---------- renomear ----------
  const renameRequest = async (
    collection: string,
    folder: string | null,
    request: RequestDef,
    newName: string,
  ) => {
    try {
      await api.saveRequest(collection, folder, { ...request, name: newName }, request.name);
    } catch (e) {
      alert(String(e));
      return;
    }
    if (active?.request.id === request.id)
      setActive({
        ...active,
        request: { ...active.request, name: newName },
        savedName: newName,
      });
    reload();
  };

  const renameFolder = async (collection: string, folder: string, newName: string) => {
    const coll = ws?.collections.find((c) => c.name === collection);
    const leaf = coll ? folderChain(coll, folder).slice(-1)[0] : undefined;
    try {
      await api.saveConfig(collection, folder, newName, leaf?.base_url ?? "", leaf?.base_urls ?? []);
    } catch (e) {
      alert(String(e));
      return;
    }
    const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/") + 1) : "";
    const newPath = parent + newName;
    if (active && active.collection === collection && active.folder) {
      if (active.folder === folder) setActive({ ...active, folder: newPath });
      else if (active.folder.startsWith(folder + "/"))
        setActive({ ...active, folder: newPath + active.folder.slice(folder.length) });
    }
    reload();
  };

  const renameCollection = async (name: string, newName: string) => {
    const coll = ws?.collections.find((c) => c.name === name);
    try {
      await api.saveConfig(name, null, newName, coll?.base_url ?? "", coll?.base_urls ?? []);
    } catch (e) {
      alert(String(e));
      return;
    }
    if (active?.collection === name) setActive({ ...active, collection: newName });
    setSpecs((s) => {
      const { [name]: moved, ...rest } = s;
      return name in s ? { ...rest, [newName]: moved } : s;
    });
    reload();
  };

  const importCurl = async (req: RequestDef) => {
    const collection = active?.collection ?? ws?.collections[0]?.name ?? "imports";
    if (!ws?.collections.some((c) => c.name === collection)) {
      await api.createCollection(collection).catch(() => {});
    }
    await api.saveRequest(collection, null, req);
    await reload();
    focusRequest(collection, null, req);
    setModal(null);
  };

  const importCollection = async (coll: ImportedCollection, name: string) => {
    try {
      await api.createCollection(name);
    } catch (e) {
      alert(String(e));
      return;
    }
    try {
      for (const req of coll.requests) await api.saveRequest(name, null, req);
      for (const folder of coll.folders) {
        await api.createFolder(name, folder.name).catch(() => {});
        for (const req of folder.requests) await api.saveRequest(name, folder.name, req);
      }
      if (coll.openapi) {
        await api.saveOpenapi(name, coll.openapi);
        setSpecs((s) => ({ ...s, [name]: JSON.parse(coll.openapi!) }));
      }
    } catch (e) {
      alert("Import parcial: " + String(e));
    }
    setModal(null);
    const data = await reload();
    const created = data?.collections.find((c) => c.name === name);
    const first = created?.requests[0] ?? created?.folders[0]?.requests[0];
    if (first)
      focusRequest(name, created?.requests[0] ? null : (created?.folders[0]?.name ?? null), first);
  };

  const seedDemo = async () => {
    try {
      await api.createCollection("exemplo").catch(() => {});
      const seed = [
        { ...newRequest("/todos/1", "https://{{base}}/todos/1") },
        { ...newRequest("/users", "https://{{base}}/users") },
      ];
      const post = newRequest("/posts", "https://{{base}}/posts");
      post.method = "POST";
      post.body_type = "json";
      post.body = JSON.stringify({ title: "raio", body: "primeiro post", userId: 1 }, null, 2);
      post.headers = [["Content-Type", "application/json"]];
      for (const r of [...seed, post]) await api.saveRequest("exemplo", null, r);
      await api.saveEnvironments("exemplo", [
        { name: "dev", vars: [["base", "jsonplaceholder.typicode.com"]] },
        { name: "prod", vars: [["base", "jsonplaceholder.typicode.com"]] },
      ]);
      const data = await reload();
      const coll = data?.collections.find((c) => c.name === "exemplo");
      if (coll?.requests[0]) focusRequest("exemplo", null, coll.requests[0]);
    } catch (e) {
      alert(String(e));
    }
  };

  // ---------- contrato / snapshot ----------
  const activeSpec: SpecJson | null = active ? (specs[active.collection] ?? null) : null;

  const contract: ContractState = useMemo(() => {
    if (!active || !response) return { kind: "no-spec" };
    const contentType = response.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1];
    return evaluateContract(
      active.request,
      activeSpec,
      envFor(active.collection, active.folder),
      response.status,
      contentType,
      response.body,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, response, activeSpec, env, ws]);

  const saveSnapshot = async () => {
    if (!active || !response) return;
    const snap: Snapshot = {
      saved_at: new Date().toISOString(),
      env: envName,
      status: response.status,
      body: prettyBody(response.body),
    };
    await api.saveSnapshot(active.collection, active.folder, active.request.name, snap);
    setSnapshot(snap);
  };

  const deleteSnapshot = async () => {
    if (!active) return;
    await api.deleteSnapshot(active.collection, active.folder, active.request.name);
    setSnapshot(null);
  };

  const exportInput: ExportInput | null = active
    ? (() => {
        const s = buildSendSpec(active.request, envFor(active.collection, active.folder));
        // urlencoded vira body inline no export (curl -d a=1&b=2)
        const body =
          s.body_kind === "urlencoded"
            ? (s.form ?? [])
                .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v))
                .join("&") || null
            : s.body;
        return { method: s.method, url: s.url, headers: s.headers, body };
      })()
    : null;

  const configCurrent = useMemo(() => {
    if (!configTarget || !ws) return null;
    const coll = ws.collections.find((c) => c.name === configTarget.collection);
    if (!coll) return null;
    if (configTarget.folder === null)
      return { name: coll.name, base: coll.base_url, baseUrls: coll.base_urls };
    const leaf = folderChain(coll, configTarget.folder).slice(-1)[0];
    return leaf ? { name: leaf.name, base: leaf.base_url, baseUrls: leaf.base_urls } : null;
  }, [configTarget, ws]);

  // ---------- render ----------
  if (loadError) return <div className="app-error">Erro ao carregar workspace: {loadError}</div>;
  if (!ws) return <div className="app-error c-dim">carregando…</div>;

  const isEmpty = ws.collections.length === 0;

  if (isEmpty) {
    return (
      <div className="app">
        <div className="empty">
          <span className="logo-big">
            <Symbol size={72} />
            <span className="wordmark" style={{ fontSize: 56 }}>raio</span>
          </span>
          <h1>
            Um client HTTP que <span className="c-accent">confere o contrato</span> — não só dispara
            a request.
          </h1>
          <div className="sub">
            Cada request é um arquivo <strong style={{ color: "var(--text)" }}>JSON</strong> em{" "}
            <span className="mono" style={{ color: "var(--text)", fontSize: "13.5px" }}>
              {ws.path.replace(/^\/home\/[^/]+/, "~")}/
            </span>
            . Versiona no git, revisa em PR. Sem conta, sem sync, roda offline.
          </div>
          <div className="cards">
            <div className="card">
              <div className="card-title c-info">≠ diff env</div>
              <div className="card-text">A mesma request em staging e prod, campo a campo.</div>
            </div>
            <div className="card offset">
              <div className="card-title" style={{ fontFamily: "var(--font-ui)" }}>snapshot</div>
              <div className="card-text">Pega breaking change sem você escrever um teste.</div>
            </div>
            <div className="card">
              <div className="card-title c-ok">✓ openapi</div>
              <div className="card-text">Valida a resposta contra o schema, sozinho.</div>
            </div>
          </div>
          <button className="cta" onClick={seedDemo}>Abrir uma collection de exemplo</button>
        </div>
      </div>
    );
  }

  const activeColl = active ? ws.collections.find((c) => c.name === active.collection) : null;
  const hasSpec = activeColl?.has_spec ?? false;

  return (
    <div className="app">
      <Sidebar
        collections={ws.collections}
        workspacePath={ws.path}
        activeRequestId={active?.request.id ?? null}
        onSelect={focusRequest}
        onNewCollection={() => setNewCollOpen(true)}
        onDeleteCollection={async (name) => {
          await api.deleteCollection(name);
          if (active?.collection === name) setActive(null);
          reload();
        }}
        onNewFolder={createFolder}
        onNewRequest={createRequest}
        onDuplicateRequest={duplicateRequest}
        onMoveRequest={moveRequest}
        onRenameRequest={renameRequest}
        onRenameFolder={renameFolder}
        onRenameCollection={renameCollection}
        onDeleteRequest={async (collection, folder, req) => {
          await api.deleteRequest(collection, folder, req.name);
          if (active?.request.id === req.id) setActive(null);
          reload();
        }}
        onConfig={(collection, folder) => setConfigTarget({ collection, folder })}
        onOpenDashboard={(collection) => {
          ensureSpec(collection);
          setDashboard(collection);
        }}
        errorIds={new Set(Object.keys(errDots).filter((id) => errDots[id]))}
      />

      <main className="main">
        <div className="topbar">
          <button className="btn-ghost" onClick={() => setModal("curl")}>
            <span className="mono c-dim">curl</span> importar
          </button>
          <button className="btn-ghost" onClick={() => setModal("import")} title="Postman / OpenAPI">
            importar collection
          </button>
          <button className="btn-ghost" onClick={() => setModal("cookies")}>
            cookies
          </button>
          {active && (
            <button className="btn-ghost" onClick={() => setModal("openapi")}>
              OpenAPI{" "}
              <span className={"mono " + (hasSpec ? "c-ok" : "c-dim")} style={{ fontWeight: 700, fontSize: 11 }}>
                {hasSpec ? "✓" : "—"}
              </span>
            </button>
          )}
          <div className="spacer" />
          {watchCount > 0 && (
            <span
              className="btn-ghost c-warn"
              style={{ cursor: "default" }}
              title={watchStatus || "aguardando primeira execução"}
            >
              ◉ vigiando {watchCount} {watchCount === 1 ? "rota" : "rotas"}
              {watchStatus && <span className="c-dim"> · {watchStatus}</span>}
            </span>
          )}
          <span className="env-label">ambiente</span>
          <Dropdown
            align="right"
            button={() => (
              <button className="env-btn">
                <span className={"dot " + envDotClass(envName)} style={{ background: "currentColor" }} />
                {envName || "(nenhum)"} <span className="c-faint">▾</span>
              </button>
            )}
          >
            {(close) => (
              <>
                {curEnvs.map((e) => (
                  <button
                    key={e.name}
                    className={"dd-item" + (e.name === envName ? " active" : "")}
                    onClick={() => {
                      close();
                      pickEnv(e.name);
                    }}
                  >
                    <span className={"dot " + envDotClass(e.name)} style={{ background: "currentColor" }} />
                    {e.name}
                  </button>
                ))}
                {curEnvs.length === 0 && (
                  <div className="dd-item c-dim" style={{ cursor: "default" }}>
                    {curColl ? "nenhum ambiente nesta collection" : "abra uma collection"}
                  </div>
                )}
              </>
            )}
          </Dropdown>
          <button className="icon-sq" title="gerenciar ambientes" onClick={() => setModal("env")}>
            ⋯
          </button>
          <button className="icon-sq" title="tema do app" onClick={() => setModal("theme")}>
            ◐
          </button>
        </div>

        {dashboard && ws.collections.some((c) => c.name === dashboard) ? (
          <DashboardView
            key={dashboard}
            collection={ws.collections.find((c) => c.name === dashboard)!}
            spec={specs[dashboard] ?? null}
            env={env}
            envName={envName}
            onOpenRequest={(folder, req) => focusRequest(dashboard, folder, req)}
            onClose={() => setDashboard(null)}
          />
        ) : active ? (
          <div className="split">
            <RequestEditor
              crumb={active.collection + (active.folder ? " / " + active.folder : "")}
              request={active.request}
              env={envFor(active.collection, active.folder)}
              envName={envName}
              sending={sending}
              dirty={active.dirty}
              diffOn={diff !== null}
              canDiff={envsOf(active.collection).length >= 2}
              onChange={(request) => setActive({ ...active, request, dirty: true })}
              onSend={send}
              onCancel={cancelSend}
              onSave={saveActive}
              onToggleDiff={toggleDiff}
              onExport={() => setModal("export")}
              hasSpec={hasSpec}
              envNames={envsOf(active.collection).map((e) => e.name)}
            />
            {diff ? (
              <DiffView
                result={diff}
                environments={envsOf(active.collection)}
                running={diffRunning}
                maxMs={active.request.max_ms ?? null}
                onRun={runDiff}
                onClose={() => setDiff(null)}
              />
            ) : (
              <ResponseViewer
                key={active.request.id}
                response={response}
                error={sendError}
                sending={sending}
                restoredFrom={restoredFrom}
                maxMs={active.request.max_ms ?? null}
                contract={contract}
                checks={checks}
                snapshot={snapshot}
                trace={trace}
                tracePort={tracePort}
                history={history}
                onRestoreHistory={restoreHistory}
                onSaveSnapshot={saveSnapshot}
                onDeleteSnapshot={deleteSnapshot}
              />
            )}
          </div>
        ) : (
          <div className="resp-center" style={{ flex: 1 }}>
            selecione uma request na sidebar — ou crie uma com o + da collection
          </div>
        )}
      </main>

      {modal === "env" && curColl && (
        <EnvModal
          collection={curColl}
          environments={curEnvs}
          onClose={() => setModal(null)}
          onSave={async (envs) => {
            await api.saveEnvironments(curColl, envs);
            setModal(null);
            reload();
          }}
        />
      )}
      {modal === "curl" && <CurlModal onImport={importCurl} onClose={() => setModal(null)} />}
      {modal === "theme" && (
        <ThemeModal current={theme} onChange={setTheme} onClose={() => setModal(null)} />
      )}
      {modal === "import" && (
        <ImportModal onImport={importCollection} onClose={() => setModal(null)} />
      )}
      {modal === "cookies" && <CookiesModal onClose={() => setModal(null)} />}
      {paletteOpen && (
        <CommandPalette
          collections={ws.collections}
          onOpen={(c, f, r) => focusRequest(c, f, r)}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {modal === "export" && exportInput && (
        <ExportModal input={exportInput} onClose={() => setModal(null)} />
      )}
      {modal === "openapi" && active && (
        <OpenApiModal
          collection={active.collection}
          hasSpec={hasSpec}
          onClose={() => setModal(null)}
          onSave={async (specJson) => {
            try {
              await api.saveOpenapi(active.collection, specJson);
              setSpecs((s) => ({ ...s, [active.collection]: JSON.parse(specJson) }));
              setModal(null);
              reload();
            } catch (e) {
              alert(String(e));
            }
          }}
          onDelete={async () => {
            await api.deleteOpenapi(active.collection);
            setSpecs((s) => ({ ...s, [active.collection]: null }));
            setModal(null);
            reload();
          }}
        />
      )}
      {newReqIn && (
        <NewRequestModal
          collection={newReqIn.collection}
          folder={newReqIn.folder}
          baseUrl={baseUrlOf(newReqIn.collection, newReqIn.folder)}
          onClose={() => setNewReqIn(null)}
          onCreate={confirmNewRequest}
        />
      )}
      {newCollOpen && (
        <ConfigModal
          target={{ collection: "", folder: null }}
          currentName=""
          currentBase=""
          create
          onClose={() => setNewCollOpen(false)}
          onSave={(name, _base, baseUrls) => createCollectionFull(name, baseUrls)}
        />
      )}
      {newFolderIn && (
        <ConfigModal
          target={{ collection: newFolderIn.collection, folder: newFolderIn.parent ?? "" }}
          currentName="nova-pasta"
          currentBase=""
          environments={envsOf(newFolderIn.collection).map((e) => e.name)}
          create
          onClose={() => setNewFolderIn(null)}
          onSave={async (name, baseUrl, baseUrls) => {
            const path = newFolderIn.parent ? newFolderIn.parent + "/" + name : name;
            try {
              await api.createFolder(newFolderIn.collection, path);
              if (baseUrl || baseUrls.length)
                await api.saveConfig(newFolderIn.collection, path, name, baseUrl, baseUrls);
              await ensureEnvironments(newFolderIn.collection, baseUrls.map(([e]) => e));
              setNewFolderIn(null);
              reload();
            } catch (e) {
              alert(String(e));
            }
          }}
        />
      )}
      {configTarget && configCurrent && (
        <ConfigModal
          target={configTarget}
          currentName={configCurrent.name}
          currentBase={configCurrent.base}
          currentBaseUrls={configCurrent.baseUrls}
          environments={envsOf(configTarget.collection).map((e) => e.name)}
          onClose={() => setConfigTarget(null)}
          onSave={async (newName, baseUrl, baseUrls) => {
            try {
              await api.saveConfig(
                configTarget.collection,
                configTarget.folder,
                newName,
                baseUrl,
                baseUrls,
              );
              await ensureEnvironments(configTarget.collection, baseUrls.map(([e]) => e));
              if (newName !== configCurrent.name && active) {
                // container renomeado: atualiza a seleção para o novo path
                if (configTarget.folder === null && active.collection === configTarget.collection)
                  setActive({ ...active, collection: newName });
                else if (
                  active.collection === configTarget.collection &&
                  active.folder === configTarget.folder
                )
                  setActive({ ...active, folder: newName });
              }
              if (configTarget.folder === null && newName !== configCurrent.name) {
                setSpecs((s) => {
                  const { [configTarget.collection]: moved, ...rest } = s;
                  return configTarget.collection in s ? { ...rest, [newName]: moved } : s;
                });
              }
              setConfigTarget(null);
              reload();
            } catch (e) {
              alert(String(e));
            }
          }}
        />
      )}
    </div>
  );
}
