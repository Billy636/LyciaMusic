#![allow(dead_code)]

#[path = "../../../src-tauri/src/desktop_lyrics/model.rs"]
mod model;
#[path = "../../../src-tauri/src/desktop_lyrics/flow.rs"]
mod flow;
#[cfg(windows)]
#[path = "../../../src-tauri/src/desktop_lyrics/outline.rs"]
mod outline;
#[cfg(windows)]
#[path = "../../../src-tauri/src/desktop_lyrics/render.rs"]
mod render;
