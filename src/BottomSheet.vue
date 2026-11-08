<script lang="ts">
import type { InjectionKey, Ref } from 'vue'

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
  try {
    window.scrollTo({ left: savedScrollX, top: savedScrollY, behavior: 'instant' })
  } catch {
    // An engine whose ScrollBehavior enum predates 'instant' rejects the
    // whole options object with a TypeError — which, thrown from here,
    // would abort the rest of the close sequence ('closed', focus restore).
    window.scrollTo(savedScrollX, savedScrollY)
  }
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

/**
 * `<meta name="theme-color">` is page-wide too. Each sheet with a themeColor
 * holds a claim; the newest claim wins, and the page's own values come back
 * only once the last claim is gone — whatever order the sheets close in.
 * Per-instance save/restore had the same failure as the body lock: closing
 * the outer sheet first left the inner one's "saved" color stuck for good.
 */
interface ThemeColorClaim {
  color: string
}
const themeColorClaims: ThemeColorClaim[] = []
/** The page's own theme-color tags and their content before the first claim; `created` is the tag added when there was none. */
let savedThemeColors: { el: HTMLMetaElement; content: string | null }[] = []
let createdThemeColorMeta: HTMLMetaElement | null = null

function writeThemeColor() {
  const top = themeColorClaims[themeColorClaims.length - 1]
  if (top) {
    // Every tag, not just the first: a page with separate light/dark tags
    // (`media="(prefers-color-scheme: dark)"`) would otherwise only get the
    // color in one of the two schemes.
    for (const { el } of savedThemeColors) el.setAttribute('content', top.color)
    createdThemeColorMeta?.setAttribute('content', top.color)
    return
  }
  for (const { el, content } of savedThemeColors) {
    if (content === null) el.removeAttribute('content')
    else el.setAttribute('content', content)
  }
  createdThemeColorMeta?.remove()
  savedThemeColors = []
  createdThemeColorMeta = null
}

function claimThemeColor(claim: ThemeColorClaim) {
  if (themeColorClaims.length === 0) {
    const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
    savedThemeColors = metas.map((el) => ({ el, content: el.getAttribute('content') }))
    if (metas.length === 0) {
      createdThemeColorMeta = document.createElement('meta')
      createdThemeColorMeta.setAttribute('name', 'theme-color')
      document.head.appendChild(createdThemeColorMeta)
    }
  }
  themeColorClaims.push(claim)
  writeThemeColor()
}

function releaseThemeColor(claim: ThemeColorClaim) {
  const index = themeColorClaims.indexOf(claim)
  if (index === -1) return
  themeColorClaims.splice(index, 1)
  writeThemeColor()
}

/**
 * The `[data-vbs-background]` element is page-wide as well, and two sheets
 * scaling it each on their own corrupted it: the second one measured the
 * already-scaled element for its clip and origin, saved the first one's
 * transform as "original", and whichever closed first un-scaled the page
 * from under the other. Now the element is set up once, by the first claim,
 * and shows the most-open claim's progress — an inner sheet rising over a
 * fully open outer one keeps the page scaled instead of resetting it, and
 * the page's own styles come back only with the last claim.
 */
const SCALE_BACKGROUND_WIDTH_INSET = 26 // px "shrink" of the background at full openness — matches iOS's own card-stack proportions
const SCALE_BACKGROUND_RADIUS = 8 // px corner radius at full openness
const SCALE_BACKGROUND_TOP_GAP = 14 // px the background peeks down by at full openness

interface ScaleBackgroundClaim {
  /** 0..1, the claiming sheet's current dim progress. */
  progress: number
  /** The claiming sheet's viewport width, which the scale factor is computed from. */
  width: number
  /** Painted behind the scaled background while this claim drives it. */
  color: string
}

interface ScaleBackgroundState {
  el: HTMLElement
  saved: { transform: string; clipPath: string; transformOrigin: string; willChange: string }
  savedBodyBackground: string
  clip: string
  /** The body background currently written, or null while not engaged — so the clip and body background are only written on an actual change, not on every frame. */
  appliedColor: string | null
}

