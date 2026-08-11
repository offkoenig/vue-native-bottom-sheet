# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install

npm run typecheck        # vue-tsc --noEmit — includes .vue files, not just .ts
npm run build             # full pipeline: typecheck → build:types → build:js → build:copy-sfc
npm run build:types       # vue-tsc --declaration --emitDeclarationOnly -p tsconfig.build.json
npm run build:js          # tsup (bundles src/index.ts and src/nuxt.ts only — not the .vue file)
npm run build:copy-sfc    # node scripts/copy-sfc.mjs — copies src/BottomSheet.vue into dist/ as-is

npm run demo:dev          # Vite dev server with HMR; imports the component straight from src/
npm run demo:build        # builds demo-dist/index.html, a single self-contained file
```

There is no test suite and no lint script in this repo — don't assume `npm test` or `npm run lint` exist.

## Architecture

This is a Vue 3 bottom-sheet component library, published as `vue-native-bottom-sheet`. The entire component lives in one file, `src/BottomSheet.vue`; the rest of `src/` is thin wiring around it:

- `src/BottomSheet.vue` — the component. All drag physics, spring animation, scroll lock, focus trap, and styling (scoped CSS + CSS custom properties) live here.
- `src/types.ts` — `BottomSheetProps` / `BottomSheetEmits` / `BottomSheetExposed`, imported by both the component (`defineProps<BottomSheetProps>()`) and re-exported from `index.ts` for consumers.
- `src/index.ts` — plain-Vue entry: exports the component + an optional install-as-global `BottomSheetPlugin`.
- `src/nuxt.ts` — a Nuxt 3 module (`defineNuxtModule` + `addComponent` from `@nuxt/kit`) that auto-registers the same `.vue` file. No separate logic or styling — it's purely an auto-import wrapper.
- `demo/` — a Vite app that imports the component directly from `src/` (not the published package), so it always reflects current code. `demo/i18n.ts` holds parallel EN/RU copy for every demo card; when adding a demo example, both language blocks need matching keys.

### The component ships as source, not pre-bundled

`dist/BottomSheet.vue` is a literal copy of `src/BottomSheet.vue` (via `scripts/copy-sfc.mjs`), not compiled to JS. `dist/index.js`/`index.cjs` `import`/`require` it by relative path, and it gets compiled by whatever Vite/webpack pipeline the *consumer* has — same as if it lived in their own `components/` folder. This is why `tsup.config.ts` marks `/\.vue$/` as `external`: esbuild can't parse SFC syntax, and isn't meant to here. Type declarations for the `.vue` file come from `vue-tsc` (`build:types`), not from tsup (`dts: false`) — tsup can't correctly analyze `defineProps`/`defineEmits` inside an SFC.

The Nuxt module is built ESM-only (see `tsup.config.ts`) because its resolver uses `import.meta.url`, which is empty in a CJS build — shipping a broken CJS variant would be worse than not shipping one.

### The one hard performance invariant

During an active drag or spring animation, **only `transform: translate3d(...)` may change** — never `top`/`height`/`width`. That's what keeps drag at a stable 60fps (compositor-only, no reflow). This constraint has already shaped one non-obvious piece of the code: the footer (`.vbs-footer`) stays in normal flex flow (so `.vbs-content`'s `flex: 1 1 auto` sizing math is untouched), but carries its own `footerStyle` transform that's the *exact negation* of the panel's `translateY` — this cancels the panel's shift so the footer visually stays glued to the true viewport bottom regardless of which snap point is active, without ever touching layout. Don't "simplify" this into a layout-based fix (e.g. sizing the panel to the visible snap height) — that would reintroduce per-frame reflow during drag.

### Snap points: percentage or `'content'`

`snapPoints` entries are either a number (`%` of viewport height) or the literal string `'content'`. Resolution happens in the `resolvedSnapPoints` computed in `BottomSheet.vue`:

- Numeric entries go through `percentToTranslate()`.
- `'content'` resolves from `fitContentHeight` (a ref populated by `measureFitContentHeight()`), which sums the `offsetHeight` of three refs: `grabberZoneRef`, `contentInnerRef`, `footerRef`. `contentInnerRef` exists specifically because `.vbs-content` itself is flex-stretched (`flex: 1 1 auto`) and can't be measured directly — its `offsetHeight` would report the stretched box, not the content's natural height. `contentInnerRef` is a plain, non-stretched wrapper div inside it.
- A `ResizeObserver` (`setupContentResizeObserver`, only attached when some entry is `'content'`) re-measures live and re-springs the sheet to the new height if it's currently resting on that snap point — without closing or fighting an active drag (guarded by `isDragging`).
- `resolvedSnapPoints` sorts by resolved percent every time, so if a `'content'` point's measured height ever crosses a fixed percentage point in the same array, their order — and which index refers to which — changes accordingly. This is a known, accepted edge case, not a bug to "fix" by pinning order.

### Other things that aren't obvious from a single file

- **Lazy mount**: the panel's DOM subtree only renders after first open (`v-if="isMounted && isInDom"` in the template), for SSR-safety and to avoid measuring/observing hidden content.
- **Framework-agnostic client check**: `const isClient = typeof window !== 'undefined'` is used everywhere instead of Nuxt's `import.meta.client`, so the same `.vue` file works identically in plain Vue and Nuxt.
- **Spring physics**: `springAnimateTo()` integrates a damped harmonic oscillator with semi-implicit Euler, once per `requestAnimationFrame`. The measured swipe velocity becomes the spring's *initial velocity* — there's no separate duration/easing-curve calculation; the "native" feel comes from the physics itself. Full math is in `README.md` under "The physics, in detail".
- **Scroll/drag handoff**: content-area drag only begins if `contentRef.scrollTop <= 0` *and* the first movement is downward (`onContentPointerDown`'s gate); the grabber has no movement threshold; the header slot has a 4px threshold so clicks on buttons inside it aren't hijacked.
- **Rubber band**: dragging past the top-most snap point uses WebKit/`UIScrollView`'s own overscroll formula (`rubberBand()`), constant `0.55` by default.

## Publishing

`package.json` has `"files": ["dist"]`, but npm always includes `README.md`, `LICENSE`, and `package.json` regardless. Keep only one `README*`-pattern file at the repo root (currently `README.md`, English) — npm's registry picks whichever root file matches that pattern for the package page, and having two (there used to be a `README.ru.md` at root) makes that choice non-deterministic. The Russian translation lives at `docs/README.ru.md` for this reason; cross-link both directions if either one moves again.

Publishing itself (`npm publish`) needs a one-time-password web confirmation that npm redacts in non-TTY output, so it must be run from a real interactive terminal, not through a piped/non-interactive shell.
