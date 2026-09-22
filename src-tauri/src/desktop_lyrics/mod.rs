//! Windows desktop lyrics use an in-process Win32 window, never a WebView.
#[cfg(any(target_os = "windows", test))]
mod flow;
#[cfg(any(target_os = "windows", test))]
mod model;
#[cfg(target_os = "windows")]
mod outline;
#[cfg(target_os = "windows")]
mod render;
#[cfg(target_os = "windows")]
mod window;

#[tauri::command]
pub async fn native_desktop_lyrics_open(
    app: tauri::AppHandle,
    payload: serde_json::Value,
    bounds: Option<serde_json::Value>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return tauri::async_runtime::spawn_blocking(move || {
        window::open(
            app,
            serde_json::from_value(payload).map_err(|e| format!("Invalid lyrics state: {e}"))?,
            bounds
                .map(serde_json::from_value)
                .transpose()
                .map_err(|e| format!("Invalid lyrics bounds: {e}"))?,
        )
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, payload, bounds);
        Err("Native desktop lyrics require Windows".into())
    }
}

#[tauri::command]
pub async fn native_desktop_lyrics_state(payload: serde_json::Value) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return tauri::async_runtime::spawn_blocking(move || {
        window::send(window::Command::State(Box::new(
            serde_json::from_value(payload).map_err(|e| format!("Invalid lyrics state: {e}"))?,
        )))
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    {
        let _ = payload;
        Ok(())
    }
}

#[tauri::command]
pub async fn native_desktop_lyrics_playback(payload: serde_json::Value) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return tauri::async_runtime::spawn_blocking(move || {
        window::send(window::Command::Playback(
            serde_json::from_value(payload).map_err(|e| format!("Invalid lyrics playback: {e}"))?,
        ))
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    {
        let _ = payload;
        Ok(())
    }
}

#[tauri::command]
pub async fn native_desktop_lyrics_reveal() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return tauri::async_runtime::spawn_blocking(|| window::send(window::Command::Reveal))
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    Ok(())
}

#[tauri::command]
pub async fn native_desktop_lyrics_close() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return tauri::async_runtime::spawn_blocking(window::close)
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    Ok(())
}
