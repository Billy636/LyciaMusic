use crate::database::migrations::run_migrations;
use crate::database::schema::{configure_connection, ensure_base_schema};
use rusqlite::Connection;
use std::fs;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

pub struct DbState {
    pub conn: Arc<Mutex<Connection>>,
}

impl DbState {
    pub fn new(app_handle: &AppHandle) -> Result<Self, String> {
        let app_dir = crate::data_storage::data_dir(app_handle);

        if !app_dir.exists() {
            fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
        }

        let db_path = app_dir.join("library.db");
        let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;

        configure_connection(&conn)?;
        ensure_base_schema(&conn)?;
        run_migrations(&conn)?;
        crate::playlist_import::ensure_schema(&conn)?;
        let storage = app_handle.state::<crate::data_storage::DataStorage>();
        if storage.needs_database_rebase {
            crate::data_storage::rebase_database(&mut conn, &storage.mappings)?;
            crate::data_storage::mark_database_rebased(app_handle)?;
        }
        crate::remote::repository::preserve_portable_credentials(&conn)?;

        Ok(DbState {
            conn: Arc::new(Mutex::new(conn)),
        })
    }
}
