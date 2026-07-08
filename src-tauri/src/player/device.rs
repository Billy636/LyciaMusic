use crate::player::types::{
    AudioCommand, AudioDevice, AudioOutputMode, AudioOutputStatus, PlayerState,
};
use cpal::traits::{DeviceTrait, HostTrait};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub async fn get_output_devices() -> Result<Vec<AudioDevice>, String> {
    tauri::async_runtime::spawn_blocking(enumerate_output_devices)
        .await
        .map_err(|error| format!("Failed to enumerate audio output devices: {error}"))?
}

fn enumerate_output_devices() -> Result<Vec<AudioDevice>, String> {
    let host = cpal::default_host();
    let devices = host.output_devices().map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    for device in devices {
        if let Ok(name) = device.name() {
            result.push(AudioDevice {
                id: name.clone(),
                name,
            });
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn set_output_device(
    device_id: Option<String>,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::SetDevice(device_id))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_audio_output_mode(
    output_mode: AudioOutputMode,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::SetOutputMode(output_mode))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_current_output_device(
    state: tauri::State<PlayerState>,
) -> Result<AudioOutputStatus, String> {
    let status = state.output_status.lock().map_err(|e| e.to_string())?;
    Ok(status.clone())
}

pub(crate) fn default_output_device_name(host: &cpal::Host) -> Option<String> {
    host.default_output_device()?.name().ok()
}

pub(crate) fn emit_output_status(
    app: &AppHandle,
    status: &Arc<Mutex<AudioOutputStatus>>,
    selected_device_id: Option<String>,
    active_device_name: Option<String>,
    requested_output_mode: AudioOutputMode,
    active_output_mode: AudioOutputMode,
    fallback_reason: Option<String>,
) {
    let next_status = AudioOutputStatus {
        selected_device_id: selected_device_id.clone(),
        active_device_name,
        follows_system_default: selected_device_id.is_none(),
        requested_output_mode,
        active_output_mode,
        fallback_reason,
    };

    if let Ok(mut current_status) = status.lock() {
        *current_status = next_status.clone();
    }

    let _ = app.emit("audio-output-device-changed", next_status);
}
