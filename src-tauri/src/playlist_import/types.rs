use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceTrack {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artists: Vec<String>,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDocument {
    pub name: String,
    pub kind: String,
    pub source: String,
    pub tracks: Vec<SourceTrack>,
    pub total: usize,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PathMapping {
    pub from: String,
    pub to: String,
}

#[derive(Deserialize)]
pub struct SourceInput {
    pub kind: String,
    pub value: String,
    pub mapping: Option<PathMapping>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub path: String,
    pub title: String,
    pub artists: Vec<String>,
    pub album: String,
    pub duration: f64,
    pub score: f64,
    pub reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMatch {
    pub candidates: Vec<Candidate>,
    pub selected_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileBinding {
    pub id: String,
    pub path: String,
    pub revision: String,
    pub mapping: Option<PathMapping>,
}

#[derive(Deserialize)]
pub struct RetainedPlaylist {
    pub id: String,
    pub paths: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUpdate {
    pub id: String,
    pub revision: String,
    pub document: Option<SourceDocument>,
    pub playable_paths: Vec<String>,
    pub error: Option<String>,
}
