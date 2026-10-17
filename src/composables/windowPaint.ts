/** Hidden WebViews can stop animation frames while native acrylic stays visible. */
export function waitForWindowPaint(maxWaitMs = 100): Promise<void> {
  return new Promise(resolve => {
    let frame: number | null = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (frame !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frame);
      }
      resolve();
    };
    const hasAnimationFrame = typeof requestAnimationFrame === 'function';
    const timeout = setTimeout(finish, hasAnimationFrame ? maxWaitMs : 16);
    if (hasAnimationFrame) {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(finish);
      });
    }
  });
}
