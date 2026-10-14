// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{
  mem::ManuallyDrop,
  ops::Deref,
  thread::{current, ThreadId},
};

use tao::event_loop::EventLoopProxy;
use tauri_runtime::UserEvent;

use crate::{DispatcherMainThreadContext, Message};

/// Shared through an Arc so worker-side handle clones never clone the Rc inside
/// Tao's EventLoopWindowTarget. The contained resources must also drop on main.
#[derive(Debug)]
pub(crate) struct SharedMainThreadContext<T: UserEvent> {
  inner: Option<DispatcherMainThreadContext<T>>,
  thread_id: ThreadId,
  proxy: EventLoopProxy<Message<T>>,
}

impl<T: UserEvent> SharedMainThreadContext<T> {
  pub(crate) fn new(
    inner: DispatcherMainThreadContext<T>,
    thread_id: ThreadId,
    proxy: EventLoopProxy<Message<T>>,
  ) -> Self {
    Self {
      inner: Some(inner),
      thread_id,
      proxy,
    }
  }
}

impl<T: UserEvent> Deref for SharedMainThreadContext<T> {
  type Target = DispatcherMainThreadContext<T>;

  fn deref(&self) -> &Self::Target {
    self
      .inner
      .as_ref()
      .expect("main thread context was dropped")
  }
}

impl<T: UserEvent> Drop for SharedMainThreadContext<T> {
  fn drop(&mut self) {
    if let Some(inner) = self.inner.take() {
      if current().id() == self.thread_id {
        drop(inner);
      } else {
        // Only the executed main-thread task may destroy these resources. Tao
        // can drop an undelivered task on this worker, including when its
        // internal event channel disconnects after posting the wake-up message.
        // ManuallyDrop also handles that case without relying on send_event's
        // return value. If shutdown prevents execution, retain this one context
        // until process exit instead of touching thread-bound Rc/GUI resources.
        let inner = ManuallyDrop::new(inner);
        let _ = self.proxy.send_event(Message::Task(Box::new(move || {
          drop(ManuallyDrop::into_inner(inner));
        })));
      }
    }
  }
}
