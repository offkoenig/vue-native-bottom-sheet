/**
 * Public package types. Pulled into a separate file (rather than declared
 * inline inside BottomSheet.vue) so that:
 *  1. They can be imported into the component itself via `defineProps<BottomSheetProps>()`.
 *  2. They can be re-exported from index.ts for package consumers who need,
 *     say, to type their own prop as `BottomSheetProps['snapPoints']`.
 */

/** Same as what Vue accepts in `:class` — a string, object, or array (recursively). */
export type ClassValue = string | Record<string, boolean> | ClassValue[]

export interface BottomSheetProps {
  /**
   * Snap points. Each is either a number (% of viewport height, 0–100) or
   * the string `'content'` — the actual height of the header+default+footer
   * slots, measured via ResizeObserver and capped at 100dvh. If the content
   * changes while the sheet is open on this point, it re-springs to the
   * new height live. Order doesn't matter — sorted automatically (and
   * re-sorted whenever the measured 'content' height changes).
   */
  snapPoints?: (number | 'content')[]
  /** Index into snapPoints the sheet opens to by default. */
  defaultSnapPoint?: number
  /** Swipe velocity threshold (px/ms) above which an inertial transition/close kicks in. */
  closeThreshold?: number
  /** Resistance (0..1) of the rubber-band effect above the top snap point. 0.55 is WebKit/UIScrollView's own constant. */
  rubberBandResistance?: number
  /** Spring stiffness of the settle animation. Higher — faster and "tighter". */
  springStiffness?: number
  /** Spring damping. Higher — less "overshoot" at the end of the animation. */
  springDamping?: number
  /** Spring body mass (usually fine to leave alone). */
  springMass?: number
  /** Whether to honor the system's prefers-reduced-motion setting (instant transitions instead of a spring). Defaults to true — as it should for a real production app. Turn off only deliberately (e.g. in a demo/showcase whose whole point is to show the animation). */
  respectReducedMotion?: boolean
  /** Show the dimmed backdrop. */
  showBackdrop?: boolean
  /** Maximum backdrop opacity (0..1) at full openness. */
  backdropOpacity?: number
  /** Close on backdrop click. */
  closeOnBackdropClick?: boolean
  /** Close on Escape. */
  closeOnEscape?: boolean
  /** If false, the sheet can't be closed via swipe/backdrop/Escape — only programmatically (v-model, the slot's close prop, or a ref). */
  dismissible?: boolean
  /** Lock body scroll while the sheet is open (accounting for iOS Safari quirks). */
  lockBodyScroll?: boolean
  /**
   * If your app's actual scrollable container isn't `<body>`/`window` —
   * e.g. an app shell with its own `overflow-y: auto` wrapper — pass a CSS
   * selector or a direct element reference here. Its scroll gets locked
   * (via `overflow: hidden` + `overscroll-behavior-y: none`) alongside the
   * `<body>` lock for as long as the sheet is open; the `<body>` lock
   * itself becomes a harmless no-op if body was never the thing scrolling.
   * Governed by the same `lockBodyScroll` switch — set that to false to
   * disable both.
   */
  lockScrollTarget?: string | HTMLElement
  /**
   * A CSS color to apply to `<meta name="theme-color">` while the sheet is
   * open — this is what mobile browsers (most notably iOS Safari's
   * toolbar) tint their UI chrome with. The library has no way to sample
   * the actual rendered color of arbitrary slot content (gradients,
   * images, nested elements aren't reliably reducible to one color), so
   * this isn't automatic — pass whatever color your content actually is.
   * The previous `content` value (or the tag's absence) is restored when
   * the sheet closes. Left unset by default: no meta tag is touched
   * unless you opt in.
   */
  themeColor?: string
  /** aria-label for the dialog. */
  ariaLabel?: string
  /** Base z-index (backdrop = zIndex, the panel itself = zIndex + 1). */
  zIndex?: number
  /** Extra classes on the panel's root element — a way to layer your own (including Tailwind/UnoCSS) classes on top of the built-in styles. */
  panelClass?: ClassValue
  /** Extra classes on the scrollable content area. */
  contentClass?: ClassValue
  /** Extra classes on the backdrop. */
  backdropClass?: ClassValue
}

export interface BottomSheetEmits {
  /** The open animation has finished. */
  opened: []
  /** The close animation has finished (the panel is removed from the DOM). */
  closed: []
  /** The panel settled on one of the snapPoints (not on closed). */
  snap: [index: number, percent: number]
  /** A drag gesture started. */
  'drag-start': []
  /** The drag gesture ended; velocity in px/ms (+ down, − up). */
  'drag-end': [velocity: number]
}

/** What's available via a template ref (defineExpose). */
export interface BottomSheetExposed {
  /** Close programmatically (equivalent to v-model = false, but with no arguments — safe for @click). */
  close: () => void
  /** Instantly snap to a snap point by index, without closing or reopening. */
  snapToIndex: (index: number) => void
}