let scaleBackgroundState: ScaleBackgroundState | null = null
const scaleBackgroundClaims: ScaleBackgroundClaim[] = []

/** Returns false (and claims nothing) when the page has no `[data-vbs-background]` element. */
function claimScaleBackground(claim: ScaleBackgroundClaim, viewportHeight: number): boolean {
  if (!scaleBackgroundState) {
    const el = document.querySelector<HTMLElement>('[data-vbs-background]')
    if (!el) return false
    const saved = {
      transform: el.style.transform,
      clipPath: el.style.clipPath,
      transformOrigin: el.style.transformOrigin,
      willChange: el.style.willChange,
    }
    // The scroll lock has already pinned the page, so this rect stays valid
    // for as long as any claim is held. The element usually extends well
    // past the screen: the origin and clip have to follow the part that's
    // in view, or scaling a scrolled page drags it upward by scrollY·(1 − scale).
    const rect = el.getBoundingClientRect()
    const visibleTop = Math.max(-rect.top, 0)
    const hiddenBelow = Math.max(rect.bottom - viewportHeight, 0)
    el.style.transformOrigin = `50% ${visibleTop}px`
    el.style.willChange = 'transform'
    scaleBackgroundState = {
      el,
      saved,
      savedBodyBackground: document.body.style.background,
      clip: `inset(${visibleTop}px 0 ${hiddenBelow}px 0 round ${SCALE_BACKGROUND_RADIUS}px)`,
      appliedColor: null,
    }
  }
  scaleBackgroundClaims.push(claim)
  return true
}

/** Writes the most-open claim's state to the element — called from a claiming sheet's renderFrame(), so only `transform` changes per frame. */
function renderScaleBackground() {
  const state = scaleBackgroundState
  if (!state) return
  let driver: ScaleBackgroundClaim | null = null
  // `>=`: on a tie the newest claim wins, and with it its color.
  for (const claim of scaleBackgroundClaims) if (!driver || claim.progress >= driver.progress) driver = claim
  const progress = driver?.progress ?? 0
  const width = driver?.width ?? 0
  const scaleTarget = width > 0 ? (width - SCALE_BACKGROUND_WIDTH_INSET) / width : 1
  const scale = 1 - (1 - scaleTarget) * progress
  const topGap = SCALE_BACKGROUND_TOP_GAP * progress
  state.el.style.transform = `scale(${scale}) translate3d(0, calc(env(safe-area-inset-top, 0px) * ${progress} + ${topGap.toFixed(2)}px), 0)`
  // Only once there's a real gap to fill (progress > 0), so a "peek"
  // position (dim progress still 0) never touches these at all.
  const color = driver && progress > 0.001 ? driver.color : null
  if (color !== state.appliedColor) {
    if ((color === null) !== (state.appliedColor === null)) {
      state.el.style.clipPath = color === null ? state.saved.clipPath : state.clip
    }
    state.appliedColor = color
    document.body.style.background = color ?? state.savedBodyBackground
  }
}

function releaseScaleBackground(claim: ScaleBackgroundClaim) {
  const index = scaleBackgroundClaims.indexOf(claim)
  if (index === -1) return
  scaleBackgroundClaims.splice(index, 1)
  const state = scaleBackgroundState
  if (!state) return
  if (scaleBackgroundClaims.length > 0) {
    renderScaleBackground()
    return
  }
  scaleBackgroundState = null
  state.el.style.transform = state.saved.transform
  state.el.style.clipPath = state.saved.clipPath
  state.el.style.transformOrigin = state.saved.transformOrigin
  state.el.style.willChange = state.saved.willChange
  document.body.style.background = state.savedBodyBackground
}

