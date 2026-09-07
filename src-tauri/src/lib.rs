#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    // v1.11.3 risk audit — considered, deliberately left as `.expect()`.
    // This is the standard Tauri entry-point pattern (every official
    // template ends this way): if the event loop can't even start, there's
    // no app left to report the error to and no caller to hand a Result
    // back to — a panic is the correct outcome, not a bug. It also doesn't
    // swallow the cause: Rust's `expect(msg)` panics with `"{msg}: {err:?}"`,
    // so the underlying plugin/setup error (e.g. from the `?` above) is
    // always printed alongside this message, not lost.
    .expect("error while running tauri application");
}
