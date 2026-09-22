use crate::player::ring_buffer::{spsc_ring_buffer, SpscConsumer, SpscProducer};
use rodio::{Decoder, Source};
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle, Thread};
use std::time::Duration;

/// Default buffer capacity in samples: 131,072 samples.
/// At 44.1kHz stereo, 131,072 samples = 65,536 frames ≈ 1.48 seconds of pre-decoded PCM audio.
/// At 48kHz stereo, 131,072 samples = 65,536 frames ≈ 1.36 seconds of pre-decoded PCM audio.
/// Memory overhead: 131,072 * 4 bytes ≈ 512 KB.
pub const DEFAULT_PREFETCH_BUFFER_CAPACITY: usize = 131_072;
const DECODER_CHUNK_SIZE: usize = 1024;
const INITIAL_PREFETCH_TARGET_FRAMES: usize = 4096; // ~85ms at 48kHz stereo
const STEREO_FRAME_SAMPLES: usize = 2;

pub struct PrefetchConsumerSource {
    consumer: SpscConsumer<f32>,
    sample_rate: u32,
    channels: u16,
    stop_flag: Arc<AtomicBool>,
    eof_flag: Arc<AtomicBool>,
    worker_is_parked: Arc<AtomicBool>,
    worker_thread: Thread,
    _join_handle: Option<JoinHandle<()>>,
    pending_frame: [f32; STEREO_FRAME_SAMPLES],
    next_frame_sample: usize,
    pending_media_samples: usize,
    media_progress: Option<Arc<AtomicU64>>,
}

impl PrefetchConsumerSource {
    /// Count decoded PCM only, preserving the caller's initial/seek offset.
    pub fn with_progress(mut self, progress: Arc<AtomicU64>) -> Self {
        self.media_progress = Some(progress);
        self
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    #[inline]
    #[allow(dead_code)]
    pub fn is_eof(&self) -> bool {
        self.eof_flag.load(Ordering::Acquire)
    }

    #[inline]
    #[allow(dead_code)]
    pub fn available_samples(&self) -> usize {
        self.consumer.available_read()
            + self
                .pending_media_samples
                .saturating_sub(self.next_frame_sample)
    }

    /// `eof` must be acquired before looking at the ring: observing EOF makes
    /// every preceding worker publication visible to this final buffer read.
    #[inline]
    fn refill_frame(&mut self, eof: bool) -> bool {
        let available = self.consumer.available_read();
        if available >= STEREO_FRAME_SAMPLES || (eof && available > 0) {
            self.pending_frame.fill(0.0);
            self.pending_media_samples = self.consumer.pop_slice(&mut self.pending_frame);

            // When buffer falls below half and the worker is parked, wake it up.
            if self.consumer.available_read() < self.consumer.capacity() / 2
                && self.worker_is_parked.load(Ordering::Relaxed)
            {
                self.worker_is_parked.store(false, Ordering::Relaxed);
                self.worker_thread.unpark();
            }
        } else if eof {
            return false;
        } else {
            // Conceal underruns for a complete stereo frame. In particular, a
            // worker publication between L/R must not move the next L to R.
            self.pending_frame.fill(0.0);
            self.pending_media_samples = 0;
            self.worker_is_parked.store(false, Ordering::Relaxed);
            self.worker_thread.unpark();
        }
        self.next_frame_sample = 0;
        true
    }
}

impl Drop for PrefetchConsumerSource {
    fn drop(&mut self) {
        self.stop_flag.store(true, Ordering::Release);
        self.worker_is_parked.store(false, Ordering::Release);
        self.worker_thread.unpark();
    }
}

impl Iterator for PrefetchConsumerSource {
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        if self.next_frame_sample == STEREO_FRAME_SAMPLES {
            // Read EOF first, then recheck the ring. Reading an empty ring
            // before EOF could miss the final chunk published between them.
            let eof = self.eof_flag.load(Ordering::Acquire);
            if !self.refill_frame(eof) {
                return None;
            }
        }

        let index = self.next_frame_sample;
        self.next_frame_sample += 1;
        if index < self.pending_media_samples {
            if let Some(progress) = &self.media_progress {
                progress.fetch_add(1, Ordering::Relaxed);
            }
        }
        Some(self.pending_frame[index])
    }
}

