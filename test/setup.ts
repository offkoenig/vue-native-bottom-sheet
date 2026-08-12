// Mocks `prefers-reduced-motion: reduce` as always matching. This isn't
// about accessibility here — it's what makes the component's springs
// resolve *synchronously* (see the `respectReducedMotion` branch in
// springAnimateTo), so tests can assert on open/close/snap state without
// juggling requestAnimationFrame timing or fake timers.
window.matchMedia = (query: string) =>
  ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList
