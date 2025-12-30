use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, AtomicU32, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::thread;
use std::fs::File;
use std::io::BufReader;
use std::time::Duration;
use rodio::{Decoder, OutputStream, Sink, Source};
use tauri::{AppHandle, Manager, Emitter};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use souvlaki::{MediaControls, PlatformConfig, MediaMetadata, MediaControlEvent, MediaPlayback, MediaPosition};

pub struct TimedSource<S> { pub inner: S, pub samples_played: Arc<AtomicU64> }
impl<S> Iterator for TimedSource<S> where S: Source<Item = f32> { type Item = f32; fn next(&mut self) -> Option<Self::Item> { let sample = self.inner.next(); if sample.is_some() { self.samples_played.fetch_add(1, Ordering::Relaxed); } sample } }
impl<S> Source for TimedSource<S> where S: Source<Item = f32> { fn channels(&self) -> u16 { self.inner.channels() } fn sample_rate(&self) -> u32 { self.inner.sample_rate() } fn current_frame_len(&self) -> Option<usize> { self.inner.current_frame_len() } fn total_duration(&self) -> Option<Duration> { self.inner.total_duration() } }

pub struct SharedProgress { pub samples_played: Arc<AtomicU64>, pub sample_rate: Arc<AtomicU32>, pub channels: Arc<AtomicU32> }

pub enum AudioCommand { Play(String), Pause, Resume, Seek(u32, bool), SetVolume(f32) }

pub struct PlayerState {
    pub tx: Mutex<Sender<AudioCommand>>, 
    pub progress: Arc<SharedProgress>,
    pub controls: Arc<Mutex<Option<MediaControls>>>, // Store MediaControls
}

pub fn init_player(app: &AppHandle) -> PlayerState {
    let (tx, rx) = channel::<AudioCommand>();
    let shared_progress = Arc::new(SharedProgress { samples_played: Arc::new(AtomicU64::new(0)), sample_rate: Arc::new(AtomicU32::new(44100)), channels: Arc::new(AtomicU32::new(2)) });
    let thread_progress = shared_progress.clone();

    // Initialize MediaControls
    let controls = Arc::new(Mutex::new(None));
    
    // Attempt to initialize souvlaki (must be on main thread logic, or have handle)
    // Here we are likely on the main thread (setup hook)
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(handle) = window.window_handle() {
             let raw_handle = handle.as_raw();
             // Determine HWND for Windows
             #[cfg(target_os = "windows")]
             {
                if let RawWindowHandle::Win32(h) = raw_handle {
                    // Cast NonZeroIisize to *mut c_void
                    let hwnd = h.hwnd.get() as *mut std::ffi::c_void;
                    
                    let config = PlatformConfig {
                        dbus_name: "my_cloud_music",
                        display_name: "My Cloud Music",
                        hwnd: Some(hwnd),
                    };

                    match MediaControls::new(config) {
                        Ok(mut mc) => {
                            let app_clone = app.clone();
                            // Attach event handler
                            // We cannot easily send commands to the rodio thread from here without a clone of tx.
                            // But PlayerState is not created yet. 
                            // We will emit events to frontend, and frontend will call invoke commands.
                            let _ = mc.attach(move |event| {
                                match event {
                                    MediaControlEvent::Play => { let _ = app_clone.emit("player:play", ()); },
                                    MediaControlEvent::Pause => { let _ = app_clone.emit("player:pause", ()); },
                                    MediaControlEvent::Next => { let _ = app_clone.emit("player:next", ()); },
                                    MediaControlEvent::Previous => { let _ = app_clone.emit("player:prev", ()); },
                                    _ => {}
                                }
                            });
                            *controls.lock().unwrap() = Some(mc);
                        },
                        Err(e) => println!("Error initializing MediaControls: {:?}", e),
                    }
                }
             }
        }
    }

    thread::spawn(move || {
        let stream_result = OutputStream::try_default();
        if stream_result.is_err() {
            println!("Failed to get default output stream: {:?}", stream_result.err());
            return;
        }
        let (_stream, stream_handle) = stream_result.unwrap();
        let mut current_sink: Option<Sink> = None;
        let mut current_path: String = String::new();
        let mut current_volume: f32 = 1.0;

        while let Ok(cmd) = rx.recv() {
            match cmd {
                AudioCommand::Play(path) => {
                    current_path = path.clone();
                    if let Ok(file) = File::open(&current_path) {
                        let reader = BufReader::with_capacity(512 * 1024, file);
                        if let Ok(source) = Decoder::new(reader) {
                            let rate = source.sample_rate();
                            let channels = source.channels();
                            thread_progress.sample_rate.store(rate, Ordering::Relaxed);
                            thread_progress.channels.store(channels as u32, Ordering::Relaxed);
                            thread_progress.samples_played.store(0, Ordering::Relaxed);
                            let timed_source = TimedSource { inner: source.convert_samples::<f32>(), samples_played: thread_progress.samples_played.clone() };
                            if let Ok(new_sink) = Sink::try_new(&stream_handle) { new_sink.append(timed_source); new_sink.set_volume(current_volume); new_sink.play(); current_sink = Some(new_sink); }
                        }
                    }
                }
                AudioCommand::Pause => { if let Some(sink) = &current_sink { sink.pause(); } }
                AudioCommand::Resume => { if let Some(sink) = &current_sink { sink.play(); } }
                AudioCommand::Seek(time, is_playing) => {
                    let jump_target = Duration::from_secs(time as u64);
                    if !current_path.is_empty() {
                        if let Some(sink) = &current_sink { sink.stop(); }
                        if let Ok(file) = File::open(&current_path) {
                            let reader = BufReader::with_capacity(512 * 1024, file);
                            if let Ok(source) = Decoder::new(reader) {
                                let rate = source.sample_rate();
                                let channels = source.channels();
                                let samples_to_skip = time as u64 * rate as u64 * channels as u64;
                                thread_progress.samples_played.store(samples_to_skip, Ordering::Relaxed);
                                let timed_source = TimedSource { inner: source.convert_samples::<f32>().skip_duration(jump_target), samples_played: thread_progress.samples_played.clone() };
                                if let Ok(new_sink) = Sink::try_new(&stream_handle) { 
                                    new_sink.set_volume(current_volume); 
                                    new_sink.append(timed_source); 
                                    if is_playing {
                                        new_sink.play(); 
                                    } else {
                                        new_sink.pause();
                                    }
                                    current_sink = Some(new_sink); 
                                }
                            }
                        }
                    }
                }
                AudioCommand::SetVolume(vol) => { current_volume = vol; if let Some(sink) = &current_sink { sink.set_volume(vol); } }
            }
        }
    });

    PlayerState { tx: Mutex::new(tx), progress: shared_progress, controls }
}

