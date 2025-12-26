use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use std::fs;

pub struct DbState {
    pub conn: Arc<Mutex<Connection>>,
}

impl DbState {
    pub fn new(app_handle: &AppHandle) -> Result<Self, String> {
        let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
        
        if !app_dir.exists() {
            fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
        }

        let db_path = app_dir.join("library.db");
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS songs (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                title TEXT,
                artist TEXT,
                album TEXT,
                duration INTEGER,
                cover_path TEXT
            )",
            [],
        ).map_err(|e| e.to_string())?;

        Ok(DbState {
            conn: Arc::new(Mutex::new(conn)),
        })
    }
}
