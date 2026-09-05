// quartz desktop shell.
//
// The window runs the same web app as the browser; the difference is what sits
// behind the storage seam. Here it is a real folder — a valid Obsidian vault
// that both apps can have open at once (plan section 5, milestone 5).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod vault;

use std::sync::Mutex;

use tauri::Manager;

use vault::{Settings, VaultState};

#[tauri::command]
fn vault_root(state: tauri::State<'_, VaultState>) -> Result<String, String> {
    Ok(state.root()?.to_string_lossy().into_owned())
}

#[tauri::command]
fn set_vault_root(path: String, state: tauri::State<'_, VaultState>) -> Result<(), String> {
    state.set_root(path)
}

#[tauri::command]
fn vault_list(state: tauri::State<'_, VaultState>) -> Result<Vec<vault::FileMeta>, String> {
    state.list()
}

#[tauri::command]
fn vault_read(path: String, state: tauri::State<'_, VaultState>) -> Result<Vec<u8>, String> {
    state.read(&path)
}

#[tauri::command]
fn vault_write(
    path: String,
    data: Vec<u8>,
    state: tauri::State<'_, VaultState>,
) -> Result<(), String> {
    state.write(&path, &data)
}

#[tauri::command]
fn vault_delete(path: String, state: tauri::State<'_, VaultState>) -> Result<(), String> {
    state.delete(&path)
}

#[tauri::command]
fn state_read(state: tauri::State<'_, VaultState>) -> Result<String, String> {
    state.read_sync_state()
}

#[tauri::command]
fn state_write(json: String, state: tauri::State<'_, VaultState>) -> Result<(), String> {
    state.write_sync_state(&json)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let config_dir = app
                .path()
                .app_config_dir()
                .map_err(|e| format!("no config directory: {e}"))?;
            let home = app.path().home_dir().map_err(|e| format!("no home directory: {e}"))?;
            let settings = Settings::load(&config_dir, &home)?;
            app.manage(VaultState {
                config_dir: config_dir.clone(),
                settings: Mutex::new(settings),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_root,
            set_vault_root,
            vault_list,
            vault_read,
            vault_write,
            vault_delete,
            state_read,
            state_write,
        ])
        .run(tauri::generate_context!())
        .expect("error while running quartz");
}
