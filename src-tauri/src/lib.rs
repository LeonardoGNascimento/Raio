mod http;
mod trace;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let trace_store: trace::SharedTraceStore = Default::default();
    trace::start_server(trace_store.clone());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(trace_store)
        .manage(http::CancelMap::default())
        .manage(http::SharedJar::default())
        .invoke_handler(tauri::generate_handler![
            http::send_request,
            http::cancel_request,
            http::list_cookies,
            http::clear_cookies,
            http::save_body,
            trace::get_trace,
            trace::trace_port,
            workspace::get_workspace,
            workspace::create_collection,
            workspace::create_folder,
            workspace::delete_folder,
            workspace::save_config,
            workspace::delete_collection,
            workspace::save_request,
            workspace::delete_request,
            workspace::move_request,
            workspace::save_environments,
            workspace::save_snapshot,
            workspace::load_snapshot,
            workspace::delete_snapshot,
            workspace::load_history,
            workspace::append_history,
            workspace::load_flows,
            workspace::save_flows,
            workspace::save_openapi,
            workspace::load_openapi,
            workspace::delete_openapi,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