impl Source for PrefetchConsumerSource {
    #[inline]
    fn current_frame_len(&self) -> Option<usize> {
        // This ordering also prevents a stale empty-ring read plus a new EOF
        // from reporting the stream as finished while final PCM is buffered.
        let eof = self.eof_flag.load(Ordering::Acquire);
        let available = self.consumer.available_read();
        let pending = STEREO_FRAME_SAMPLES - self.next_frame_sample;
        let buffered = if eof {
            // A truncated final frame is padded, but only real PCM is timed.
            available.div_ceil(STEREO_FRAME_SAMPLES) * STEREO_FRAME_SAMPLES
        } else {
            available / STEREO_FRAME_SAMPLES * STEREO_FRAME_SAMPLES
        };
        if pending + buffered > 0 || eof {
            Some(pending + buffered)
        } else {
            None
        }
    }

    #[inline]
    fn channels(&self) -> u16 {
        self.channels
    }

    #[inline]
    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    #[inline]
    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

pub fn create_prefetch_source<R>(
    reader: R,
    start_offset: Option<Duration>,
    cue_start_offset: Duration,
    total_duration: Option<Duration>,
) -> Result<PrefetchConsumerSource, String>
where
    R: Read + Seek + Send + Sync + 'static,
{
    let offset = start_offset.unwrap_or(Duration::ZERO);

    let (mut source_chain, sample_rate): (Box<dyn Source<Item = f32> + Send>, u32) = {
        let mut reader = reader;
        let mut is_id3_prefixed_m4a = false;
        let mut m4a_offset = 0;

        let mut head = [0u8; 16];
        if reader.seek(SeekFrom::Start(0)).is_ok() && reader.read_exact(&mut head).is_ok() {
            if &head[..3] == b"ID3" {
                if let Ok(offset) = crate::music::tags::find_ftyp_offset(&mut reader) {
                    if offset > 0 {
                        is_id3_prefixed_m4a = true;
                        m4a_offset = offset;
                    }
                }
            }
        }
        let _ = reader.seek(SeekFrom::Start(0));

        fn prepare_source<S: Read + Seek + Send + Sync + 'static>(
            mut decoder: Decoder<BufReader<S>>,
            offset: Duration,
        ) -> (Box<dyn Source<Item = f32> + Send>, u32) {
            let rate = decoder.sample_rate();
            let source: Box<dyn Source<Item = f32> + Send> = if offset.is_zero() {
                Box::new(decoder.convert_samples::<f32>())
            } else {
                match decoder.try_seek(offset) {
                    Ok(()) => Box::new(decoder.convert_samples::<f32>()),
                    Err(err) => {
                        eprintln!(
                            "Decoder try_seek to {:?} failed ({err:?}), falling back to linear skip_duration",
                            offset
                        );
                        Box::new(decoder.convert_samples::<f32>().skip_duration(offset))
                    }
                }
            };
            (source, rate)
        }

        if is_id3_prefixed_m4a {
            let offset_reader = crate::music::tags::OffsetReader::new(reader, m4a_offset);
            let buf_reader = BufReader::with_capacity(512 * 1024, offset_reader);
            let decoder =
                Decoder::new(buf_reader).map_err(|e| format!("Failed to create decoder: {e}"))?;
            prepare_source(decoder, offset)
        } else {
            let buf_reader = BufReader::with_capacity(512 * 1024, reader);
            let decoder =
                Decoder::new(buf_reader).map_err(|e| format!("Failed to create decoder: {e}"))?;
            prepare_source(decoder, offset)
        }
    };

    if let Some(tot_dur) = total_duration {
        let resume_time = offset.saturating_sub(cue_start_offset);
        let remaining = tot_dur.saturating_sub(resume_time);
        source_chain = Box::new(source_chain.take_duration(remaining));
    }

    source_chain = crate::player::downmix::into_stereo(source_chain);
    let channels = source_chain.channels(); // always 2 (stereo downmixed)

    let (producer, consumer) = spsc_ring_buffer::<f32>(DEFAULT_PREFETCH_BUFFER_CAPACITY);
    let stop_flag = Arc::new(AtomicBool::new(false));
    let eof_flag = Arc::new(AtomicBool::new(false));
    let worker_is_parked = Arc::new(AtomicBool::new(false));

