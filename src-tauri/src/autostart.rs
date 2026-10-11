#[cfg(target_os = "windows")]
mod windows {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA, ERROR_SUCCESS};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegGetValueW, RegOpenKeyExW, RegSetValueExW,
        HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_REG_BINARY,
        RRF_RT_REG_SZ,
    };

    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const STARTUP_APPROVED_KEY: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

    struct RegistryKey(HKEY);

    impl Drop for RegistryKey {
        fn drop(&mut self) {
            unsafe { RegCloseKey(self.0) };
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    fn registry_error(action: &str, status: u32) -> String {
        format!(
            "{action}: {}",
            std::io::Error::from_raw_os_error(status as i32)
        )
    }

    fn startup_command() -> Result<String, String> {
        let executable = std::env::current_exe().map_err(|e| format!("无法获取程序路径: {e}"))?;
        let executable = executable
            .to_str()
            .ok_or_else(|| "程序路径包含无效的 Unicode 字符".to_string())?;
        let command = format!("\"{executable}\"");
        // Windows Run entries accept command lines of at most 260 characters.
        if command.encode_utf16().count() > 260 {
            return Err("程序路径过长，无法设置开机自动运行，请将程序移至较短的路径".to_string());
        }
        Ok(command)
    }

    fn read_startup_command(name: &str) -> Result<Option<String>, String> {
        let key_path = wide(RUN_KEY);
        let name = wide(name);
        let mut byte_len = 0;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key_path.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_SZ,
                null_mut(),
                null_mut(),
                &mut byte_len,
            )
        };
        if status == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        if status != ERROR_SUCCESS {
            return Err(registry_error("读取开机自动运行设置失败", status));
        }

        // Leave room for a terminator and retry if another process changes the value.
        for _ in 0..3 {
            let mut value = vec![0u16; byte_len as usize / 2 + 1];
            let mut capacity = (value.len() * 2) as u32;
            let status = unsafe {
                RegGetValueW(
                    HKEY_CURRENT_USER,
                    key_path.as_ptr(),
                    name.as_ptr(),
                    RRF_RT_REG_SZ,
                    null_mut(),
                    value.as_mut_ptr().cast(),
                    &mut capacity,
                )
            };
            if status == ERROR_FILE_NOT_FOUND {
                return Ok(None);
            }
            if status == ERROR_MORE_DATA {
                byte_len = capacity;
                continue;
            }
            if status != ERROR_SUCCESS {
                return Err(registry_error("读取开机自动运行设置失败", status));
            }
            let len = value.iter().position(|&ch| ch == 0).unwrap_or(value.len());
            let command = String::from_utf16(&value[..len])
                .map_err(|e| format!("开机自动运行设置包含无效的路径: {e}"))?;
            return Ok(Some(command));
        }
        Err("开机自动运行设置正在被其他程序修改，请重试".to_string())
    }

    fn is_startup_approved(name: &str) -> Result<bool, String> {
        let key_path = wide(STARTUP_APPROVED_KEY);
        let name = wide(name);
        let mut value = [0u8; 12];
        let mut byte_len = value.len() as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key_path.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_BINARY,
                null_mut(),
                value.as_mut_ptr().cast(),
                &mut byte_len,
            )
        };
        if status == ERROR_FILE_NOT_FOUND {
            return Ok(true);
        }
        // Treat unknown records conservatively, including future larger formats.
        if status == ERROR_MORE_DATA {
            return Ok(false);
        }
        if status != ERROR_SUCCESS {
            return Err(registry_error("读取系统启动项状态失败", status));
        }
        if byte_len != value.len() as u32 {
            return Ok(false);
        }
        // Electron's Windows login-item implementation recognizes states 0 and 2.
        // Only read this OS-owned record; explicit changes delete our own value.
        let state = u32::from_le_bytes([value[0], value[1], value[2], value[3]]);
        Ok(matches!(state, 0 | 2))
    }

    fn delete_startup_value(path: &str, name: &str) -> Result<(), String> {
        let key_path = wide(path);
        let name_wide = wide(name);
        let mut key = null_mut();
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                key_path.as_ptr(),
                0,
                KEY_SET_VALUE,
                &mut key,
            )
        };
        if status == ERROR_FILE_NOT_FOUND {
            return Ok(());
        }
        if status != ERROR_SUCCESS {
            return Err(registry_error("打开系统启动项设置失败", status));
        }
        let key = RegistryKey(key);
        let status = unsafe { RegDeleteValueW(key.0, name_wide.as_ptr()) };
        if status != ERROR_SUCCESS && status != ERROR_FILE_NOT_FOUND {
            return Err(registry_error("清除系统启动项设置失败", status));
        }
        Ok(())
    }

    pub(super) fn get(name: &str) -> Result<bool, String> {
        let Some(command) = read_startup_command(name)? else {
            return Ok(false);
        };
        if !command.eq_ignore_ascii_case(&startup_command()?) {
            return Ok(false);
        }
        is_startup_approved(name)
    }

    pub(super) fn set(name: &str, enabled: bool) -> Result<bool, String> {
        if !enabled {
            delete_startup_value(RUN_KEY, name)?;
            delete_startup_value(STARTUP_APPROVED_KEY, name)?;
            if get(name)? {
                return Err("开机自动运行设置未生效，请重试".to_string());
            }
            return Ok(false);
        }

        let key_path = wide(RUN_KEY);
        let name_wide = wide(name);
        let command = wide(&startup_command()?);
        let mut key = null_mut();
        let status = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                key_path.as_ptr(),
                0,
                null(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                null(),
                &mut key,
                null_mut(),
            )
        };
        if status != ERROR_SUCCESS {
            return Err(registry_error("打开开机自动运行设置失败", status));
        }
        let key = RegistryKey(key);
        let status = unsafe {
            RegSetValueExW(
                key.0,
                name_wide.as_ptr(),
                0,
                REG_SZ,
                command.as_ptr().cast(),
                (command.len() * 2) as u32,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(registry_error("保存开机自动运行设置失败", status));
        }
        delete_startup_value(STARTUP_APPROVED_KEY, name)?;
        let actual = get(name)?;
        if actual != enabled {
            return Err("开机自动运行设置未生效，请重试".to_string());
        }
        Ok(actual)
    }
}

#[tauri::command]
pub fn get_launch_on_startup(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let name = app
            .config()
            .product_name
            .as_deref()
            .unwrap_or(&app.package_info().name);
        windows::get(name)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("当前平台不支持开机自动运行".to_string())
    }
}

#[tauri::command]
pub fn set_launch_on_startup(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        // Match the NSIS uninstall entry, including when running a portable copy.
        let name = app
            .config()
            .product_name
            .as_deref()
            .unwrap_or(&app.package_info().name);
        windows::set(name, enabled)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, enabled);
        Err("当前平台不支持开机自动运行".to_string())
    }
}
