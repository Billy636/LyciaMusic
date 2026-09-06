export const isProfilingEnabled = () =>
  import.meta.env.DEV || import.meta.env.VITE_LYCIA_PROFILING === '1';