/** What one sheet instance lets the others see of it. */
interface SheetEntry {
  /** The panel's z-index while it's in the DOM (open or closing), null otherwise. */
  panelZIndex(): number | null
  /** Where this sheet hands focus back to when it closes. */
  restoreTarget: HTMLElement | null
  /** What this sheet's backdrop would show on its own (dim progress × backdropOpacity), or null without a backdrop. */
  ownBackdropOpacity: number | null
  /** Writes the opacity renderBackdrops() settled on to this sheet's backdrop. */
  applyBackdropOpacity(opacity: number): void
}

/** Every mounted sheet, open or not. */
const mountedSheets = new Set<SheetEntry>()

/** Open sheets, oldest first — only the last one answers Escape and traps Tab. */
const openSheetStack: SheetEntry[] = []

/**
 * The z-index a sheet opening now must start from to land above every sheet
 * still on screen. All sheets share one default zIndex, and a Teleport puts
 * its content at the spot in <body> its component reserved when IT mounted —
 * so with equal z-indexes, a sheet declared before another (or a lower one
 * reopened over an upper one) was painted underneath the sheet it had just
 * opened over. Derived from what's actually on screen, so it doesn't creep
 * upward over a session: it's back to each sheet's own zIndex once they're
 * all closed.
 */
function stackZIndexFloor(self: SheetEntry): number {
  let floor = -Infinity
  for (const sheet of mountedSheets) {
    if (sheet === self) continue
    const z = sheet.panelZIndex()
    if (z !== null && z + 1 > floor) floor = z + 1
  }
  return floor
}

/**
 * Stacked sheets don't stack their dimming. Each backdrop covers the whole
 * page, so N of them at 0.45 used to multiply into near-black a few levels
 * deep. Like iOS, the page stays dimmed as much as under a single sheet,
 * while a covered sheet gets dimmed by the backdrop above it.
 *
 * Walking down from the top: `cover` is how much light the backdrops above
 * still let through. A backdrop that would show `own` alone shows
 *   effective = 1 − (1 − own) / cover
 * so the page under both reads exactly `own` — throughout the transition,
 * not only at rest: as the upper backdrop fades in, the lower one fades out
 * by just as much, with no dip or jump in between. Once the upper one is
 * darker than `own` already, the lower one is fully transparent.
 *
 * Called from every sheet's renderFrame(): the sheets underneath are at rest
 * and run no frames of their own, yet their backdrops have to follow the
 * moving one. Only style writes, and only on change.
 */
function renderBackdrops() {
  const visible: { sheet: SheetEntry; z: number }[] = []
  for (const sheet of mountedSheets) {
    const z = sheet.panelZIndex()
    if (z !== null && sheet.ownBackdropOpacity !== null) visible.push({ sheet, z })
  }
  visible.sort((a, b) => b.z - a.z)
  let cover = 1
  for (const { sheet } of visible) {
    const own = sheet.ownBackdropOpacity as number
    const effective = cover >= 1 ? own : cover <= 0 ? 0 : Math.min(Math.max(1 - (1 - own) / cover, 0), 1)
    sheet.applyBackdropOpacity(effective)
    cover *= 1 - effective
  }
}

/** Provided by every sheet to the sheets nested in its slots: whether it is open. */
const PARENT_SHEET_OPEN: InjectionKey<Ref<boolean>> = Symbol('vbs-parent-sheet-open')

/**
 * True while a closing sheet hands focus back to where it was before it
 * opened. That element can sit in another sheet's content, scrolled far out
 * of view (a field at the top of a long list that opened a nested sheet
 * from below): it must get focus back without dragging that list to it.
 */
