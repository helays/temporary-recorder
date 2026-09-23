mod commands;

/// 关闭 WebView2 的「浏览器加速键」。
///
/// wry 默认把这个开关保持为 WebView2 的默认值 true，于是 Ctrl+F / Ctrl+P /
/// Ctrl+R / Ctrl+Plus / F12 等会被 WebView2 自己截走：按 Ctrl+F 弹出的是
/// WebView2 自带的查找条，而不是 CodeMirror 的搜索面板——自带查找条既没有
/// 正则/大小写/全词，也没有替换。Ctrl+N 与 Ctrl+H 不在被截走的列表里。
///
/// Tauri 的配置项没有暴露这个开关，只能取到底层 COM 接口自行设置。
///
/// 每一步都打日志：静默 return 会让人分不清「设置成功」与「中途失败」。
#[cfg(windows)]
fn disable_browser_accelerator_keys(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;

    let result = window.with_webview(|webview| {
        let controller = webview.controller();
        // SAFETY: tauri 保证闭包在主线程上执行，且 controller 在回调期间有效
        unsafe {
            let core = match controller.CoreWebView2() {
                Ok(core) => core,
                Err(err) => {
                    eprintln!("[webview] 取 CoreWebView2 失败：{err}");
                    return;
                }
            };
            let settings = match core.Settings() {
                Ok(settings) => settings,
                Err(err) => {
                    eprintln!("[webview] 取 Settings 失败：{err}");
                    return;
                }
            };
            let settings3 = match settings.cast::<ICoreWebView2Settings3>() {
                Ok(settings3) => settings3,
                Err(err) => {
                    eprintln!("[webview] 取 Settings3 失败（WebView2 运行时可能过旧）：{err}");
                    return;
                }
            };
            match settings3.SetAreBrowserAcceleratorKeysEnabled(false) {
                Ok(()) => {
                    eprintln!("[webview] 已关闭浏览器加速键：Ctrl+F 归 CodeMirror 搜索面板");
                }
                Err(err) => eprintln!("[webview] 关闭浏览器加速键失败：{err}"),
            }
        }
    });

    if let Err(err) = result {
        eprintln!("[webview] with_webview 调用失败：{err}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::textfile::read_text_file,
            commands::textfile::write_text_file,
            commands::textfile::path_status,
            commands::textfile::delete_file,
            commands::textfile::list_dir,
            commands::textfile::ensure_dir,
            commands::textfile::reveal_path,
        ])
        .setup(|app| {
            #[cfg(windows)]
            {
                use tauri::Manager;
                match app.get_webview_window("main") {
                    Some(window) => disable_browser_accelerator_keys(&window),
                    None => eprintln!("[webview] 未找到 main 窗口，跳过加速键设置"),
                }
            }
            #[cfg(not(windows))]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
