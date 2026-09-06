// quartz desktop shell.
//
// The window runs the same web app as the browser; the difference is what sits
// behind the storage seam. Here each vault is a real folder — a valid Obsidian
// vault that both apps can have open at once (plan section 5, milestone 5).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod vault;

use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use vault::{LocalVault, Settings, VaultState};

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
fn local_vaults(state: tauri::State<'_, VaultState>) -> Result<Vec<LocalVault>, String> {
    state.local_vaults()
}

/// Asks for a folder and opens it as a vault. `None` means the picker was
/// dismissed, which is not an error worth surfacing.
///
/// The dialog is opened from here rather than from the web app so the shell
/// keeps needing no plugin permissions in the webview: the frontend asks for a
/// vault, not for filesystem access.
///
/// `(async)` is load-bearing: without it a command runs on the main thread,
/// and a blocking picker there deadlocks against the event loop it is waiting
/// on. This marker moves the body to the thread pool instead.
#[tauri::command(async)]
fn pick_local_vault(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
) -> Result<Option<LocalVault>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    state.add_local(&path).map(Some)
}

#[tauri::command]
fn forget_local_vault(id: String, state: tauri::State<'_, VaultState>) -> Result<(), String> {
    state.forget_local(&id)
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
        .plugin(tauri_plugin_dialog::init())
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
            local_vaults,
            pick_local_vault,
            forget_local_vault,
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