#[tauri::command]
pub fn play_audio(path: String, title: String, artist: String, album: String, cover: String, duration: u32, state: tauri::State<PlayerState>) -> Result<(), String> { 
    let tx = state.tx.lock().map_err(|e| e.to_string())?; 
    tx.send(AudioCommand::Play(path)).map_err(|e| e.to_string())?; 
    
    // Update Media Controls
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_metadata(MediaMetadata {
                title: Some(&title),
                artist: Some(&artist),
                album: Some(&album),
                cover_url: if cover.is_empty() { None } else { Some(&cover) }, 
                duration: if duration > 0 { Some(Duration::from_secs(duration as u64)) } else { None }, 
            });
            let _ = mc.set_playback(MediaPlayback::Playing { progress: Some(MediaPosition(Duration::from_secs(0))) });
        }
    }

    Ok(()) 
}

#[tauri::command]
pub fn pause_audio(state: tauri::State<PlayerState>) -> Result<(), String> { 
    let tx = state.tx.lock().map_err(|e| e.to_string())?; 
    tx.send(AudioCommand::Pause).map_err(|e| e.to_string())?; 
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_playback(MediaPlayback::Paused { progress: None });
        }
    }
    Ok(()) 
}

#[tauri::command]
pub fn resume_audio(state: tauri::State<PlayerState>) -> Result<(), String> { 
    let tx = state.tx.lock().map_err(|e| e.to_string())?; 
    tx.send(AudioCommand::Resume).map_err(|e| e.to_string())?; 
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
             let _ = mc.set_playback(MediaPlayback::Playing { progress: None });
        }
    }
    Ok(()) 
}

#[tauri::command]
pub fn seek_audio(time: u32, is_playing: bool, state: tauri::State<PlayerState>) -> Result<(), String> { 
    let tx = state.tx.lock().map_err(|e| e.to_string())?; 
    tx.send(AudioCommand::Seek(time, is_playing)).map_err(|e| e.to_string())?; 
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
             if is_playing {
                let _ = mc.set_playback(MediaPlayback::Playing { progress: Some(MediaPosition(Duration::from_secs(time as u64))) });
             } else {
                let _ = mc.set_playback(MediaPlayback::Paused { progress: Some(MediaPosition(Duration::from_secs(time as u64))) });
             }
        }
    }
    Ok(()) 
}

#[tauri::command]
pub fn set_volume(volume: f32, state: tauri::State<PlayerState>) -> Result<(), String> { let tx = state.tx.lock().map_err(|e| e.to_string())?; tx.send(AudioCommand::SetVolume(volume)).map_err(|e| e.to_string())?; Ok(()) }
#[tauri::command]
pub fn get_playback_progress(state: tauri::State<PlayerState>) -> f64 { let samples = state.progress.samples_played.load(Ordering::Relaxed); let rate = state.progress.sample_rate.load(Ordering::Relaxed); let channels = state.progress.channels.load(Ordering::Relaxed); if rate == 0 || channels == 0 { return 0.0; } let total_samples_per_sec = rate as u64 * channels as u64; samples as f64 / total_samples_per_sec as f64 }