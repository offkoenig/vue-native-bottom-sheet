<script lang="ts">
/* ════════════════════════════════════════════════════════════════════ *
 *  State shared by every BottomSheet on the page. Each of these resources
 *  (<body>'s lock, a scroll target's lock, "who answers Escape/Tab") has
 *  one owner per page, not one per instance — with per-instance
 *  save/restore, closing one sheet while another opens restored the
 *  intermediate "already locked" styles and left <body> stuck at
 *  `position: fixed`.
 * ════════════════════════════════════════════════════════════════════ */

let bodyLockCount = 0
let savedScrollX = 0
let savedScrollY = 0
let savedBodyStyles: Record<string, string> = {}
let savedHtmlOverscrollBehaviorY = ''

function acquireBodyLock() {
  if (bodyLockCount++ > 0) return
  const body = document.body
  const html = document.documentElement
  savedScrollX = window.scrollX
  savedScrollY = window.scrollY
  // `width: 100%` below makes body span the full viewport width — on any
  // platform with a space-reserving scrollbar (most desktop browsers),
  // that's WIDER than body was a moment ago, since it no longer needs to
  // leave room for the scrollbar that `overflow: hidden` just removed.
  // Left uncompensated, the page's content visibly grows by that many
  // pixels the instant the sheet opens (and shrinks back on close) — a
  // page-wide jump that reads as "everything flickers." Padding the
  // vacated width back in keeps body's actual content box the same size
  // it was; platforms with overlay scrollbars (macOS, touch) already have
  // innerWidth === clientWidth, so this naturally computes to 0 there.
  const scrollbarWidth = window.innerWidth - html.clientWidth
  const currentPaddingRight = scrollbarWidth > 0 ? parseFloat(getComputedStyle(body).paddingRight) || 0 : 0
  savedBodyStyles = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
    overscrollBehaviorY: body.style.overscrollBehaviorY,
    paddingRight: body.style.paddingRight,
  }
  body.style.position = 'fixed'
  body.style.top = `-${savedScrollY}px`
  body.style.left = `-${savedScrollX}px`
  body.style.right = '0'
  body.style.width = '100%'
  body.style.overflow = 'hidden'
  if (scrollbarWidth > 0) body.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`
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

function releaseBodyLock() {
  if (--bodyLockCount > 0) return
  const body = document.body
  body.style.position = savedBodyStyles.position ?? ''
  body.style.top = savedBodyStyles.top ?? ''
  body.style.left = savedBodyStyles.left ?? ''
  body.style.right = savedBodyStyles.right ?? ''
  body.style.width = savedBodyStyles.width ?? ''
  body.style.overflow = savedBodyStyles.overflow ?? ''
  body.style.paddingRight = savedBodyStyles.paddingRight ?? ''
  body.style.overscrollBehaviorY = savedBodyStyles.overscrollBehaviorY ?? ''
  document.documentElement.style.overscrollBehaviorY = savedHtmlOverscrollBehaviorY
  // 'instant', not the default 'auto': under a consumer's
  // `html { scroll-behavior: smooth }`, 'auto' would visibly glide the
  // page back from the top every time a sheet closes.
  window.scrollTo({ left: savedScrollX, top: savedScrollY, behavior: 'instant' })
}

interface TargetLock {
  count: number
  overflow: string
  overscrollBehaviorY: string
  paddingRight: string
}
const targetLocks = new WeakMap<HTMLElement, TargetLock>()

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
function acquireTargetLock(el: HTMLElement) {
  const existing = targetLocks.get(el)
  if (existing) {
    existing.count++
    return
  }
  targetLocks.set(el, {
    count: 1,
    overflow: el.style.overflow,
    overscrollBehaviorY: el.style.overscrollBehaviorY,
    paddingRight: el.style.paddingRight,
  })
  // Same reasoning as acquireBodyLock's scrollbarWidth compensation: removing
  // this element's own scrollbar via overflow:hidden can grow its content
  // box by however much space that scrollbar was reserving.
  const scrollbarWidth = el.offsetWidth - el.clientWidth
  const currentPaddingRight = scrollbarWidth > 0 ? parseFloat(getComputedStyle(el).paddingRight) || 0 : 0
  el.style.overflow = 'hidden'
  el.style.overscrollBehaviorY = 'none'
  if (scrollbarWidth > 0) el.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`
}

function releaseTargetLock(el: HTMLElement) {
  const lock = targetLocks.get(el)
  if (!lock || --lock.count > 0) return
  el.style.overflow = lock.overflow
  el.style.overscrollBehaviorY = lock.overscrollBehaviorY
  el.style.paddingRight = lock.paddingRight
  targetLocks.delete(el)
}

/** Open sheets, oldest first — only the last one answers Escape and traps Tab. */
const openSheetStack: object[] = []
</script>

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
 *  1. During a gesture or spring, ONLY `transform` (and the backdrop's
 *     `opacity`) change, and they're written straight to the DOM by
 *     renderFrame() — not through Vue. A reactive translateY would re-run
 *     this component's render function, and with it every slot, on every
 *     frame; that cost scales with the consumer's content and is what
 *     drops frames on an iPhone.
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
  springStiffness: 600,
  springDamping: 42,
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
const backdropRef = ref<HTMLElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)
const grabberZoneRef = ref<HTMLElement | null>(null)
const contentInnerRef = ref<HTMLElement | null>(null)
const footerRef = ref<HTMLElement | null>(null)

/* ════════════════════════════════════════════════════════════════════ *
 *  Geometry: converting snap points (%) to translateY pixels
 * ════════════════════════════════════════════════════════════════════ */

/** What's actually visible right now — excludes the on-screen keyboard. The panel's own height is pinned to this. */
const viewportHeight = ref(0)
/**
 * What percentage snap points are a percentage OF. Same as viewportHeight,
 * except while the on-screen keyboard is up, when it keeps its pre-keyboard
 * value: a 55% sheet should stay that tall and ride up above the keyboard
 * (capped at the visible area), the way a native sheet does — not shrink
 * to 55% of the sliver the keyboard left over, which wouldn't leave room
 * for the very input that summoned it.
 */
const snapBaseHeight = ref(0)
let viewportWidth = 0
/**
 * How far the visual viewport has panned within the layout viewport.
 *
 * `position: fixed` stays anchored to the LAYOUT viewport, but iOS Safari's
 * on-screen keyboard shrinks and pans the VISUAL viewport. Anchoring the
 * panel by its TOP edge makes the correction exact and independent of where
 * the layout viewport's bottom happens to be: top = viewportOffsetTop +
 * translateY is, by definition, translateY px below the visible area's top.
 * The bottom edge has no such reference — field numbers from a real iPhone
 * with the keyboard up (innerHeight 471, vv.height 377, vv.offsetTop 243)
 * put the visual viewport's bottom at 620, past `innerHeight` itself.
 */
let viewportOffsetTop = 0

const usesContentFit = computed(() => (props.snapPoints ?? []).some((p) => p === 'content'))

