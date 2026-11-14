export interface DuplicateSong {
  path: string;
  name: string;
  title: string;
  artist: string;
  album: string;
  /** Audio duration in seconds. */
  duration: number;
  format: string;
  codec?: string;
  /** Audio bitrate in kbps; 0 when unavailable. */
  bitrate: number;
  sample_rate: number;
  bit_depth: number;
  file_size: number;
  /** Last modification time captured during scanning, in Unix milliseconds. */
  modified_at_ms?: number | null;
}

export interface DuplicateScanResult {
  songs: DuplicateSong[];
  /** Unique supported files inspected, including files that could not be read. */
  scanned_count: number;
  skipped_count: number;
  warnings: string[];
}

export interface DuplicateDeleteFile {
  path: string;
  expected_size: number;
  expected_modified_at_ms?: number | null;
}

export interface DuplicateDeleteGroup {
  delete_files: DuplicateDeleteFile[];
  retained_files: DuplicateDeleteFile[];
}

export interface DuplicateDeleteResult {
  deleted_paths: string[];
  missing_paths: string[];
  failures: Array<{ path: string; reason: string }>;
  warnings: string[];
}
