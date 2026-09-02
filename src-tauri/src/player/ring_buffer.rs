use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[repr(align(64))]
struct PaddedAtomicUsize(AtomicUsize);

impl PaddedAtomicUsize {
    fn new(val: usize) -> Self {
        Self(AtomicUsize::new(val))
    }
}

pub struct SpscRingBuffer<T> {
    buffer: Box<[UnsafeCell<T>]>,
    capacity: usize,
    mask: usize,
    head: PaddedAtomicUsize, // Written by Producer, read by Consumer
    tail: PaddedAtomicUsize, // Written by Consumer, read by Producer
}

// Safety: Producer and Consumer access disjoint indices at any given moment.
unsafe impl<T: Send> Send for SpscRingBuffer<T> {}
unsafe impl<T: Send> Sync for SpscRingBuffer<T> {}

pub struct SpscProducer<T> {
    ring: Arc<SpscRingBuffer<T>>,
}

pub struct SpscConsumer<T> {
    ring: Arc<SpscRingBuffer<T>>,
}

unsafe impl<T: Send> Send for SpscProducer<T> {}
unsafe impl<T: Send> Send for SpscConsumer<T> {}

/// Creates an SPSC (Single-Producer Single-Consumer) lock-free ring buffer.
/// `capacity` will be rounded up to the next power of two (minimum 64).
pub fn spsc_ring_buffer<T: Copy + Default + Send + 'static>(
    capacity: usize,
) -> (SpscProducer<T>, SpscConsumer<T>) {
    let actual_capacity = capacity.max(64).next_power_of_two();
    let mut vec = Vec::with_capacity(actual_capacity);
    for _ in 0..actual_capacity {
        vec.push(UnsafeCell::new(T::default()));
    }

    let ring = Arc::new(SpscRingBuffer {
        buffer: vec.into_boxed_slice(),
        capacity: actual_capacity,
        mask: actual_capacity - 1,
        head: PaddedAtomicUsize::new(0),
        tail: PaddedAtomicUsize::new(0),
    });

    (
        SpscProducer { ring: ring.clone() },
        SpscConsumer { ring },
    )
}

impl<T: Copy + Default + Send + 'static> SpscProducer<T> {
    #[inline]
    pub fn capacity(&self) -> usize {
        self.ring.capacity
    }

    #[inline]
    pub fn available_write(&self) -> usize {
        let head = self.ring.head.0.load(Ordering::Relaxed);
        let tail = self.ring.tail.0.load(Ordering::Acquire);
        self.ring.capacity.saturating_sub(head.wrapping_sub(tail))
    }

    #[inline]
    pub fn push(&self, item: T) -> bool {
        let head = self.ring.head.0.load(Ordering::Relaxed);
        let tail = self.ring.tail.0.load(Ordering::Acquire);

        if head.wrapping_sub(tail) >= self.ring.capacity {
            return false;
        }

        let idx = head & self.ring.mask;
        unsafe {
            *self.ring.buffer[idx].get() = item;
        }
        self.ring.head.0.store(head.wrapping_add(1), Ordering::Release);
        true
    }

    pub fn push_slice(&self, slice: &[T]) -> usize {
        if slice.is_empty() {
            return 0;
        }

        let head = self.ring.head.0.load(Ordering::Relaxed);
        let tail = self.ring.tail.0.load(Ordering::Acquire);
        let occupied = head.wrapping_sub(tail);
        let available = self.ring.capacity.saturating_sub(occupied);
        let to_write = slice.len().min(available);

        if to_write == 0 {
            return 0;
        }

        let start_idx = head & self.ring.mask;
        let first_chunk = to_write.min(self.ring.capacity - start_idx);
        let second_chunk = to_write - first_chunk;

        unsafe {
            let buffer_ptr = self.ring.buffer.as_ptr() as *mut T;
            std::ptr::copy_nonoverlapping(
                slice.as_ptr(),
                buffer_ptr.add(start_idx),
                first_chunk,
            );
            if second_chunk > 0 {
                std::ptr::copy_nonoverlapping(
                    slice.as_ptr().add(first_chunk),
                    buffer_ptr,
                    second_chunk,
                );
            }
        }

        self.ring.head.0.store(head.wrapping_add(to_write), Ordering::Release);
        to_write
    }
}

