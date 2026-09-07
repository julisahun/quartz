//! Folder-backed vault access.
//!
//! The rules here mirror the server's `internal/vault`: the same path checks,
//! the same ignore list, the same atomic writes, the same sha256 hashes — so a
//! file means the same thing on the Pi, in the browser and on the desktop.

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

#[derive(Serialize)]
pub struct FileMeta {
    pub path: String,
    pub hash: String,
    pub size: u64,
    pub mtime: i64,
}

/// A folder the user opened as a vault.
///
/// Until it is promoted it belongs to no account and never syncs: the folder
/// on disk is the whole of it, which is what makes the app usable with no
/// server at all. Promotion does not move it — the entry is re-keyed to the id
/// the server gave the vault, and from then on this is where that vault's
/// bytes live on this machine.
#[derive(Serialize, Deserialize, Clone)]
pub struct LocalVault {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    /// Set once the folder has been promoted. Defaulted so a settings file
    /// written before promotion existed still loads.
    #[serde(default)]
    pub synced: bool,
}

/// Whether this machine keeps a vault's notes as a folder, or only inside the
/// app — and whether it has been asked yet.
///
/// A vault kept in the app has no folder of its own, so this cannot be
/// recorded in one: it lives beside the list of folders instead.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum VaultMode {
    /// Cloned: a real directory of markdown files, which Obsidian can open.
    Folder,
    /// Kept in the app's own storage. Nothing of it lands in the filesystem.
    App,
    /// Never asked. The client asks before opening the vault the first time.
    Unset,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    /// Vaults live side by side under this directory, one folder each, named
    /// after the vault id the server uses.
    pub vaults: PathBuf,
    /// Folders opened from disk, each at a path of its own choosing. Defaulted
    /// so a settings file written before local vaults existed still loads.
    #[serde(default)]
    pub local: Vec<LocalVault>,
    /// Vaults this machine was told to keep inside the app instead of cloning.
    /// Being in neither list is a third answer, not the same as this one: it
    /// means nobody has been asked yet. Defaulted so a settings file written
    /// before the choice existed still loads.
    #[serde(default)]
    pub app_only: Vec<String>,
}

impl Settings {
    pub fn load(config_dir: &Path, home: &Path) -> Result<Self, String> {
        fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
        let file = config_dir.join("settings.json");
        if let Ok(raw) = fs::read_to_string(&file) {
            if let Ok(settings) = serde_json::from_str::<Settings>(&raw) {
                return Ok(settings);
            }
        }
        // The default is a folder the user can also open in Obsidian.
        let settings = Settings {
            vaults: home.join("Documents").join("quartz"),
            local: Vec::new(),
            app_only: Vec::new(),
        };
        settings.save(config_dir)?;
        Ok(settings)
    }

    pub fn save(&self, config_dir: &Path) -> Result<(), String> {
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(config_dir.join("settings.json"), json).map_err(|e| e.to_string())
    }
}

pub struct VaultState {
    pub config_dir: PathBuf,
    pub settings: Mutex<Settings>,
}

impl VaultState {
    /// The folder holding one vault. A server vault is a directory under the
    /// base named after its id, so the id is checked as strictly as any other
    /// path input; a local vault is wherever the user pointed at.
    pub fn root(&self, vault: &str) -> Result<PathBuf, String> {
        if !valid_vault_id(vault) {
            return Err(format!("invalid vault id: {vault}"));
        }
        let settings = self.settings.lock().map_err(|_| "settings lock")?;
        if let Some(local) = settings.local.iter().find(|v| v.id == vault) {
            let path = local.path.clone();
            // Never created here: a folder that has been moved or unplugged is
            // an error worth showing, not an empty vault worth inventing.
            if !path.is_dir() {
                return Err(format!("{} is no longer on disk", path.display()));
            }
            return Ok(path);
        }
        // Not a folder on this machine. Either the vault is kept inside the
        // app — in which case nothing here should be asking the filesystem for
        // it — or it has never been cloned. Inventing a directory under the
        // base is what used to clone every synced vault the instant it was
        // opened, whether or not anybody wanted files.
        Err(format!("{vault} is not kept as a folder on this machine"))
    }

