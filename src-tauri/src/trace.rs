use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::sync::{Arc, Mutex};

/// Porta local onde o raio recebe eventos de trace da lib @raio/trace.
pub const TRACE_PORT: u16 = 7741;
const MAX_TRACES: usize = 100;
const MAX_EVENTS_PER_TRACE: usize = 500;
const MAX_BODY_BYTES: usize = 1024 * 1024; // 1MB por POST

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TraceEvent {
    /// offset em ms desde o início da request
    pub t: u64,
    /// route | check | cache | query | error | response | ...
    pub kind: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dur: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct TraceData {
    pub events: Vec<TraceEvent>,
    pub source: Option<String>,
    pub runtime: Option<String>,
    /// lib marcou fim da request
    pub done: bool,
}

#[derive(Debug, Deserialize)]
struct TracePost {
    trace_id: String,
    #[serde(default)]
    events: Vec<TraceEvent>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    runtime: Option<String>,
    #[serde(default)]
    done: bool,
}

#[derive(Default)]
pub struct TraceStore {
    traces: HashMap<String, TraceData>,
    order: VecDeque<String>,
}

pub type SharedTraceStore = Arc<Mutex<TraceStore>>;

impl TraceStore {
    fn ingest(&mut self, post: TracePost) {
        if !self.traces.contains_key(&post.trace_id) {
            self.order.push_back(post.trace_id.clone());
            while self.order.len() > MAX_TRACES {
                if let Some(old) = self.order.pop_front() {
                    self.traces.remove(&old);
                }
            }
        }
        let entry = self.traces.entry(post.trace_id).or_default();
        if post.source.is_some() {
            entry.source = post.source;
        }
        if post.runtime.is_some() {
            entry.runtime = post.runtime;
        }
        let room = MAX_EVENTS_PER_TRACE.saturating_sub(entry.events.len());
        entry.events.extend(post.events.into_iter().take(room));
        entry.events.sort_by_key(|e| e.t);
        entry.done = entry.done || post.done;
    }
}

/// Sobe o listener local em thread própria. Falha de bind não é fatal (porta ocupada).
pub fn start_server(store: SharedTraceStore) {
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http(("127.0.0.1", TRACE_PORT)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("raio: trace server não subiu na porta {TRACE_PORT}: {e}");
                return;
            }
        };
        for mut request in server.incoming_requests() {
            let ok = request.method() == &tiny_http::Method::Post
                && request.url().trim_end_matches('/') == "/trace";
            if !ok {
                let _ = request.respond(tiny_http::Response::empty(404));
                continue;
            }
            let mut body = String::new();
            let read_ok = request
                .as_reader()
                .take(MAX_BODY_BYTES as u64)
                .read_to_string(&mut body)
                .is_ok();
            let parsed: Option<TracePost> =
                if read_ok { serde_json::from_str(&body).ok() } else { None };
            let status = match parsed {
                Some(post) => {
                    if let Ok(mut store) = store.lock() {
                        store.ingest(post);
                    }
                    204
                }
                None => 400,
            };
            let _ = request.respond(tiny_http::Response::empty(status));
        }
    });
}

#[tauri::command]
pub fn get_trace(
    store: tauri::State<'_, SharedTraceStore>,
    trace_id: String,
) -> Result<Option<TraceData>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(store.traces.get(&trace_id).cloned())
}

#[tauri::command]
pub fn trace_port() -> u16 {
    TRACE_PORT
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(t: u64, kind: &str) -> TraceEvent {
        TraceEvent {
            t,
            kind: kind.into(),
            label: format!("{kind}@{t}"),
            dur: None,
            data: None,
            at: None,
            stack: None,
        }
    }

    #[test]
    fn ingest_appends_sorts_and_marks_done() {
        let mut store = TraceStore::default();
        store.ingest(TracePost {
            trace_id: "a".into(),
            events: vec![ev(10, "check")],
            source: Some("app local".into()),
            runtime: None,
            done: false,
        });
        store.ingest(TracePost {
            trace_id: "a".into(),
            events: vec![ev(0, "route"), ev(20, "response")],
            source: None,
            runtime: Some("node 20".into()),
            done: true,
        });
        let t = store.traces.get("a").unwrap();
        assert!(t.done);
        assert_eq!(t.source.as_deref(), Some("app local"));
        assert_eq!(t.runtime.as_deref(), Some("node 20"));
        let offsets: Vec<u64> = t.events.iter().map(|e| e.t).collect();
        assert_eq!(offsets, vec![0, 10, 20]);
    }

    #[test]
    fn ingest_evicts_oldest_over_cap() {
        let mut store = TraceStore::default();
        for i in 0..(MAX_TRACES + 5) {
            store.ingest(TracePost {
                trace_id: format!("t{i}"),
                events: vec![ev(0, "route")],
                source: None,
                runtime: None,
                done: true,
            });
        }
        assert_eq!(store.traces.len(), MAX_TRACES);
        assert!(!store.traces.contains_key("t0"));
        assert!(store.traces.contains_key(&format!("t{}", MAX_TRACES + 4)));
    }

    #[test]
    fn ingest_caps_events_per_trace() {
        let mut store = TraceStore::default();
        let events: Vec<TraceEvent> = (0..(MAX_EVENTS_PER_TRACE as u64 + 50)).map(|i| ev(i, "check")).collect();
        store.ingest(TracePost { trace_id: "big".into(), events, source: None, runtime: None, done: true });
        assert_eq!(store.traces.get("big").unwrap().events.len(), MAX_EVENTS_PER_TRACE);
    }
}
