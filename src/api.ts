import { invoke } from "@tauri-apps/api/core";
import type {
  Environment,
  HistoryEntry,
  HttpResponseData,
  RequestDef,
  Snapshot,
  TraceData,
  WorkspaceData,
} from "./types";

export interface SendSpec {
  method: string;
  url: string;
  headers: [string, string][];
  body: string | null;
  body_kind?: "raw" | "urlencoded" | "multipart";
  form?: [string, string][];
  multipart?: { name: string; kind: "text" | "file"; value: string }[];
  timeout_ms?: number;
  follow_redirects: boolean;
  insecure?: boolean;
}

export interface CookieInfo {
  domain: string;
  path: string;
  name: string;
  value: string;
}

export const api = {
  sendRequest: (spec: SendSpec, cancelId?: string) =>
    invoke<HttpResponseData>("send_request", { spec, cancelId: cancelId ?? null }),
  cancelRequest: (cancelId: string) => invoke<void>("cancel_request", { cancelId }),
  listCookies: () => invoke<CookieInfo[]>("list_cookies"),
  clearCookies: () => invoke<void>("clear_cookies"),
  saveBody: (path: string, base64Data: string) =>
    invoke<void>("save_body", { path, base64Data }),
  getWorkspace: () => invoke<WorkspaceData>("get_workspace"),
  createCollection: (name: string) => invoke<void>("create_collection", { name }),
  createFolder: (collection: string, name: string) =>
    invoke<void>("create_folder", { collection, name }),
  saveConfig: (
    collection: string,
    folder: string | null,
    newName: string,
    baseUrl: string,
    baseUrls: [string, string][] = [],
  ) => invoke<void>("save_config", { collection, folder, newName, baseUrl, baseUrls }),
  deleteCollection: (name: string) => invoke<void>("delete_collection", { name }),
  saveRequest: (
    collection: string,
    folder: string | null,
    request: RequestDef,
    oldName?: string,
  ) => invoke<void>("save_request", { collection, folder, request, oldName: oldName ?? null }),
  deleteRequest: (collection: string, folder: string | null, requestName: string) =>
    invoke<void>("delete_request", { collection, folder, requestName }),
  moveRequest: (
    collection: string,
    folder: string | null,
    requestName: string,
    toCollection: string,
    toFolder: string | null,
  ) =>
    invoke<void>("move_request", { collection, folder, requestName, toCollection, toFolder }),
  saveEnvironments: (collection: string, environments: Environment[]) =>
    invoke<void>("save_environments", { collection, environments }),
  saveSnapshot: (
    collection: string,
    folder: string | null,
    requestName: string,
    snapshot: Snapshot,
  ) => invoke<void>("save_snapshot", { collection, folder, requestName, snapshot }),
  loadSnapshot: (collection: string, folder: string | null, requestName: string) =>
    invoke<Snapshot | null>("load_snapshot", { collection, folder, requestName }),
  deleteSnapshot: (collection: string, folder: string | null, requestName: string) =>
    invoke<void>("delete_snapshot", { collection, folder, requestName }),
  getTrace: (traceId: string) => invoke<TraceData | null>("get_trace", { traceId }),
  tracePort: () => invoke<number>("trace_port"),
  loadHistory: (collection: string, folder: string | null, requestName: string) =>
    invoke<HistoryEntry[]>("load_history", { collection, folder, requestName }),
  appendHistory: (
    collection: string,
    folder: string | null,
    requestName: string,
    entry: HistoryEntry,
  ) => invoke<HistoryEntry[]>("append_history", { collection, folder, requestName, entry }),
  saveOpenapi: (collection: string, content: string) =>
    invoke<void>("save_openapi", { collection, content }),
  loadOpenapi: (collection: string) => invoke<string | null>("load_openapi", { collection }),
  deleteOpenapi: (collection: string) => invoke<void>("delete_openapi", { collection }),
};
