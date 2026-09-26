import { describe, expect, it, vi } from 'vitest';

import mainSource from '../main.ts?raw';
import { createWindowScriptErrorHandler, isResizeObserverNotification } from './windowScriptErrors';

const notification = 'ResizeObserver loop completed with undelivered notifications.';
const errorEvent = (message: string, error: unknown = null) => ({
  message, error, preventDefault: vi.fn(),
});

describe('ResizeObserver notification classification', () => {
  it.each([notification, 'ResizeObserver loop limit exceeded'])(
    'recognizes the exact browser diagnostic %s without an exception', (message) => {
      expect(isResizeObserverNotification(errorEvent(message))).toBe(true);
      expect(isResizeObserverNotification({ ...errorEvent(message), error: undefined })).toBe(true);
    },
  );

  it.each([
    'ResizeObserver is not defined',
    'Cannot read properties of undefined',
    'Script error.',
    'Uncaught Error: ResizeObserver loop completed with undelivered notifications.',
    'ResizeObserver loop completed with undelivered notifications. extra details',
    '',
  ])('does not hide another error: %s', (message) => {
    expect(isResizeObserverNotification(errorEvent(message))).toBe(false);
  });

  it.each([new Error(notification), notification, 0, false])(
    'keeps an actual exception payload fatal even if its message matches', (error) => {
      expect(isResizeObserverNotification(errorEvent(notification, error))).toBe(false);
    },
  );
});

describe('window script error routing', () => {
  it('leaves the mounted player and stored fatal record unchanged after a resize notification', () => {
    const appRoot = { innerHTML: '<div>Mounted lyrics and controls</div>' };
    const writeFatalRecord = vi.fn();
    const fatal = vi.fn((title: string, error: unknown) => {
      writeFatalRecord(title, error);
      appRoot.innerHTML = 'Fatal error screen';
    });
    const warning = vi.fn();
    const event = errorEvent(notification);

    createWindowScriptErrorHandler(fatal, warning)(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledExactlyOnceWith(notification, 1);
    expect(fatal).not.toHaveBeenCalled();
    expect(writeFatalRecord).not.toHaveBeenCalled();
    expect(appRoot.innerHTML).toBe('<div>Mounted lyrics and controls</div>');
  });

  it('keeps persistent resize feedback visible in bounded, counted warnings', () => {
    const fatal = vi.fn();
    const warning = vi.fn();
    const handle = createWindowScriptErrorHandler(fatal, warning);
    for (let count = 0; count < 250; count += 1) handle(errorEvent(notification));

    expect(fatal).not.toHaveBeenCalled();
    expect(warning.mock.calls).toEqual([[notification, 1], [notification, 100], [notification, 200]]);
  });

  it('still reports a real script exception after a resize notification', () => {
    const fatal = vi.fn();
    const handle = createWindowScriptErrorHandler(fatal, vi.fn());
    const exception = new TypeError('Real player failure');
    const event = errorEvent(exception.message, exception);
    handle(errorEvent(notification));
    handle(event);

    expect(fatal).toHaveBeenCalledExactlyOnceWith('窗口脚本错误', exception);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('keeps unknown browser errors without an Error object visible', () => {
    const fatal = vi.fn();
    createWindowScriptErrorHandler(fatal, vi.fn())(errorEvent('Script error.'));
    expect(fatal).toHaveBeenCalledExactlyOnceWith('窗口脚本错误', 'Script error.');
  });

  it('routes an actual error event without cancelling unrelated events', () => {
    const target = new EventTarget();
    const fatal = vi.fn();
    const handle = createWindowScriptErrorHandler(fatal, vi.fn());
    target.addEventListener('error', (event) => handle(event as ErrorEvent));
    const resizeEvent = Object.assign(new Event('error', { cancelable: true }), {
      message: notification, error: null,
    });
    expect(target.dispatchEvent(resizeEvent)).toBe(false);
    expect(resizeEvent.defaultPrevented).toBe(true);
    const thrownError = new Error(notification);
    const scriptEvent = Object.assign(new Event('error', { cancelable: true }), {
      message: notification, error: thrownError,
    });
    expect(target.dispatchEvent(scriptEvent)).toBe(true);
    expect(fatal).toHaveBeenCalledExactlyOnceWith('窗口脚本错误', thrownError);
  });

  it('uses this handler at the entry point but retains promise, Vue and startup error handling', () => {
    expect(mainSource).toContain('createWindowScriptErrorHandler(');
    expect(mainSource).toContain("window.addEventListener('error', handleWindowScriptError)");
    expect(mainSource).toContain("showFatalError('未处理的异步错误', event.reason)");
    expect(mainSource).toContain('app.config.errorHandler =');
    expect(mainSource).toContain("showFatalError('应用挂载失败', error)");
  });
});