/** Measured "natural" height of header+content+footer, for the 'content' snap point. */
const fitContentHeight = ref(0)

/** 0 = the panel's top at the top of the visible area, viewportHeight = "closed" position. Whole px: a layer resting on a fractional offset renders its text blurry. */
function percentToTranslate(percent: number): number {
  const clamped = Math.min(Math.max(percent, 0), 100)
  return Math.round(Math.max(viewportHeight.value - (snapBaseHeight.value * clamped) / 100, 0))
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
      const translate = Math.floor(Math.max(viewportHeight.value - height, 0))
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
/**
 * Deliberately not a ref, and neither is the other per-frame state around
 * it — see principle 1 at the top of this file. renderFrame() is what
 * makes a new value visible.
 */
let translateY = 0
let isDragging = false

function isEditableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

function updateViewportHeight() {
  if (!isClient) return
  const vv = window.visualViewport
  const height = vv ? vv.height : window.innerHeight
  const width = window.innerWidth
  // Focus lands before the keyboard's resize event and leaves before its
  // dismissal's, so this tells a keyboard apart from an actual viewport
  // change (a rotation, a resized window), which does move the base.
  const keepBase = isEditableFocused() && width === viewportWidth && snapBaseHeight.value > 0
  snapBaseHeight.value = keepBase ? Math.max(snapBaseHeight.value, height) : height
  viewportHeight.value = height
  viewportOffsetTop = vv ? vv.offsetTop : 0
  viewportWidth = width
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Per-frame output — the only code that runs on every drag/spring frame
 * ════════════════════════════════════════════════════════════════════ */

let lastBackdropOpacity = -1
let lastBackdropPassThrough = false
let lastScaleProgress = -1

function renderFrame() {
  syncStableMinTranslate()
  const sheet = sheetRef.value
  if (sheet) sheet.style.transform = `translate3d(0, ${translateY + viewportOffsetTop}px, 0)`
  const footer = footerRef.value
  /*
   * The footer sits in the same flex flow as before (this keeps
   * .vbs-content's available-space math unchanged), but the panel has a
   * full viewport height and translateY shifts it down — at any snap point
   * below 100% the footer, as the last flex item, physically ends up
   * outside the visible screen area.
   *
   * The footer's correct on-screen position doesn't depend on how far the
   * sheet is extended — it's always the bottom edge of the viewport (unlike
   * the header, which must move together with the sheet). So instead of
   * changing layout (which would mean a reflow on every drag frame), the
   * footer gets its own transform that cancels out the parent's translateY:
   * the net on-screen shift is zero, and the footer stays glued to the
   * bottom of the screen through any drag/snap, remaining a pure transform
   * effect (compositing, not layout). Above the top-most point (rubber
   * band) it simply rides along with the panel.
   */
  if (footer) footer.style.transform = `translate3d(0, ${-Math.max(translateY, 0)}px, 0)`

  const progress = computeDimProgress()
  const backdrop = backdropRef.value
  if (backdrop) {
    const opacity = progress * props.backdropOpacity
    if (opacity !== lastBackdropOpacity) {
      lastBackdropOpacity = opacity
      backdrop.style.opacity = String(opacity)
    }
    // "Below fadeFromIndex shows no backdrop at all" has to hold for touches
    // too — an invisible full-screen layer that swallows taps isn't a peek.
    // Same for a sheet on its way out: the page is usable again right away.
    const passThrough = !isOpen.value || (props.fadeFromIndex !== undefined && progress <= 0)
    if (passThrough !== lastBackdropPassThrough) {
      lastBackdropPassThrough = passThrough
      backdrop.style.pointerEvents = passThrough ? 'none' : ''
    }
  }
  if (isScaleBackgroundApplied && progress !== lastScaleProgress) {
    lastScaleProgress = progress
    renderScaleBackground(progress)
  }
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Rubber band — WebKit/UIScrollView's formula: f(x,d,c) = x·d·c / (d + c·x)
 * ════════════════════════════════════════════════════════════════════ */

function rubberBand(overshoot: number, dimension: number, constant: number): number {
  if (dimension <= 0 || overshoot <= 0) return Math.max(overshoot, 0)
  return (overshoot * dimension * constant) / (dimension + constant * overshoot)
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Spring animation (semi-implicit Euler, fixed timestep)
 * ════════════════════════════════════════════════════════════════════ */

/**
 * The spring integrates in fixed steps, however long a frame took. Stepping
 * by the frame's own duration made the motion differ between 60Hz and 120Hz
 * screens, and goes numerically unstable once damping·dt reaches 2 — a stiff
 * configuration would explode on the first dropped frame.
 */
const SPRING_STEP = 1 / 240
/** Longest stretch one frame may advance the spring — after a stall (a backgrounded tab, a slow mount) it resumes instead of teleporting. */
const SPRING_MAX_FRAME = 1 / 15
/** Damping multiplier past the top-most point — a hard upward flick digs in softly instead of flying past it and baring the panel's underside. */
const SPRING_OVERSHOOT_DAMPING = 3
/** How far past the bottom edge the closing spring aims. A spring aimed exactly at the edge spends its last ~200ms creeping through pixels nobody can see, with the page still blocked; this way the panel leaves at speed. */
const CLOSE_TARGET_MARGIN = 16 // px

let rafId: number | null = null
let reducedMotionQuery: MediaQueryList | null = null
/** Live spring state: kept outside step() so a geometry change mid-flight can re-aim it (see syncToSnapPoints) without restarting it. */
let springTarget = 0
let springPosition = 0
let springVelocity = 0 // px/s
let springOnDone: (() => void) | undefined

function cancelSpringAnimation() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  springOnDone = undefined
}

/**
 * Animates translateY toward target, starting from the current position
 * and a given initial velocity (usually the measured swipe velocity, in
 * px/ms). Interrupted animations just drop their onDone: a real spring is
 * interruptible mid-flight, and whatever takes over decides what completes
 * (see finishOpen).
 */
function springAnimateTo(target: number, initialVelocity: number, onDone?: () => void) {
  cancelSpringAnimation()

  if (props.respectReducedMotion && reducedMotionQuery?.matches) {
    translateY = target
    renderFrame()
    onDone?.()
    return
  }

  springTarget = target
  springOnDone = onDone
  springPosition = translateY
  // px/ms → px/s, clamped against anomalous velocity spikes
  springVelocity = Math.max(Math.min(initialVelocity, 6), -6) * 1000

  const { springStiffness: k, springDamping: c, springMass: m } = props
  let accumulator = 0
  let lastTime = 0
  let startupFrames = 2

  const step = (now: number) => {
    // The first frames count as exactly one frame each, not "since last
    // time": the layout and paint of freshly mounted slot content land
    // between them, and would otherwise be charged to the animation as a
    // jump right at its start.
    if (startupFrames > 0) {
      startupFrames--
      accumulator += 1 / 60
    } else {
      accumulator += Math.min(Math.max((now - lastTime) / 1000, 0), SPRING_MAX_FRAME)
    }
    lastTime = now

    const floor = springTarget === minTranslate.value ? springTarget : -Infinity
    while (accumulator >= SPRING_STEP) {
      const damping = springPosition < floor ? c * SPRING_OVERSHOOT_DAMPING : c
      const acceleration = (-k * (springPosition - springTarget) - damping * springVelocity) / m
      springVelocity += acceleration * SPRING_STEP
      springPosition += springVelocity * SPRING_STEP
      accumulator -= SPRING_STEP
    }

    const atRest = Math.abs(springVelocity) < 6 && Math.abs(springPosition - springTarget) < 0.5
    // The panel is out of sight the moment it reaches the bottom edge.
    const pastClosed = !isOpen.value && springPosition >= closedTranslate.value - 0.5
    if (atRest || pastClosed) {
      translateY = springTarget
      renderFrame()
      rafId = null
      const done = springOnDone
      springOnDone = undefined
      done?.()
      return
    }
    translateY = springPosition
    renderFrame()
    rafId = requestAnimationFrame(step)
  }

  rafId = requestAnimationFrame(step)
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Scroll lock (see the shared module-level helpers above)
 * ════════════════════════════════════════════════════════════════════ */

let holdsBodyLock = false
let scrollLockTargetEl: HTMLElement | null = null

function resolveScrollLockTarget(): HTMLElement | null {
  const target = props.lockScrollTarget
  if (!target) return null
  return typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target
}

function lockScroll() {
  if (!isClient || !props.lockBodyScroll) return
  if (!holdsBodyLock) {
    holdsBodyLock = true
    acquireBodyLock()
  }
  if (!scrollLockTargetEl) {
    scrollLockTargetEl = resolveScrollLockTarget()
    if (scrollLockTargetEl) acquireTargetLock(scrollLockTargetEl)
  }
}

function unlockScroll() {
  if (!isClient) return
  if (holdsBodyLock) {
    holdsBodyLock = false
    releaseBodyLock()
  }
  if (scrollLockTargetEl) {
    releaseTargetLock(scrollLockTargetEl)
    scrollLockTargetEl = null
  }
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
 *  (a fixed-duration CSS transition triggered at commit points), the scale
 *  is driven by the same live translateY the sheet and backdrop already
 *  use, applied imperatively from renderFrame() since the target element
 *  lives outside this component's own template (it's addressed via a
 *  data-attribute selector, not a ref).
 *
 *  Only `transform` animates. The rounded corners are a `clip-path` set
 *  once when the scale engages: animating border-radius would repaint the
 *  consumer's entire app on every frame, and `overflow: hidden` would both
 *  reflow it and, on a page taller than the screen, round corners nobody
 *  can see — the clip is cut to the part that's actually in view.
 * ════════════════════════════════════════════════════════════════════ */

const SCALE_BACKGROUND_WIDTH_INSET = 26 // px "shrink" of the background at full openness — matches iOS's own card-stack proportions
const SCALE_BACKGROUND_RADIUS = 8 // px corner radius at full openness
const SCALE_BACKGROUND_TOP_GAP = 14 // px the background peeks down by at full openness

let scaleBackgroundEl: HTMLElement | null = null
let savedScaleBackgroundStyle: { transform: string; clipPath: string; transformOrigin: string; willChange: string } | null = null
let isScaleBackgroundApplied = false
let savedBodyBackground: string | null = null
let scaleBackgroundClip = ''
/** Tracks whether the background is currently clipped and body's background swapped to scaleBackgroundColor, so renderScaleBackground() only writes those on an actual on/off transition — not on every frame the scale animates through. */
let isScaleBackgroundEngaged = false

function applyScaleBackground() {
  if (!isClient || !props.scaleBackground || isScaleBackgroundApplied) return
  const el = document.querySelector<HTMLElement>('[data-vbs-background]')
  if (!el) return
  scaleBackgroundEl = el
  isScaleBackgroundApplied = true
  savedScaleBackgroundStyle = {
    transform: el.style.transform,
    clipPath: el.style.clipPath,
    transformOrigin: el.style.transformOrigin,
    willChange: el.style.willChange,
  }
  // lockScroll() has already pinned the page, so this rect stays valid for
  // as long as the sheet is open. The element usually extends well past the
  // screen: the origin and clip have to follow the part that's in view, or
  // scaling a scrolled page drags it upward by scrollY·(1 − scale).
  const rect = el.getBoundingClientRect()
  const visibleTop = Math.max(-rect.top, 0)
  const hiddenBelow = Math.max(rect.bottom - viewportHeight.value, 0)
  el.style.transformOrigin = `50% ${visibleTop}px`
  el.style.willChange = 'transform'
  scaleBackgroundClip = `inset(${visibleTop}px 0 ${hiddenBelow}px 0 round ${SCALE_BACKGROUND_RADIUS}px)`
  savedBodyBackground = document.body.style.background
  lastScaleProgress = -1
}

function renderScaleBackground(progress: number) {
  const el = scaleBackgroundEl
  if (!el) return
  const scaleTarget = viewportWidth > 0 ? (viewportWidth - SCALE_BACKGROUND_WIDTH_INSET) / viewportWidth : 1
  const scale = 1 - (1 - scaleTarget) * progress
  const topGap = SCALE_BACKGROUND_TOP_GAP * progress
  el.style.transform = `scale(${scale}) translate3d(0, calc(env(safe-area-inset-top, 0px) * ${progress} + ${topGap.toFixed(2)}px), 0)`
  // Only once there's a real gap to fill (progress > 0), so a "peek"
  // position (dim progress still 0) never touches these at all.
  const engaged = progress > 0.001
  if (engaged !== isScaleBackgroundEngaged) {
    isScaleBackgroundEngaged = engaged
    el.style.clipPath = engaged ? scaleBackgroundClip : (savedScaleBackgroundStyle?.clipPath ?? '')
    document.body.style.background = engaged ? props.scaleBackgroundColor : (savedBodyBackground ?? '')
  }
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
    el.style.clipPath = saved.clipPath
    el.style.transformOrigin = saved.transformOrigin
    el.style.willChange = saved.willChange
  }
  document.body.style.background = savedBodyBackground ?? ''
  savedBodyBackground = null
  isScaleBackgroundEngaged = false
}

/**
 * A lagged copy of minTranslate: tracks it normally, except it withholds a
 * move to a MORE open (smaller) value until translateY has actually caught
 * up to at least that point. minTranslate updates the instant a 'content'
 * snap point's measured height changes, but translateY only follows it
 * gradually via the spring — using minTranslate directly in computeOpenProgress
 * below would make it (and backdrop/scaleBackground, which read off it)
 * visibly dip for a frame every time content grows while resting on that
 * point, since the "open" boundary jumps ahead of the position it's
 * measured against. Shrinking the target doesn't have this problem (the
 * ratio only ever clamps toward 1, never dips), so only that direction
 * needs withholding.
 */
let stableMinTranslate = 0
function syncStableMinTranslate() {
  const mt = minTranslate.value
  if (mt >= stableMinTranslate || translateY <= mt) {
    stableMinTranslate = mt
  }
}

/** 0 (closed) .. 1 (resting on the top-most snap point) — the "no fadeFromIndex" baseline both the backdrop and the background scale fall back to. */
function computeOpenProgress(): number {
  const open = stableMinTranslate
  const closed = closedTranslate.value
  const range = closed - open || 1
  return 1 - Math.min(Math.max((translateY - open) / range, 0), 1)
}

/**
 * 0..1, shared by the backdrop and the background scale so they stay in
 * lockstep. Without fadeFromIndex it's just computeOpenProgress(); with it,
 * ramps from 0 at the snap point just *before* fadeFromIndex (or fully
 * closed, if fadeFromIndex is 0) up to 1 exactly at fadeFromIndex itself,
 * and stays 1 for anything more open than that — resting ON fadeFromIndex
 * must read as "fully shown," not as the far edge of a range that's never
 * actually reached in normal use.
 */
function computeDimProgress(): number {
  if (props.fadeFromIndex === undefined) return computeOpenProgress()
  const snaps = snapTranslates.value
  if (snaps.length === 0) return computeOpenProgress()
  const idx = Math.min(Math.max(props.fadeFromIndex, 0), snaps.length - 1)
  const upper = snaps[idx] // fadeFromIndex's own translateY — progress reaches 1 here (and anything more open)
  const lower = idx > 0 ? snaps[idx - 1] : closedTranslate.value // the point just before it (or fully closed) — progress is 0 here (and anything less open)
  const range = lower - upper || 1
  return Math.min(Math.max((lower - translateY) / range, 0), 1)
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Auto-fitting to content height (the 'content' snap point)
 * ════════════════════════════════════════════════════════════════════ */

let contentResizeObserver: ResizeObserver | null = null

/**
 * grabberZoneRef and footerRef don't participate in flex stretching
 * (flex-shrink: 0), so their height already equals their natural height.
 * .vbs-content, though, stretches to fill all available space
 * (flex: 1 1 auto) — measuring it directly is meaningless, hence
 * contentInnerRef: a plain block div inside the scroll container that
 * doesn't participate in stretching, whose height is the slot's real
 * height regardless of how much space flex gave it.
 */
function measureFitContentHeight() {
  const heightOf = (el: HTMLElement | null) => el?.getBoundingClientRect().height ?? 0
  fitContentHeight.value = Math.ceil(
    heightOf(grabberZoneRef.value) + heightOf(contentInnerRef.value) + heightOf(footerRef.value),
  )
}

/** Live reaction to content height changes while the sheet is already open (an accordion expands, an image loads, etc.) — syncToSnapPoints picks up any resulting change. */
function setupContentResizeObserver() {
  teardownContentResizeObserver()
  if (!isClient || !usesContentFit.value || typeof ResizeObserver === 'undefined') return
  contentResizeObserver = new ResizeObserver(measureFitContentHeight)
  for (const el of [grabberZoneRef.value, contentInnerRef.value, footerRef.value]) {
    if (el) contentResizeObserver.observe(el)
  }
}

function teardownContentResizeObserver() {
  contentResizeObserver?.disconnect()
  contentResizeObserver = null
}

watch([usesContentFit, footerRef], () => {
  if (!isInDom.value) return
  if (usesContentFit.value) measureFitContentHeight()
  setupContentResizeObserver()
})

/**
 * The single place that reacts to the snap points themselves moving,
 * whatever the cause — a resize, the keyboard, measured content, or a
 * changed snapPoints prop. Mid-spring, it only re-aims the spring: position,
 * velocity and completion callback all carry over, so `opened` can't get
 * lost to an image finishing loading during the open animation.
 */
function syncToSnapPoints() {
  if (!isInDom.value || isDragging || isOpeningPending) return
  if (!isOpen.value) {
    if (rafId !== null) springTarget = closedTranslate.value + CLOSE_TARGET_MARGIN
    return
  }
  const lastIndex = snapTranslates.value.length - 1
  if (currentSnapIndex.value > lastIndex) currentSnapIndex.value = lastIndex
  const index = currentSnapIndex.value
  const target = snapTranslates.value[index]
  if (rafId !== null) {
    springTarget = target
  } else if (Math.abs(target - translateY) >= 0.5) {
    settleOn(index, 0)
  } else {
    // Resting on a point that didn't move, but the top-most one may have —
    // and the backdrop's progress is measured against it.
    renderFrame()
  }
}
watch(snapTranslates, syncToSnapPoints)

/* ════════════════════════════════════════════════════════════════════ *
 *  Content reachability
 * ════════════════════════════════════════════════════════════════════ */

/**
 * The scroller is a full viewport tall even when the sheet rests lower, so
 * its bottom `translateY` px sit below the screen edge. Without this spacer,
 * that much content simply can't be reached by scrolling — on a sheet whose
 * only snap point is 45%, ever. It's sized from the resting position and
 * only changes once the sheet has come to rest, never during motion.
 */
const contentSpacerHeight = ref(0)

function onSheetRest() {
  const target = snapTranslates.value[currentSnapIndex.value]
  if (target !== undefined) contentSpacerHeight.value = target
  revealFocusedInContent()
}

/**
 * Keeps whatever has focus inside the scroller above the footer and the
 * keyboard. The browser's own scroll-into-view can't do this: it only knows
 * about boxes, not about the part of the scroller that's currently off-screen
 * or covered by the transform-shifted footer.
 */
function revealFocusedInContent() {
  const el = document.activeElement as HTMLElement | null
  const scroller = contentRef.value
  const sheet = sheetRef.value
  if (!el || !sheet || !scroller || el === scroller || !scroller.contains(el)) return
  const target = snapTranslates.value[currentSnapIndex.value] ?? 0
  const sheetTop = sheet.getBoundingClientRect().top
  const rect = el.getBoundingClientRect()
  const footerHeight = footerRef.value?.getBoundingClientRect().height ?? 0
  const margin = 12
  const visibleTop = scroller.getBoundingClientRect().top - sheetTop + margin
  const visibleBottom = viewportHeight.value - target - footerHeight - margin
  const top = rect.top - sheetTop
  const bottom = rect.bottom - sheetTop
  if (bottom > visibleBottom) scroller.scrollTop += Math.min(bottom - visibleBottom, top - visibleTop)
  else if (top < visibleTop) scroller.scrollTop -= visibleTop - top
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Open / close
 * ════════════════════════════════════════════════════════════════════ */

const stackEntry = {}
let previouslyFocused: HTMLElement | null = null
/** True from the start of openSheet() until its spring actually kicks off — syncToSnapPoints stays out of the way until the spring reads the final geometry itself. */
let isOpeningPending = false
/** Bumped by anything that invalidates an open sequence still waiting on its nextTick. */
let openToken = 0
/** True until the sheet first comes to rest after opening — survives a drag or re-aim interrupting the open spring. */
let isOpenedPending = false
let lastVelocity = 0 // px/ms; needed so the closing animation carries over the flick's velocity
let viewportListenersAttached = false

function attachOpenListeners() {
  if (viewportListenersAttached) return
  viewportListenersAttached = true
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
}

function detachOpenListeners() {
  if (!viewportListenersAttached) return
  viewportListenersAttached = false
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', onViewportResize)
    window.visualViewport.removeEventListener('scroll', onViewportResize)
  } else {
    window.removeEventListener('resize', onViewportResize)
  }
  document.removeEventListener('keydown', onDocumentKeydown)
}

function openSheet() {
  // If the panel was already in the DOM (e.g. the user changed their mind
  // about closing and reopened it right during the closing animation) —
  // don't yank translateY to "closed", just re-target the spring from its
  // current position and velocity. Otherwise there'd be a visible downward
  // "jump" before opening.
  const wasAlreadyInDom = isInDom.value

  if (!openSheetStack.includes(stackEntry)) openSheetStack.push(stackEntry)
  attachOpenListeners()
  isOpenedPending = true

  // lockScroll() (below) sets body's overflow to hidden, which on desktop
  // (unlike touch/mobile, where scrollbars are typically overlay and don't
  // reserve layout width) reclaims the vertical scrollbar's width — a
  // genuine viewport size change. isOpeningPending keeps syncToSnapPoints
  // from reacting to it by jumping the sheet to its target, which would
  // leave the real spring with nothing left to animate.
  isOpeningPending = true
  if (!wasAlreadyInDom) {
    updateViewportHeight()
    translateY = closedTranslate.value
    stableMinTranslate = minTranslate.value
    lastBackdropOpacity = -1
    lastBackdropPassThrough = false
  }
  isInDom.value = true
  lockScroll()
  applyThemeColor()
  applyScaleBackground()
  const token = ++openToken
  nextTick(() => {
    if (token !== openToken) return
    currentSnapIndex.value = clampedDefaultIndex.value
    // Measure BEFORE reading snapTranslates below — otherwise, the very
    // first time, 'content' would resolve against fitContentHeight.value's
    // default (0), i.e. the closed position.
    if (usesContentFit.value) {
      measureFitContentHeight()
      setupContentResizeObserver()
    }
    // Sized now rather than at rest, so opening doesn't end in a reflow.
    contentSpacerHeight.value = snapTranslates.value[currentSnapIndex.value]
    primeKeyboard()
    isOpeningPending = false
    // A velocity carried over from an interrupted close keeps a reversal
    // continuous instead of stopping dead first.
    const velocity = rafId !== null ? springVelocity / 1000 : 0
    springAnimateTo(snapTranslates.value[currentSnapIndex.value], velocity, finishOpen)
  })
}

/** Runs the first time the sheet comes to rest after opening, however it got there. */
function finishOpen() {
  onSheetRest()
  if (!isOpenedPending) return
  isOpenedPending = false
  emit('opened')
  focusOnOpen()
}

function finishClose() {
  isInDom.value = false
  unlockScroll()
  restoreThemeColor()
  restoreScaleBackground()
  teardownContentResizeObserver()
  detachOpenListeners()
  releaseKeyboardProxy()
  emit('closed')
  previouslyFocused?.focus?.({ preventScroll: true })
}

/** Internal version: used when closing from a gesture, to pass the flick's velocity into the animation. */
function closeWithVelocity(velocity: number) {
  lastVelocity = velocity
  isOpen.value = false
  // A parent can decline the update (`:model-value` with its own confirm
  // flow). The sheet is still open then, and mustn't stay wherever the
  // gesture left it.
  nextTick(() => {
    if (!isOpen.value || isDragging) return
    lastVelocity = 0
    settleOn(currentSnapIndex.value, velocity)
  })
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
    return
  }
  const stackIndex = openSheetStack.indexOf(stackEntry)
  if (stackIndex !== -1) openSheetStack.splice(stackIndex, 1)
  openToken++
  isOpeningPending = false
  isOpenedPending = false
  releaseKeyboardProxy()
  abortGesture()
  springAnimateTo(closedTranslate.value + CLOSE_TARGET_MARGIN, lastVelocity, finishClose)
  lastVelocity = 0
})

/* ════════════════════════════════════════════════════════════════════ *
 *  External programmatic control (template ref + defineExpose)
 * ════════════════════════════════════════════════════════════════════ */

/** Springs to a snap point and reports it once settled. */
function settleOn(index: number, velocity: number) {
  currentSnapIndex.value = index
  springAnimateTo(snapTranslates.value[index], velocity, () => {
    finishOpen()
    emit('snap', index, resolvedSnapPoints.value[index]?.percent ?? 0)
  })
}

function snapToIndex(index: number) {
  const clamped = Math.min(Math.max(index, 0), resolvedSnapPoints.value.length - 1)
  currentSnapIndex.value = clamped
  if (isOpen.value && !isDragging && !isOpeningPending) settleOn(clamped, 0)
}

defineExpose<BottomSheetExposed>({ close, snapToIndex })

/* ════════════════════════════════════════════════════════════════════ *
 *  Gesture: touch + mouse input, velocity, rubber band, scroll handoff
 * ════════════════════════════════════════════════════════════════════ */

/*
 * Touch and mouse are deliberately separate input paths feeding one state
 * machine. Pointer events can't drive a drag that competes with native
 * scrolling: once the browser decides a pan belongs to it, it fires
 * `pointercancel` and sends nothing more, and calling preventDefault() on
 * pointermove has no effect on scrolling at all. Only a non-passive
 * `touchmove` can claim the gesture — and on iOS Safari only if the very
 * first one is cancelled, and only if the listener existed before the touch
 * began (hence the template listeners rather than ones added on demand).
 */

interface Sample {
  y: number
  t: number
}

type DragPhase = 'idle' | 'pending' | 'dragging'

let dragPhase: DragPhase = 'idle'
/** Touch.identifier or PointerEvent.pointerId, depending on which path started the gesture. */
let activeInputId: number | null = null
let startX = 0
let startY = 0
let startTranslate = 0
let samples: Sample[] = []
/** Receives the raw first-movement deltaY (px; negative = upward) so each pending source can decide whether to take over by direction, not just a fixed yes/no. */
let pendingGate: (deltaY: number) => boolean = () => true
/** Whether the very first movement has to decide (touch on the scrollable content — see the comment above) instead of waiting out DRAG_THRESHOLD. */
let pendingDecidesOnFirstMove = false

const DRAG_THRESHOLD = 4 // px
const VELOCITY_WINDOW = 100 // ms
/** A pause this long before lifting the finger means the sheet is being placed, not flicked — the samples before it say nothing about the release. */
const VELOCITY_STALE_AFTER = 80 // ms

function setDragging(dragging: boolean) {
  isDragging = dragging
  /** A hook for consumer CSS — e.g. suppressing hover states or pausing transitions on other elements while a drag is in flight. */
  document.documentElement.classList.toggle('vbs-dragging', dragging)
}

const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, label, summary, [role="button"], [contenteditable="true"], [data-vbs-no-drag]'

function isInteractiveTarget(target: EventTarget | null): boolean {
  return !!(target as HTMLElement | null)?.closest?.(INTERACTIVE_SELECTOR)
}

function pushSample(y: number, t: number) {
  samples.push({ y, t })
  const cutoff = t - VELOCITY_WINDOW
  while (samples.length > 2 && samples[0].t < cutoff) samples.shift()
}

/** px/ms; a positive value means downward movement. */
function getVelocity(releaseTime: number): number {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]
  if (releaseTime - last.t > VELOCITY_STALE_AFTER) return 0
  // Only the final stretch of movement counts: for a drag down that ends in
  // a flick up, averaging across the reversal would say "barely moving."
  let firstIndex = samples.length - 2
  const direction = Math.sign(last.y - samples[firstIndex].y)
  while (firstIndex > 0 && Math.sign(samples[firstIndex].y - samples[firstIndex - 1].y) === direction) firstIndex--
  const first = samples[firstIndex]
  const dt = last.t - first.t
  if (dt <= 0) return 0
  return (last.y - first.y) / dt
}

function beginDrag(y: number, t: number) {
  cancelSpringAnimation()
  dragPhase = 'dragging'
  startTranslate = translateY
  samples = []
  pushSample(y, t)
  setDragging(true)
  emit('drag-start')
}

/**
 * Which part of the panel a gesture started on decides how it behaves:
 *  - the grabber bar starts dragging immediately, no movement threshold;
 *  - the header slot has a movement threshold, so it doesn't interfere with
 *    clicks on buttons inside it;
 *  - the scrollable content area hands off to contentDragGate.
 * Footer gestures aren't drags.
 */
function beginGesture(target: EventTarget | null, inputId: number, x: number, y: number, t: number, isTouch: boolean) {
  if (dragPhase !== 'idle') return false
  const el = target as HTMLElement | null
  startX = x
  startY = y
  if (el?.closest?.('.vbs-grabber-row')) {
    activeInputId = inputId
    beginDrag(y, t)
    return true
  }
  if (props.grabberOnly || isInteractiveTarget(target)) return false
  const isContent = !!contentRef.value?.contains(el)
  if (!isContent && !el?.closest?.('.vbs-header-zone')) return false
  activeInputId = inputId
  dragPhase = 'pending'
  pendingGate = isContent ? (deltaY) => contentDragGate(el, deltaY) : () => true
  pendingDecidesOnFirstMove = isContent && isTouch
  return true
}

function isScrollableY(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight + 1) return false
  const { overflowY } = getComputedStyle(el)
  return overflowY === 'auto' || overflowY === 'scroll'
}