    let worker_stop = stop_flag.clone();
    let worker_eof = eof_flag.clone();
    let worker_parked = worker_is_parked.clone();

    let join_handle = thread::Builder::new()
        .name("lycia-audio-decoder".into())
        .spawn(move || {
            run_decoder_worker(
                source_chain,
                producer,
                worker_stop,
                worker_eof,
                worker_parked,
            );
        })
        .map_err(|e| format!("Failed to spawn decoder worker thread: {e}"))?;

    let worker_thread = join_handle.thread().clone();

    // Initial prefetch burst: wait briefly (~up to 50ms) to prime the ring buffer
    // with at least INITIAL_PREFETCH_TARGET_FRAMES samples so start of playback is instantaneous.
    let target_prime_samples = (INITIAL_PREFETCH_TARGET_FRAMES * channels as usize)
        .min(DEFAULT_PREFETCH_BUFFER_CAPACITY / 4);
    let prime_deadline = std::time::Instant::now() + Duration::from_millis(50);
    while consumer.available_read() < target_prime_samples
        && !eof_flag.load(Ordering::Relaxed)
        && !stop_flag.load(Ordering::Relaxed)
    {
        if std::time::Instant::now() >= prime_deadline {
            break;
        }
        thread::yield_now();
    }

    Ok(PrefetchConsumerSource {
        consumer,
        sample_rate,
        channels,
        stop_flag,
        eof_flag,
        worker_is_parked,
        worker_thread,
        _join_handle: Some(join_handle),
        pending_frame: [0.0; STEREO_FRAME_SAMPLES],
        next_frame_sample: STEREO_FRAME_SAMPLES,
        pending_media_samples: 0,
        media_progress: None,
    })
}

#[cfg(test)]
pub(crate) fn test_prefetch_source() -> (SpscProducer<f32>, PrefetchConsumerSource, Arc<AtomicBool>)
{
    let (producer, consumer) = spsc_ring_buffer::<f32>(64);
    let eof_flag = Arc::new(AtomicBool::new(false));
    let source = PrefetchConsumerSource {
        consumer,
        sample_rate: 44_100,
        channels: STEREO_FRAME_SAMPLES as u16,
        stop_flag: Arc::new(AtomicBool::new(false)),
        eof_flag: eof_flag.clone(),
        worker_is_parked: Arc::new(AtomicBool::new(false)),
        worker_thread: thread::current(),
        _join_handle: None,
        pending_frame: [0.0; STEREO_FRAME_SAMPLES],
        next_frame_sample: STEREO_FRAME_SAMPLES,
        pending_media_samples: 0,
        media_progress: None,
    };
    (producer, source, eof_flag)
}

