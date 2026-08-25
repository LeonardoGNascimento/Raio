use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::oneshot;

/// Envios em andamento canceláveis: cancel_id -> sinal de abort.
#[derive(Default)]
pub struct CancelMap(pub Mutex<HashMap<String, oneshot::Sender<()>>>);

/// Cookie jar compartilhado entre envios (sessão do app).
pub struct SharedJar(pub Arc<reqwest_cookie_store::CookieStoreMutex>);

impl Default for SharedJar {
    fn default() -> Self {
        SharedJar(Arc::new(reqwest_cookie_store::CookieStoreMutex::default()))
    }
}

#[derive(Debug, Deserialize)]
pub struct MultipartField {
    pub name: String,
    /// "text" | "file" (value = caminho do arquivo)
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct HttpRequestSpec {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
    /// "raw" (default) | "urlencoded" | "multipart"
    #[serde(default)]
    pub body_kind: Option<String>,
    #[serde(default)]
    pub form: Vec<(String, String)>,
    #[serde(default)]
    pub multipart: Vec<MultipartField>,
    /// Timeout em milissegundos (default 30s)
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub follow_redirects: bool,
    /// aceita certificado TLS inválido (só para dev)
    #[serde(default)]
    pub insecure: bool,
}

#[derive(Debug, Serialize)]
pub struct HttpResponseData {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    /// headers efetivamente enviados na request (já interpolados)
    pub request_headers: Vec<(String, String)>,
    pub body: String,
    pub body_truncated: bool,
    /// body não é texto UTF-8 (imagem, pdf, binário)
    pub is_binary: bool,
    /// base64 do body quando binário (até o cap)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_base64: Option<String>,
    /// Tempo até receber os headers (ms)
    pub ttfb_ms: u64,
    /// Tempo total incluindo download do body (ms)
    pub total_ms: u64,
    pub size_bytes: u64,
    pub http_version: String,
}

const MAX_BODY_BYTES: usize = 10 * 1024 * 1024; // 10MB exibidos no viewer

#[tauri::command]
pub async fn send_request(
    state: tauri::State<'_, CancelMap>,
    jar: tauri::State<'_, SharedJar>,
    spec: HttpRequestSpec,
    cancel_id: Option<String>,
) -> Result<HttpResponseData, String> {
    let (tx, rx) = oneshot::channel::<()>();
    if let Some(id) = &cancel_id {
        if let Ok(mut map) = state.0.lock() {
            map.insert(id.clone(), tx);
        }
    }
    let jar = jar.0.clone();
    let result = if cancel_id.is_some() {
        tokio::select! {
            r = do_send(spec, jar) => r,
            _ = rx => Err("Cancelado pelo usuário".into()),
        }
    } else {
        do_send(spec, jar).await
    };
    if let Some(id) = &cancel_id {
        if let Ok(mut map) = state.0.lock() {
            map.remove(id);
        }
    }
    result
}

#[tauri::command]
pub fn cancel_request(state: tauri::State<'_, CancelMap>, cancel_id: String) -> Result<(), String> {
    if let Some(tx) = state.0.lock().map_err(|e| e.to_string())?.remove(&cancel_id) {
        let _ = tx.send(());
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct CookieInfo {
    pub domain: String,
    pub path: String,
    pub name: String,
    pub value: String,
}

#[tauri::command]
pub fn list_cookies(jar: tauri::State<'_, SharedJar>) -> Result<Vec<CookieInfo>, String> {
    let store = jar.0.lock().map_err(|e| e.to_string())?;
    Ok(store
        .iter_any()
        .map(|c| CookieInfo {
            domain: c.domain().unwrap_or("").to_string(),
            path: c.path().unwrap_or("/").to_string(),
            name: c.name().to_string(),
            value: c.value().to_string(),
        })
        .collect())
}

#[tauri::command]
pub fn clear_cookies(jar: tauri::State<'_, SharedJar>) -> Result<(), String> {
    let mut store = jar.0.lock().map_err(|e| e.to_string())?;
    store.clear();
    Ok(())
}

/// Salva o body binário (base64) num arquivo escolhido pelo usuário.
#[tauri::command]
pub fn save_body(path: String, base64_data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

fn is_texty(content_type: &str) -> bool {
    let ct = content_type.to_lowercase();
    ct.starts_with("text/")
        || ct.contains("json")
        || ct.contains("xml")
        || ct.contains("javascript")
        || ct.contains("urlencoded")
        || ct.contains("svg")
        || ct.contains("csv")
        || ct.contains("yaml")
        || ct.contains("html")
}

async fn do_send(
    spec: HttpRequestSpec,
    jar: Arc<reqwest_cookie_store::CookieStoreMutex>,
) -> Result<HttpResponseData, String> {
    let method = reqwest::Method::from_bytes(spec.method.as_bytes())
        .map_err(|_| format!("Método inválido: {}", spec.method))?;

    let redirect = if spec.follow_redirects {
        reqwest::redirect::Policy::limited(10)
    } else {
        reqwest::redirect::Policy::none()
    };

    let client = reqwest::Client::builder()
        .redirect(redirect)
        .cookie_provider(jar)
        .danger_accept_invalid_certs(spec.insecure)
        .timeout(std::time::Duration::from_millis(
            spec.timeout_ms.unwrap_or(30_000),
        ))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.request(method, &spec.url);
    let mut request_headers: Vec<(String, String)> = Vec::new();
    for (k, v) in &spec.headers {
        if !k.trim().is_empty() {
            req = req.header(k.trim(), v.as_str());
            request_headers.push((k.trim().to_string(), v.clone()));
        }
    }

    match spec.body_kind.as_deref().unwrap_or("raw") {
        "urlencoded" => {
            let pairs: Vec<(String, String)> = spec
                .form
                .into_iter()
                .filter(|(k, _)| !k.trim().is_empty())
                .collect();
            request_headers.push((
                "content-type".into(),
                "application/x-www-form-urlencoded".into(),
            ));
            req = req.form(&pairs);
        }
        "multipart" => {
            let mut form = reqwest::multipart::Form::new();
            for field in spec.multipart {
                if field.name.trim().is_empty() {
                    continue;
                }
                if field.kind == "file" {
                    let bytes = std::fs::read(&field.value)
                        .map_err(|e| format!("arquivo {}: {e}", field.value))?;
                    let filename = std::path::Path::new(&field.value)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| "arquivo".into());
                    form = form.part(
                        field.name,
                        reqwest::multipart::Part::bytes(bytes).file_name(filename),
                    );
                } else {
                    form = form.text(field.name, field.value);
                }
            }
            request_headers.push(("content-type".into(), "multipart/form-data".into()));
            req = req.multipart(form);
        }
        _ => {
            if let Some(body) = spec.body {
                if !body.is_empty() {
                    request_headers.push(("content-length".into(), body.len().to_string()));
                    req = req.body(body);
                }
            }
        }
    }
    // reqwest adiciona sozinho conforme as features habilitadas
    request_headers.push(("accept-encoding".into(), "gzip, br, deflate".into()));

    let start = Instant::now();
    let resp = req.send().await.map_err(|e| friendly_error(&e))?;
    let ttfb_ms = start.elapsed().as_millis() as u64;

    let status = resp.status();
    let http_version = format!("{:?}", resp.version());
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| {
            (
                k.to_string(),
                v.to_str().unwrap_or("<binário>").to_string(),
            )
        })
        .collect();
    let content_type = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
        .map(|(_, v)| v.clone())
        .unwrap_or_default();

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let total_ms = start.elapsed().as_millis() as u64;
    let size_bytes = bytes.len() as u64;

    let (slice, truncated) = if bytes.len() > MAX_BODY_BYTES {
        (&bytes[..MAX_BODY_BYTES], true)
    } else {
        (&bytes[..], false)
    };

    let is_binary = !is_texty(&content_type) && std::str::from_utf8(slice).is_err();
    let (body, body_base64) = if is_binary {
        (
            String::new(),
            Some(base64::engine::general_purpose::STANDARD.encode(slice)),
        )
    } else {
        (String::from_utf8_lossy(slice).to_string(), None)
    };

    Ok(HttpResponseData {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        request_headers,
        body,
        body_truncated: truncated,
        is_binary,
        body_base64,
        ttfb_ms,
        total_ms,
        size_bytes,
        http_version,
    })
}

fn friendly_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return "Timeout: servidor não respondeu no tempo limite".into();
    }
    if e.is_connect() {
        return format!("Falha de conexão: {}", root_cause(e));
    }
    e.to_string()
}

fn root_cause(e: &dyn std::error::Error) -> String {
    let mut cur: &dyn std::error::Error = e;
    while let Some(src) = cur.source() {
        cur = src;
    }
    cur.to_string()
}
