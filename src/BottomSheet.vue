<script setup lang="ts">
/**
 * BottomSheet.vue
 * ──────────────────────────────────────────────────────────────────────────
 * A bottom sheet for Vue 3 built to feel native. Works in any Vue 3 (≥3.4)
 * project — Vite, webpack/vue-loader, Nuxt 3 (see the neighboring nuxt.ts
 * for auto-registration). Doesn't require Tailwind — all styling is
 * self-contained (scoped CSS + CSS custom properties for theming), and it
 * doesn't depend on `import.meta.client` (a Nuxt-specific macro) — instead
 * it uses the universal `typeof window !== 'undefined'` check.
 *
 * Core implementation principles (full details and math are in README.md):
 *  1. During a gesture, ONLY `transform: translate3d(...)` changes.
 *     top/bottom/height are never touched in real time → no reflow,
 *     only compositing → a genuinely stable 60 FPS.
 *  2. Open/close/snap are animated with a spring (Hooke's law + damping),
 *     not a fixed-duration CSS transition. Swipe velocity becomes the
 *     spring's initial velocity — the animation settles physically
 *     accurately rather than following one and the same easing curve.
 *  3. Rubber-band resistance when dragging past the fully-open point uses
 *     the same formula WebKit/UIScrollView itself uses for overscroll
 *     (constant 0.55).
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { BottomSheetProps, BottomSheetEmits, BottomSheetExposed } from './types'

/* A universal, framework-agnostic client check. SSR-safe: `typeof window`
   never throws a ReferenceError, even when window isn't declared at all
   (unlike accessing window directly). */
const isClient = typeof window !== 'undefined'

/* ════════════════════════════════════════════════════════════════════ *
 *  Props / Emits / v-model
 * ════════════════════════════════════════════════════════════════════ */

const props = withDefaults(defineProps<BottomSheetProps>(), {
  snapPoints: () => [50, 100],
  defaultSnapPoint: 0,
  closeThreshold: 0.5,
  edgeFlickVelocity: 1.8,
  rubberBandResistance: 0.55,
  springStiffness: 300,
  springDamping: 32,
  springMass: 1,
  respectReducedMotion: true,
  showBackdrop: true,
  backdropOpacity: 0.45,
  fadeFromIndex: undefined,
  closeOnBackdropClick: true,
  closeOnEscape: true,
  dismissible: true,
  grabberOnly: false,
  autoFocus: true,
  lockBodyScroll: true,
  scaleBackground: false,
  scaleBackgroundColor: '#000000',
  ariaLabel: 'Panel',
  zIndex: 60,
  panelClass: undefined,
  contentClass: undefined,
  backdropClass: undefined,
})

const emit = defineEmits<BottomSheetEmits>()

const isOpen = defineModel<boolean>({ default: false })

/* ════════════════════════════════════════════════════════════════════ *
 *  SSR / mounting
 * ════════════════════════════════════════════════════════════════════ */

const isMounted = ref(false) // true only on the client after onMounted — guards against hydration mismatches
const isInDom = ref(false) // lazy mount: content only renders after the first open

/* ════════════════════════════════════════════════════════════════════ *
 *  DOM refs
 * ════════════════════════════════════════════════════════════════════ */

const sheetRef = ref<HTMLElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)
const grabberZoneRef = ref<HTMLElement | null>(null)
const contentInnerRef = ref<HTMLElement | null>(null)
const footerRef = ref<HTMLElement | null>(null)

/* ════════════════════════════════════════════════════════════════════ *
 *  Geometry: converting snap points (%) to translateY pixels
 * ════════════════════════════════════════════════════════════════════ */

const viewportHeight = ref(0)
const viewportWidth = ref(0)

const usesContentFit = computed(() => (props.snapPoints ?? []).some((p) => p === 'content'))

/** Measured "natural" height of header+content+footer, for the 'content' snap point. */
const fitContentHeight = ref(0)

/** 0 = fully open (100% of viewport), viewportHeight = "closed" position. */
function percentToTranslate(percent: number): number {
  const clamped = Math.min(Math.max(percent, 0), 100)
  return viewportHeight.value * (1 - clamped / 100)
}

interface ResolvedSnapPoint {
  raw: number | 'content'
  /** translateY in px. */
  translate: number
  /** Equivalent in % of viewport — used for sorting and the `snap` event payload. */
  percent: number
}

/**
 * 'content' resolves to a translate independently of percentToTranslate:
 * content height is already a px quantity, so round-tripping it through
 * percent would only add rounding error. Sorting by percent means the
 * point order re-resolves itself if the measured 'content' height ever
 * overtakes or falls behind a neighboring fixed point.
 */
const resolvedSnapPoints = computed<ResolvedSnapPoint[]>(() => {
  const points = props.snapPoints?.length ? props.snapPoints : [100]
  const resolved = points.map((raw): ResolvedSnapPoint => {
    if (raw === 'content') {
      const height = Math.min(fitContentHeight.value, viewportHeight.value)
      const translate = Math.max(viewportHeight.value - height, 0)
      const percent = viewportHeight.value > 0 ? (height / viewportHeight.value) * 100 : 0
      return { raw, translate, percent }
    }
    const percent = Math.min(Math.max(raw, 0), 100)
    return { raw, translate: percentToTranslate(percent), percent }
  })
  return resolved.sort((a, b) => a.percent - b.percent)
})

const clampedDefaultIndex = computed(() =>
  Math.min(Math.max(props.defaultSnapPoint, 0), resolvedSnapPoints.value.length - 1),
)

const snapTranslates = computed(() => resolvedSnapPoints.value.map((r) => r.translate))
/** translateY of the fully-open point — the upper bound past which rubber-band kicks in. */
const minTranslate = computed(() => snapTranslates.value[snapTranslates.value.length - 1] ?? 0)
/** translateY of the fully-closed state — the whole panel below the bottom edge of the screen. */
const closedTranslate = computed(() => viewportHeight.value)

