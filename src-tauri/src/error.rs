use serde::Serialize;
use std::io;

#[derive(Debug, Serialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
        }
    }
}

impl From<io::Error> for CommandError {
    fn from(err: io::Error) -> Self {
        Self {
            code: "IO_ERROR".to_string(),
            message: err.to_string(),
        }
    }
}

impl From<String> for CommandError {
    fn from(err: String) -> Self {
        Self {
            code: "UNKNOWN_ERROR".to_string(),
            message: err,
        }
    }
}