fn run_decoder_worker(
    mut source: Box<dyn Source<Item = f32> + Send>,
    producer: SpscProducer<f32>,
    stop_flag: Arc<AtomicBool>,
    eof_flag: Arc<AtomicBool>,
    worker_is_parked: Arc<AtomicBool>,
) {
    let mut chunk = [0.0f32; DECODER_CHUNK_SIZE];

    loop {
        if stop_flag.load(Ordering::Relaxed) {
            break;
        }

        let avail_write = producer.available_write();
        if avail_write < DECODER_CHUNK_SIZE {
            // Buffer is sufficiently full, park briefly
            worker_is_parked.store(true, Ordering::Release);
            thread::park_timeout(Duration::from_millis(15));
            worker_is_parked.store(false, Ordering::Release);
            continue;
        }

        // Decode into chunk
        let mut count = 0;
        let mut is_eof = false;

        for sample in chunk.iter_mut() {
            match source.next() {
                Some(val) => {
                    *sample = val;
                    count += 1;
                }
                None => {
                    is_eof = true;
                    break;
                }
            }
        }

        if count > 0 {
            let written = producer.push_slice(&chunk[..count]);
            // If somehow not all written (should not happen since we checked avail_write), handle gracefully
            if written < count {
                let mut retry = written;
                while retry < count && !stop_flag.load(Ordering::Relaxed) {
                    let w = producer.push_slice(&chunk[retry..count]);
                    retry += w;
                    if w == 0 {
                        thread::park_timeout(Duration::from_millis(5));
                    }
                }
            }
        }

        if is_eof {
            eof_flag.store(true, Ordering::Release);
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::player::types::{SharedVisualizer, TimedSource};
    use std::io::Cursor;
    use std::sync::Barrier;

    #[test]
    fn underrun_completes_silent_frame_before_resuming_stereo_at_eof() {
        let (producer, mut source, eof) = test_prefetch_source();
        assert_eq!(source.current_frame_len(), None);
        assert_eq!(source.next(), Some(0.0));
        assert_eq!(source.current_frame_len(), Some(1));

        // The last chunk arrives between the synthetic L and R samples.
        assert_eq!(producer.push_slice(&[1.0, 10.0, 2.0, 20.0]), 4);
        eof.store(true, Ordering::Release);
        assert_eq!(source.current_frame_len(), Some(5));
        assert_eq!(source.available_samples(), 4);
        assert_eq!(source.next(), Some(0.0));
        assert_eq!(source.by_ref().collect::<Vec<_>>(), [1.0, 10.0, 2.0, 20.0]);
        assert_eq!(source.current_frame_len(), Some(0));
    }

    #[test]
    fn incomplete_stereo_frame_waits_for_its_matching_channel() {
        let (producer, mut source, eof) = test_prefetch_source();
        assert!(producer.push(1.0));
        assert_eq!(source.next(), Some(0.0));
        assert_eq!(source.available_samples(), 1);

        assert!(producer.push(10.0));
        assert_eq!(source.next(), Some(0.0));
        assert_eq!(source.next(), Some(1.0));
        assert_eq!(source.next(), Some(10.0));
        eof.store(true, Ordering::Release);
        assert_eq!(source.next(), None);
    }

    #[test]
    fn last_chunk_published_after_eof_snapshot_is_drained() {
        let (producer, mut source, eof) = test_prefetch_source();
        assert_eq!(source.consumer.available_read(), 0);

        // Deterministically publish at the critical boundary: after the
        // consumer snapshots EOF, but before it inspects/reads the ring.
        let eof_snapshot = source.eof_flag.load(Ordering::Acquire);
        assert!(!eof_snapshot);
        assert_eq!(producer.push_slice(&[1.0, 10.0, 2.0, 20.0]), 4);
        eof.store(true, Ordering::Release);

        assert!(source.refill_frame(eof_snapshot));
        assert_eq!(source.current_frame_len(), Some(4));
        assert_eq!(source.by_ref().collect::<Vec<_>>(), [1.0, 10.0, 2.0, 20.0]);
        assert_eq!(source.available_samples(), 0);
        assert_eq!(source.current_frame_len(), Some(0));
    }

    #[test]
    fn pending_pcm_is_timed_when_returned_not_when_prefetched() {
        let (producer, source, eof) = test_prefetch_source();
        let progress = Arc::new(AtomicU64::new(88_200));
        let mut source = source.with_progress(progress.clone());
        assert_eq!(producer.push_slice(&[0.25, -0.5]), 2);
        eof.store(true, Ordering::Release);

        assert_eq!(source.next(), Some(0.25));
        assert_eq!(progress.load(Ordering::Relaxed), 88_201);
        assert_eq!(source.available_samples(), 1);
        assert_eq!(source.current_frame_len(), Some(1));
        assert_eq!(source.next(), Some(-0.5));
        assert_eq!(progress.load(Ordering::Relaxed), 88_202);
        assert_eq!(source.next(), None);
    }

    #[test]
    fn final_partial_frame_padding_does_not_advance_media_progress() {
        let (producer, source, eof) = test_prefetch_source();
        let progress = Arc::new(AtomicU64::new(42));
        let mut source = source.with_progress(progress.clone());
        assert!(producer.push(0.5));
        eof.store(true, Ordering::Release);

        assert_eq!(source.current_frame_len(), Some(2));
        assert_eq!(source.next(), Some(0.5));
        assert_eq!(progress.load(Ordering::Relaxed), 43);
        assert_eq!(source.available_samples(), 0);
        assert_eq!(source.current_frame_len(), Some(1));
        assert_eq!(source.next(), Some(0.0));
        assert_eq!(progress.load(Ordering::Relaxed), 43);
        assert_eq!(source.next(), None);
    }

    #[test]
    fn timed_source_counts_real_silence_but_not_underrun_with_visualizer_disabled() {
        let (producer, source, eof) = test_prefetch_source();
        let progress = Arc::new(AtomicU64::new(88_200));
        let visualizer = Arc::new(SharedVisualizer::new());
        let mut source =
            TimedSource::new(source.with_progress(progress.clone()), visualizer.clone());
        assert!(!visualizer.is_enabled());

        assert_eq!(source.next(), Some(0.0));
        assert_eq!(progress.load(Ordering::Relaxed), 88_200);
        assert_eq!(producer.push_slice(&[0.0, 0.0, 0.25, -0.5]), 4);
        assert_eq!(source.next(), Some(0.0)); // Complete the underrun frame.
        assert_eq!(progress.load(Ordering::Relaxed), 88_200);

        // Actual decoded silence must advance media time despite matching the
        // value used for concealment; disabling visualization must not stop it.
        assert_eq!(source.next(), Some(0.0));
        assert_eq!(progress.load(Ordering::Relaxed), 88_201);
        assert_eq!(source.next(), Some(0.0));
        assert_eq!(progress.load(Ordering::Relaxed), 88_202);
        assert_eq!(visualizer.cursor.load(Ordering::Relaxed), 0);

        visualizer.set_enabled(true);
        assert_eq!(source.next(), Some(0.25));
        assert_eq!(source.next(), Some(-0.5));
        assert_eq!(progress.load(Ordering::Relaxed), 88_204);
        assert_eq!(visualizer.cursor.load(Ordering::Relaxed), 1);
        eof.store(true, Ordering::Release);
        assert_eq!(source.next(), None);
    }

    #[test]
    fn prolonged_underrun_preserves_media_position_and_resumes_in_stereo() {
        let (producer, source, eof) = test_prefetch_source();
        let progress = Arc::new(AtomicU64::new(88_200));
        let mut source = source.with_progress(progress.clone());

        // Two seconds of stereo output without media, with no wall-clock wait.
        for _ in 0..44_100 * 2 * STEREO_FRAME_SAMPLES {
            assert_eq!(source.next(), Some(0.0));
        }
        assert_eq!(progress.load(Ordering::Relaxed), 88_200);
        assert_eq!(source.available_samples(), 0);
        assert_eq!(source.current_frame_len(), None);

        assert_eq!(producer.push_slice(&[0.25, -0.5, 0.75, -1.0]), 4);
        eof.store(true, Ordering::Release);
        assert_eq!(
            source.by_ref().collect::<Vec<_>>(),
            [0.25, -0.5, 0.75, -1.0]
        );
        assert_eq!(progress.load(Ordering::Relaxed), 88_204);
        assert_eq!(source.current_frame_len(), Some(0));
    }

    #[test]
    fn concurrent_short_streams_preserve_final_pcm_and_stereo_frames() {
        for _ in 0..256 {
            let (producer, source, eof) = test_prefetch_source();
            let progress = Arc::new(AtomicU64::new(0));
            let mut source = source.with_progress(progress.clone());
            let start = Arc::new(Barrier::new(2));
            let worker_start = start.clone();
            let expected = vec![1.0, 10.0, 2.0, 20.0, 3.0, 30.0];
            let pcm = expected.clone();
            let worker = thread::spawn(move || {
                worker_start.wait();
                for chunk in pcm.chunks(STEREO_FRAME_SAMPLES) {
                    assert_eq!(producer.push_slice(chunk), chunk.len());
                    thread::yield_now();
                }
                eof.store(true, Ordering::Release);
            });

            start.wait();
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            let mut actual = Vec::new();
            while let Some(left) = source.next() {
                let right = source.next().expect("every output frame must be complete");
                if left != 0.0 || right != 0.0 {
                    actual.extend_from_slice(&[left, right]);
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "source must reach EOF"
                );
            }
            worker.join().unwrap();
            assert_eq!(actual, expected);
            assert_eq!(progress.load(Ordering::Relaxed), expected.len() as u64);
            assert_eq!(source.current_frame_len(), Some(0));
        }
    }

    // Helper: generate a valid minimal 44.1kHz mono WAV file in memory
    fn generate_wav_bytes(num_samples: usize) -> Vec<u8> {
        let sample_rate: u32 = 44100;
        let channels: u16 = 1;
        let bits_per_sample: u16 = 16;
        let byte_rate = sample_rate * channels as u32 * (bits_per_sample / 8) as u32;
        let block_align = channels * (bits_per_sample / 8);
        let data_size = (num_samples * (bits_per_sample / 8) as usize) as u32;

        let mut buf = Vec::with_capacity(44 + data_size as usize);
        buf.extend_from_slice(b"RIFF");
        buf.extend_from_slice(&(36 + data_size).to_le_bytes());
        buf.extend_from_slice(b"WAVEfmt ");
        buf.extend_from_slice(&16u32.to_le_bytes()); // subchunk1 size (16 for PCM)
        buf.extend_from_slice(&1u16.to_le_bytes()); // audio format (1 for PCM)
        buf.extend_from_slice(&channels.to_le_bytes());
        buf.extend_from_slice(&sample_rate.to_le_bytes());
        buf.extend_from_slice(&byte_rate.to_le_bytes());
        buf.extend_from_slice(&block_align.to_le_bytes());
        buf.extend_from_slice(&bits_per_sample.to_le_bytes());
        buf.extend_from_slice(b"data");
        buf.extend_from_slice(&data_size.to_le_bytes());

        for i in 0..num_samples {
            let val = ((i % 100) as f32 / 100.0 * i16::MAX as f32) as i16;
            buf.extend_from_slice(&val.to_le_bytes());
        }

        buf
    }

    #[test]
    fn test_prefetch_source_reads_all_samples() {
        let sample_count = 10_000;
        let wav = generate_wav_bytes(sample_count);
        let cursor = Cursor::new(wav);

        let mut source = create_prefetch_source(cursor, None, Duration::ZERO, None)
            .expect("should create prefetch source");

        assert_eq!(source.sample_rate(), 44100);
        assert_eq!(source.channels(), 2); // Downmixed to stereo

        // Wait until decoder worker finishes reading all packets into the ring buffer
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while !source.is_eof() && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(2));
        }
        assert!(source.is_eof(), "decoder worker should reach EOF");

        let mut total_samples = 0;
        while let Some(_) = source.next() {
            total_samples += 1;
        }

        // Mono duplicated to stereo -> 10,000 * 2 = 20,000 samples
        assert_eq!(total_samples, sample_count * 2);
    }

    #[test]
    fn test_prefetch_source_drop_cancels_worker() {
        let sample_count = 500_000;
        let wav = generate_wav_bytes(sample_count);
        let cursor = Cursor::new(wav);

        let mut source = create_prefetch_source(cursor, None, Duration::ZERO, None)
            .expect("should create prefetch source");

        // Read a few samples and drop immediately
        for _ in 0..100 {
            assert!(source.next().is_some());
        }

        drop(source); // should signal worker stop and not hang
    }

    #[test]
    fn test_prefetch_source_with_seek_offset() {
        let sample_count = 44_100; // 1 second of mono audio at 44.1kHz
        let wav = generate_wav_bytes(sample_count);
        let cursor = Cursor::new(wav);

        // Seek to 0.5s (offset of 500ms)
        let mut source = create_prefetch_source(
            cursor,
            Some(Duration::from_millis(500)),
            Duration::ZERO,
            None,
        )
        .expect("should create prefetch source with offset");

        assert_eq!(source.sample_rate(), 44100);
        assert_eq!(source.channels(), 2);

        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while !source.is_eof() && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(2));
        }
        assert!(source.is_eof(), "decoder worker should reach EOF");

        let mut total_samples = 0;
        while let Some(_) = source.next() {
            total_samples += 1;
        }

        // 0.5s of stereo audio = 44100 * 0.5 * 2 = 44100 samples
        // Allow a small tolerance for block-based decoder alignment
        let expected_samples = (sample_count as f64 * 0.5 * 2.0).round() as usize;
        let diff = (total_samples as isize - expected_samples as isize).abs();
        assert!(
            diff < 200,
            "Expected around {expected_samples} samples, got {total_samples} (diff {diff})"
        );
    }
}