    /// How this machine keeps a vault, and whether it has been asked.
    pub fn vault_mode(&self, vault: &str) -> Result<VaultMode, String> {
        if !valid_vault_id(vault) {
            return Err(format!("invalid vault id: {vault}"));
        }
        let settings = self.settings.lock().map_err(|_| "settings lock")?;
        if settings.local.iter().any(|v| v.id == vault) {
            return Ok(VaultMode::Folder);
        }
        if settings.app_only.iter().any(|id| id == vault) {
            return Ok(VaultMode::App);
        }
        Ok(VaultMode::Unset)
    }

    /// Records that a vault stays inside the app on this machine.
    pub fn keep_in_app(&self, vault: &str) -> Result<(), String> {
        if !valid_vault_id(vault) {
            return Err(format!("invalid vault id: {vault}"));
        }
        let mut settings = self.settings.lock().map_err(|_| "settings lock")?;
        if settings.local.iter().any(|v| v.id == vault) {
            // There is no un-cloning. The notes are already files somewhere,
            // and taking that back would mean either deleting them or leaving
            // two stores over one folder.
            return Err(format!("{vault} is already kept as a folder here"));
        }
        if !settings.app_only.iter().any(|id| id == vault) {
            settings.app_only.push(vault.to_string());
            settings.save(&self.config_dir)?;
        }
        Ok(())
    }

    /// Clones a synced vault onto this machine: from here on its bytes live in
    /// `at`, or in a directory named after it under the base.
    ///
    /// The folder may already hold a copy of the notes — the same Obsidian
    /// vault on a second machine is the case this is for — because the sync
    /// engine adopts what matches and only conflicts what differs.
    pub fn clone_vault(&self, vault: &str, at: Option<PathBuf>) -> Result<LocalVault, String> {
        if !valid_vault_id(vault) {
            return Err(format!("invalid vault id: {vault}"));
        }
        let mut settings = self.settings.lock().map_err(|_| "settings lock")?;
        if settings.local.iter().any(|v| v.id == vault) {
            return Err(format!("{vault} is already a folder here"));
        }
        let target = at.unwrap_or_else(|| settings.vaults.join(vault));
        // Checked before anything is created, so a refusal leaves no directory
        // lying around.
        if let Ok(existing) = fs::canonicalize(&target) {
            if let Some(other) = settings.local.iter().find(|v| v.path == existing) {
                return Err(format!("that folder is already {}", other.id));
            }
        }
        fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        let path = fs::canonicalize(&target).map_err(|e| e.to_string())?;
        // Asked and answered the other way now.
        settings.app_only.retain(|id| id != vault);
        let cloned = LocalVault {
            id: vault.to_string(),
            name: vault.to_string(),
            path,
            synced: true,
        };
        settings.local.push(cloned.clone());
        settings.save(&self.config_dir)?;
        Ok(cloned)
    }

    pub fn local_vaults(&self) -> Result<Vec<LocalVault>, String> {
        Ok(self.settings.lock().map_err(|_| "settings lock")?.local.clone())
    }

