use crate::player::ring_buffer::{spsc_ring_buffer, SpscConsumer, SpscProducer};
use rodio::{Decoder, Source};
use std::io::{BufReader, Read, Seek};
use std::sync::atomic::{AtomicBool, Ordering};
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

pub struct PrefetchConsumerSource {
    consumer: SpscConsumer<f32>,
    sample_rate: u32,
    channels: u16,
    stop_flag: Arc<AtomicBool>,
    eof_flag: Arc<AtomicBool>,
    worker_is_parked: Arc<AtomicBool>,
    worker_thread: Thread,
    _join_handle: Option<JoinHandle<()>>,
}

impl PrefetchConsumerSource {
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
        match self.consumer.pop() {
            Some(sample) => {
                // When buffer falls below half and the worker is parked, wake it up
                if self.consumer.available_read() < self.consumer.capacity() / 2 {
                    if self.worker_is_parked.load(Ordering::Relaxed) {
                        self.worker_is_parked.store(false, Ordering::Relaxed);
                        self.worker_thread.unpark();
                    }
                }
                Some(sample)
            }
            None => {
                if self.eof_flag.load(Ordering::Acquire) {
                    // Fully reached end of stream and ring buffer drained
                    None
                } else {
                    // Buffer underrun (extreme I/O or decoding delay).
                    // Wake worker immediately and output silence concealment
                    // rather than tearing down the audio sink.
                    self.worker_is_parked.store(false, Ordering::Relaxed);
                    self.worker_thread.unpark();
                    Some(0.0)
                }
            }
        }
    }
}

impl Source for PrefetchConsumerSource {
    #[inline]
    fn current_frame_len(&self) -> Option<usize> {
        let avail = self.consumer.available_read();
        if avail > 0 {
            Some(avail)
        } else if self.eof_flag.load(Ordering::Acquire) {
            Some(0)
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
    let buf_reader = BufReader::with_capacity(512 * 1024, reader);
    let decoder = Decoder::new(buf_reader).map_err(|e| format!("Failed to create decoder: {e}"))?;
    let sample_rate = decoder.sample_rate();

    let offset = start_offset.unwrap_or(Duration::ZERO);
    let skipped = decoder.convert_samples::<f32>().skip_duration(offset);
    let mut source_chain: Box<dyn Source<Item = f32> + Send> = Box::new(skipped);

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
            run_decoder_worker(source_chain, producer, worker_stop, worker_eof, worker_parked);
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
    })
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
    use std::io::Cursor;

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
        buf.extend_from_slice(&1u16.to_le_bytes());  // audio format (1 for PCM)
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

        let mut source = create_prefetch_source(
            cursor,
            None,
            Duration::ZERO,
            None,
        )
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

        let mut source = create_prefetch_source(
            cursor,
            None,
            Duration::ZERO,
            None,
        )
        .expect("should create prefetch source");

        // Read a few samples and drop immediately
        for _ in 0..100 {
            assert!(source.next().is_some());
        }

        drop(source); // should signal worker stop and not hang
    }
}