/**
 * Dragging down only takes over the sheet once everything under the finger
 * is scrolled all the way to the top (otherwise it's a normal scroll-back-up).
 * Dragging up always takes over instead of scrolling, as long as there's a
 * more-open snap point left — matches the "drag has priority until fully
 * expanded" behavior of Google Maps-style sheets. Once resting on the
 * top-most snap point, further upward drags fall through to native content
 * scroll as usual — unless there's nothing to scroll, in which case the
 * sheet gets its rubber band instead of the browser's own page bounce.
 * Checks nested scrollers too, not just .vbs-content: a list inside the slot
 * has to be able to finish scrolling before the sheet starts moving.
 */
function contentDragGate(from: HTMLElement | null, deltaY: number): boolean {
  const boundary = contentRef.value
  if (deltaY < 0 && currentSnapIndex.value < snapTranslates.value.length - 1) return true
  for (let el = from; el; el = el === boundary ? null : el.parentElement) {
    if (deltaY >= 0 ? el.scrollTop > 0 : isScrollableY(el)) return false
  }
  return true
}

function cancelPending() {
  dragPhase = 'idle'
  activeInputId = null
}

function computeDragTranslate(clientY: number): number {
  const next = startTranslate + (clientY - startY)
  const resistance = props.rubberBandResistance
  if (next < minTranslate.value) {
    return minTranslate.value - rubberBand(minTranslate.value - next, viewportHeight.value, resistance)
  }
  // A sheet that can't be dismissed resists being pulled below its lowest
  // point the same way it resists being pulled above its highest.
  const floor = snapTranslates.value[0] ?? closedTranslate.value
  if (!props.dismissible && next > floor) {
    return floor + rubberBand(next - floor, viewportHeight.value, resistance)
  }
  return Math.min(next, closedTranslate.value)
}

