/**
 * Server-side localStorage polyfill for Next.js SSR.
 * Prevents "localStorage.getItem is not a function" when code (or deps) runs during SSR.
 */
if (typeof window === 'undefined') {
  const noopStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    get length() {
      return 0;
    },
    key: () => null,
  };
  (globalThis as any).localStorage = noopStorage;
  (globalThis as any).sessionStorage = noopStorage;
}
