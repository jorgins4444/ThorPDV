use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrototypeStatus {
    mode: &'static str,
    backend_connected: bool,
    production_operations_enabled: bool,
    message: &'static str,
}

#[tauri::command]
fn prototype_status() -> PrototypeStatus {
    PrototypeStatus {
        mode: "tauri2-visual-prototype",
        backend_connected: false,
        production_operations_enabled: false,
        message: "Visual shell ready. ThorPDV commercial backend migration pending.",
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![prototype_status])
        .run(tauri::generate_context!())
        .expect("failed to run ThorPDV Tauri prototype");
}
