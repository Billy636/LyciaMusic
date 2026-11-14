use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TextFormat {
    #[default]
    Auto,
    TitleArtist,
    ArtistTitle,
    Title,
}

impl TextFormat {
    fn is_auto(&self) -> bool {
        *self == Self::Auto
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceTrack {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub artists: Vec<String>,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_line: Option<String>,
    #[serde(default, skip_serializing_if = "TextFormat::is_auto")]
    pub text_format: TextFormat,
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
    #[serde(default, rename = "textFormat")]
    pub text_format: TextFormat,
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
    pub match_warnings: Vec<String>,
    pub source_type: String,
    pub source_name: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchFields {
    pub title: bool,
    #[serde(default)]
    pub artist: bool,
    #[serde(default)]
    pub album: bool,
    #[serde(default)]
    pub duration: bool,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMatch {
    pub candidates: Vec<Candidate>,
    pub selected_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_track: Option<SourceTrack>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_issue: Option<String>,
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