let restoringFocus = false
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
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, provide, inject } from 'vue'
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
  // A NaN or Infinity entry (a computed value gone wrong upstream) is
  // dropped rather than turned into a NaN transform.
  const valid = (props.snapPoints ?? []).filter((p) => p === 'content' || Number.isFinite(p))
  const points = valid.length ? valid : [100]
  const resolved = points.map((raw): ResolvedSnapPoint => {
    if (raw === 'content') {
      const maxHeight =
        props.contentMaxHeight === undefined ? Infinity : (snapBaseHeight.value * props.contentMaxHeight) / 100
      const height = Math.min(fitContentHeight.value, viewportHeight.value, maxHeight)
      const translate = Math.floor(Math.max(viewportHeight.value - height, 0))
      const percent = viewportHeight.value > 0 ? (height / viewportHeight.value) * 100 : 0
      return { raw, translate, percent }
    }
    const percent = Math.min(Math.max(raw, 0), 100)
    return { raw, translate: percentToTranslate(percent), percent }
  })
  return resolved.sort((a, b) => a.percent - b.percent)
})

const clampedDefaultIndex = computed(() => toIndex(props.defaultSnapPoint, resolvedSnapPoints.value.length))

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

/** Input types that never bring up an on-screen keyboard. */
const NON_TEXT_INPUT_TYPES = /^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i

/** Whether what has focus is something an on-screen keyboard could be up for. */
function isEditableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  // A focused checkbox isn't a keyboard: a browser toolbar collapsing while
  // one has focus is a real viewport change and must move the snap base.
  return el.tagName === 'INPUT' && !NON_TEXT_INPUT_TYPES.test((el as HTMLInputElement).type)
}