/** Feeds one movement into the state machine. Returns whether it now belongs to the sheet, not to the browser. */
function gestureMove(x: number, y: number, t: number, immediate = false): boolean {
  if (dragPhase === 'pending') {
    const deltaX = x - startX
    const deltaY = y - startY
    if (deltaX === 0 && deltaY === 0) return false
    if (!immediate && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return false
    // Mostly sideways: a carousel or slider in the slot, not a sheet drag.
    if (Math.abs(deltaX) > Math.abs(deltaY) || !pendingGate(deltaY)) {
      cancelPending()
      return false
    }
    // startY stays at the touch origin: the sheet stays under the point that
    // was grabbed and moves on this very event, instead of the movement it
    // took to get here (10-15px on touch screens) being lost as a dead zone.
    beginDrag(y, t)
  } else if (dragPhase === 'dragging') {
    pushSample(y, t)
  } else {
    return false
  }
  // Written straight from the handler, not batched into a rAF: browsers
  // already align these events to the frame, and a style write this cheap
  // doesn't need coalescing — waiting would only add a frame of lag behind
  // the finger.
  translateY = computeDragTranslate(y)
  renderFrame()
  return true
}

/** Returns whether a real drag just ended (as opposed to a gesture that never became one). */
function gestureEnd(t: number): boolean {
  const wasDragging = dragPhase === 'dragging'
  dragPhase = 'idle'
  activeInputId = null
  if (!wasDragging) return false
  setDragging(false)
  const velocity = getVelocity(t)
  emit('drag-end', velocity)
  settle(velocity)
  return true
}

/** The parent closed the sheet mid-gesture: the finger no longer decides anything. */
function abortGesture() {
  const wasDragging = dragPhase === 'dragging'
  detachMouseListeners()
  dragPhase = 'idle'
  activeInputId = null
  if (!wasDragging) return
  setDragging(false)
  emit('drag-end', 0)
}

/* ---- Touch input path ---- */

function findActiveTouch(list: TouchList): Touch | null {
  for (let i = 0; i < list.length; i++) {
    if (list[i].identifier === activeInputId) return list[i]
  }
  return null
}

function onTouchStart(e: TouchEvent) {
  if (dragPhase !== 'idle') return
  const touch = e.changedTouches[0]
  // Apple Pencil arrives through the pointer path too; don't handle it twice.
  if (!touch || (touch as Touch & { touchType?: string }).touchType === 'stylus') return
  beginGesture(e.target, touch.identifier, touch.clientX, touch.clientY, e.timeStamp, true)
}

function onTouchMove(e: TouchEvent) {
  if (dragPhase === 'idle') return
  const touch = findActiveTouch(e.changedTouches)
  if (!touch) return
  if (dragPhase === 'pending' && (e.touches.length > 1 || !e.cancelable)) {
    // A pinch, or a scroll the browser has already committed to.
    cancelPending()
    return
  }
  const claimed = gestureMove(touch.clientX, touch.clientY, e.timeStamp, pendingDecidesOnFirstMove)
  if (claimed && e.cancelable) e.preventDefault()
}

function onTouchEnd(e: TouchEvent) {
  if (dragPhase === 'idle' || !findActiveTouch(e.changedTouches)) return
  gestureEnd(e.timeStamp)
}

/* ---- Mouse (and non-iOS stylus) input path ---- */

function attachMouseListeners() {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}
function detachMouseListeners() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

function onPanelPointerDown(e: PointerEvent) {
  if (e.pointerType === 'touch' || e.button !== 0) return
  if (beginGesture(e.target, e.pointerId, e.clientX, e.clientY, e.timeStamp, false)) attachMouseListeners()
}

function onPointerMove(e: PointerEvent) {
  if (e.pointerId !== activeInputId) return
  const wasPending = dragPhase === 'pending'
  gestureMove(e.clientX, e.clientY, e.timeStamp)
  if (dragPhase === 'idle') detachMouseListeners()
  if (wasPending && dragPhase === 'dragging') window.getSelection()?.removeAllRanges()
}

function onPointerUp(e: PointerEvent) {
  if (e.pointerId !== activeInputId) return
  detachMouseListeners()
  if (gestureEnd(e.timeStamp)) swallowNextClick()
}

/** The click a mouse drag ends in isn't a click on whatever happened to be under the cursor. */
function swallowNextClick() {
  const swallow = (e: Event) => e.stopPropagation()
  window.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
}

function findNextSnap(from: number, direction: 1 | -1, snaps: number[]): number {
  // snaps are sorted from least to most open, so translates descend.
  if (direction > 0) {
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i] > from + 0.5) return i
    }
    return -1
  }
  for (let i = 0; i < snaps.length; i++) {
    if (snaps[i] < from - 0.5) return i
  }
  return snaps.length - 1
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
    // fast downward flick — move to the next snap point below where the sheet is NOW (it may be far from where the drag began); if there's none (or flicked hard enough), close
    const next = findNextSnap(translateY, 1, snaps)
    if (isEdgeFlick || next < 0) closing = true
    else targetIndex = next
  } else if (velocity < -props.closeThreshold) {
    // fast upward flick — move to the next snap point above, or straight to the top on an edge flick
    targetIndex = isEdgeFlick ? snaps.length - 1 : findNextSnap(translateY, -1, snaps)
  } else {
    // slow release — stick to whichever point is nearest (including "closed")
    const candidates = [...snaps, closedTranslate.value]
    const nearest = findNearestIndex(translateY, candidates)
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

  settleOn(targetIndex, velocity)
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Keyboard: Escape closes, Tab is a focus trap inside the panel
 * ════════════════════════════════════════════════════════════════════ */

function onDocumentKeydown(e: KeyboardEvent) {
  if (openSheetStack[openSheetStack.length - 1] !== stackEntry) return
  if (e.key === 'Tab') {
    trapTab(e)
  } else if (e.key === 'Escape' && isOpen.value && props.closeOnEscape && !e.defaultPrevented && !e.isComposing) {
    requestClose()
  }
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])'

