/**
 * 通用并发调度器工具
 * 确保同一时间最多只有一个异步任务处于 Pending 状态。
 * 后续的新增任务会覆盖之前未执行的 pending 任务（Latest-Only 策略），
 * 在当前任务完成后，立即执行最新的暂存任务。
 */
export function useConcurrentScheduler() {
  let activePromise: Promise<any> | null = null;
  let pendingRequest: (() => Promise<any>) | null = null;

  const execute = <T>(taskFn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const wrappedTask = () => {
        return taskFn()
          .then(resolve)
          .catch(reject);
      };

      if (activePromise) {
        // 如果当前有正在执行的请求，覆盖 pendingRequest 为当前最新的 wrappedTask
        pendingRequest = wrappedTask;
        return;
      }

      // 没有活跃的请求，立即启动
      const promise = wrappedTask();
      activePromise = promise;

      const cleanUpAndNext = () => {
        activePromise = null;
        if (pendingRequest) {
          const next = pendingRequest;
          pendingRequest = null;
          
          // 执行最新的挂起任务
          const nextPromise = next();
          activePromise = nextPromise;
          nextPromise.finally(cleanUpAndNext);
        }
      };

      promise.finally(cleanUpAndNext);
    });
  };

  const cancel = () => {
    pendingRequest = null;
  };

  return {
    execute,
    cancel,
  };
}
