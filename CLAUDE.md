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

npm test                  # Vitest + happy-dom (test/); test/setup.ts mocks reduced motion so springs resolve synchronously
```

There is no lint script in this repo — don't assume `npm run lint` exists. happy-dom has no layout and no native scrolling, so gesture arbitration against real scrolling and anything visual still has to be checked in a browser.

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

During an active drag or spring animation, **only `transform: translate3d(...)` (and the backdrop's `opacity`) may change** — never `top`/`height`/`width`, and never through Vue. `translateY` is deliberately a plain variable, and `renderFrame()` writes it straight to the DOM: a reactive value would re-run the component's render function, and every slot with it, on each frame. Don't add per-frame reactive state, and don't put `transform`/`opacity` back into template `:style` bindings. The panel's px `height` and the content spacer are reactive, but only change when the viewport changes or the sheet comes to rest. This constraint has already shaped one non-obvious piece of the code: the footer (`.vbs-footer`) stays in normal flex flow (so `.vbs-content`'s `flex: 1 1 auto` sizing math is untouched), but carries its own transform that's the *exact negation* of the panel's `translateY` — this cancels the panel's shift so the footer visually stays glued to the true viewport bottom regardless of which snap point is active, without ever touching layout. Don't "simplify" this into a layout-based fix (e.g. sizing the panel to the visible snap height) — that would reintroduce per-frame reflow during drag.

### Snap points: percentage or `'content'`

`snapPoints` entries are either a number (`%` of viewport height) or the literal string `'content'`. Resolution happens in the `resolvedSnapPoints` computed in `BottomSheet.vue`:

- Numeric entries go through `percentToTranslate()`.
- `'content'` resolves from `fitContentHeight` (a ref populated by `measureFitContentHeight()`), which sums the height of three refs: `grabberZoneRef`, `contentInnerRef`, `footerRef`. `contentInnerRef` exists specifically because `.vbs-content` itself is flex-stretched (`flex: 1 1 auto`) and can't be measured directly — its height would report the stretched box, not the content's natural height. `contentInnerRef` is a plain, non-stretched wrapper div inside it.
- A `ResizeObserver` (`setupContentResizeObserver`, only attached when some entry is `'content'`) re-measures live. `syncToSnapPoints`, a watcher on `snapTranslates`, is the single reaction to snap points moving for any reason (content, viewport, keyboard, the prop itself): it re-aims a running spring in place, keeping position, velocity and completion callback, or springs from rest — without fighting an active drag.
- `resolvedSnapPoints` sorts by resolved percent every time, so if a `'content'` point's measured height ever crosses a fixed percentage point in the same array, their order — and which index refers to which — changes accordingly. This is a known, accepted edge case, not a bug to "fix" by pinning order.

### Other things that aren't obvious from a single file

- **Lazy mount**: the panel's DOM subtree only renders after first open (`v-if="isMounted && isInDom"` in the template), for SSR-safety and to avoid measuring/observing hidden content.
- **Framework-agnostic client check**: `const isClient = typeof window !== 'undefined'` is used everywhere instead of Nuxt's `import.meta.client`, so the same `.vue` file works identically in plain Vue and Nuxt.
- **Spring physics**: `springAnimateTo()` integrates a damped harmonic oscillator with semi-implicit Euler, in fixed 1/240s steps inside each `requestAnimationFrame`. The measured swipe velocity becomes the spring's *initial velocity* — there's no separate duration/easing-curve calculation; the "native" feel comes from the physics itself. Full math is in `README.md` under "The physics, in detail".
- **Two input paths, one state machine**: touch goes through touch events, mouse through pointer events, both into `beginGesture`/`gestureMove`/`gestureEnd`. Don't merge them back onto pointer events: `pointermove`'s `preventDefault()` doesn't stop scrolling, and the browser sends `pointercancel` once it claims a pan. `touchmove` must stay a non-passive listener in the template, since iOS only honors listeners that existed at touch start and only a cancelled *first* touchmove.
- **Scroll/drag handoff**: `contentDragGate` decides on the first touchmove (mostly-horizontal gestures are left to the slot before it's asked); the grabber has no movement threshold; the header slot has a 4px threshold so clicks on buttons inside it aren't hijacked.
- **Keyboard geometry**: the panel is anchored by its top edge at `viewportOffsetTop + translateY`, with its height pinned to `visualViewport.height`. Don't go back to `bottom: 0` with an inset formula: on a real iPhone `offsetTop + height` exceeded `innerHeight`, so the bottom edge has no reliable reference. Percent snap points use `snapBaseHeight`, which holds its pre-keyboard value while an editable element has focus.
- **Page-wide state lives in the plain `<script>` block**: the body/target scroll locks and the open-sheet stack are shared across instances and reference-counted. Per-instance save/restore left `<body>` stuck at `position: fixed` when sheets overlapped.
- **Theming defaults live in the unscoped `<style>` block under `:where()`**: scoped, they'd outrank consumers' `.vbs-panel` overrides. Vue also compiles a scoped `:global(.a) .b` down to just `.a`, so don't use that form.
- **Rubber band**: dragging past the top-most snap point uses WebKit/`UIScrollView`'s own overscroll formula (`rubberBand()`), constant `0.55` by default.

## Publishing

`package.json` has `"files": ["dist"]`, but npm always includes `README.md`, `LICENSE`, and `package.json` regardless. Keep only one `README*`-pattern file at the repo root (currently `README.md`, English) — npm's registry picks whichever root file matches that pattern for the package page, and having two (there used to be a `README.ru.md` at root) makes that choice non-deterministic. The Russian translation lives at `docs/README.ru.md` for this reason; cross-link both directions if either one moves again.

Publishing itself (`npm publish`) needs a one-time-password web confirmation that npm redacts in non-TTY output, so it must be run from a real interactive terminal, not through a piped/non-interactive shell.
