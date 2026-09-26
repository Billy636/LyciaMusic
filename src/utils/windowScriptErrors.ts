export interface WindowScriptErrorEvent {
  readonly message: string;
  readonly error: unknown;
  preventDefault(): void;
}

const RESIZE_OBSERVER_NOTIFICATIONS = new Set([
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
]);

/**
 * The browser reports deferred ResizeObserver deliveries through window.error,
 * without a thrown exception. This is a layout diagnostic, not an app crash.
 * Match only the known messages and keep genuine exceptions fatal, including
 * exceptions whose message happens to contain the same text.
 */
export function isResizeObserverNotification(event: WindowScriptErrorEvent): boolean {
  return event.error == null && RESIZE_OBSERVER_NOTIFICATIONS.has(event.message);
}

export function createWindowScriptErrorHandler(
  onFatalError: (title: string, error: unknown) => void,
  onResizeObserverWarning: (message: string, count: number) => void,
) {
  let resizeObserverCount = 0;

  return (event: WindowScriptErrorEvent) => {
    if (!isResizeObserverNotification(event)) {
      onFatalError('窗口脚本错误', event.error ?? event.message);
      return;
    }

    event.preventDefault();
    resizeObserverCount += 1;
    // Do not replace #app or write a fatal-error record. Keep repeated layout
    // feedback diagnosable without flooding the console during a slider drag.
    if (resizeObserverCount === 1 || resizeObserverCount % 100 === 0) {
      onResizeObserverWarning(event.message, resizeObserverCount);
    }
  };
}
