// quartz desktop shell.
//
// The window runs the same web app as the browser; the difference is what sits
// behind the storage seam. Here each vault is a real folder — a valid Obsidian
// vault that both apps can have open at once (plan section 5, milestone 5).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod vault;

use std::sync::Mutex;

use tauri::Manager;

use vault::{Settings, VaultState};

#[tauri::command]
fn vaults_base(state: tauri::State<'_, VaultState>) -> Result<String, String> {
    Ok(state.base()?.to_string_lossy().into_owned())
}

#[tauri::command]
fn set_vaults_base(path: String, state: tauri::State<'_, VaultState>) -> Result<(), String> {
    state.set_base(path)
}

#[tauri::command]
fn vault_root(vault: String, state: tauri::State<'_, VaultState>) -> Result<String, String> {
    Ok(state.root(&vault)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn vault_list(vault: String, state: tauri::State<'_, VaultState>) -> Result<Vec<vault::FileMeta>, String> {
    state.list(&vault)
}

#[tauri::command]
fn vault_read(
    vault: String,
    path: String,
    state: tauri::State<'_, VaultState>,
) -> Result<Vec<u8>, String> {
    state.read(&vault, &path)
}

#[tauri::command]
fn vault_write(
    vault: String,
    path: String,
    data: Vec<u8>,
    state: tauri::State<'_, VaultState>,
) -> Result<(), String> {
    state.write(&vault, &path, &data)
}

#[tauri::command]
fn vault_delete(
    vault: String,
    path: String,
    state: tauri::State<'_, VaultState>,
) -> Result<(), String> {
    state.delete(&vault, &path)
}

#[tauri::command]
fn state_read(vault: String, state: tauri::State<'_, VaultState>) -> Result<String, String> {
    state.read_sync_state(&vault)
}

#[tauri::command]
fn state_write(
    vault: String,
    json: String,
    state: tauri::State<'_, VaultState>,
) -> Result<(), String> {
    state.write_sync_state(&vault, &json)
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
            vaults_base,
            set_vaults_base,
            vault_root,
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
