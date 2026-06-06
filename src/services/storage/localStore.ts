export const localStore = {
  getString(key: string) {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  },

  setString(key: string, value: string) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  },

  remove(key: string) {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  },

  clear() {
    if (typeof localStorage === 'undefined') return;
    localStorage.clear();
  },

  getJson<T>(key: string): T | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  setJson(key: string, value: unknown) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  },
};