function getFocusableElements(): HTMLElement[] {
  if (!sheetRef.value) return []
  return Array.from(sheetRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null,
  )
}

const INPUT_LIKE_SELECTOR =
  'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"]'

/** For `autoFocus="input"` — the first visible, enabled input-like element in the panel, in DOM order. */
function getFirstInputElement(): HTMLElement | null {
  if (!sheetRef.value) return null
  const el = sheetRef.value.querySelector<HTMLElement>(INPUT_LIKE_SELECTOR)
  return el && el.offsetParent !== null ? el : null
}

/**
 * iOS only raises the keyboard for a focus() made during a user gesture, and
 * the real input isn't focused until the open animation has finished, long
 * after the tap. An invisible stand-in input takes focus now, while the tap
 * is still on the stack; iOS keeps the keyboard up as focus moves from it
 * to the real input later.
 */
let keyboardProxy: HTMLInputElement | null = null

function primeKeyboard() {
  if (props.autoFocus !== 'input' || keyboardProxy || !('ontouchstart' in window) || !getFirstInputElement()) return
  const proxy = document.createElement('input')
  proxy.setAttribute('aria-hidden', 'true')
  proxy.tabIndex = -1
  // 16px: iOS zooms the page when focusing anything smaller.
  proxy.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;'
  document.body.appendChild(proxy)
  proxy.focus({ preventScroll: true })
  keyboardProxy = proxy
}

