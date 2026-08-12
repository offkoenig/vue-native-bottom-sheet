🇬🇧 **English** · [🇷🇺 Русский](./docs/README.ru.md)

# vue-native-bottom-sheet

A production-ready bottom sheet for Vue 3, built with physics that feels as close as possible to a native iOS/Android sheet: velocity-based inertia, a rubber-band resistance effect, spring animations instead of CSS timing curves, snap points, and a full set of accessibility mechanics.

Works as a regular component library in **any** Vue 3 (≥3.4) project — Vite, webpack/vue-loader — and as a full **Nuxt 3 module** with auto-import. Doesn't require Tailwind: all styling is self-contained (scoped CSS + CSS custom properties for theming).

**[Live demo →](https://offkoenig.github.io/vue-native-bottom-sheet/)**

## Features

- **v-model** via `defineModel()`.
- 3 named slots — `header`, default, `footer` — each with a scoped `close()` prop.
- Renders through `<Teleport to="body">`, fully SSR-safe.
- Only `transform: translate3d(...)` changes during a drag — a genuinely stable 60 FPS.
- Velocity-based inertia: a fast downward swipe closes the sheet even if only ~10% of the height was dragged.
- Rubber-band resistance when dragging past the fully-open point — the same formula WebKit/UIScrollView uses.
- Configurable snap points — fixed percentages or `'content'` (auto-fits and live-adapts to actual content height); every settle/open/close animation is a spring (Hooke's law), not a CSS transition.
- Body scroll lock that accounts for iOS Safari, with a smooth handoff between content scroll and sheet drag.
- Escape closes, Tab keeps focus trapped inside the panel, and it respects `prefers-reduced-motion`.
- Dark mode out of the box — via `prefers-color-scheme` and/or a `.dark` class on an ancestor.
- No Tailwind/UnoCSS dependency — styles ship with the component; add your own classes on top via `panelClass` / `contentClass` / `backdropClass` if you want to.

## Installation

```bash
npm install vue-native-bottom-sheet
```

The only peer dependency is `vue` (^3.4.0). `@nuxt/kit` is only needed if you use the Nuxt module (see below) — for a plain Vue project it isn't required and won't be installed.

## Usage in plain Vue 3 (Vite, etc.)

Import the component directly:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { BottomSheet } from 'vue-native-bottom-sheet'

const isOpen = ref(false)
</script>

<template>
  <button @click="isOpen = true">Open</button>

  <BottomSheet v-model="isOpen" :snap-points="[50, 100]">
    <template #header="{ close }">
      <h2>Title</h2>
      <button @click="close">✕</button>
    </template>

    <p>Content</p>

    <template #footer="{ close }">
      <button @click="close">Done</button>
    </template>
  </BottomSheet>
</template>
```

Or register it globally via the plugin, so it's available in templates without importing it:

```ts
// main.ts
import { createApp } from 'vue'
import { BottomSheetPlugin } from 'vue-native-bottom-sheet'
import App from './App.vue'

createApp(App)
  .use(BottomSheetPlugin /* , { componentName: 'MySheet' } — optional */)
  .mount('#app')
```

> The component ships as source — a raw `.vue` file, not pre-bundled into JS. It gets compiled by the same `@vitejs/plugin-vue`/`vue-loader` your project already has. This is a standard, well-established pattern for Vue libraries: Vite handles `.vue` files the same way whether they live in `src/` or `node_modules/`, including during dependency pre-bundling in dev mode.

## Usage in Nuxt 3

### Option A — auto-import module (recommended)

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['vue-native-bottom-sheet/nuxt'],

  // optional:
  nativeBottomSheet: {
    componentName: 'BottomSheet', // the name it's registered under
  },
})
```

After this, `<BottomSheet>` is available in any component in the project without an import — just like a built-in Nuxt component. No separate CSS import is needed either: styles live inside the `.vue` file and are picked up by Nuxt's normal build.

### Option B — manual registration

If you'd rather not add the module, you can import the component exactly like in plain Vue:

```vue
<script setup lang="ts">
import { BottomSheet } from 'vue-native-bottom-sheet'
</script>
```

Both options use the same component — the module just saves you the manual import.

## Theming

Appearance is controlled through CSS custom properties on the `.vbs-panel` class — override them in your project's global CSS:

```css
.vbs-panel {
  --vbs-bg: #0a0a0a;
  --vbs-fg: #f5f5f5;
  --vbs-radius: 1rem;
  --vbs-shadow: 0 -12px 32px -8px rgba(0, 0, 0, 0.4);
  --vbs-ring: rgba(255, 255, 255, 0.08);
  --vbs-handle-color: #52525b;
  --vbs-border-color: #27272a;
  --vbs-max-width: 32rem; /* panel width on screens ≥640px */
}
```

Dark mode applies automatically based on `prefers-color-scheme: dark`, and also — if your project follows Tailwind's convention of a `.dark` class on `<html>`/an ancestor — based on that class, without needing Tailwind itself.

If that's not enough, `panelClass` / `contentClass` / `backdropClass` accept any classes (including Tailwind/UnoCSS, if your project has them) and are layered on top of the built-in ones:

```vue
<BottomSheet v-model="isOpen" panel-class="ring-2 ring-blue-500">
```

## Props

`v-model` (the `modelValue: boolean` prop, `update:modelValue` event) is required to control openness — everything else is optional.

| Prop | Type | Default | Description |
|---|---|---|---|
| `snapPoints` | `(number \| 'content')[]` | `[50, 100]` | Snap points as % of viewport height. `'content'` measures the actual rendered height of header+default+footer via `ResizeObserver` instead (capped at 100dvh) and re-springs live if that content changes size while open. Order doesn't matter — sorted automatically, including around a moving `'content'` point. |
| `defaultSnapPoint` | `number` | `0` | Index into `snapPoints` the sheet opens to by default. |
| `closeThreshold` | `number` | `0.5` | Swipe velocity threshold (px/ms) above which an inertial transition/close kicks in. |
| `edgeFlickVelocity` | `number` | `1.8` | Swipe velocity (px/ms) above which a flick jumps straight to the edge — fully closed (or the lowest snap point, if not dismissible) on a fast downward flick, or the top-most snap point on a fast upward one — instead of moving one snap point at a time. Must exceed `closeThreshold` to matter; set to `Infinity` to disable. |
| `rubberBandResistance` | `number` | `0.55` | Resistance (0..1) of the rubber-band effect above the top snap point. `0.55` is WebKit/UIScrollView's own constant. |
| `springStiffness` | `number` | `300` | Spring stiffness (`k`). Higher — faster and "tighter". |
| `springDamping` | `number` | `32` | Spring damping (`c`). Higher — less "settle" overshoot at the end. |
| `springMass` | `number` | `1` | Spring body mass (`m`). |
| `respectReducedMotion` | `boolean` | `true` | Whether to honor `prefers-reduced-motion: reduce` (instant transitions instead of a spring). If your app opens without any visible animation and you didn't expect that, this is almost certainly why — check the OS/browser accessibility setting before assuming it's a bug. Turn off only deliberately (e.g. in a demo whose whole point is to show the animation). |
| `showBackdrop` | `boolean` | `true` | Show the dimmed backdrop. |
| `backdropOpacity` | `number` | `0.45` | Maximum backdrop opacity (0..1) at full openness. |
| `fadeFromIndex` | `number` | — | Index into (sorted) `snapPoints` from which the backdrop starts to dim. Snap points below it show no backdrop at all — a "peek" state that doesn't feel modal. Unset (default) dims continuously across the whole closed→open range. |
| `closeOnBackdropClick` | `boolean` | `true` | Close on backdrop click. |
| `closeOnEscape` | `boolean` | `true` | Close on the `Escape` key. |
| `dismissible` | `boolean` | `true` | If `false`, swipe/backdrop/`Escape` won't close the sheet — only programmatic close works. |
| `grabberOnly` | `boolean` | `false` | If `true`, a drag can only be started from the grabber bar — the header slot and content area no longer initiate one (they still scroll normally). |
| `autoFocus` | `boolean \| 'input'` | `true` | Whether something receives focus once the open animation finishes. `true` focuses the panel; `'input'` instead focuses the first visible, enabled `input`/`textarea`/`select`/`[contenteditable]` inside it (falls back to the panel if there isn't one) — handy for a sheet that's mostly a form. `false` disables it entirely. |
| `lockBodyScroll` | `boolean` | `true` | Lock `<body>` scroll while the sheet is open. |
| `lockScrollTarget` | `string \| HTMLElement` | — | If your app's actual scrollable container isn't `<body>`/`window` (an app shell with its own `overflow-y: auto` wrapper, say), a CSS selector or element here gets its scroll locked too, alongside `<body>`. Governed by the same `lockBodyScroll` switch. |
| `themeColor` | `string` | — | A CSS color applied to `<meta name="theme-color">` while the sheet is open (what mobile browsers, notably iOS Safari's toolbar, tint their UI chrome with) — restored to whatever it was before on close. The library can't sample the actual rendered color of arbitrary slot content, so this isn't automatic; pass the color your content actually is. |
| `scaleBackground` | `boolean` | `false` | Scales down and rounds the corners of your app's background while the sheet is open — the iOS "card stack" look. Requires an element elsewhere in the DOM marked `data-vbs-background` (a sibling of where `BottomSheet` teleports to, not an ancestor); a no-op without one. See [Background scale effect](#background-scale-effect). |
| `scaleBackgroundColor` | `string` | `'#000000'` | Color painted behind the scaled-down background, filling the gap its rounded corners reveal, while `scaleBackground` is active. |
| `ariaLabel` | `string` | `'Panel'` | `aria-label` for the dialog. |
| `zIndex` | `number` | `60` | Base z-index (backdrop = `zIndex`, panel = `zIndex + 1`). |
| `panelClass` | `string \| object \| array` | — | Extra classes on the panel's root element. |
| `contentClass` | `string \| object \| array` | — | Extra classes on the scrollable content area. |
| `backdropClass` | `string \| object \| array` | — | Extra classes on the backdrop. |

### Fitting to content height

Instead of guessing a percentage, a snap point can be the literal string `'content'`:

```vue
<BottomSheet v-model="isOpen" :snap-points="['content']">
  <p>As tall as I am, no taller.</p>
</BottomSheet>
```

Under the hood, `header` + default slot + `footer` are measured with a `ResizeObserver` (capped at `100dvh`) and converted to a translateY exactly like a percentage point — same sort order, same rubber-band, same spring. If the content's height changes while the sheet is open (an accordion expands, an image loads), it re-springs to the new height live, without closing.

`'content'` can be mixed with fixed percentages, e.g. `:snap-points="['content', 100]"` opens sized to content but still lets a fast upward flick take it to 100%. Pairing it with a point the content can never exceed (`100`) keeps sort order stable; mixing it with an *intermediate* fixed point (e.g. `['content', 50]`) is supported too, but if the measured content height crosses that point, the point order — and therefore what index a given snap position corresponds to — changes accordingly.

### Background scale effect

`scaleBackground` reproduces the iOS "card stack" look — your app's background scales down and its corners round off while the sheet is open. It needs an element to scale, marked with a `data-vbs-background` attribute, sitting *outside* the sheet's own subtree (it teleports to `<body>`, so wrap your app root, not the `<BottomSheet>` itself):

```vue
<template>
  <div data-vbs-background>
    <!-- your whole app -->
  </div>
  <BottomSheet v-model="isOpen" scale-background>
    …
  </BottomSheet>
</template>
```

Unlike a typical implementation of this effect (a fixed-duration CSS transition fired at open/close), the scale here is driven by the exact same live `translateY` the sheet and backdrop already use, applied imperatively to that element — so it tracks drag, rubber-band, and the spring settle frame-for-frame instead of running on its own separate timing curve. If no `data-vbs-background` element exists, this is a silent no-op.

If `fadeFromIndex` is also set, the background scale shares its progress with the backdrop — it stays untouched below that snap point and only starts scaling/tinting once you cross into it, so a "peek" state doesn't visually change the background any more than it dims it.

## Events (Emits)

| Event | Payload | When |
|---|---|---|
| `update:modelValue` | `boolean` | Standard for `v-model`, emitted on any openness change. |
| `opened` | — | The open animation has finished. |
| `closed` | — | The close animation has finished; the panel is removed from the DOM. |
| `snap` | `(index: number, percent: number)` | The panel settled on one of the `snapPoints` (not on closed). |
| `drag-start` | — | A drag gesture started (after crossing the movement threshold). |
| `drag-end` | `(velocity: number)` | The gesture ended. `velocity` in px/ms: `+` down, `−` up. |

## Slots

| Slot | Scoped props | Description |
|---|---|---|
| `header` | `{ close: () => void, snapIndex: number }` | Header: title, close button, etc. The visual grab-handle indicator is rendered by the component automatically **above** this slot. |
| default (unnamed) | `{ close: () => void }` | Main scrollable content. |
| `footer` | `{ close: () => void }` | Fixed footer (confirmation buttons, etc.). |

## Programmatic control

`close()` and `snapToIndex(index)` are exposed via `defineExpose` — grab them through a template ref:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { BottomSheet } from 'vue-native-bottom-sheet'

const isOpen = ref(false)
const sheet = ref<InstanceType<typeof BottomSheet> | null>(null)

function expandFully() {
  sheet.value?.snapToIndex(1)
}
</script>

<template>
  <BottomSheet ref="sheet" v-model="isOpen" :snap-points="[35, 100]" />
</template>
```

## The physics, in detail

### 1. Coordinate system

The panel is a `100dvh`-tall element pinned to the bottom of the screen (`position: fixed; bottom: 0`). Its whole position is described by a single number — `translateY` (px):

- `translateY = 0` → 100% of the viewport height is visible.
- `translateY = viewportHeight` → the panel is entirely below the bottom edge ("closed").
- A snap point at `p`% of viewport height corresponds to `translateY = viewportHeight × (1 − p / 100)`.

Since only `translateY` changes during a gesture, via `transform: translate3d(0, Ypx, 0)`, the browser never recomputes layout — only compositing — which is what gives a genuinely stable 60 FPS.

### 2. Swipe velocity

The component keeps a sliding window of `{y, t}` points from the last ~150ms. On release, velocity is computed as:

```
velocity = (yLast − yFirst) / (tLast − tFirst)      [px/ms]
```

A 150ms window rather than the delta between the last two `pointermove` events, because an instantaneous delta is too noisy (especially on Android) — the window smooths that noise out while staying short enough to reflect the final "releasing" flick rather than the whole gesture.

### 3. Rubber band

When the panel is dragged past the top-most snap point, it uses the same formula WebKit itself uses in `UIScrollView` for overscroll:

```
f(x, d, c) = (x · d · c) / (d + c · x)
```

where `x` is the amount of "extra" overdrag (px), `d` is the viewport height, and `c` is `rubberBandResistance` (`0.55` by default — Apple's own constant). The function asymptotically approaches `d / c`: resistance grows the farther you pull, but there's never a hard stop.

### 4. Spring physics

After release (and on programmatic open/close), `translateY` isn't animated with a fixed-duration CSS transition — it's integrated as a damped harmonic oscillator (Hooke's law + viscous damping) using semi-implicit Euler, once per frame:

```
displacement  = position − target
acceleration  = (−k · displacement − c · velocity) / m
velocity     += acceleration · dt
position     += velocity · dt
```

where `k` = `springStiffness`, `c` = `springDamping`, `m` = `springMass`. The animation stops once `|velocity| < 6 px/s` and `|position − target| < 0.5px`.

> Inside the simulation, velocity is kept in **px/s** (not px/ms, like the measured gesture velocity) — the gesture's `velocity` is multiplied by 1000 once when the spring starts. That's just a unit conversion for integrating correctly against `dt` in seconds.

The key detail: **the spring's initial velocity in this equation is the measured swipe velocity**. That's why a fast flick reaches its target quickly with a barely-there characteristic settle, while a slow release glides gently into place — with no separate "animation duration from velocity" calculation needed. The shape of the motion isn't a pre-drawn easing curve; it comes from a real initial velocity fed into the equation.

The spring is also **interruptible**: grabbing the sheet while it's still animating open, closed, or toward a snap point picks the drag up from wherever `translateY` currently is, mid-flight — there's no "wait for it to finish first." A real physical object doesn't refuse to be touched while it's still moving, and neither does this.

At `k = 300, c = 32, m = 1` the system is slightly underdamped: critical damping is `2√(k·m) ≈ 34.6`, and `32` sits just below that. Hence the barely-perceptible settle at the end — the detail that reads as "native" rather than a linear or abrupt stop.

### 5. Deciding where to settle on release

1. `velocity > closeThreshold` (fast downward flick) → move to the snap point one index down; if already at the lowest one, close.
2. `velocity < −closeThreshold` (fast upward flick) → move to the snap point one index up.
3. Otherwise (a slow release) → snap to whichever point — among all `snapPoints` plus "closed" — is geometrically closest.

Rule 1 is what lets a fast downward swipe close the sheet even if only ~10% of the height was dragged. If `dismissible === false`, closing in rules 1/3 is replaced with returning to the lowest (first) snap point instead.

A flick fast enough to clear `edgeFlickVelocity` (`1.8` px/ms by default) skips rules 1/2's "one index at a time" and jumps straight to the edge instead — closed on a hard downward flick, the top-most snap point on a hard upward one — the same way a forceful swipe behaves on a native iOS sheet.

### 6. Scroll handoff

The default slot's area listens for `pointerdown` and enters a `pending` state; which way the first movement goes decides who wins:

- **Downward** takes over the sheet only if `contentRef.scrollTop <= 0` — content is already scrolled to the very top. Otherwise it's handed entirely to native scrolling (scrolling back up through content shouldn't drag the sheet).
- **Upward** takes over the sheet as long as it isn't already resting on its top-most snap point — matches the "drag has priority until fully expanded" feel of Google Maps-style sheets. Once there's nowhere higher to go, further upward drags fall through to native scroll as usual.

A simpler rule (just a 4px movement threshold, no directional gate) applies to the `header` slot's area, so clicks on buttons inside it aren't hijacked by the drag but dragging works both ways. Set `grabberOnly` to skip all of this and only ever start a drag from the grabber bar.

One consequence worth knowing: with a long scrollable list inside a multi-snap-point sheet, an upward swipe anywhere on it expands the sheet first rather than scrolling — scrolling only takes over once you're resting on the top-most point.

While a drag is in flight, a `vbs-dragging` class is toggled on `<html>` — a hook for your own CSS, e.g. suppressing hover states or pausing unrelated transitions elsewhere on the page for the duration of the gesture.

## Accessibility

- `role="dialog"`, `aria-modal="true"`, configurable via `ariaLabel`.
- Focus moves into the panel on open and returns to the triggering element on close.
- `Tab`/`Shift+Tab` don't leave the panel while it's open (focus trap).
- `Escape` closes it (if `closeOnEscape`).
- `:inert="!isOpen"` — while the panel is hidden, it's excluded from focus and from screen readers.
- Respects `prefers-reduced-motion: reduce` — animations become instant.
- Dragging never starts from underneath interactive elements (`button, a, input, textarea, select, [role="button"]`).

## Package architecture

```
src/
├── BottomSheet.vue   — the component itself; shipped as source (not bundled)
├── types.ts           — shared types (Props/Emits/Exposed), imported by both the component and index.ts
├── index.ts            — plain-Vue entry point: component + plugin + re-exported types
└── nuxt.ts              — the Nuxt 3 module: auto-import via @nuxt/kit
```

`BottomSheet.vue` depends on neither Nuxt (`import.meta.client` is replaced with a universal `typeof window !== 'undefined'` check) nor Tailwind (styling is a self-contained `<style scoped>` block with CSS variables) — so the exact same file works identically as a plain Vue component and as a Nuxt auto-import.

The file is deliberately not pre-compiled to JS: it's resolved and compiled by whatever Vite/webpack pipeline the consumer already has, exactly as if it lived directly in their own `components/` folder. `index.ts`/`nuxt.ts` (plain `.ts` modules, no Vue syntax) are built to JS separately.

## Demo

**[Try it live](https://offkoenig.github.io/vue-native-bottom-sheet/)** — hosted on GitHub Pages, built from the same `demo/` app below.

A live demo lives in `demo/` — it imports the component straight from `src/`, so it always reflects the current code, not the published version.

```bash
npm run demo:dev     # Vite dev server with HMR
npm run demo:build   # builds demo-dist/index.html — a single self-contained file, open it directly in a browser
```

It covers: default snap points, multiple snap points, a non-dismissible sheet, custom theming through CSS variables, fitting to content height (`'content'` snap point, add/remove rows while it's open), a live physics playground (drag the sliders, then drag the sheet), and programmatic control through a template ref. Includes an EN/RU toggle in the top-right corner.

## Building from source

```bash
npm install
npm run build     # typecheck → .d.ts (vue-tsc) → .js (tsup) → copy BottomSheet.vue into dist/
```

After building, `dist/` contains:

```
dist/
├── BottomSheet.vue      (source, copied as-is)
├── BottomSheet.vue.d.ts  (precise prop/emit/slot types — generated by vue-tsc)
├── index.js / index.cjs / index.d.ts
├── nuxt.js / nuxt.d.ts   (ESM only — Nuxt 3 is ESM-first anyway, and path
│                          resolution relies on import.meta.url, which
│                          doesn't work in CJS)
└── types.d.ts
```

Before publishing: replace the placeholder in `LICENSE`, and rename the package in `package.json` (the `name` field) and in the import examples above, if needed.

## Troubleshooting

**It opens/closes instantly, with no animation.** This is almost always `prefers-reduced-motion: reduce` being active in your OS or browser — the component honors it on purpose (see Accessibility above), so this is by design, not a bug. To check: in Chrome/Edge DevTools, open the Command Menu (`Cmd/Ctrl+Shift+P`) → "Emulate CSS prefers-reduced-motion" → make sure it's not set to "reduce"; or check your OS accessibility settings (e.g. "Reduce motion" on macOS/iOS, "Reduce animations" on GNOME). If you specifically want the sheet to always animate regardless of that setting (a demo/showcase page, for instance), pass `:respect-reduced-motion="false"`.

**On a touch device, an open sheet occasionally triggers the browser's pull-to-refresh.** With `lockBodyScroll` (the default), the component sets `overscroll-behavior-y: none` on both `<html>` and `<body>` — that's what disables Chrome/Android's pull-to-refresh gesture recognizer, which is otherwise unaffected by the `position: fixed` scroll-lock trick itself. If you've set `:lock-body-scroll="false"`, that protection is off along with the rest of the scroll lock — either re-enable it, or add `overscroll-behavior-y: none` on `<html>`/`<body>` yourself for as long as the sheet is open.

**The page behind the sheet still scrolls even with `lockBodyScroll` on.** `lockBodyScroll` locks `<body>`/`window`. If your app's actual scroll container is something else — an app-shell wrapper with its own `overflow-y: auto`, for instance — locking `<body>` is a no-op for it. Pass that element (or a CSS selector for it) as `lockScrollTarget`.

**A focused input inside the sheet triggers the on-screen keyboard, and a translucent gap appears at the bottom.** iOS Safari's keyboard shrinks and pans the *visual* viewport, while a `position: fixed` panel stays anchored to the *layout* viewport — the two diverge once the keyboard is up, which is what the gap is. The component compensates automatically by tracking `visualViewport`'s `resize`/`scroll` events and shifting the panel to match. This has been reasoned through against documented `visualViewport` behavior and covered by automated tests for everything *except* the on-screen-keyboard case itself — headless browser automation can't trigger a real iOS keyboard, so that specific path hasn't been confirmed on physical hardware. If you still see the gap, please open an issue with your iOS/Safari version.

## Requirements

- Vue ≥ 3.4 (needs `defineModel()`).
- For the Nuxt module — Nuxt 3 (uses `@nuxt/kit`, listed as an optional peer dependency — no need to install it manually if you're already inside a Nuxt project).
- Any bundler with `.vue` file support (Vite, webpack + vue-loader) — in practice, any standard Vue 3 project.

## License

MIT
