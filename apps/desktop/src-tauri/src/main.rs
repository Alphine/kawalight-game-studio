#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

enum WorkerChild {
    Sidecar(CommandChild),
    Direct(std::process::Child),
}

impl WorkerChild {
    fn kill(self) {
        match self {
            WorkerChild::Sidecar(child) => {
                let _ = child.kill();
            }
            WorkerChild::Direct(mut child) => {
                let _ = child.kill();
            }
        }
    }
}

struct Worker(Mutex<Option<WorkerChild>>);

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn other<E: std::fmt::Display>(e: E) -> std::io::Error {
    std::io::Error::other(e.to_string())
}

fn kill_worker(app: &tauri::AppHandle) {
    if let Ok(mut slot) = app.state::<Worker>().0.lock() {
        if let Some(child) = slot.take() {
            child.kill();
        }
    }
}

/// Portable fallback: worker exe sitting next to the app exe (a raw/portable
/// layout has no bundle resources for the plugin sidecar lookup).
fn spawn_exe_dir_worker() -> Result<std::process::Child, std::io::Error> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let dir = std::env::current_exe()?
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| other("app exe has no parent dir"))?;
    for name in [
        "kgsm-worker-x86_64-pc-windows-msvc.exe",
        "kgsm-worker.exe",
    ] {
        let candidate = dir.join(name);
        if candidate.is_file() {
            eprintln!("spawning worker fallback: {}", candidate.display());
            return std::process::Command::new(candidate)
                .args(["--port", "4317"])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
        }
    }
    Err(other(format!(
        "worker binary not found next to the app exe ({})",
        dir.display()
    )))
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Worker(Mutex::new(None)))
        .setup(|app| {
            let spawned = app
                .shell()
                .sidecar("kgsm-worker")
                .map_err(other)?
                .args(["--port", "4317"])
                .spawn();
            let child = match spawned {
                Ok((rx, child)) => {
                    // Drain sidecar output so a full pipe can never block it.
                    tauri::async_runtime::spawn(async move {
                        let mut rx = rx;
                        while rx.recv().await.is_some() {}
                    });
                    WorkerChild::Sidecar(child)
                }
                Err(e) => {
                    eprintln!("plugin sidecar failed ({e}); trying exe-dir fallback");
                    WorkerChild::Direct(spawn_exe_dir_worker().map_err(other)?)
                }
            };
            *app.state::<Worker>()
                .0
                .lock()
                .map_err(other)? = Some(child);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![app_version])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            kill_worker(handle);
        }
    });
}