const currentSnapIndex = ref(0)
const translateY = ref(0)
const isDragging = ref(false)
const isAnimating = ref(false)

/**
 * `position: fixed` stays anchored to the LAYOUT viewport, but iOS
 * Safari's on-screen keyboard only shrinks and pans the VISUAL viewport
 * (`visualViewport.offsetTop` grows as the page pans to keep the focused
 * input visible above the keyboard) — `window.innerHeight` doesn't
 * reliably shrink to match. Left uncompensated, a `bottom: 0` panel stays
 * pinned to the layout viewport's bottom, which ends up hidden under the
 * keyboard, leaving a visible gap between the panel and the actually-
 * visible bottom edge of the screen. `keyboardInset` is that gap, applied
 * as an extra upward shift in `sheetStyle` below. It's 0 whenever there's
 * no keyboard (or no visualViewport support), so this is a no-op outside
 * that specific scenario.
 */
const keyboardInset = ref(0)

function updateViewportHeight() {
  if (!isClient) return
  const vv = window.visualViewport
  if (vv) {
    viewportHeight.value = vv.height
    keyboardInset.value = Math.max(window.innerHeight - vv.offsetTop - vv.height, 0)
  } else {
    viewportHeight.value = window.innerHeight
    keyboardInset.value = 0
  }
  viewportWidth.value = window.innerWidth
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Rubber band — WebKit/UIScrollView's formula: f(x,d,c) = x·d·c / (d + c·x)
 * ════════════════════════════════════════════════════════════════════ */

function rubberBand(overshoot: number, dimension: number, constant: number): number {
  if (dimension <= 0 || overshoot <= 0) return Math.max(overshoot, 0)
  return (overshoot * dimension * constant) / (dimension + constant * overshoot)
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Spring animation (semi-implicit Euler)
 * ════════════════════════════════════════════════════════════════════ */

let rafId: number | null = null
let reducedMotionQuery: MediaQueryList | null = null
/** Last spring target — so the content-resize handler doesn't restart the animation toward the same target. */
let lastSpringTarget: number | null = null
/** The onDone of whichever spring is currently in flight — lets a mid-animation re-target (see onViewportResize) preserve it instead of silently dropping it. */
let currentSpringOnDone: (() => void) | undefined

function cancelSpringAnimation() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

/**
 * Animates translateY.value toward target, starting from the current
 * position and a given initial velocity (usually the measured swipe
 * velocity, in px/ms).
 */
function springAnimateTo(target: number, initialVelocity: number, onDone?: () => void) {
  cancelSpringAnimation()
  lastSpringTarget = target
  currentSpringOnDone = onDone

  if (props.respectReducedMotion && reducedMotionQuery?.matches) {
    translateY.value = target
    currentSpringOnDone = undefined
    onDone?.()
    return
  }

  isAnimating.value = true

  let position = translateY.value
  // px/ms → px/s, clamped against anomalous velocity spikes
  let velocity = Math.max(Math.min(initialVelocity, 6), -6) * 1000

  const { springStiffness: k, springDamping: c, springMass: m } = props
  let lastTime = performance.now()

  const step = (now: number) => {
    const dt = Math.min((now - lastTime) / 1000, 1 / 30) // guards against spikes (e.g. switching tabs)
    lastTime = now

    const displacement = position - target
    const acceleration = (-k * displacement - c * velocity) / m

    velocity += acceleration * dt
    position += velocity * dt
    translateY.value = position

    const atRest = Math.abs(velocity) < 6 && Math.abs(position - target) < 0.5
    if (atRest) {
      translateY.value = target
      isAnimating.value = false
      rafId = null
      currentSpringOnDone = undefined
      onDone?.()
      return
    }
    rafId = requestAnimationFrame(step)
  }

  rafId = requestAnimationFrame(step)
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Body scroll lock (accounting for iOS Safari)
 * ════════════════════════════════════════════════════════════════════ */

let savedScrollY = 0
let savedBodyStyles: Record<string, string> = {}
let savedHtmlOverscrollBehaviorY = ''
let isScrollLocked = false

function lockScroll() {
  if (!isClient || !props.lockBodyScroll || isScrollLocked) return
  isScrollLocked = true
  const body = document.body
  const html = document.documentElement
  savedScrollY = window.scrollY
  savedBodyStyles = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
    overscrollBehaviorY: body.style.overscrollBehaviorY,
  }
  body.style.position = 'fixed'
  body.style.top = `-${savedScrollY}px`
  body.style.left = '0'
  body.style.right = '0'
  body.style.width = '100%'
  body.style.overflow = 'hidden'
  // `position: fixed` alone stops body's own scrollbar from moving, but
  // browsers' pull-to-refresh (Chrome/Android, PWA/WebView shells) is a
  // separate gesture recognizer keyed off overscroll-behavior-y on the
  // viewport, unaffected by that trick — hence it firing intermittently
  // even with the sheet "locking" scroll. Different engines key it off
  // <html> or <body>, so both get it, saved/restored the same way as the
  // rest of the locked styles.
  body.style.overscrollBehaviorY = 'none'
  savedHtmlOverscrollBehaviorY = html.style.overscrollBehaviorY
  html.style.overscrollBehaviorY = 'none'
}

function unlockScroll() {
  if (!isClient || !props.lockBodyScroll || !isScrollLocked) return
  isScrollLocked = false
  const body = document.body
  const html = document.documentElement
  body.style.position = savedBodyStyles.position ?? ''
  body.style.top = savedBodyStyles.top ?? ''
  body.style.left = savedBodyStyles.left ?? ''
  body.style.right = savedBodyStyles.right ?? ''
  body.style.width = savedBodyStyles.width ?? ''
  body.style.overflow = savedBodyStyles.overflow ?? ''
  body.style.overscrollBehaviorY = savedBodyStyles.overscrollBehaviorY ?? ''
  html.style.overscrollBehaviorY = savedHtmlOverscrollBehaviorY
  window.scrollTo(0, savedScrollY)
}

/**
 * Locking `<body>` is enough to stop the page from scrolling ONLY if
 * `<body>`/`window` is actually what scrolls in the consumer's app. Plenty
 * of app shells instead wrap everything in their own `overflow-y: auto`
 * container, in which case the `<body>` lock above is a complete no-op —
 * `lockScrollTarget` names that real scrollable element. Unlike the
 * `<body>` case, an ordinary element's scrollTop isn't disturbed by
 * toggling its own `overflow`, so none of the position-save/restore
 * dance above is needed here — `overflow: hidden` alone freezes it in
 * place, and reverting it resumes scrolling from the same spot.
 */
let scrollLockTargetEl: HTMLElement | null = null
let savedTargetOverflow = ''
let savedTargetOverscrollBehaviorY = ''
let isTargetScrollLocked = false

function resolveScrollLockTarget(): HTMLElement | null {
  const target = props.lockScrollTarget
  if (!target) return null
  return typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target
}

function lockTargetScroll() {
  if (!isClient || !props.lockBodyScroll || isTargetScrollLocked) return
  const el = resolveScrollLockTarget()
  if (!el) return
  scrollLockTargetEl = el
  isTargetScrollLocked = true
  savedTargetOverflow = el.style.overflow
  savedTargetOverscrollBehaviorY = el.style.overscrollBehaviorY
  el.style.overflow = 'hidden'
  el.style.overscrollBehaviorY = 'none'
}

function unlockTargetScroll() {
  if (!isClient || !isTargetScrollLocked || !scrollLockTargetEl) return
  scrollLockTargetEl.style.overflow = savedTargetOverflow
  scrollLockTargetEl.style.overscrollBehaviorY = savedTargetOverscrollBehaviorY
  scrollLockTargetEl = null
  isTargetScrollLocked = false
}

/* ════════════════════════════════════════════════════════════════════ *
 *  theme-color sync (opt-in via the themeColor prop)
 * ════════════════════════════════════════════════════════════════════ */

let isThemeColorApplied = false
let savedThemeColorMeta: { existed: boolean; content: string } | null = null

function getThemeColorMeta(): HTMLMetaElement | null {
  return document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
}

function applyThemeColor() {
  if (!isClient || !props.themeColor || isThemeColorApplied) return
  isThemeColorApplied = true
  let meta = getThemeColorMeta()
  if (meta) {
    savedThemeColorMeta = { existed: true, content: meta.getAttribute('content') ?? '' }
  } else {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
    savedThemeColorMeta = { existed: false, content: '' }
  }
  meta.setAttribute('content', props.themeColor)
}

function restoreThemeColor() {
  if (!isClient || !isThemeColorApplied) return
  isThemeColorApplied = false
  const meta = getThemeColorMeta()
  if (meta && savedThemeColorMeta) {
    if (savedThemeColorMeta.existed) meta.setAttribute('content', savedThemeColorMeta.content)
    else meta.remove()
  }
  savedThemeColorMeta = null
}

/** Live-updates the tag's content if themeColor changes while the sheet is already open — doesn't touch savedThemeColorMeta, which must keep holding the pre-open value for a correct restore on close. */
watch(
  () => props.themeColor,
  (color) => {
    if (!isThemeColorApplied || !color) return
    getThemeColorMeta()?.setAttribute('content', color)
  },
)

/* ════════════════════════════════════════════════════════════════════ *
 *  scaleBackground — iOS-style "card stack" scale of the app behind the
 *  sheet, opt-in via the scaleBackground prop. Unlike vaul's version
 *  (a fixed-duration CSS transition triggered at commit points), this is
 *  driven by the same live translateY the sheet and backdrop already use —
 *  a computed style, applied imperatively since the target element lives
 *  outside this component's own template (it's addressed via a
 *  data-attribute selector, not a ref).
 * ════════════════════════════════════════════════════════════════════ */

const SCALE_BACKGROUND_WIDTH_INSET = 26 // px "shrink" of the background at full openness — matches iOS's own card-stack proportions
const SCALE_BACKGROUND_RADIUS = 8 // px corner radius at full openness
const SCALE_BACKGROUND_TOP_GAP = 14 // px the background peeks down by at full openness

let scaleBackgroundEl: HTMLElement | null = null
let savedScaleBackgroundStyle: { transform: string; borderRadius: string; overflow: string; transformOrigin: string } | null = null
let isScaleBackgroundApplied = false
let savedBodyBackground: string | null = null
/** Tracks whether body's background is currently swapped to scaleBackgroundColor, so the reactive watcher below only writes to it on an actual on/off transition — not on every frame the scale animates through. */
let isBodyBackgroundOn = false

function applyScaleBackground() {
  if (!isClient || !props.scaleBackground || isScaleBackgroundApplied) return
  const el = document.querySelector<HTMLElement>('[data-vbs-background]')
  if (!el) return
  scaleBackgroundEl = el
  isScaleBackgroundApplied = true
  savedScaleBackgroundStyle = {
    transform: el.style.transform,
    borderRadius: el.style.borderRadius,
    overflow: el.style.overflow,
    transformOrigin: el.style.transformOrigin,
  }
  el.style.transformOrigin = 'top'
  savedBodyBackground = document.body.style.background
}

function restoreScaleBackground() {
  if (!isClient || !isScaleBackgroundApplied || !scaleBackgroundEl) return
  const el = scaleBackgroundEl
  const saved = savedScaleBackgroundStyle
  isScaleBackgroundApplied = false
  scaleBackgroundEl = null
  savedScaleBackgroundStyle = null
  if (saved) {
    el.style.transform = saved.transform
    el.style.borderRadius = saved.borderRadius
    el.style.overflow = saved.overflow
    el.style.transformOrigin = saved.transformOrigin
  }
  document.body.style.background = savedBodyBackground ?? ''
  savedBodyBackground = null
  isBodyBackgroundOn = false
}

/**
 * A lagged copy of minTranslate: tracks it normally, except it withholds a
 * move to a MORE open (smaller) value until translateY has actually caught
 * up to at least that point. minTranslate updates the instant a 'content'
 * snap point's measured height changes, but translateY only follows it
 * gradually via the spring — using minTranslate directly in openProgress
 * below would make it (and backdrop/scaleBackground, which read off it)
 * visibly dip for a frame every time content grows while resting on that
 * point, since the "open" boundary jumps ahead of the position it's
 * measured against. Shrinking the target doesn't have this problem (the
 * ratio only ever clamps toward 1, never dips), so only that direction
 * needs withholding.
 */
const stableMinTranslate = ref(minTranslate.value)
watch(
  [minTranslate, translateY],
  ([mt, ty]) => {
    if (mt >= stableMinTranslate.value || ty <= mt) {
      stableMinTranslate.value = mt
    }
  },
  { immediate: true },
)

/** 0 (closed) .. 1 (resting on the top-most snap point) — the "no fadeFromIndex" baseline both the backdrop and the background scale fall back to. */
const openProgress = computed(() => {
  const open = stableMinTranslate.value
  const closed = closedTranslate.value
  const range = closed - open || 1
  return 1 - Math.min(Math.max((translateY.value - open) / range, 0), 1)
})

/**
 * 0..1, shared by the backdrop and the background scale so they stay in
 * lockstep. Without fadeFromIndex it's just openProgress; with it, ramps
 * from 0 at the snap point just *before* fadeFromIndex (or fully closed,
 * if fadeFromIndex is 0) up to 1 exactly at fadeFromIndex itself, and
 * stays 1 for anything more open than that — resting ON fadeFromIndex
 * must read as "fully shown," not as the far edge of a range that's never
 * actually reached in normal use.
 */
const dimProgress = computed(() => {
  if (props.fadeFromIndex === undefined) return openProgress.value
  const snaps = snapTranslates.value
  if (snaps.length === 0) return openProgress.value
  const idx = Math.min(Math.max(props.fadeFromIndex, 0), snaps.length - 1)
  const upper = snaps[idx] // fadeFromIndex's own translateY — progress reaches 1 here (and anything more open)
  const lower = idx > 0 ? snaps[idx - 1] : closedTranslate.value // the point just before it (or fully closed) — progress is 0 here (and anything less open)
  const range = lower - upper || 1
  return Math.min(Math.max((lower - translateY.value) / range, 0), 1)
})

const scaleBackgroundStyle = computed(() => {
  if (!props.scaleBackground) return null
  const progress = dimProgress.value
  const scaleTarget = viewportWidth.value > 0 ? (viewportWidth.value - SCALE_BACKGROUND_WIDTH_INSET) / viewportWidth.value : 1
  const scale = 1 - (1 - scaleTarget) * progress
  const topGap = SCALE_BACKGROUND_TOP_GAP * progress
  return {
    transform: `scale(${scale}) translate3d(0, calc(env(safe-area-inset-top) + ${topGap.toFixed(2)}px), 0)`,
    borderRadius: `${(SCALE_BACKGROUND_RADIUS * progress).toFixed(2)}px`,
    overflow: progress > 0.001 ? 'hidden' : (savedScaleBackgroundStyle?.overflow ?? ''),
  }
})

watch(scaleBackgroundStyle, (style) => {
  if (!isScaleBackgroundApplied || !scaleBackgroundEl || !style) return
  scaleBackgroundEl.style.transform = style.transform
  scaleBackgroundEl.style.borderRadius = style.borderRadius
  scaleBackgroundEl.style.overflow = style.overflow
  // Only the actual on/off transition writes to body — not every frame the
  // scale animates through — and only once there's a real gap for it to
  // fill (progress > 0), so a "peek" position (dimProgress still 0) never
  // touches body's background at all.
  const shouldShowBodyBackground = style.overflow === 'hidden'
  if (shouldShowBodyBackground !== isBodyBackgroundOn) {
    isBodyBackgroundOn = shouldShowBodyBackground
    document.body.style.background = shouldShowBodyBackground ? props.scaleBackgroundColor : (savedBodyBackground ?? '')
  }
})

/* ════════════════════════════════════════════════════════════════════ *
 *  Auto-fitting to content height (the 'content' snap point)
 * ════════════════════════════════════════════════════════════════════ */

let contentResizeObserver: ResizeObserver | null = null

/**
 * grabberZoneRef and footerRef don't participate in flex stretching
 * (flex-shrink: 0), so their offsetHeight already equals their natural
 * height. .vbs-content, though, stretches to fill all available space
 * (flex: 1 1 auto) — measuring it directly is meaningless, hence
 * contentInnerRef: a plain block div inside the scroll container that
 * doesn't participate in stretching, whose offsetHeight is the slot's
 * real height regardless of how much space flex gave it.
 */
function measureFitContentHeight() {
  const grabberH = grabberZoneRef.value?.offsetHeight ?? 0
  const contentH = contentInnerRef.value?.offsetHeight ?? 0
  const footerH = footerRef.value?.offsetHeight ?? 0
  fitContentHeight.value = grabberH + contentH + footerH
}

/**
 * Live reaction to content height changes while the sheet is already open
 * (an accordion expands, an image loads, etc.): if the 'content' snap
 * point is currently active, the spring settles toward the new height.
 * Doesn't interfere with an active user drag, and doesn't duplicate the
 * animation if the height hasn't actually changed (ResizeObserver's
 * initial callback fires right after observe(), by which point the
 * opening animation has already accounted for it).
 */
function onContentResize() {
  measureFitContentHeight()
  if (!isOpen.value || !isInDom.value || isDragging.value) return
  const target = snapTranslates.value[currentSnapIndex.value]
  if (target === undefined) return
  if (lastSpringTarget !== null && Math.abs(target - lastSpringTarget) < 0.5) return
  const targetIndex = currentSnapIndex.value
  springAnimateTo(target, 0, () => {
    emit('snap', targetIndex, resolvedSnapPoints.value[targetIndex]?.percent ?? 0)
  })
}

function setupContentResizeObserver() {
  if (!isClient || !usesContentFit.value || typeof ResizeObserver === 'undefined') return
  contentResizeObserver?.disconnect()
  contentResizeObserver = new ResizeObserver(onContentResize)
  for (const el of [grabberZoneRef.value, contentInnerRef.value, footerRef.value]) {
    if (el) contentResizeObserver.observe(el)
  }
}

function teardownContentResizeObserver() {
  contentResizeObserver?.disconnect()
  contentResizeObserver = null
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Open / close
 * ════════════════════════════════════════════════════════════════════ */

let previouslyFocused: HTMLElement | null = null
/** True from the start of openSheet() until its spring actually kicks off — see the comment in openSheet() for why onViewportResize needs to ignore resize events during that window. */
let isOpeningPending = false
let lastVelocity = 0 // px/ms; needed so the closing animation carries over the flick's velocity

function openSheet() {
  // If the panel was already in the DOM (e.g. the user changed their mind
  // about closing and reopened it right during the closing animation) —
  // don't yank translateY to "closed", just re-target the spring from its
  // current position. Otherwise there'd be a visible downward "jump"
  // before opening.
  const wasAlreadyInDom = isInDom.value

  // Important: translateY is set to the closed position BEFORE isInDom =
  // true — i.e. BEFORE Vue even creates the panel's DOM node. Doing this
  // later (inside nextTick, as it used to be) would render the panel's
  // very first frame with the old translateY (0 — "open"), only jumping to
  // the closed position on the next step: an extra reactive pass, and a
  // risk that the browser collapses both updates into a single paint,
  // making the opening animation invisible entirely — that's exactly what
  // the "the sheet just appears with no animation" bug looks like.
  if (!wasAlreadyInDom) {
    updateViewportHeight()
    translateY.value = closedTranslate.value
  }

  isInDom.value = true
  // lockScroll() (below) sets body's overflow to hidden, which on desktop
  // (unlike touch/mobile, where scrollbars are typically overlay and don't
  // reserve layout width) reclaims the vertical scrollbar's width — a
  // genuine viewport size change, which fires a visualViewport 'resize'
  // synchronously-ish, before springAnimateTo below has even started.
  // onViewportResize would see isAnimating still false at that point and
  // jump translateY straight to the target itself; by the time the real
  // spring kicks in a moment later, displacement is already 0 and it
  // "completes" in a single frame — the opening animation never visibly
  // plays. isOpeningPending suppresses onViewportResize's reaction for
  // exactly that narrow window.
  isOpeningPending = true
  lockScroll()
  lockTargetScroll()
  applyThemeColor()
  applyScaleBackground()
  nextTick(() => {
    currentSnapIndex.value = clampedDefaultIndex.value
    // Measure BEFORE reading snapTranslates below — otherwise, the very
    // first time, 'content' would resolve against fitContentHeight.value's
    // default (0), i.e. the closed position.
    if (usesContentFit.value) {
      measureFitContentHeight()
      setupContentResizeObserver()
    }
    requestAnimationFrame(() => {
      isOpeningPending = false
      springAnimateTo(snapTranslates.value[currentSnapIndex.value], 0, () => {
        emit('opened')
        if (props.autoFocus) sheetRef.value?.focus()
      })
    })
  })
}

/** Internal version: used when closing from a gesture, to pass the flick's velocity into the animation. */
function closeWithVelocity(velocity: number) {
  lastVelocity = velocity
  isOpen.value = false
}

/**
 * Public close function — takes no arguments.
 * Deliberately doesn't accept a payload, so `<button @click="close">` in
 * slots is safe: the DOM would pass a PointerEvent there, not a number,
 * and that would fill the spring's velocity with garbage (NaN).
 */
function close() {
  closeWithVelocity(0)
}

function requestClose() {
  if (props.dismissible) close()
}

watch(isOpen, (open) => {
  if (!isClient) return
  if (open) {
    previouslyFocused = document.activeElement as HTMLElement
    openSheet()
  } else {
    springAnimateTo(closedTranslate.value, lastVelocity, () => {
      isInDom.value = false
      unlockScroll()
      unlockTargetScroll()
      restoreThemeColor()
      restoreScaleBackground()
      teardownContentResizeObserver()
      emit('closed')
      previouslyFocused?.focus?.()
    })
    lastVelocity = 0
  }
})

/* ════════════════════════════════════════════════════════════════════ *
 *  External programmatic control (template ref + defineExpose)
 * ════════════════════════════════════════════════════════════════════ */

function snapToIndex(index: number) {
  const clamped = Math.min(Math.max(index, 0), resolvedSnapPoints.value.length - 1)
  currentSnapIndex.value = clamped
  if (isOpen.value) {
    springAnimateTo(snapTranslates.value[clamped], 0, () => {
      emit('snap', clamped, resolvedSnapPoints.value[clamped]?.percent ?? 0)
    })
  }
}

defineExpose<BottomSheetExposed>({ close, snapToIndex })

/* ════════════════════════════════════════════════════════════════════ *
 *  Gesture: pointer events, velocity, rubber band, scroll handoff
 * ════════════════════════════════════════════════════════════════════ */

interface Sample {
  y: number
  t: number
}

type DragPhase = 'idle' | 'pending' | 'dragging'

let dragPhase: DragPhase = 'idle'
let activePointerId: number | null = null
let startY = 0
let startTranslate = 0
let samples: Sample[] = []
/** Receives the raw first-movement deltaY (px; negative = upward) so each pending source can decide whether to take over by direction, not just a fixed yes/no. */
let pendingGate: (deltaY: number) => boolean = () => true

/** A hook for consumer CSS — e.g. suppressing hover states or pausing transitions on other elements while a drag is in flight. */
watch(isDragging, (dragging) => {
  if (!isClient) return
  document.documentElement.classList.toggle('vbs-dragging', dragging)
})

const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [role="button"], [contenteditable="true"]'

function isInteractiveTarget(target: EventTarget | null): boolean {
  return !!(target as HTMLElement | null)?.closest?.(INTERACTIVE_SELECTOR)
}

function pushSample(y: number) {
  const t = performance.now()
  samples.push({ y, t })
  const cutoff = t - 150
  while (samples.length > 2 && samples[0].t < cutoff) samples.shift()
}

/** px/ms; a positive value means downward movement. */
function getVelocity(): number {
  if (samples.length < 2) return 0
  const first = samples[0]
  const last = samples[samples.length - 1]
  const dt = last.t - first.t
  if (dt <= 0) return 0
  return (last.y - first.y) / dt
}

function attachWindowListeners() {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}
function detachWindowListeners() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

function beginPending(e: PointerEvent, gate: (deltaY: number) => boolean) {
  if (isInteractiveTarget(e.target) || isAnimating.value) return
  activePointerId = e.pointerId
  dragPhase = 'pending'
  pendingGate = gate
  startY = e.clientY
  startTranslate = translateY.value
  samples = []
  pushSample(e.clientY)
  attachWindowListeners()
}

function beginDragging(e: PointerEvent) {
  if (isAnimating.value) return
  activePointerId = e.pointerId
  dragPhase = 'dragging'
  startY = e.clientY
  startTranslate = translateY.value
  samples = []
  pushSample(e.clientY)
  isDragging.value = true
  emit('drag-start')
  attachWindowListeners()
}

/** The small grabber-bar indicator — starts dragging immediately, no movement threshold. */
function onGrabberPointerDown(e: PointerEvent) {
  beginDragging(e)
}
/** The header slot's area — has a movement threshold, so it doesn't interfere with clicks on buttons inside it. */
function onHeaderPointerDown(e: PointerEvent) {
  if (props.grabberOnly) return
  beginPending(e, () => true)
}
/**
 * The scrollable content area. Dragging down only takes over the sheet
 * once content is scrolled all the way to the top (otherwise it's a
 * normal scroll-back-up). Dragging up always takes over instead of
 * scrolling, as long as there's a more-open snap point left — matches the
 * "drag has priority until fully expanded" behavior of Google Maps-style
 * sheets. Once resting on the top-most snap point, further upward drags
 * fall through to native content scroll as usual.
 */
function onContentPointerDown(e: PointerEvent) {
  if (props.grabberOnly) return
  beginPending(e, (deltaY) => {
    if (deltaY >= 0) return (contentRef.value?.scrollTop ?? 0) <= 0
    return currentSnapIndex.value < snapTranslates.value.length - 1
  })
}

function cancelPending() {
  dragPhase = 'idle'
  activePointerId = null
  detachWindowListeners()
}

/*
 * pointermove can fire far more often than the display actually paints —
 * especially on high-sampling-rate touchscreens (120Hz+), where it isn't
 * rate-limited to the compositor's pace the way it tends to be on a 60Hz
 * screen. Writing translateY.value straight from the event handler means
 * Vue's reactive flush (a microtask, not vsync-aligned) runs once per
 * *input* sample rather than once per *frame* — extra, wasted reactive
 * passes that don't correspond to an actual paint, which is what reads as
 * "janky" rather than smooth, and is more noticeable the higher the
 * display's refresh rate (less frame budget to absorb the overhead).
 * Instead, onPointerMove only records the latest pointer position; a
 * single rAF callback applies it (and computes rubber-band) once per
 * frame, in step with the browser's own paint cadence.
 */
let dragRafId: number | null = null
let latestDragClientY: number | null = null

function computeDragTranslate(clientY: number): number {
  const raw = startTranslate + (clientY - startY)
  let next = raw

  if (next < minTranslate.value) {
    const overshoot = minTranslate.value - next
    next = minTranslate.value - rubberBand(overshoot, viewportHeight.value, props.rubberBandResistance)
  }
  return Math.min(next, closedTranslate.value)
}

function flushDragFrame() {
  dragRafId = null
  if (latestDragClientY === null) return
  translateY.value = computeDragTranslate(latestDragClientY)
}

function scheduleDragFrame() {
  if (dragRafId !== null) return
  dragRafId = requestAnimationFrame(flushDragFrame)
}

/** Cancels any pending frame and, if one was queued, applies it synchronously — so translateY reflects the exact last pointer position before a spring animation reads it as its start. */
function finalizeDragFrame() {
  if (dragRafId !== null) {
    cancelAnimationFrame(dragRafId)
    dragRafId = null
  }
  if (latestDragClientY !== null) {
    translateY.value = computeDragTranslate(latestDragClientY)
    latestDragClientY = null
  }
}

function onPointerMove(e: PointerEvent) {
  if (e.pointerId !== activePointerId) return

  if (dragPhase === 'pending') {
    const deltaY = e.clientY - startY
    const THRESHOLD = 4
    if (Math.abs(deltaY) < THRESHOLD) return
    if (!pendingGate(deltaY)) {
      cancelPending()
      return
    }
    dragPhase = 'dragging'
    isDragging.value = true
    emit('drag-start')
    startY = e.clientY
    startTranslate = translateY.value
    samples = []
    pushSample(e.clientY)
    return
  }

  if (dragPhase !== 'dragging') return
  e.preventDefault()
  pushSample(e.clientY)
  latestDragClientY = e.clientY
  scheduleDragFrame()
}

function onPointerUp(e: PointerEvent) {
  if (e.pointerId !== activePointerId) return
  detachWindowListeners()
  const wasDragging = dragPhase === 'dragging'
  dragPhase = 'idle'
  activePointerId = null
  isDragging.value = false

  if (!wasDragging) return
  finalizeDragFrame()

  const velocity = getVelocity()
  emit('drag-end', velocity)
  settle(velocity)
}

function findNearestIndex(value: number, arr: number[]): number {
  let bestIndex = 0
  let bestDistance = Infinity
  arr.forEach((candidate, index) => {
    const distance = Math.abs(candidate - value)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })
  return bestIndex
}

function settle(velocity: number) {
  const snaps = snapTranslates.value
  let targetIndex = currentSnapIndex.value
  let closing = false
  // A flick fast enough to clear edgeFlickVelocity jumps straight to the
  // edge (closed, or the top-most snap point) instead of moving one snap
  // at a time — mirrors how a hard swipe on a native iOS sheet behaves.
  const isEdgeFlick = Math.abs(velocity) > props.edgeFlickVelocity

  if (velocity > props.closeThreshold) {
    // fast downward flick — move to the snap point below; if already at the lowest one (or flicked hard enough), close
    if (isEdgeFlick || currentSnapIndex.value <= 0) closing = true
    else targetIndex = currentSnapIndex.value - 1
  } else if (velocity < -props.closeThreshold) {
    // fast upward flick — move to the snap point above, or straight to the top on an edge flick
    targetIndex = isEdgeFlick ? snaps.length - 1 : Math.min(currentSnapIndex.value + 1, snaps.length - 1)
  } else {
    // slow release — stick to whichever point is nearest (including "closed")
    const candidates = [...snaps, closedTranslate.value]
    const nearest = findNearestIndex(translateY.value, candidates)
    closing = nearest === candidates.length - 1
    if (!closing) targetIndex = nearest
  }

  if (closing && !props.dismissible) {
    closing = false
    targetIndex = 0
  }

  if (closing) {
    closeWithVelocity(velocity)
    return
  }

  currentSnapIndex.value = targetIndex
  springAnimateTo(snaps[targetIndex], velocity, () => {
    emit('snap', targetIndex, resolvedSnapPoints.value[targetIndex]?.percent ?? 0)
  })
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Keyboard: Escape closes, Tab is a focus trap inside the panel
 * ════════════════════════════════════════════════════════════════════ */

function onDocumentKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value && props.closeOnEscape) {
    requestClose()
  }
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function getFocusableElements(): HTMLElement[] {
  if (!sheetRef.value) return []
  return Array.from(sheetRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null,
  )
}

function onSheetKeydown(e: KeyboardEvent) {
  if (e.key !== 'Tab') return
  const focusable = getFocusableElements()
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Resize / lifecycle
 * ════════════════════════════════════════════════════════════════════ */

function onViewportResize() {
  updateViewportHeight()
  // A width change (e.g. rotating the screen) can reflow the content's
  // line breaks and its natural height — recompute before reading snapTranslates.
  if (usesContentFit.value) measureFitContentHeight()
  if (!isInDom.value || isDragging.value || isOpeningPending) return

  const target = snapTranslates.value[currentSnapIndex.value] ?? closedTranslate.value
  if (isAnimating.value) {
    // A resize mid-animation (e.g. iOS Safari's toolbar collapsing right
    // as body-scroll-lock engages, or the keyboard opening) means the
    // spring's original target was computed against a since-stale
    // viewport height. Re-target instead of leaving it to settle at the
    // wrong position — springAnimateTo picks up from the current position,
    // so this reads as a course-correction, not a jump. currentSpringOnDone
    // carries over whatever completion callback the interrupted animation
    // had (e.g. `opened`/`snap`), so it isn't silently dropped.
    springAnimateTo(target, 0, currentSpringOnDone)
  } else {
    translateY.value = target
  }
}

function onBackdropClick() {
  if (props.closeOnBackdropClick) requestClose()
}

const backdropStyle = computed(() => ({
  opacity: dimProgress.value * props.backdropOpacity,
  zIndex: props.zIndex,
}))

const sheetStyle = computed(() => ({
  transform: `translate3d(0, ${translateY.value - keyboardInset.value}px, 0)`,
  zIndex: props.zIndex + 1,
}))

/**
 * The footer sits in the same flex flow as before (this keeps
 * .vbs-content's available-space math unchanged), but the panel has a
 * fixed 100dvh height and translateY shifts it down — at any snap point
 * below 100% the footer, as the last flex item, physically ends up
 * outside the visible screen area (see README/PR: "Got it, close" was
 * unreachable).
 *
 * The footer's correct on-screen position doesn't depend on how far the
 * sheet is extended — it's always the bottom edge of the viewport (unlike
 * the header, which must move together with the sheet). So instead of
 * changing layout (which would mean a reflow on every drag frame), the
 * footer gets its own transform that cancels out the parent's translateY:
 * the net on-screen shift is zero, and the footer stays glued to the
 * bottom of the screen through any drag/snap, remaining a pure
 * transform effect (compositing, not layout).
 */
const footerStyle = computed(() => ({
  transform: `translate3d(0, ${-translateY.value}px, 0)`,
}))

// onMounted/onBeforeUnmount are guaranteed to run client-side only (this
// is a Vue contract), so isClient checks aren't needed inside them —
// they're only needed in functions that CAN also be called from places
// not guarded by the lifecycle (watch(isOpen), updateViewportHeight, etc.).
onMounted(() => {
  isMounted.value = true
  updateViewportHeight()
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

  if (isOpen.value) {
    previouslyFocused = document.activeElement as HTMLElement
    openSheet()
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewportResize)
    // `offsetTop` (how far the visual viewport has panned within the
    // layout viewport) can change independently of `resize` — iOS fires
    // `scroll` for that as it pans the page to keep a focused input above
    // the keyboard, without necessarily also firing `resize`.
    window.visualViewport.addEventListener('scroll', onViewportResize)
  } else {
    window.addEventListener('resize', onViewportResize)
  }
  document.addEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  cancelSpringAnimation()
  if (dragRafId !== null) cancelAnimationFrame(dragRafId)
  detachWindowListeners()
  document.documentElement.classList.remove('vbs-dragging')
  teardownContentResizeObserver()
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', onViewportResize)
    window.visualViewport.removeEventListener('scroll', onViewportResize)
  } else {
    window.removeEventListener('resize', onViewportResize)
  }
  document.removeEventListener('keydown', onDocumentKeydown)
  if (isOpen.value) {
    unlockScroll()
    unlockTargetScroll()
    restoreThemeColor()
    restoreScaleBackground()
  }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="isMounted && isInDom" class="vbs-root">
      <!-- Backdrop -->
      <div
        v-if="showBackdrop"
        class="vbs-backdrop"
        :class="backdropClass"
        :style="backdropStyle"
        aria-hidden="true"
        @click="onBackdropClick"
      />

      <!-- Panel -->
      <div
        ref="sheetRef"
        class="vbs-panel"
        :class="panelClass"
        :style="sheetStyle"
        role="dialog"
        aria-modal="true"
        :aria-label="ariaLabel"
        :inert="!isOpen"
        tabindex="-1"
        @keydown="onSheetKeydown"
      >
        <!-- Grabber + header slot -->
        <div ref="grabberZoneRef" class="vbs-grabber-zone">
          <div class="vbs-grabber-row" @pointerdown="onGrabberPointerDown">
            <span class="vbs-grabber-bar" aria-hidden="true" />
          </div>
          <div v-if="$slots.header" class="vbs-header-zone" @pointerdown="onHeaderPointerDown">
            <slot name="header" :close="close" :snap-index="currentSnapIndex" />
          </div>
        </div>

        <!-- Scrollable content -->
        <div
          ref="contentRef"
          class="vbs-content"
          :class="contentClass"
          @pointerdown="onContentPointerDown"
        >
          <!-- contentInnerRef doesn't stretch along with .vbs-content (flex: 1),
               so its offsetHeight is the slot's real, undistorted height. -->
          <div ref="contentInnerRef">
            <slot :close="close" />
          </div>
        </div>

        <!-- Fixed footer -->
        <div v-if="$slots.footer" ref="footerRef" class="vbs-footer" :style="footerStyle">
          <slot name="footer" :close="close" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* The root wrapper shouldn't create a layout box of its own. */
.vbs-root {
  display: contents;
}

.vbs-backdrop {
  position: fixed;
  inset: 0;
  background: #000;
  /* No pointer/touch handler here calls preventDefault (only a click
     listener), so without this, a touch that starts on the backdrop and
     moves is left for the browser to interpret as a generic scroll/nav
     gesture — on touch devices that's part of what can trigger
     pull-to-refresh even while body scroll is locked. */
  touch-action: none;
  /* opacity changes every frame during a drag/spring, same as the panel's
     translateY — promoting it to its own layer up front avoids Safari
     deciding this mid-animation, which is itself a jank source. */
  will-change: opacity;
}

.vbs-panel {
  /* Theming via CSS custom properties — overridden from the outside without
     Tailwind: .vbs-panel { --vbs-bg: #0a0a0a; } in the consumer's global CSS. */
  --vbs-bg: #ffffff;
  --vbs-fg: #18181b;
  --vbs-radius: 1.5rem;
  --vbs-shadow: 0 -16px 48px -12px rgba(15, 15, 15, 0.18);
  --vbs-ring: rgba(0, 0, 0, 0.05);
  --vbs-handle-color: #d4d4d4;
  --vbs-border-color: #f5f5f5;
  --vbs-max-width: 40rem;

  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  margin-left: auto;
  margin-right: auto;
  width: 100%;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--vbs-radius) var(--vbs-radius) 0 0;
  background: var(--vbs-bg);
  color: var(--vbs-fg);
  box-shadow: var(--vbs-shadow), 0 0 0 1px var(--vbs-ring);
  will-change: transform;
  /* Fallback for browsers without dvh support: plain vh first, then dvh —
     if the unit isn't recognized, the whole line is ignored and the first
     (valid) value stands. */
  height: 100vh;
  height: 100dvh;
  max-height: 100vh;
  max-height: 100dvh;
}

.vbs-panel:focus {
  outline: none;
}

@media (min-width: 640px) {
  .vbs-panel {
    max-width: var(--vbs-max-width);
  }
}

/* Dark mode: automatically, based on the system setting... */
@media (prefers-color-scheme: dark) {
  .vbs-panel {
    --vbs-bg: #171717;
    --vbs-fg: #f4f4f5;
    --vbs-ring: rgba(255, 255, 255, 0.1);
    --vbs-handle-color: #52525b;
    --vbs-border-color: #262626;
  }
}
/* ...and/or manually via a .dark class on any ancestor (Tailwind's
   convention) — doesn't require Tailwind itself, just compatible with it. */
:global(.dark) .vbs-panel {
  --vbs-bg: #171717;
  --vbs-fg: #f4f4f5;
  --vbs-ring: rgba(255, 255, 255, 0.1);
  --vbs-handle-color: #52525b;
  --vbs-border-color: #262626;
}

.vbs-grabber-zone {
  flex-shrink: 0;
  user-select: none;
}

.vbs-grabber-row {
  display: flex;
  justify-content: center;
  padding: 0.625rem 0 0.375rem;
  touch-action: none;
  cursor: grab;
}
.vbs-grabber-row:active {
  cursor: grabbing;
}

.vbs-grabber-bar {
  width: 2.25rem;
  height: 0.375rem;
  border-radius: 9999px;
  background: var(--vbs-handle-color);
}

/* Without this, a mouse-drag started on header text (a title, say) is
   read by the browser as a text-selection drag first — the sheet still
   ends up moving once the gesture crosses the threshold, but the visible
   selection highlight fighting for the same gesture reads as "broken." */
.vbs-header-zone {
  touch-action: none;
  user-select: none;
}

.vbs-content {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
}

.vbs-footer {
  flex-shrink: 0;
  border-top: 1px solid var(--vbs-border-color);
  background: var(--vbs-bg);
  padding-left: 1.25rem;
  padding-right: 1.25rem;
  padding-top: 0.75rem;
  padding-bottom: max(0.875rem, env(safe-area-inset-bottom));
  will-change: transform;
}
</style>
