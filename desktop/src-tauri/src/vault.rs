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

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    pub vault: PathBuf,
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
            vault: home.join("Documents").join("quartz"),
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
    pub fn root(&self) -> Result<PathBuf, String> {
        let root = self.settings.lock().map_err(|_| "settings lock")?.vault.clone();
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        Ok(root)
    }

    pub fn set_root(&self, path: String) -> Result<(), String> {
        let mut settings = self.settings.lock().map_err(|_| "settings lock")?;
        settings.vault = PathBuf::from(path);
        settings.save(&self.config_dir)
    }

    pub fn list(&self) -> Result<Vec<FileMeta>, String> {
        let root = self.root()?;
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

    pub fn read(&self, rel: &str) -> Result<Vec<u8>, String> {
        let path = self.resolve(rel)?;
        fs::read(path).map_err(|e| e.to_string())
    }

    /// Writes through a temporary file in the same directory, so a reader —
    /// Obsidian included — never sees half a note.
    pub fn write(&self, rel: &str, data: &[u8]) -> Result<(), String> {
        let path = self.resolve(rel)?;
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

    pub fn delete(&self, rel: &str) -> Result<(), String> {
        let path = self.resolve(rel)?;
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(err) => return Err(err.to_string()),
        }
        // Leave no empty folders behind, the way Obsidian does.
        let root = self.root()?;
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
    pub fn read_sync_state(&self) -> Result<String, String> {
        match fs::read_to_string(self.config_dir.join("sync-state.json")) {
            Ok(text) => Ok(text),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
            Err(err) => Err(err.to_string()),
        }
    }

    pub fn write_sync_state(&self, json: &str) -> Result<(), String> {
        fs::create_dir_all(&self.config_dir).map_err(|e| e.to_string())?;
        fs::write(self.config_dir.join("sync-state.json"), json).map_err(|e| e.to_string())
    }

    fn resolve(&self, rel: &str) -> Result<PathBuf, String> {
        let clean = clean_path(rel)?;
        if ignored(&clean) {
            return Err(format!("{clean} is not synced"));
        }
        let root = self.root()?;
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
    fn hashes_like_the_server() {
        // sha256("hello") — the same value Go and the browser produce.
        assert_eq!(
            hash_bytes(b"hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }
}