impl<T: Copy + Default + Send + 'static> SpscConsumer<T> {
    #[inline]
    pub fn capacity(&self) -> usize {
        self.ring.capacity
    }

    #[inline]
    pub fn available_read(&self) -> usize {
        let tail = self.ring.tail.0.load(Ordering::Relaxed);
        let head = self.ring.head.0.load(Ordering::Acquire);
        head.wrapping_sub(tail)
    }

    #[inline]
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.available_read() == 0
    }

    #[inline]
    pub fn pop(&self) -> Option<T> {
        let tail = self.ring.tail.0.load(Ordering::Relaxed);
        let head = self.ring.head.0.load(Ordering::Acquire);

        if tail == head {
            return None;
        }

        let idx = tail & self.ring.mask;
        let item = unsafe { *self.ring.buffer[idx].get() };
        self.ring.tail.0.store(tail.wrapping_add(1), Ordering::Release);
        Some(item)
    }

    pub fn pop_slice(&self, slice: &mut [T]) -> usize {
        if slice.is_empty() {
            return 0;
        }

        let tail = self.ring.tail.0.load(Ordering::Relaxed);
        let head = self.ring.head.0.load(Ordering::Acquire);
        let available = head.wrapping_sub(tail);
        let to_read = slice.len().min(available);

        if to_read == 0 {
            return 0;
        }

        let start_idx = tail & self.ring.mask;
        let first_chunk = to_read.min(self.ring.capacity - start_idx);
        let second_chunk = to_read - first_chunk;

        unsafe {
            let buffer_ptr = self.ring.buffer.as_ptr() as *const T;
            std::ptr::copy_nonoverlapping(
                buffer_ptr.add(start_idx),
                slice.as_mut_ptr(),
                first_chunk,
            );
            if second_chunk > 0 {
                std::ptr::copy_nonoverlapping(
                    buffer_ptr,
                    slice.as_mut_ptr().add(first_chunk),
                    second_chunk,
                );
            }
        }

        self.ring.tail.0.store(tail.wrapping_add(to_read), Ordering::Release);
        to_read
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_spsc_basic_push_pop() {
        let (producer, consumer) = spsc_ring_buffer::<f32>(64);
        assert_eq!(producer.capacity(), 64);
        assert_eq!(consumer.available_read(), 0);
        assert_eq!(producer.available_write(), 64);

        assert!(producer.push(1.0));
        assert!(producer.push(2.0));
        assert!(producer.push(3.0));

        assert_eq!(consumer.available_read(), 3);
        assert_eq!(consumer.pop(), Some(1.0));
        assert_eq!(consumer.pop(), Some(2.0));
        assert_eq!(consumer.pop(), Some(3.0));
        assert_eq!(consumer.pop(), None);
    }

    #[test]
    fn test_spsc_slice_operations_and_wraparound() {
        let (producer, consumer) = spsc_ring_buffer::<f32>(64);

        // Fill 60 elements
        let input: Vec<f32> = (0..60).map(|i| i as f32).collect();
        let written = producer.push_slice(&input);
        assert_eq!(written, 60);

        // Pop 40 elements
        let mut out = vec![0.0f32; 40];
        let read = consumer.pop_slice(&mut out);
        assert_eq!(read, 40);
        for i in 0..40 {
            assert_eq!(out[i], i as f32);
        }

        // Now write 40 more elements which will wrap around the 64-element boundary
        let input2: Vec<f32> = (100..140).map(|i| i as f32).collect();
        let written2 = producer.push_slice(&input2);
        assert_eq!(written2, 40);

        // Read remaining 20 + 40 = 60 elements
        let mut out2 = vec![0.0f32; 60];
        let read2 = consumer.pop_slice(&mut out2);
        assert_eq!(read2, 60);
        for i in 0..20 {
            assert_eq!(out2[i], (40 + i) as f32);
        }
        for i in 0..40 {
            assert_eq!(out2[20 + i], (100 + i) as f32);
        }
    }

    #[test]
    fn test_spsc_multithreaded_stress() {
        let (producer, consumer) = spsc_ring_buffer::<f32>(128);
        const TOTAL: usize = 100_000;

        let prod_handle = thread::spawn(move || {
            let mut chunk = [0.0f32; 64];
            let mut current = 0;
            while current < TOTAL {
                let to_send = (TOTAL - current).min(chunk.len());
                for i in 0..to_send {
                    chunk[i] = (current + i) as f32;
                }
                let pushed = producer.push_slice(&chunk[..to_send]);
                current += pushed;
                if pushed == 0 {
                    thread::yield_now();
                }
            }
        });

        let cons_handle = thread::spawn(move || {
            let mut chunk = [0.0f32; 64];
            let mut received = 0;
            while received < TOTAL {
                let popped = consumer.pop_slice(&mut chunk);
                for i in 0..popped {
                    assert_eq!(chunk[i], (received + i) as f32);
                }
                received += popped;
                if popped == 0 {
                    thread::yield_now();
                }
            }
        });

        prod_handle.join().unwrap();
        cons_handle.join().unwrap();
    }
}