    /// Opens a folder as a vault. Adding the same folder twice returns what is
    /// already there rather than a second entry over the same files.
    pub fn add_local(&self, path: &Path) -> Result<LocalVault, String> {
        if !path.is_dir() {
            return Err(format!("{} is not a folder", path.display()));
        }
        let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
        let mut settings = self.settings.lock().map_err(|_| "settings lock")?;

        // A folder under the base is already a synced vault's folder. Opening
        // it locally as well would put two stores over one directory.
        let base = fs::canonicalize(&settings.vaults).unwrap_or_else(|_| settings.vaults.clone());
        if path.starts_with(&base) {
            return Err("that folder is already a synced vault".into());
        }

        // Matched on the path, which is what a folder *is*. The derived id is
        // only how it starts out being addressed: promoting re-keys the entry
        // to the id the server gave it, and an entry recognised by its id
        // alone stops being recognised at all the moment that happens —
        // putting a second entry over a directory already open here, which is
        // the one thing this check exists to prevent.
        if let Some(existing) = settings.local.iter().find(|v| v.path == path) {
            return Ok(existing.clone());
        }
        let vault = LocalVault {
            id: local_id(&path),
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "vault".to_string()),
            path,
            synced: false,
        };
        settings.local.push(vault.clone());
        settings.save(&self.config_dir)?;
        Ok(vault)
    }

    /// Re-keys a folder to the id the server gave its vault, and marks it
    /// synced. The folder does not move: a promotion is about where the notes
    /// are *published*, not about where the user keeps them.
    pub fn promote_local(&self, id: &str, new_id: &str) -> Result<LocalVault, String> {
        if !valid_vault_id(new_id) {
            return Err(format!("invalid vault id: {new_id}"));
        }
        let mut settings = self.settings.lock().map_err(|_| "settings lock")?;
        if new_id != id && settings.local.iter().any(|v| v.id == new_id) {
            return Err(format!("{new_id} is already a folder here"));
        }
        let Some(vault) = settings.local.iter_mut().find(|v| v.id == id) else {
            return Err(format!("no local vault {id}"));
        };
        vault.id = new_id.to_string();
        vault.synced = true;
        let promoted = vault.clone();
        settings.save(&self.config_dir)?;
        drop(settings);
        // The bookkeeping was filed under the old id and describes a vault
        // that had never synced; the first sync writes it afresh.
        let _ = fs::remove_file(self.config_dir.join(format!("sync-state-{id}.json")));
        Ok(promoted)
    }

    /// Forgets a local vault. The folder and every note in it stay exactly
    /// where they are — only Quartz's bookkeeping goes.
    pub fn forget_local(&self, id: &str) -> Result<(), String> {
        let mut settings = self.settings.lock().map_err(|_| "settings lock")?;
        if settings.local.iter().any(|v| v.id == id && v.synced) {
            // Forgetting one would leave a synced vault with nowhere to live
            // and it would quietly re-download into the managed base. There is
            // no un-syncing yet, so this says no rather than half-doing it.
            return Err(format!("{id} is a synced vault now — remove it with quartz-admin"));
        }
        let before = settings.local.len();
        settings.local.retain(|v| v.id != id);
        if settings.local.len() == before {
            return Err(format!("no local vault {id}"));
        }
        settings.save(&self.config_dir)?;
        drop(settings);
        let _ = fs::remove_file(self.config_dir.join(format!("sync-state-{id}.json")));
        Ok(())
    }

    pub fn base(&self) -> Result<PathBuf, String> {
        Ok(self.settings.lock().map_err(|_| "settings lock")?.vaults.clone())
    }

    pub fn set_base(&self, path: String) -> Result<(), String> {
        let mut settings = self.settings.lock().map_err(|_| "settings lock")?;
        settings.vaults = PathBuf::from(path);
        settings.save(&self.config_dir)
    }

    pub fn list(&self, vault: &str) -> Result<Vec<FileMeta>, String> {
        let root = self.root(vault)?;
        let mut out = Vec::new();
        for entry in WalkDir::new(&root).follow_links(false).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            let Ok(rel) = entry.path().strip_prefix(&root) else {
                continue;
            };
            let rel = rel.to_string_lossy().replace('\\', "/");
            if ignored(&rel) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let Ok(bytes) = fs::read(entry.path()) else { continue };
            out.push(FileMeta {
                path: rel,
                hash: hash_bytes(&bytes),
                size: meta.len(),
                mtime: meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0),
            });
        }
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    pub fn read(&self, vault: &str, rel: &str) -> Result<Vec<u8>, String> {
        let path = self.resolve(vault, rel)?;
        fs::read(path).map_err(|e| e.to_string())
    }

    /// Writes through a temporary file in the same directory, so a reader —
    /// Obsidian included — never sees half a note.
    pub fn write(&self, vault: &str, rel: &str, data: &[u8]) -> Result<(), String> {
        let path = self.resolve(vault, rel)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let tmp = path.with_file_name(format!(
            ".quartz-tmp-{}",
            path.file_name().and_then(|n| n.to_str()).unwrap_or("note")
        ));
        {
            let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
            file.write_all(data).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
        }
        fs::rename(&tmp, &path).map_err(|e| e.to_string())
    }

    pub fn delete(&self, vault: &str, rel: &str) -> Result<(), String> {
        let path = self.resolve(vault, rel)?;
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(err) => return Err(err.to_string()),
        }
        // Leave no empty folders behind, the way Obsidian does.
        let root = self.root(vault)?;
        let mut dir = path.parent().map(Path::to_path_buf);
        while let Some(current) = dir {
            if current == root || !current.starts_with(&root) {
                break;
            }
            if fs::read_dir(&current).map(|mut d| d.next().is_some()).unwrap_or(true) {
                break;
            }
            if fs::remove_dir(&current).is_err() {
                break;
            }
            dir = current.parent().map(Path::to_path_buf);
        }
        Ok(())
    }

    /// Sync bookkeeping lives beside the app's config, never inside the vault:
    /// the vault holds notes and nothing else.
    pub fn read_sync_state(&self, vault: &str) -> Result<String, String> {
        if !valid_vault_id(vault) {
            return Err(format!("invalid vault id: {vault}"));
        }
        match fs::read_to_string(self.config_dir.join(format!("sync-state-{vault}.json"))) {
            Ok(text) => Ok(text),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
            Err(err) => Err(err.to_string()),
        }
    }

    pub fn write_sync_state(&self, vault: &str, json: &str) -> Result<(), String> {
        if !valid_vault_id(vault) {
            return Err(format!("invalid vault id: {vault}"));
        }
        fs::create_dir_all(&self.config_dir).map_err(|e| e.to_string())?;
        fs::write(self.config_dir.join(format!("sync-state-{vault}.json")), json)
            .map_err(|e| e.to_string())
    }

    fn resolve(&self, vault: &str, rel: &str) -> Result<PathBuf, String> {
        let clean = clean_path(rel)?;
        if ignored(&clean) {
            return Err(format!("{clean} is not synced"));
        }
        let root = self.root(vault)?;
        let joined = root.join(&clean);
        // Confirm the target stays inside the vault once symlinks are resolved.
        let probe = joined
            .ancestors()
            .find(|p| p.exists())
            .ok_or_else(|| "no existing ancestor".to_string())?;
        let resolved = fs::canonicalize(probe).map_err(|e| e.to_string())?;
        let canonical_root = fs::canonicalize(&root).map_err(|e| e.to_string())?;
        if !resolved.starts_with(&canonical_root) {
            return Err("path escapes the vault".into());
        }
        Ok(joined)
    }
}