function releaseKeyboardProxy() {
  keyboardProxy?.remove()
  keyboardProxy = null
}

function focusOnOpen() {
  if (props.autoFocus === 'input') {
    const inputEl = getFirstInputElement()
    if (inputEl) {
      inputEl.focus({ preventScroll: true })
      releaseKeyboardProxy()
      revealFocusedInContent()
      return
    }
  }
  releaseKeyboardProxy()
  if (props.autoFocus) sheetRef.value?.focus({ preventScroll: true })
}

function trapTab(e: KeyboardEvent) {
  const sheet = sheetRef.value
  if (!sheet) return
  const focusable = getFocusableElements()
  const active = document.activeElement as HTMLElement | null
  if (!focusable.length) {
    e.preventDefault()
    sheet.focus({ preventScroll: true })
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  // Focus on the panel itself, or still outside it (autoFocus: false), has
  // no neighbor inside the trap for the browser to move to.
  if (active === sheet || !active || !sheet.contains(active)) {
    e.preventDefault()
    ;(e.shiftKey ? last : first).focus()
  } else if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
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
  // line breaks and its natural height. Any resulting change in the snap
  // points reaches syncToSnapPoints through its watcher.
  if (usesContentFit.value && isInDom.value) measureFitContentHeight()
  if (!isInDom.value) return
  if (isOpeningPending && rafId === null) translateY = closedTranslate.value
  // viewportOffsetTop isn't reactive: it can move without any snap point moving.
  renderFrame()
  revealFocusedInContent()
}

function onBackdropClick() {
  if (props.closeOnBackdropClick) requestClose()
}

/** With `overflow: clip` the panel can't scroll at all; this is the fallback for Safari < 16, where focusing an off-screen input could scroll an `overflow: hidden` panel out from under its own grabber. */
function onPanelScroll() {
  if (sheetRef.value) sheetRef.value.scrollTop = 0
}

const backdropStyle = computed(() => ({ zIndex: props.zIndex }))

/** A px height (only ever written when the viewport itself changes, never during motion) instead of `100dvh`: dvh ignores the on-screen keyboard, and everything else here — snap points, the footer's position — is measured against what's actually visible. */
const sheetStyle = computed(() => ({
  height: `${viewportHeight.value}px`,
  zIndex: props.zIndex + 1,
}))

// Vue doesn't own `transform`/`opacity` (see renderFrame), so an element
// that just appeared has to get them before its first paint.
watch([sheetRef, backdropRef, footerRef], renderFrame, { flush: 'post' })

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
})

