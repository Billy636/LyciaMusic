# Lycia local patch

Based on the crates.io `tauri-runtime-wry` 2.9.3 source, licensed under
Apache-2.0 OR MIT. The upstream licenses are included in this directory.

## Share and release the main-thread context safely

Upstream `Context` derives `Clone` and owns `DispatcherMainThreadContext` by
value. Cloning application, window or webview handles on worker threads therefore
clones the `Rc<EventLoopRunner>` inside Tao's Windows `EventLoopWindowTarget`.
That reference count is not atomic. Background image preparation/cancellation
can race with the main event loop, corrupt the count and crash the process.

`Context::main_thread` now shares a `SharedMainThreadContext` through `Arc`.
Handle clones and drops only change the outer atomic reference count. Access to
the contained resources still follows the upstream main-thread checks.

The shared wrapper releases the contained context directly on the main thread,
or queues its destruction there when the last handle is released by a worker.
The queued task captures the context in `ManuallyDrop`: only executing the task
on main releases it. If shutdown prevents delivery or execution, the context is
intentionally retained until process exit. This also covers Tao's Windows proxy
silently dropping a task when its event channel disconnects after the wake-up
message was posted. The shutdown leak is bounded to the one shared context and
prevents its thread-bound resources from being destroyed on a worker.

Changed runtime file: `src/lib.rs`. Added implementation:
`src/shared_main_thread_context.rs`. The upstream test-only block in
`src/dialog/windows.rs` is omitted to follow this project's no-new-tests policy;
other upstream source files are unchanged. No background image processing
behavior is changed by this patch.

The root Cargo patch and lockfile select this local crate. Review or port this
patch when upgrading Tauri; an update that selects a newer registry version
must not silently discard the lifetime/thread-safety fix.