/// Vault ids come from the server but become directory names here, so they are
/// held to the same rules the server enforces: no separators, no dot entries.
fn valid_vault_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id != "."
        && id != ".."
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
}

/// A stable id for a folder opened from disk: the same path always derives the
/// same id, so opening a folder twice reopens it instead of duplicating it.
/// The prefix keeps it out of the way of the ids the server hands out.
fn local_id(path: &Path) -> String {
    format!("local-{}", &hash_bytes(path.to_string_lossy().as_bytes())[..12])
}

fn clean_path(rel: &str) -> Result<String, String> {
    if rel.is_empty() || rel.contains('\0') || rel.contains('\\') || rel.starts_with('/') {
        return Err("invalid path".into());
    }
    for segment in rel.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err("invalid path".into());
        }
    }
    Ok(rel.to_string())
}

fn ignored(rel: &str) -> bool {
    for segment in rel.split('/') {
        if segment == ".git" || segment == ".trash" || segment.starts_with(".quartz") {
            return true;
        }
    }
    let last = rel.rsplit('/').next().unwrap_or(rel);
    if last == ".DS_Store" || last == "Thumbs.db" {
        return true;
    }
    if rel.starts_with(".obsidian/") {
        return matches!(last, "workspace.json" | "workspace-mobile.json" | "cache")
            || rel.contains("/cache/");
    }
    false
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal() {
        for bad in ["", "../x.md", "/etc/passwd", "a/../b.md", "a\\b.md", "a/./b.md"] {
            assert!(clean_path(bad).is_err(), "accepted {bad}");
        }
        assert_eq!(clean_path("notes/a.md").unwrap(), "notes/a.md");
    }

    #[test]
    fn ignores_the_same_paths_as_the_server() {
        for path in [
            ".git/config",
            ".obsidian/workspace.json",
            ".DS_Store",
            "notes/.DS_Store",
            ".quartz-sync.json",
        ] {
            assert!(ignored(path), "should ignore {path}");
        }
        for path in ["a.md", ".obsidian/app.json", "img/pic.png"] {
            assert!(!ignored(path), "should keep {path}");
        }
    }

    #[test]
    fn rejects_bad_vault_ids() {
        for bad in ["", "..", ".", "a/b", "a\\b", "../escape", "a b", &"x".repeat(65)] {
            assert!(!valid_vault_id(bad), "accepted {bad}");
        }
        for good in ["juli", "casa", "maria.lopez", "shared-vault_2"] {
            assert!(valid_vault_id(good), "rejected {good}");
        }
    }

    #[test]
    fn local_ids_are_stable_and_valid() {
        let a = local_id(Path::new("/Users/juli/Documents/Obsidian"));
        assert_eq!(a, local_id(Path::new("/Users/juli/Documents/Obsidian")));
        assert_ne!(a, local_id(Path::new("/Users/juli/Documents/Work")));
        assert!(valid_vault_id(&a), "{a} is not usable as a vault id");
    }

    #[test]
    fn reopening_a_promoted_folder_does_not_list_it_twice() {
        let dirs = scratch("reopen-promoted");
        let picked = dirs.join("talasia");
        fs::create_dir_all(&picked).unwrap();
        let state = state_in(&dirs);

        let opened = state.add_local(&picked).unwrap();
        state.promote_local(&opened.id, "talasia").unwrap();

        // The entry no longer carries the id derived from its path, so a
        // dedupe that asked about the id used to miss it and add a second
        // entry over the same directory — which then could not be promoted,
        // because the id it wanted was taken by the first.
        let again = state.add_local(&picked).unwrap();
        assert_eq!(again.id, "talasia");
        assert!(again.synced, "reopening lost that it was already promoted");
        assert_eq!(state.local_vaults().unwrap().len(), 1, "the folder was listed twice");
    }

    #[test]
    fn a_vault_is_unasked_until_it_is_answered() {
        let dirs = scratch("mode");
        let state = state_in(&dirs);

        // Being in neither list is its own answer: nobody has been asked, so
        // the client knows to ask rather than assuming either way.
        assert_eq!(state.vault_mode("talasia").unwrap(), VaultMode::Unset);
        state.keep_in_app("talasia").unwrap();
        assert_eq!(state.vault_mode("talasia").unwrap(), VaultMode::App);
        // Answering twice is not an error; it is the same answer.
        state.keep_in_app("talasia").unwrap();
        assert_eq!(state.vault_mode("talasia").unwrap(), VaultMode::App);
        fs::remove_dir_all(&dirs).ok();
    }

    #[test]
    fn an_app_only_vault_has_no_folder() {
        let dirs = scratch("app-only");
        let state = state_in(&dirs);
        state.keep_in_app("talasia").unwrap();
        // Nothing of it is in the filesystem, so asking where it is on disk is
        // a mistake worth reporting rather than a directory worth inventing.
        assert!(state.root("talasia").is_err());
        assert!(!dirs.join("base").join("talasia").exists());
        fs::remove_dir_all(&dirs).ok();
    }

    #[test]
    fn cloning_gives_a_vault_a_folder_and_settles_the_question() {
        let dirs = scratch("clone");
        let state = state_in(&dirs);
        state.keep_in_app("talasia").unwrap();

        let cloned = state.clone_vault("talasia", None).unwrap();
        assert!(cloned.synced);
        assert_eq!(state.vault_mode("talasia").unwrap(), VaultMode::Folder);
        assert_eq!(
            fs::canonicalize(state.root("talasia").unwrap()).unwrap(),
            fs::canonicalize(dirs.join("base").join("talasia")).unwrap()
        );
        // It is a folder now, so the record of it being app-only is gone
        // rather than left to contradict the folder.
        assert!(state.settings.lock().unwrap().app_only.is_empty());
        fs::remove_dir_all(&dirs).ok();
    }

    #[test]
    fn cloning_adopts_a_folder_that_already_holds_the_notes() {
        let dirs = scratch("clone-onto");
        let existing = dirs.join("Talasia");
        fs::create_dir_all(&existing).unwrap();
        fs::write(existing.join("a.md"), b"# a").unwrap();
        let state = state_in(&dirs);

        state.clone_vault("talasia", Some(existing.clone())).unwrap();
        // The same Obsidian vault on a second machine: nothing is moved and
        // nothing is cleared, because reconcile adopts what already matches.
        assert!(existing.join("a.md").exists());
        assert_eq!(
            fs::canonicalize(state.root("talasia").unwrap()).unwrap(),
            fs::canonicalize(&existing).unwrap()
        );
        fs::remove_dir_all(&dirs).ok();
    }

    #[test]
    fn there_is_no_un_cloning() {
        let dirs = scratch("no-unclone");
        let state = state_in(&dirs);
        state.clone_vault("talasia", None).unwrap();

        // The notes are files now. Going back would mean deleting them, or
        // leaving two stores over one folder.
        assert!(state.keep_in_app("talasia").is_err());
        assert!(state.clone_vault("talasia", None).is_err(), "cloned twice");
        fs::remove_dir_all(&dirs).ok();
    }

    #[test]
    fn a_local_vault_resolves_to_the_folder_that_was_picked() {
        let dirs = scratch("resolves");
        let picked = dirs.join("Notes of mine");
        fs::create_dir_all(&picked).unwrap();
        let state = state_in(&dirs);

        let vault = state.add_local(&picked).unwrap();
        assert_eq!(vault.name, "Notes of mine");
        assert_eq!(fs::canonicalize(state.root(&vault.id).unwrap()).unwrap(), fs::canonicalize(&picked).unwrap());

        // Adding it again is the same vault, not a second one over one folder.
        assert_eq!(state.add_local(&picked).unwrap().id, vault.id);
        assert_eq!(state.local_vaults().unwrap().len(), 1);

        // Forgetting leaves every note where it was.
        fs::write(picked.join("a.md"), b"# a").unwrap();
        state.forget_local(&vault.id).unwrap();
        assert!(state.local_vaults().unwrap().is_empty());
        assert!(picked.join("a.md").exists());
        fs::remove_dir_all(&dirs).ok();
    }

    #[test]
    fn refuses_a_folder_that_is_already_a_synced_vault() {
        let dirs = scratch("refuses");
        let state = state_in(&dirs);
        let inside = state.clone_vault("juli", None).unwrap().path; // under the base
        assert!(state.add_local(&inside).is_err());
        assert!(state.add_local(&dirs.join("nope")).is_err(), "accepted a missing folder");
        fs::remove_dir_all(&dirs).ok();
    }

    /// A vault whose folder has been moved away must say so rather than come
    /// back empty, which would read as "all your notes are gone".
    #[test]
    fn a_missing_folder_is_an_error_not_an_empty_vault() {
        let dirs = scratch("missing");
        let picked = dirs.join("Gone");
        fs::create_dir_all(&picked).unwrap();
        let state = state_in(&dirs);
        let vault = state.add_local(&picked).unwrap();
        fs::remove_dir_all(&picked).unwrap();
        assert!(state.root(&vault.id).is_err());
        assert!(state.list(&vault.id).is_err());
        fs::remove_dir_all(&dirs).ok();
    }

    #[test]
    fn promotion_re_keys_the_folder_without_moving_it() {
        let dirs = scratch("promote");
        let picked = dirs.join("Field notes");
        fs::create_dir_all(&picked).unwrap();
        fs::write(picked.join("a.md"), b"# a").unwrap();
        let state = state_in(&dirs);
        let local = state.add_local(&picked).unwrap();

        let promoted = state.promote_local(&local.id, "field-notes").unwrap();
        assert_eq!(promoted.id, "field-notes");
        assert!(promoted.synced);
        // The notes are exactly where the user left them, and the vault now
        // answers to the name the server gave it.
        assert_eq!(
            fs::canonicalize(state.root("field-notes").unwrap()).unwrap(),
            fs::canonicalize(&picked).unwrap()
        );
        assert!(picked.join("a.md").exists());
        // The old id no longer names anything. It used to fall through to a
        // fresh directory under the base, which is how a vault nobody asked to
        // clone got one anyway.
        assert!(state.root(&local.id).is_err());

        // No un-syncing: forgetting it would leave the vault homeless.
        assert!(state.forget_local("field-notes").is_err());
        fs::remove_dir_all(&dirs).ok();
    }

    #[test]
    fn promotion_refuses_a_name_another_folder_answers_to() {
        let dirs = scratch("promote-clash");
        let (a, b) = (dirs.join("One"), dirs.join("Two"));
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        let state = state_in(&dirs);
        let first = state.add_local(&a).unwrap();
        let second = state.add_local(&b).unwrap();

        state.promote_local(&first.id, "notes").unwrap();
        assert!(state.promote_local(&second.id, "notes").is_err());
        assert!(state.promote_local(&second.id, "../escape").is_err());
        fs::remove_dir_all(&dirs).ok();
    }

    fn scratch(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("quartz-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A state whose config and vault base both sit under one scratch folder.
    fn state_in(dir: &Path) -> VaultState {
        fs::create_dir_all(dir.join("config")).unwrap();
        VaultState {
            config_dir: dir.join("config"),
            settings: Mutex::new(Settings {
                vaults: dir.join("base"),
                local: Vec::new(),
                app_only: Vec::new(),
            }),
        }
    }

    #[test]
    fn hashes_like_the_server() {
        // sha256("hello") — the same value Go and the browser produce.
        assert_eq!(
            hash_bytes(b"hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }
}