onBeforeUnmount(() => {
  openToken++
  cancelSpringAnimation()
  abortGesture()
  teardownContentResizeObserver()
  detachOpenListeners()
  releaseKeyboardProxy()
  const stackIndex = openSheetStack.indexOf(stackEntry)
  if (stackIndex !== -1) openSheetStack.splice(stackIndex, 1)
  // Whatever's still held, not "if currently open": a sheet unmounted during
  // its close animation (a route change right after closing, say) would
  // otherwise leave <body> locked for good.
  unlockScroll()
  restoreThemeColor()
  restoreScaleBackground()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="isMounted && isInDom" class="vbs-root">
      <!-- Backdrop -->
      <div
        v-if="showBackdrop"
        ref="backdropRef"
        class="vbs-backdrop"
        :class="backdropClass"
        :style="backdropStyle"
        aria-hidden="true"
        @click="onBackdropClick"
        @touchmove.prevent
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
        @scroll="onPanelScroll"
        @focusin="revealFocusedInContent"
        @pointerdown="onPanelPointerDown"
        @touchstart.passive="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      >
        <!-- Grabber + header slot -->
        <div ref="grabberZoneRef" class="vbs-grabber-zone">
          <div class="vbs-grabber-row">
            <span class="vbs-grabber-bar" aria-hidden="true" />
          </div>
          <div v-if="$slots.header" class="vbs-header-zone">
            <slot name="header" :close="close" :snap-index="currentSnapIndex" />
          </div>
        </div>

        <!-- Scrollable content -->
        <div ref="contentRef" class="vbs-content" :class="contentClass">
          <!-- contentInnerRef doesn't stretch along with .vbs-content (flex: 1),
               so its height is the slot's real, undistorted height. -->
          <div ref="contentInnerRef" :class="{ 'vbs-content-inner--no-footer': !$slots.footer }">
            <slot :close="close" />
          </div>
          <div :style="{ height: `${contentSpacerHeight}px` }" aria-hidden="true" />
        </div>

        <!-- Fixed footer -->
        <div v-if="$slots.footer" ref="footerRef" class="vbs-footer">
          <slot name="footer" :close="close" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
/* Theming defaults live outside the scoped block on purpose, at zero
   specificity. In a scoped block they'd compile to
   `.vbs-panel[data-v-xxxx]`, which outranks the plain `.vbs-panel { ... }`
   or `panelClass` rule a consumer themes with, no matter the order. */
:where(.vbs-panel) {
  --vbs-bg: #ffffff;
  --vbs-fg: #18181b;
  --vbs-radius: 1.5rem;
  --vbs-shadow: 0 -16px 48px -12px rgba(15, 15, 15, 0.18);
  --vbs-ring: rgba(0, 0, 0, 0.05);
  --vbs-handle-color: #d4d4d4;
  --vbs-border-color: #f5f5f5;
  --vbs-max-width: 40rem;
}

/* Dark mode: automatically, based on the system setting... */
@media (prefers-color-scheme: dark) {
  :where(.vbs-panel) {
    --vbs-bg: #171717;
    --vbs-fg: #f4f4f5;
    --vbs-ring: rgba(255, 255, 255, 0.1);
    --vbs-handle-color: #52525b;
    --vbs-border-color: #262626;
  }
}
/* ...and/or manually via a .dark class on any ancestor (Tailwind's
   convention) — doesn't require Tailwind itself, just compatible with it. */
:where(.dark) :where(.vbs-panel) {
  --vbs-bg: #171717;
  --vbs-fg: #f4f4f5;
  --vbs-ring: rgba(255, 255, 255, 0.1);
  --vbs-handle-color: #52525b;
  --vbs-border-color: #262626;
}

/* Also here rather than in the scoped block: Vue compiles a scoped
   `:global(.a) .b` down to just `.a`, which would put this on <html> and
   recalculate the whole page's styles at the start of every drag. */
:where(.vbs-dragging) .vbs-content {
  -webkit-user-select: none;
  user-select: none;
}
</style>

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
  -webkit-tap-highlight-color: transparent;
  /* opacity changes every frame during a drag/spring, same as the panel's
     translateY — promoting it to its own layer up front avoids Safari
     deciding this mid-animation, which is itself a jank source. */
  will-change: opacity;
}

.vbs-panel {
  position: fixed;
  /* Anchored by the top edge, not the bottom — see viewportOffsetTop. */
  top: 0;
  left: 0;
  right: 0;
  margin-left: auto;
  margin-right: auto;
  width: 100%;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  /* Inline `height` is the visible viewport; this padding extends the panel's
     background below it, so a rubber-band pull past 100% lifts the panel
     without baring a gap underneath. Being padding, it's out of the flex
     children's way, and the transform that closes the sheet is unaffected. */
  box-sizing: content-box;
  padding-bottom: 50vh;
  overflow: hidden;
  overflow: clip;
  border-radius: var(--vbs-radius) var(--vbs-radius) 0 0;
  background: var(--vbs-bg);
  color: var(--vbs-fg);
  box-shadow: var(--vbs-shadow), 0 0 0 1px var(--vbs-ring);
  will-change: transform;
  /* Whatever the slots do inside can't invalidate layout or paint outside. */
  contain: layout style paint;
}

.vbs-panel:focus {
  outline: none;
}

@media (min-width: 640px) {
  .vbs-panel {
    max-width: var(--vbs-max-width);
  }
}

.vbs-grabber-zone {
  flex-shrink: 0;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
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
  -webkit-user-select: none;
  user-select: none;
}

/* No `touch-action` here: `pan-y` on this ancestor would also rule out
   horizontal scrollers and pinch-zoom inside the slot. Who gets the gesture
   is decided per touch, in onTouchMove. */
.vbs-content {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior-y: contain;
}

/* The footer's padding handles this when there is one. */
.vbs-content-inner--no-footer {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.vbs-footer {
  flex-shrink: 0;
  border-top: 1px solid var(--vbs-border-color);
  background: var(--vbs-bg);
  padding-left: 1.25rem;
  padding-right: 1.25rem;
  padding-top: 0.75rem;
  padding-bottom: max(0.875rem, env(safe-area-inset-bottom));
  touch-action: pan-x;
  will-change: transform;
}
</style>
