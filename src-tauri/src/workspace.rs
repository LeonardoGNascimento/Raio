use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContractDef {
    #[serde(rename = "type")]
    pub kind: String, // "zod" | "json-schema"
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RequestDef {
    pub id: String,
    pub name: String,
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub body_type: String, // "none" | "json" | "text" | "form"
    /// contrato da rota (zod ou json-schema); ausente = herda OpenAPI da collection
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract: Option<ContractDef>,
    /// SLA de latência em ms; execução acima disso gera alerta
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_ms: Option<u64>,
    /// query params anexados à URL no envio
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub query: Vec<(String, String)>,
    /// valores dos path params ({id} ou :id na URL)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub path_params: Vec<(String, String)>,
    /// autenticação da rota (bearer/basic/apikey)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<serde_json::Value>,
    /// pares de x-www-form-urlencoded
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub form: Vec<(String, String)>,
    /// campos multipart: {name, kind: "text"|"file", value}
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub multipart: Vec<serde_json::Value>,
    /// opções de envio: timeout_ms, follow_redirects, insecure
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<serde_json::Value>,
    /// checks declarativos, um por linha (ex.: status == 200)
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub checks: String,
    /// extração pós-response: (variável, path do body ex.: $.token)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extract: Vec<(String, String)>,
    /// vigia da rota: reexecuta no intervalo e notifica quebras
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub watch: Option<serde_json::Value>, // { env: string, minutes: number }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Environment {
    pub name: String,
    #[serde(default)]
    pub vars: Vec<(String, String)>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct DirConfig {
    #[serde(default)]
    base_url: String,
    /// bases por ambiente: (nome do ambiente, base)
    #[serde(default)]
    base_urls: Vec<(String, String)>,
}

#[derive(Debug, Serialize)]
pub struct Folder {
    pub name: String,
    pub base_url: String,
    pub base_urls: Vec<(String, String)>,
    pub requests: Vec<RequestDef>,
    pub folders: Vec<Folder>,
}

fn read_folder(path: &Path, name: String) -> Folder {
    let cfg = read_config(path);
    let mut folders = Vec::new();
    if let Ok(subs) = fs::read_dir(path) {
        for sub in subs.flatten() {
            let spath = sub.path();
            let sname = sub.file_name().to_string_lossy().to_string();
            if spath.is_dir() && !sname.starts_with('.') {
                folders.push(read_folder(&spath, sname));
            }
        }
    }
    folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Folder {
        name,
        base_url: cfg.base_url,
        base_urls: cfg.base_urls,
        requests: read_requests(path),
        folders,
    }
}

#[derive(Debug, Serialize)]
pub struct Collection {
    pub name: String,
    pub base_url: String,
    pub base_urls: Vec<(String, String)>,
    pub has_spec: bool,
    pub requests: Vec<RequestDef>,
    pub folders: Vec<Folder>,
    /// ambientes próprios da collection
    pub environments: Vec<Environment>,
}

#[derive(Debug, Serialize)]
pub struct WorkspaceData {
    pub path: String,
    pub collections: Vec<Collection>,
}

fn read_environments(path: &Path) -> Vec<Environment> {
    if !path.exists() {
        return Vec::new();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn workspace_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Home não encontrada")?;
    let dir = home.join("raio-collections");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "sem-nome".into()
    } else {
        trimmed.to_string()
    }
}

/// Diretório que contém as requests: collection ou collection/pasta (aninhada: "a/b/c").
fn container_dir(ws: &Path, collection: &str, folder: Option<&str>) -> PathBuf {
    let mut dir = ws.join(sanitize(collection));
    if let Some(f) = folder {
        for seg in f.split('/').filter(|s| !s.trim().is_empty()) {
            dir = dir.join(sanitize(seg));
        }
    }
    dir
}

fn request_path(ws: &Path, collection: &str, folder: Option<&str>, request_name: &str) -> PathBuf {
    container_dir(ws, collection, folder).join(format!("{}.json", sanitize(request_name)))
}

fn snapshot_path(ws: &Path, collection: &str, folder: Option<&str>, request_name: &str) -> PathBuf {
    container_dir(ws, collection, folder)
        .join(".snapshots")
        .join(format!("{}.json", sanitize(request_name)))
}

fn read_config(dir: &Path) -> DirConfig {
    let path = dir.join(".config.json");
    if !path.exists() {
        return DirConfig::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_config(dir: &Path, cfg: &DirConfig) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(dir.join(".config.json"), raw).map_err(|e| e.to_string())
}

fn read_requests(dir: &Path) -> Vec<RequestDef> {
    let mut requests = Vec::new();
    if let Ok(files) = fs::read_dir(dir) {
        for file in files.flatten() {
            let fpath = file.path();
            let fname = file.file_name().to_string_lossy().to_string();
            if fname.starts_with('.') || !fname.ends_with(".json") {
                continue;
            }
            if let Ok(raw) = fs::read_to_string(&fpath) {
                if let Ok(req) = serde_json::from_str::<RequestDef>(&raw) {
                    requests.push(req);
                }
            }
        }
    }
    requests.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    requests
}

#[tauri::command]
pub fn get_workspace() -> Result<WorkspaceData, String> {
    let ws = workspace_dir()?;

    // legado: environments.json na raiz vale como fallback para collections sem o próprio
    let legacy_envs = read_environments(&ws.join("environments.json"));

    let mut collections = Vec::new();
    let entries = fs::read_dir(&ws).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let cfg = read_config(&path);
        let mut folders = Vec::new();
        if let Ok(subs) = fs::read_dir(&path) {
            for sub in subs.flatten() {
                let spath = sub.path();
                let sname = sub.file_name().to_string_lossy().to_string();
                if spath.is_dir() && !sname.starts_with('.') {
                    folders.push(read_folder(&spath, sname));
                }
            }
        }
        folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        let own_envs = read_environments(&path.join("environments.json"));
        collections.push(Collection {
            has_spec: path.join(".openapi.json").exists(),
            base_url: cfg.base_url,
            base_urls: cfg.base_urls,
            requests: read_requests(&path),
            folders,
            environments: if own_envs.is_empty() { legacy_envs.clone() } else { own_envs },
            name,
        });
    }
    collections.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(WorkspaceData {
        path: ws.to_string_lossy().to_string(),
        collections,
    })
}

#[tauri::command]
pub fn create_collection(name: String) -> Result<(), String> {
    let ws = workspace_dir()?;
    let dir = ws.join(sanitize(&name));
    if dir.exists() {
        return Err("Collection já existe".into());
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_folder(collection: String, name: String) -> Result<(), String> {
    let ws = workspace_dir()?;
    let dir = container_dir(&ws, &collection, Some(&name));
    if dir.exists() {
        return Err("Pasta já existe".into());
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())
}

/// Exclui uma pasta (e subpastas/requests) da collection.
#[tauri::command]
pub fn delete_folder(collection: String, folder: String) -> Result<(), String> {
    if folder.trim().is_empty() {
        return Err("Pasta inválida".into());
    }
    let ws = workspace_dir()?;
    let dir = container_dir(&ws, &collection, Some(&folder));
    // nunca deixa apagar a própria collection por um path vazio/sanitizado
    if dir == container_dir(&ws, &collection, None) {
        return Err("Pasta inválida".into());
    }
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_collection(name: String) -> Result<(), String> {
    let ws = workspace_dir()?;
    let dir = ws.join(sanitize(&name));
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Salva nome + base URL de uma collection ou pasta. Renomeia o diretório se o nome mudou.
#[tauri::command]
pub fn save_config(
    collection: String,
    folder: Option<String>,
    new_name: String,
    base_url: String,
    base_urls: Option<Vec<(String, String)>>,
) -> Result<(), String> {
    let ws = workspace_dir()?;
    let cur = container_dir(&ws, &collection, folder.as_deref());
    if !cur.exists() {
        return Err("Diretório não existe".into());
    }
    let target_name = sanitize(&new_name);
    let cur_name = cur
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let dir = if !target_name.is_empty() && target_name != cur_name {
        let dest = cur.with_file_name(&target_name);
        if dest.exists() {
            return Err("Já existe collection/pasta com esse nome".into());
        }
        fs::rename(&cur, &dest).map_err(|e| e.to_string())?;
        dest
    } else {
        cur
    };
    write_config(
        &dir,
        &DirConfig {
            base_url,
            base_urls: base_urls
                .unwrap_or_default()
                .into_iter()
                .filter(|(env, _)| !env.trim().is_empty())
                .collect(),
        },
    )
}

#[tauri::command]
pub fn save_request(
    collection: String,
    folder: Option<String>,
    request: RequestDef,
    old_name: Option<String>,
) -> Result<(), String> {
    let ws = workspace_dir()?;
    let dir = container_dir(&ws, &collection, folder.as_deref());
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // renomeou: remove o arquivo antigo e move o snapshot junto
    if let Some(old) = old_name {
        if sanitize(&old) != sanitize(&request.name) {
            let old_path = request_path(&ws, &collection, folder.as_deref(), &old);
            let _ = fs::remove_file(old_path);
            let old_snap = snapshot_path(&ws, &collection, folder.as_deref(), &old);
            if old_snap.exists() {
                let _ = fs::rename(
                    old_snap,
                    snapshot_path(&ws, &collection, folder.as_deref(), &request.name),
                );
            }
            let old_hist = history_path(&ws, &collection, folder.as_deref(), &old);
            if old_hist.exists() {
                let _ = fs::rename(
                    old_hist,
                    history_path(&ws, &collection, folder.as_deref(), &request.name),
                );
            }
        }
    }

    let path = request_path(&ws, &collection, folder.as_deref(), &request.name);
    let raw = serde_json::to_string_pretty(&request).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_request(
    collection: String,
    folder: Option<String>,
    request_name: String,
) -> Result<(), String> {
    let ws = workspace_dir()?;
    let path = request_path(&ws, &collection, folder.as_deref(), &request_name);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    let snap = snapshot_path(&ws, &collection, folder.as_deref(), &request_name);
    if snap.exists() {
        let _ = fs::remove_file(snap);
    }
    let hist = history_path(&ws, &collection, folder.as_deref(), &request_name);
    if hist.exists() {
        let _ = fs::remove_file(hist);
    }
    Ok(())
}

/// Move uma request (com snapshot e histórico) para outra collection/pasta.
#[tauri::command]
pub fn move_request(
    collection: String,
    folder: Option<String>,
    request_name: String,
    to_collection: String,
    to_folder: Option<String>,
) -> Result<(), String> {
    let ws = workspace_dir()?;
    let src = request_path(&ws, &collection, folder.as_deref(), &request_name);
    if !src.exists() {
        return Err("Request não encontrada".into());
    }
    let dest_dir = container_dir(&ws, &to_collection, to_folder.as_deref());
    if !dest_dir.exists() {
        return Err("Destino não existe".into());
    }
    let dest = request_path(&ws, &to_collection, to_folder.as_deref(), &request_name);
    if dest.exists() {
        return Err("Já existe request com esse nome no destino".into());
    }
    fs::rename(&src, &dest).map_err(|e| e.to_string())?;

    let companions = [
        (
            snapshot_path(&ws, &collection, folder.as_deref(), &request_name),
            snapshot_path(&ws, &to_collection, to_folder.as_deref(), &request_name),
        ),
        (
            history_path(&ws, &collection, folder.as_deref(), &request_name),
            history_path(&ws, &to_collection, to_folder.as_deref(), &request_name),
        ),
    ];
    for (from, to) in companions {
        if from.exists() {
            if let Some(dir) = to.parent() {
                let _ = fs::create_dir_all(dir);
            }
            let _ = fs::rename(from, to);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_environments(collection: String, environments: Vec<Environment>) -> Result<(), String> {
    let ws = workspace_dir()?;
    let dir = container_dir(&ws, &collection, None);
    if !dir.exists() {
        return Err("Collection não existe".into());
    }
    let raw = serde_json::to_string_pretty(&environments).map_err(|e| e.to_string())?;
    fs::write(dir.join("environments.json"), raw).map_err(|e| e.to_string())
}

// ---------- Snapshots ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Snapshot {
    pub saved_at: String,
    #[serde(default)]
    pub env: String,
    pub status: u16,
    pub body: String,
}

#[tauri::command]
pub fn save_snapshot(
    collection: String,
    folder: Option<String>,
    request_name: String,
    snapshot: Snapshot,
) -> Result<(), String> {
    let ws = workspace_dir()?;
    let path = snapshot_path(&ws, &collection, folder.as_deref(), &request_name);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_snapshot(
    collection: String,
    folder: Option<String>,
    request_name: String,
) -> Result<Option<Snapshot>, String> {
    let ws = workspace_dir()?;
    let path = snapshot_path(&ws, &collection, folder.as_deref(), &request_name);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let snap = serde_json::from_str(&raw).map_err(|e| format!("snapshot inválido: {e}"))?;
    Ok(Some(snap))
}

#[tauri::command]
pub fn delete_snapshot(
    collection: String,
    folder: Option<String>,
    request_name: String,
) -> Result<(), String> {
    let ws = workspace_dir()?;
    let path = snapshot_path(&ws, &collection, folder.as_deref(), &request_name);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- Histórico de execuções ----------

const MAX_HISTORY: usize = 10;
/// teto por body salvo no histórico — sem isso 10 entradas de 10MB atravessam o IPC juntas
const MAX_HISTORY_BODY: usize = 512 * 1024;

fn truncate_utf8(s: &mut String, max: usize) {
    if s.len() <= max {
        return;
    }
    let mut cut = max;
    while cut > 0 && !s.is_char_boundary(cut) {
        cut -= 1;
    }
    s.truncate(cut);
    s.push_str("\n… [truncado pelo raio: body maior que 512KB]");
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct HistoryContract {
    /// "ok" | "fail" | "none" (não validado)
    #[serde(default)]
    pub status: String,
    /// "zod" | "json-schema" | "openapi" | "none"
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub operation: String,
    #[serde(default)]
    pub violations: Vec<(String, String)>, // (path, mensagem)
    /// snapshot do schema da rota usado nesta execução ("" para openapi)
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryEntry {
    pub id: String,
    pub at: String, // ISO
    #[serde(default)]
    pub env: String,
    pub status: u16,
    pub status_text: String,
    pub ttfb_ms: u64,
    pub total_ms: u64,
    pub size_bytes: u64,
    pub http_version: String,
    pub body: String,
    pub headers: Vec<(String, String)>,
    /// trace da execução acusou exception interna
    #[serde(default)]
    pub trace_error: bool,
    // request enviada (para detalhe no histórico)
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub request_body: String,
    /// resultado do contrato nesta execução
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract: Option<HistoryContract>,
    /// SLA vigente nesta execução (ms)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_ms: Option<u64>,
    /// checks declarativos avaliados nesta execução
    #[serde(default)]
    pub checks_total: u32,
    #[serde(default)]
    pub checks_failed: u32,
}

fn history_path(ws: &Path, collection: &str, folder: Option<&str>, request_name: &str) -> PathBuf {
    container_dir(ws, collection, folder)
        .join(".history")
        .join(format!("{}.json", sanitize(request_name)))
}

fn read_history(path: &Path) -> Vec<HistoryEntry> {
    if !path.exists() {
        return Vec::new();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn load_history(
    collection: String,
    folder: Option<String>,
    request_name: String,
) -> Result<Vec<HistoryEntry>, String> {
    let ws = workspace_dir()?;
    Ok(read_history(&history_path(&ws, &collection, folder.as_deref(), &request_name)))
}

#[tauri::command]
pub fn append_history(
    collection: String,
    folder: Option<String>,
    request_name: String,
    mut entry: HistoryEntry,
) -> Result<Vec<HistoryEntry>, String> {
    let ws = workspace_dir()?;
    let path = history_path(&ws, &collection, folder.as_deref(), &request_name);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // bodies gigantes no histórico (10 entradas) travam o load ao abrir a request
    truncate_utf8(&mut entry.body, MAX_HISTORY_BODY);
    truncate_utf8(&mut entry.request_body, MAX_HISTORY_BODY);
    let mut hist = read_history(&path);
    hist.push(entry);
    if hist.len() > MAX_HISTORY {
        let excess = hist.len() - MAX_HISTORY;
        hist.drain(0..excess);
    }
    let raw = serde_json::to_string_pretty(&hist).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())?;
    Ok(hist)
}

// ---------- OpenAPI ----------

fn openapi_path(ws: &Path, collection: &str) -> PathBuf {
    ws.join(sanitize(collection)).join(".openapi.json")
}

#[tauri::command]
pub fn save_openapi(collection: String, content: String) -> Result<(), String> {
    let ws = workspace_dir()?;
    // valida que é JSON antes de gravar
    serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|e| format!("Spec não é JSON válido: {e}"))?;
    fs::write(openapi_path(&ws, &collection), content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_openapi(collection: String) -> Result<Option<String>, String> {
    let ws = workspace_dir()?;
    let path = openapi_path(&ws, &collection);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_openapi(collection: String) -> Result<(), String> {
    let ws = workspace_dir()?;
    let path = openapi_path(&ws, &collection);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod dup_tests {
    use super::*;

    // HOME é global do processo: serializa os testes e usa um dir único por teste
    static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn with_temp_home<F: FnOnce()>(f: F) {
        let _guard = HOME_LOCK.lock().unwrap();
        static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let tmp = std::env::temp_dir().join(format!("raio-test-{}-{}", std::process::id(), n));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        std::env::set_var("HOME", &tmp);
        f();
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn salvar_config_nao_duplica_collection() {
        with_temp_home(|| {
            create_collection("Account".into()).unwrap();
            save_config(
                "Account".into(),
                None,
                "Account".into(),
                "".into(),
                Some(vec![("Prod".into(), "https://x".into())]),
            )
            .unwrap();
            save_environments(
                "Account".into(),
                vec![Environment { name: "Prod".into(), vars: vec![] }],
            )
            .unwrap();
            let ws = get_workspace().unwrap();
            let names: Vec<_> = ws.collections.iter().map(|c| c.name.clone()).collect();
            assert_eq!(names, vec!["Account"], "listagem: {:?}", names);
        });
    }

    #[test]
    fn renomear_collection_nao_duplica() {
        with_temp_home(|| {
            create_collection("Account".into()).unwrap();
            save_config("Account".into(), None, "Contas".into(), "".into(), None).unwrap();
            let ws = get_workspace().unwrap();
            let names: Vec<_> = ws.collections.iter().map(|c| c.name.clone()).collect();
            assert_eq!(names, vec!["Contas"], "listagem: {:?}", names);
        });
    }

    #[test]
    fn salvar_config_de_pasta_nao_duplica() {
        with_temp_home(|| {
            create_collection("Account".into()).unwrap();
            create_folder("Account".into(), "orders".into()).unwrap();
            save_config(
                "Account".into(),
                Some("orders".into()),
                "orders".into(),
                "/orders".into(),
                None,
            )
            .unwrap();
            let ws = get_workspace().unwrap();
            assert_eq!(ws.collections.len(), 1);
            assert_eq!(ws.collections[0].folders.len(), 1);
        });
    }
}
