use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImmersiveFullscreenState {
    pub is_fullscreen: bool,
    pub was_maximized_before_fullscreen: bool,
}

/// Applies the maximize/fullscreen transition in one native command.
///
/// On Windows a frameless maximized window can fail to visually transition when
/// fullscreen is applied directly. Restoring it first removes that conflicting
/// window state without exposing an intermediate frontend render.
#[tauri::command]
pub fn set_immersive_fullscreen(
    window: tauri::Window,
    fullscreen: bool,
    restore_maximized: bool,
) -> Result<ImmersiveFullscreenState, String> {
    if fullscreen {
        let was_maximized = window.is_maximized().map_err(|error| error.to_string())?;

        if was_maximized {
            window.unmaximize().map_err(|error| error.to_string())?;
        }

        if let Err(error) = window.set_fullscreen(true) {
            if was_maximized {
                let _ = window.maximize();
            }
            return Err(error.to_string());
        }

        return Ok(ImmersiveFullscreenState {
            is_fullscreen: true,
            was_maximized_before_fullscreen: was_maximized,
        });
    }

    window
        .set_fullscreen(false)
        .map_err(|error| error.to_string())?;

    if restore_maximized {
        window.maximize().map_err(|error| error.to_string())?;
    }

    Ok(ImmersiveFullscreenState {
        is_fullscreen: false,
        was_maximized_before_fullscreen: false,
    })
}
