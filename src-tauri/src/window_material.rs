use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowMaterialCapabilities {
    pub is_windows: bool,
    pub supports_acrylic: bool,
    pub supports_mica: bool,
    pub supports_blur: bool,
    pub system_transparency_enabled: Option<bool>,
    pub windows_build_number: Option<u32>,
}

#[tauri::command]
pub fn get_window_material_capabilities() -> WindowMaterialCapabilities {
    platform_capabilities()
}

#[tauri::command]
pub async fn apply_transparent_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;

        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "主窗口不存在".to_string())?;

        // WebView2 only accepts fully transparent or opaque backgrounds.
        window
            .set_background_color(Some(tauri::window::Color(0, 0, 0, 0)))
            .map_err(|error| error.to_string())?;
        // A native RGBA color still paints an RGB GDI brush on Windows.
        // Remove that brush instead of asking it to honor a zero alpha.
        window
            .as_ref()
            .window()
            .set_background_color(None)
            .map_err(|error| error.to_string())?;

        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as usize;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                let _ = sender.send(apply_native_transparency(hwnd));
            })
            .map_err(|error| error.to_string())?;
        receiver.await.map_err(|error| error.to_string())?
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("透明窗口仅支持 Windows".to_string())
    }
}

#[cfg(target_os = "windows")]
fn apply_native_transparency(hwnd: usize) -> Result<(), String> {
    use std::{ffi::c_void, mem::size_of};
    use windows_sys::Win32::{
        Foundation::{BOOL, HWND},
        Graphics::{
            Dwm::{DwmEnableBlurBehindWindow, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWM_BLURBEHIND},
            Gdi::{CreateRectRgn, DeleteObject},
        },
        System::LibraryLoader::{GetModuleHandleW, GetProcAddress},
    };

    #[repr(C)]
    struct AccentPolicy {
        state: u32,
        flags: u32,
        gradient_color: u32,
        animation_id: u32,
    }

    #[repr(C)]
    struct CompositionAttributeData {
        attribute: u32,
        data: *mut c_void,
        size: usize,
    }

    type SetCompositionAttribute =
        unsafe extern "system" fn(HWND, *mut CompositionAttributeData) -> BOOL;

    unsafe {
        let hwnd = hwnd as HWND;
        // Restore the same alpha composition Tao establishes when creating a
        // transparent window; clearing an Accent material can disturb it.
        let region = CreateRectRgn(0, 0, -1, -1);
        if region.is_null() {
            return Err("无法创建窗口透明区域".to_string());
        }
        let blur = DWM_BLURBEHIND {
            dwFlags: DWM_BB_ENABLE | DWM_BB_BLURREGION,
            fEnable: 1,
            hRgnBlur: region,
            fTransitionOnMaximized: 0,
        };
        let result = DwmEnableBlurBehindWindow(hwnd, &blur);
        DeleteObject(region);
        if result < 0 {
            return Err(format!("无法恢复窗口透明合成：0x{:08X}", result as u32));
        }

        let user32: Vec<u16> = "user32.dll\0".encode_utf16().collect();
        let module = GetModuleHandleW(user32.as_ptr());
        if module.is_null() {
            return Err("无法加载窗口材质接口".to_string());
        }
        let function = GetProcAddress(module, b"SetWindowCompositionAttribute\0".as_ptr())
            .ok_or_else(|| "系统不支持透明窗口材质".to_string())?;
        let set_composition: SetCompositionAttribute = std::mem::transmute(function);
        let mut policy = AccentPolicy {
            state: 2, // ACCENT_ENABLE_TRANSPARENTGRADIENT, without blur.
            flags: 2,
            gradient_color: 0,
            animation_id: 0,
        };
        let mut data = CompositionAttributeData {
            attribute: 19, // WCA_ACCENT_POLICY
            data: &mut policy as *mut _ as *mut c_void,
            size: size_of::<AccentPolicy>(),
        };
        if set_composition(hwnd, &mut data) == 0 {
            return Err("系统未能应用透明窗口材质".to_string());
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn platform_capabilities() -> WindowMaterialCapabilities {
    let build = query_windows_build_number();
    let supports_acrylic = matches!(build, Some(value) if value >= 17763);
    let supports_mica = matches!(build, Some(value) if value >= 22000);
    let supports_blur = matches!(build, Some(value) if value >= 17763 && value < 22621);

    WindowMaterialCapabilities {
        is_windows: true,
        supports_acrylic,
        supports_mica,
        supports_blur,
        system_transparency_enabled: query_transparency_enabled(),
        windows_build_number: build,
    }
}

#[cfg(not(target_os = "windows"))]
fn platform_capabilities() -> WindowMaterialCapabilities {
    WindowMaterialCapabilities {
        is_windows: false,
        supports_acrylic: false,
        supports_mica: false,
        supports_blur: false,
        system_transparency_enabled: None,
        windows_build_number: None,
    }
}

#[cfg(target_os = "windows")]
fn query_windows_build_number() -> Option<u32> {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;

    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn RtlGetVersion(lp_version_information: *mut OSVERSIONINFOW) -> i32;
    }

    unsafe {
        let mut version: OSVERSIONINFOW = zeroed();
        version.dwOSVersionInfoSize = size_of::<OSVERSIONINFOW>() as u32;

        if RtlGetVersion(&mut version) == 0 {
            Some(version.dwBuildNumber)
        } else {
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn query_transparency_enabled() -> Option<bool> {
    use std::{mem::size_of, ptr::null_mut};
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

    let sub_key: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\0"
        .encode_utf16()
        .collect();
    let value_name: Vec<u16> = "EnableTransparency\0".encode_utf16().collect();

    let mut value: u32 = 0;
    let mut value_size = size_of::<u32>() as u32;

    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            sub_key.as_ptr(),
            value_name.as_ptr(),
            RRF_RT_REG_DWORD,
            null_mut(),
            &mut value as *mut _ as *mut _,
            &mut value_size,
        )
    };

    if status == 0 {
        Some(value != 0)
    } else {
        None
    }
}