/** A prop meant as an index, made into a usable one — `snapTranslates[1.5]` or `[NaN]` is `undefined`, and that would end up as a NaN transform. */
function toIndex(value: number | undefined, length: number): number {
  const n = Number.isFinite(value) ? Math.round(value as number) : 0
  return Math.min(Math.max(n, 0), Math.max(length - 1, 0))
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
  stackEntry.ownBackdropOpacity = backdrop ? progress * props.backdropOpacity : null
  // Not written directly: with sheets stacked, what each backdrop shows
  // depends on the ones above it (see renderBackdrops).
  renderBackdrops()
  if (backdrop) {
    // "Below fadeFromIndex shows no backdrop at all" has to hold for touches
    // too — an invisible full-screen layer that swallows taps isn't a peek.
    // Same for a sheet on its way out: the page is usable again right away.
    const passThrough = !isOpen.value || (props.fadeFromIndex !== undefined && progress <= 0)
    if (passThrough !== lastBackdropPassThrough) {
      lastBackdropPassThrough = passThrough
      backdrop.style.pointerEvents = passThrough ? 'none' : ''
    }
  }
  const claim = scaleBackgroundClaim
  if (claim && (progress !== lastScaleProgress || claim.width !== viewportWidth)) {
    lastScaleProgress = progress
    claim.progress = progress
    claim.width = viewportWidth
    renderScaleBackground()
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
  springVelocity = Number.isFinite(initialVelocity) ? Math.max(Math.min(initialVelocity, 6), -6) * 1000 : 0

  const { springStiffness: k, springDamping: c } = props
  // A zero or negative mass divides the acceleration into Infinity/NaN.
  const m = props.springMass > 0 ? props.springMass : 1
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
    // A spring configuration that diverges (a stiffness/damping far outside
    // anything sensible) would otherwise never be "at rest" and keep a rAF
    // loop running forever: land on the target instead.
    const diverged = !Number.isFinite(springPosition) || !Number.isFinite(springVelocity)
    if (atRest || pastClosed || diverged) {
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

/** This instance's claim on the page-wide theme-color (see claimThemeColor), held from open until the close animation ends. */
let themeColorClaim: ThemeColorClaim | null = null

function applyThemeColor() {
  if (!isClient || !props.themeColor || themeColorClaim) return
  themeColorClaim = { color: props.themeColor }
  claimThemeColor(themeColorClaim)
}

function restoreThemeColor() {
  if (!isClient || !themeColorClaim) return
  releaseThemeColor(themeColorClaim)
  themeColorClaim = null
}

/** Follows a themeColor changed while the sheet is open; the page's own values stay saved for the restore. */
watch(
  () => props.themeColor,
  (color) => {
    if (!themeColorClaim) {
      if (color && isOpen.value && isInDom.value) applyThemeColor()
      return
    }
    if (!color) {
      restoreThemeColor()
      return
    }
    themeColorClaim.color = color
    writeThemeColor()
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

/** This instance's claim on the page-wide background scale (see claimScaleBackground), held from open until the close animation ends. */
let scaleBackgroundClaim: ScaleBackgroundClaim | null = null

function applyScaleBackground() {
  if (!isClient || !props.scaleBackground || scaleBackgroundClaim) return
  const claim: ScaleBackgroundClaim = { progress: 0, width: viewportWidth, color: props.scaleBackgroundColor }
  if (!claimScaleBackground(claim, viewportHeight.value)) return
  scaleBackgroundClaim = claim
  lastScaleProgress = -1
}

function restoreScaleBackground() {
  if (!isClient || !scaleBackgroundClaim) return
  releaseScaleBackground(scaleBackgroundClaim)
  scaleBackgroundClaim = null
}

watch(
  () => props.scaleBackgroundColor,
  (color) => {
    if (!scaleBackgroundClaim) return
    scaleBackgroundClaim.color = color
    renderScaleBackground()
  },
)

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
  const idx = toIndex(props.fadeFromIndex, snaps.length)
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
 *
 * With a single snap point the sheet never rises past that rest, so the bottom
 * margin takes the spacer's job and the scroller ends right at the screen edge:
 * `position: sticky; bottom: 0` in a slot then sticks where it's seen. Several
 * snap points keep the spacer, since a scroller cut to the current rest would
 * leave a blank panel below it on the way up: use the `footer` slot there.
 */
const contentSpacerHeight = ref(0)

/**
 * What revealFocusedInContent keeps in view: an element focused inside the
 * panel by the user (or by autoFocus), not one that got focus back from a
 * closing sheet — see restoringFocus. Remembered rather than read from
 * document.activeElement each time, so a later resize (the keyboard, iOS
 * Safari's toolbar) doesn't scroll to a restored element either.
 */
let revealTarget: HTMLElement | null = null

function onPanelFocusIn(e: FocusEvent) {
  revealTarget = restoringFocus ? null : (e.target as HTMLElement)
  revealFocusedInContent()
}

function onPanelFocusOut(e: FocusEvent) {
  if (e.target === revealTarget) revealTarget = null
}
const hasSingleSnapPoint = computed(() => snapTranslates.value.length === 1)

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
  const el = revealTarget
  if (el !== document.activeElement) return
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

let previouslyFocused: HTMLElement | null = null

/** Set at each open from the sheets already on screen (see stackZIndexFloor); -Infinity leaves the zIndex prop alone. */
const zIndexFloor = ref(-Infinity)
/** The backdrop's z-index; the panel sits one above it. */
const baseZIndex = computed(() => Math.max(props.zIndex, zIndexFloor.value))

const stackEntry: SheetEntry = {
  panelZIndex: () => (isInDom.value ? baseZIndex.value + 1 : null),
  ownBackdropOpacity: null,
  applyBackdropOpacity(opacity) {
    const backdrop = backdropRef.value
    if (!backdrop || opacity === lastBackdropOpacity) return
    lastBackdropOpacity = opacity
    backdrop.style.opacity = String(opacity)
  },
  get restoreTarget() {
    return previouslyFocused
  },
  set restoreTarget(el) {
    previouslyFocused = el
  },
}

/**
 * About to leave the DOM: a sheet opened from inside this one would hand
 * focus back to an element that's about to be gone (the outer sheet closed
 * programmatically while the inner one stays up, say). It gets this sheet's
 * own restore target instead — what the chain was opened from.
 */
function handOffRestoreTargets() {
  const panel = sheetRef.value
  if (!panel) return
  for (const sheet of mountedSheets) {
    if (sheet !== stackEntry && sheet.restoreTarget && panel.contains(sheet.restoreTarget)) {
      sheet.restoreTarget = previouslyFocused
    }
  }
}

/**
 * A sheet nested in another's slot closes along with it, like a native
 * presented sheet dismissed with the one presenting it. Left open, it would
 * vanish without an animation when the outer panel's content unmounts — and
 * its v-model would still say "open", so it popped right back up the next
 * time the outer sheet opened.
 */
const parentSheetOpen = inject(PARENT_SHEET_OPEN, null)
if (parentSheetOpen) {
  watch(parentSheetOpen, (parentOpen) => {
    if (!parentOpen && isOpen.value) close()
  })
}
provide(
  PARENT_SHEET_OPEN,
  computed(() => isOpen.value),
)
/** True from the start of openSheet() until its spring actually kicks off — syncToSnapPoints stays out of the way until the spring reads the final geometry itself. */
let isOpeningPending = false
/** Bumped by anything that invalidates an open sequence still waiting on its nextTick. */
let openToken = 0
/** True until the sheet first comes to rest after opening — survives a drag or re-aim interrupting the open spring. */
let isOpenedPending = false
let lastVelocity = 0 // px/ms; needed so the closing animation carries over the flick's velocity
let viewportListenersAttached = false
/** An index snapToIndex() was given while the sheet couldn't move yet (closed, or opening) — the open sequence goes there instead of defaultSnapPoint. */
let pendingSnapIndex: number | null = null
let isUnmounted = false

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
  // Also when reopened during its own close animation: something may have
  // opened above it since.
  zIndexFloor.value = stackZIndexFloor(stackEntry)
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
    currentSnapIndex.value =
      pendingSnapIndex === null ? clampedDefaultIndex.value : toIndex(pendingSnapIndex, snapTranslates.value.length)
    pendingSnapIndex = null
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

/**
 * Whether focus is still where a closing sheet left it: in the panel, on the
 * keyboard stand-in, or dropped to <body> (what `inert` does to focus inside
 * the panel). Anything else means focus has been moved on purpose since —
 * the parent focusing a field right after closing, or a tap on the page
 * during the close animation — and handing it back would steal it.
 */
function isFocusLeftBehind(): boolean {
  const active = document.activeElement
  return !active || active === document.body || active === keyboardProxy || !!sheetRef.value?.contains(active)
}

function restoreFocus() {
  const target = previouslyFocused
  previouslyFocused = null
  if (!target?.isConnected) return
  // focusin fires synchronously inside focus(), so the flag covers it
  restoringFocus = true
  try {
    target.focus?.({ preventScroll: true })
  } finally {
    restoringFocus = false
  }
}

function finishClose() {
  // Both before isInDom goes false and the panel stops containing anything.
  handOffRestoreTargets()
  const shouldRestoreFocus = isFocusLeftBehind()
  isInDom.value = false
  // The sheets underneath take back the dimming this one's backdrop held.
  renderBackdrops()
  unlockScroll()
  restoreThemeColor()
  restoreScaleBackground()
  teardownContentResizeObserver()
  detachOpenListeners()
  releaseKeyboardProxy()
  revealTarget = null
  if (shouldRestoreFocus) restoreFocus()
  else previouslyFocused = null
  emit('closed')
}

/** Internal version: used when closing from a gesture, to pass the flick's velocity into the animation. */
function closeWithVelocity(velocity: number) {
  lastVelocity = velocity
  isOpen.value = false
  // A parent can decline the update (`:model-value` with its own confirm
  // flow). The sheet is still open then, and mustn't stay wherever the
  // gesture left it.
  nextTick(() => {
    if (isUnmounted || !isOpen.value || isDragging) return
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

/**
 * Reopened during its own close animation, the sheet still has whatever
 * opened it the first time to hand focus back to — while what has focus now
 * is only <body> or the panel itself (left there by `inert`).
 */
function rememberFocus() {
  if (isInDom.value && previouslyFocused && isFocusLeftBehind()) return
  previouslyFocused = document.activeElement as HTMLElement | null
}

watch(isOpen, (open) => {
  if (!isClient) return
  if (open) {
    rememberFocus()
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
  if (!Number.isFinite(index)) return
  const clamped = toIndex(index, resolvedSnapPoints.value.length)
  // Called right alongside opening (`open = true; sheet.snapToIndex(2)`),
  // the open sequence hasn't picked its target yet and would otherwise
  // overwrite this one with defaultSnapPoint.
  if (!isOpen.value || isOpeningPending) {
    pendingSnapIndex = clamped
    return
  }
  currentSnapIndex.value = clamped
  if (!isDragging) settleOn(clamped, 0)
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
/** Which path activeInputId belongs to — touch identifiers and pointer ids are separate number spaces. */
let activeIsTouch = false
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

/**
 * Touch can afford a narrower list than the mouse: browsers only send a
 * touchmove once the finger has left the tap slop, and claiming it cancels the
 * click, so a tap still reaches the control while a swipe drags the sheet. A
 * list or menu made of buttons and links stays draggable that way, like a
 * native sheet. What's left owns the movement itself.
 */
const TOUCH_NO_DRAG_SELECTOR =
  'input[type="range"], input:focus, textarea:focus, [contenteditable="true"]:focus, [data-vbs-no-drag]'

function isInteractiveTarget(target: EventTarget | null, isTouch: boolean): boolean {
  return !!(target as HTMLElement | null)?.closest?.(isTouch ? TOUCH_NO_DRAG_SELECTOR : INTERACTIVE_SELECTOR)
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
  // Events with no vertical movement (a mouse jittering sideways, a touch
  // that only moved in x) don't break the stretch — they used to: a final
  // sideways-only pointermove read as direction 0, and the flick as zero.
  let firstIndex = samples.length - 1
  let direction = 0
  while (firstIndex > 0) {
    const step = Math.sign(samples[firstIndex].y - samples[firstIndex - 1].y)
    if (step !== 0) {
      if (direction === 0) direction = step
      else if (step !== direction) break
    }
    firstIndex--
  }
  if (direction === 0) return 0
  // Standing still before the movement started isn't part of it.
  while (firstIndex < samples.length - 1 && samples[firstIndex + 1].y === samples[firstIndex].y) firstIndex++
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
  activeIsTouch = isTouch
  if (el?.closest?.('.vbs-grabber-row')) {
    activeInputId = inputId
    beginDrag(y, t)
    return true
  }
  if (props.grabberOnly || isInteractiveTarget(target, isTouch)) return false
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
  if (dragPhase !== 'idle') {
    // A second finger, or a touch while the mouse holds a gesture. (A
    // tracked id among the touches that just STARTED is a reused identifier,
    // not the same finger still down.)
    const stillDown = !!findActiveTouch(e.touches) && !findActiveTouch(e.changedTouches)
    if (!activeIsTouch || stillDown) return
    // The tracked finger is gone, yet its touchend never arrived: when the
    // element under it is removed from the DOM (slot content re-rendering
    // mid-gesture), the rest of that touch is dispatched to the detached
    // node and never bubbles up here. Left alone, the gesture would stay
    // "in progress" and every later touch would be ignored for good.
    gestureEnd(e.timeStamp)
  }
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
  // The button was released where no pointerup reached the window (outside
  // the browser window, over an iframe, during a context menu): the first
  // move after that has no buttons pressed, and ends the gesture instead.
  if (e.buttons === 0) {
    onPointerUp(e)
    return
  }
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

/**
 * What Tab can reach. A negative tabindex is excluded from every entry, not
 * only from the `[tabindex]` one: a `<button tabindex="-1">` that ended up as
 * the list's last element meant Tab from the real last stop wasn't caught,
 * and focus walked out of the dialog into the page behind it.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'summary',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
]
  .map((s) => `${s}:not([tabindex^="-"])`)
  .join(', ')

/** Rendered at all: `offsetParent` alone misses a `position: fixed` element, which never has one. */
function isRendered(el: HTMLElement): boolean {
  if (el.offsetParent !== null) return true
  return getComputedStyle(el).position === 'fixed' && el.getClientRects().length > 0
}

function getFocusableElements(): HTMLElement[] {
  if (!sheetRef.value) return []
  return Array.from(sheetRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isRendered)
}

const INPUT_LIKE_SELECTOR =
  'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [contenteditable]:not([contenteditable="false"])'

/** For `autoFocus="input"` — the first visible, enabled input-like element in the panel, in DOM order. */
function getFirstInputElement(): HTMLElement | null {
  if (!sheetRef.value) return null
  // The first VISIBLE one: a hidden field ahead of it in the DOM (a
  // collapsed section, a `v-show`n step of a form) used to mean none at all.
  for (const el of sheetRef.value.querySelectorAll<HTMLElement>(INPUT_LIKE_SELECTOR)) {
    if (isRendered(el)) return el
  }
  return null
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
  } else if (!focusable.includes(active)) {
    // Focus sits on something Tab itself can't reach (a `tabindex="-1"`
    // element focused from code, a scroller the browser made focusable):
    // the browser would move on from there in DOM order, and past the last
    // stop that's out of the dialog. Do the same move here, wrapping.
    e.preventDefault()
    const after = (el: HTMLElement) => !!(active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
    const next = e.shiftKey
      ? [...focusable].reverse().find((el) => !after(el))
      : focusable.find(after)
    ;(next ?? (e.shiftKey ? last : first)).focus()
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

const backdropStyle = computed(() => ({ zIndex: baseZIndex.value }))

/** A px height (only ever written when the viewport itself changes, never during motion) instead of `100dvh`: dvh ignores the on-screen keyboard, and everything else here — snap points, the footer's position — is measured against what's actually visible. */
const sheetStyle = computed(() => ({
  height: `${viewportHeight.value}px`,
  zIndex: baseZIndex.value + 1,
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
  mountedSheets.add(stackEntry)
  updateViewportHeight()
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

  if (isOpen.value) {
    rememberFocus()
    openSheet()
  }
})

onBeforeUnmount(() => {
  // The outer sheet closed without an animation (reduced motion), and its
  // content is unmounting before the watcher above got to run.
  if (parentSheetOpen && !parentSheetOpen.value && isOpen.value) isOpen.value = false
  isUnmounted = true
  // Unmounted while open (a route change, a v-if around the sheet): focus
  // would otherwise sink to <body> along with the removed panel.
  const shouldRestoreFocus = isInDom.value && isFocusLeftBehind()
  if (isInDom.value) handOffRestoreTargets()
  mountedSheets.delete(stackEntry)
  renderBackdrops()
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
  if (shouldRestoreFocus) restoreFocus()
  previouslyFocused = null
  revealTarget = null
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
        :style="[panelStyle, sheetStyle]"
        role="dialog"
        aria-modal="true"
        :aria-label="ariaLabel"
        :inert="!isOpen"
        tabindex="-1"
        @scroll="onPanelScroll"
        @focusin="onPanelFocusIn"
        @focusout="onPanelFocusOut"
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
        <div
          ref="contentRef"
          class="vbs-content"
          :class="contentClass"
          :style="hasSingleSnapPoint ? { marginBottom: `${contentSpacerHeight}px` } : undefined"
        >
          <!-- contentInnerRef doesn't stretch along with .vbs-content (flex: 1),
               so its height is the slot's real, undistorted height. -->
          <div ref="contentInnerRef" :class="{ 'vbs-content-inner--no-footer': !$slots.footer }">
            <slot :close="close" />
          </div>
          <div v-if="!hasSingleSnapPoint" :style="{ height: `${contentSpacerHeight}px` }" aria-hidden="true" />
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
