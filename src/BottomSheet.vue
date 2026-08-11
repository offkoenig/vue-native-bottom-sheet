<script setup lang="ts">
/**
 * BottomSheet.vue
 * ──────────────────────────────────────────────────────────────────────────
 * Нативно ощущающаяся выезжающая снизу панель (bottom sheet) для Vue 3.
 * Работает в любом Vue 3 (≥3.4) проекте — Vite, webpack/vue-loader, Nuxt 3
 * (см. соседний nuxt.ts для авто-регистрации). Не требует Tailwind — все
 * стили самодостаточны (scoped CSS + CSS-переменные для темизации), не
 * зависит от `import.meta.client` (Nuxt-специфичного макроса) — вместо
 * этого используется универсальная проверка `typeof window !== 'undefined'`.
 *
 * Ключевые принципы реализации (подробности и математика — в README.md):
 *  1. Во время жеста меняется ТОЛЬКО `transform: translate3d(...)`.
 *     top/bottom/height никогда не трогаются в реальном времени → нет reflow,
 *     только compositing → стабильные 60 FPS.
 *  2. Открытие/закрытие/снап анимируются пружиной (закон Гука + демпфирование),
 *     а не CSS-transition с фиксированной длительностью. Скорость свайпа
 *     (velocity) становится начальной скоростью пружины — анимация «доезжает»
 *     физически достоверно, а не по одной и той же кривой.
 *  3. Rubber-band при перетягивании выше самой открытой точки использует ту же
 *     формулу, что и сам WebKit/UIScrollView для оверскролла (константа 0.55).
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { BottomSheetProps, BottomSheetEmits, BottomSheetExposed } from './types'

/* Универсальная, framework-agnostic проверка клиента. Безопасна на SSR:
   `typeof window` никогда не бросает ReferenceError, даже если window не
   объявлен (в отличие от прямого обращения к window). */
const isClient = typeof window !== 'undefined'

/* ════════════════════════════════════════════════════════════════════ *
 *  Props / Emits / v-model
 * ════════════════════════════════════════════════════════════════════ */

const props = withDefaults(defineProps<BottomSheetProps>(), {
  snapPoints: () => [50, 100],
  defaultSnapPoint: 0,
  closeThreshold: 0.5,
  rubberBandResistance: 0.55,
  springStiffness: 300,
  springDamping: 32,
  springMass: 1,
  respectReducedMotion: true,
  showBackdrop: true,
  backdropOpacity: 0.45,
  closeOnBackdropClick: true,
  closeOnEscape: true,
  dismissible: true,
  lockBodyScroll: true,
  ariaLabel: 'Panel',
  zIndex: 60,
  panelClass: undefined,
  contentClass: undefined,
  backdropClass: undefined,
})

const emit = defineEmits<BottomSheetEmits>()

const isOpen = defineModel<boolean>({ default: false })

/* ════════════════════════════════════════════════════════════════════ *
 *  SSR / монтирование
 * ════════════════════════════════════════════════════════════════════ */

const isMounted = ref(false) // true только на клиенте после onMounted — защита от гидратации
const isInDom = ref(false) // ленивый маунт: контент рендерится только после первого открытия

/* ════════════════════════════════════════════════════════════════════ *
 *  Рефы на DOM
 * ════════════════════════════════════════════════════════════════════ */

const sheetRef = ref<HTMLElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)

/* ════════════════════════════════════════════════════════════════════ *
 *  Геометрия: перевод snap-точек (%) в пиксели translateY
 * ════════════════════════════════════════════════════════════════════ */

const viewportHeight = ref(0)

const sortedSnapPoints = computed(() => {
  const points = props.snapPoints?.length ? props.snapPoints : [100]
  return [...points].sort((a, b) => a - b)
})

const clampedDefaultIndex = computed(() =>
  Math.min(Math.max(props.defaultSnapPoint, 0), sortedSnapPoints.value.length - 1),
)

/** 0 = самая открытая позиция (100% вьюпорта), viewportHeight = позиция «закрыто». */
function percentToTranslate(percent: number): number {
  const clamped = Math.min(Math.max(percent, 0), 100)
  return viewportHeight.value * (1 - clamped / 100)
}

const snapTranslates = computed(() => sortedSnapPoints.value.map(percentToTranslate))
/** translateY самой открытой точки — верхняя граница, выше которой начинается rubber-band. */
const minTranslate = computed(() => snapTranslates.value[snapTranslates.value.length - 1] ?? 0)
/** translateY полностью закрытого состояния — вся панель под нижним краем экрана. */
const closedTranslate = computed(() => viewportHeight.value)

const currentSnapIndex = ref(0)
const translateY = ref(0)
const isDragging = ref(false)
const isAnimating = ref(false)

function updateViewportHeight() {
  if (!isClient) return
  viewportHeight.value = window.visualViewport?.height ?? window.innerHeight
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Rubber band — формула WebKit/UIScrollView: f(x,d,c) = x·d·c / (d + c·x)
 * ════════════════════════════════════════════════════════════════════ */

function rubberBand(overshoot: number, dimension: number, constant: number): number {
  if (dimension <= 0 || overshoot <= 0) return Math.max(overshoot, 0)
  return (overshoot * dimension * constant) / (dimension + constant * overshoot)
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Пружинная анимация (semi-implicit Euler)
 * ════════════════════════════════════════════════════════════════════ */

let rafId: number | null = null
let reducedMotionQuery: MediaQueryList | null = null

function cancelSpringAnimation() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

/**
 * Анимирует translateY.value к target, стартуя с текущей позиции и заданной
 * начальной скорости (обычно — измеренная скорость свайпа в px/мс).
 */
function springAnimateTo(target: number, initialVelocity: number, onDone?: () => void) {
  cancelSpringAnimation()

  if (props.respectReducedMotion && reducedMotionQuery?.matches) {
    translateY.value = target
    onDone?.()
    return
  }

  isAnimating.value = true

  let position = translateY.value
  // px/мс → px/с, с защитой от аномальных выбросов velocity
  let velocity = Math.max(Math.min(initialVelocity, 6), -6) * 1000

  const { springStiffness: k, springDamping: c, springMass: m } = props
  let lastTime = performance.now()

  const step = (now: number) => {
    const dt = Math.min((now - lastTime) / 1000, 1 / 30) // защита от скачков (напр. смена вкладки)
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
      onDone?.()
      return
    }
    rafId = requestAnimationFrame(step)
  }

  rafId = requestAnimationFrame(step)
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Блокировка скролла body (с учётом iOS Safari)
 * ════════════════════════════════════════════════════════════════════ */

let savedScrollY = 0
let savedBodyStyles: Record<string, string> = {}
let isScrollLocked = false

function lockScroll() {
  if (!isClient || !props.lockBodyScroll || isScrollLocked) return
  isScrollLocked = true
  const body = document.body
  savedScrollY = window.scrollY
  savedBodyStyles = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
  }
  body.style.position = 'fixed'
  body.style.top = `-${savedScrollY}px`
  body.style.left = '0'
  body.style.right = '0'
  body.style.width = '100%'
  body.style.overflow = 'hidden'
}

function unlockScroll() {
  if (!isClient || !props.lockBodyScroll || !isScrollLocked) return
  isScrollLocked = false
  const body = document.body
  body.style.position = savedBodyStyles.position ?? ''
  body.style.top = savedBodyStyles.top ?? ''
  body.style.left = savedBodyStyles.left ?? ''
  body.style.right = savedBodyStyles.right ?? ''
  body.style.width = savedBodyStyles.width ?? ''
  body.style.overflow = savedBodyStyles.overflow ?? ''
  window.scrollTo(0, savedScrollY)
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Открытие / закрытие
 * ════════════════════════════════════════════════════════════════════ */

let previouslyFocused: HTMLElement | null = null
let lastVelocity = 0 // px/мс; нужна, чтобы closing-анимация продолжала скорость флика

function openSheet() {
  // Если панель уже была в DOM (например, пользователь передумал закрывать
  // и снова открыл её прямо во время closing-анимации) — не дёргаем
  // translateY к «закрыто», а просто разворачиваем пружину из текущей
  // позиции. Иначе был бы заметный «прыжок» вниз перед открытием.
  const wasAlreadyInDom = isInDom.value

  // Важно: translateY переводится в закрытую позицию ДО isInDom = true —
  // то есть ДО того, как Vue вообще создаст DOM-узел панели. Если сделать
  // это позже (внутри nextTick, как было раньше), самый первый рендер
  // панели произойдёт со старым translateY (0 — «открыто»), и только следующим
  // шагом «прыгнет» в закрытую позицию: лишний реактивный проход и риск,
  // что браузер схлопнёт оба обновления в один пейнт, а анимация открытия
  // окажется не видна вовсе — именно так выглядит баг «шторка просто
  // появляется без анимации».
  if (!wasAlreadyInDom) {
    updateViewportHeight()
    translateY.value = closedTranslate.value
  }

  isInDom.value = true
  lockScroll()
  nextTick(() => {
    currentSnapIndex.value = clampedDefaultIndex.value
    requestAnimationFrame(() => {
      springAnimateTo(snapTranslates.value[currentSnapIndex.value], 0, () => {
        emit('opened')
        sheetRef.value?.focus()
      })
    })
  })
}

/** Внутренняя версия: используется при закрытии из жеста, чтобы передать velocity флика в анимацию. */
function closeWithVelocity(velocity: number) {
  lastVelocity = velocity
  isOpen.value = false
}

/**
 * Публичная функция закрытия — без аргументов.
 * Специально не принимает payload, чтобы `<button @click="close">` в слотах
 * был безопасен: DOM передал бы туда PointerEvent, а не число, и это
 * заполнило бы velocity пружины мусором (NaN).
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
      emit('closed')
      previouslyFocused?.focus?.()
    })
    lastVelocity = 0
  }
})

/* ════════════════════════════════════════════════════════════════════ *
 *  Программное управление снаружи (template ref + defineExpose)
 * ════════════════════════════════════════════════════════════════════ */

function snapToIndex(index: number) {
  const clamped = Math.min(Math.max(index, 0), sortedSnapPoints.value.length - 1)
  currentSnapIndex.value = clamped
  if (isOpen.value) {
    springAnimateTo(snapTranslates.value[clamped], 0, () => {
      emit('snap', clamped, sortedSnapPoints.value[clamped])
    })
  }
}

defineExpose<BottomSheetExposed>({ close, snapToIndex })

/* ════════════════════════════════════════════════════════════════════ *
 *  Жест: pointer-события, velocity, rubber band, scroll-handoff
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
let pendingGate: () => boolean = () => true

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

/** px/мс; положительное значение — движение вниз. */
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

function beginPending(e: PointerEvent, gate: () => boolean) {
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

/** Маленькая «хваталка»-индикатор — тащит сразу, без порога движения. */
function onGrabberPointerDown(e: PointerEvent) {
  beginDragging(e)
}
/** Область слота header — с порогом движения, чтобы не мешать кликам по кнопкам внутри. */
function onHeaderPointerDown(e: PointerEvent) {
  beginPending(e, () => true)
}
/** Область скроллируемого контента — тащим шторку, только если контент докручен до самого верха. */
function onContentPointerDown(e: PointerEvent) {
  beginPending(e, () => (contentRef.value?.scrollTop ?? 0) <= 0)
}

function cancelPending() {
  dragPhase = 'idle'
  activePointerId = null
  detachWindowListeners()
}

function onPointerMove(e: PointerEvent) {
  if (e.pointerId !== activePointerId) return

  if (dragPhase === 'pending') {
    const deltaY = e.clientY - startY
    const THRESHOLD = 4
    if (Math.abs(deltaY) < THRESHOLD) return
    if (deltaY < 0 || !pendingGate()) {
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

  const raw = startTranslate + (e.clientY - startY)
  let next = raw

  if (next < minTranslate.value) {
    const overshoot = minTranslate.value - next
    next = minTranslate.value - rubberBand(overshoot, viewportHeight.value, props.rubberBandResistance)
  }
  next = Math.min(next, closedTranslate.value)

  translateY.value = next
}

function onPointerUp(e: PointerEvent) {
  if (e.pointerId !== activePointerId) return
  detachWindowListeners()
  const wasDragging = dragPhase === 'dragging'
  dragPhase = 'idle'
  activePointerId = null
  isDragging.value = false

  if (!wasDragging) return

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

  if (velocity > props.closeThreshold) {
    // быстрый флик вниз — переходим на снап ниже; если уже на самом нижнем — закрываемся
    if (currentSnapIndex.value <= 0) closing = true
    else targetIndex = currentSnapIndex.value - 1
  } else if (velocity < -props.closeThreshold) {
    // быстрый флик вверх — переходим на снап выше
    targetIndex = Math.min(currentSnapIndex.value + 1, snaps.length - 1)
  } else {
    // медленный релиз — прилипаем к ближайшей точке (включая «закрыто»)
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
    emit('snap', targetIndex, sortedSnapPoints.value[targetIndex])
  })
}

/* ════════════════════════════════════════════════════════════════════ *
 *  Клавиатура: Escape закрывает, Tab — focus trap внутри панели
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
 *  Ресайз / жизненный цикл
 * ════════════════════════════════════════════════════════════════════ */

function onViewportResize() {
  updateViewportHeight()
  if (isInDom.value && !isDragging.value && !isAnimating.value) {
    translateY.value = snapTranslates.value[currentSnapIndex.value] ?? closedTranslate.value
  }
}

function onBackdropClick() {
  if (props.closeOnBackdropClick) requestClose()
}

const backdropStyle = computed(() => {
  const open = minTranslate.value
  const closed = closedTranslate.value
  const range = closed - open || 1
  const progress = 1 - Math.min(Math.max((translateY.value - open) / range, 0), 1)
  return {
    opacity: progress * props.backdropOpacity,
    zIndex: props.zIndex,
  }
})

const sheetStyle = computed(() => ({
  transform: `translate3d(0, ${translateY.value}px, 0)`,
  zIndex: props.zIndex + 1,
}))

/**
 * Футер лежит в том же flex-потоке, что и раньше (это сохраняет расчёт
 * доступного места для .vbs-content без изменений), но у панели фиксированная
 * высота 100dvh, а translateY уводит её вниз — при любой snap-точке ниже 100%
 * футер, как последний flex-элемент, физически оказывается за пределами
 * видимой области экрана (см. README/PR: «Got it, close» был недостижим).
 *
 * Правильная позиция футера на экране не зависит от того, насколько шторка
 * протянута — это всегда нижний край вьюпорта (в отличие от шапки, которая
 * обязана двигаться вместе со шторкой). Поэтому вместо изменения раскладки
 * (что означало бы reflow на каждый кадр драга) футеру задаётся собственный
 * transform, компенсирующий translateY родителя: итоговое смещение на экране
 * равно нулю, и футер остаётся приклеенным к низу экрана при любом drag/snap,
 * оставаясь чистым transform-эффектом (композитинг, не layout).
 */
const footerStyle = computed(() => ({
  transform: `translate3d(0, ${-translateY.value}px, 0)`,
}))

// onMounted/onBeforeUnmount гарантированно выполняются только на клиенте
// (это контракт Vue), поэтому внутри них isClient-проверки не нужны —
// они нужны только в функциях, которые МОГУТ быть вызваны и из мест, не
// защищённых жизненным циклом (watch(isOpen), updateViewportHeight и т.д.).
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
  } else {
    window.addEventListener('resize', onViewportResize)
  }
  document.addEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  cancelSpringAnimation()
  detachWindowListeners()
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', onViewportResize)
  } else {
    window.removeEventListener('resize', onViewportResize)
  }
  document.removeEventListener('keydown', onDocumentKeydown)
  if (isOpen.value) unlockScroll()
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

      <!-- Панель -->
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
        <!-- Хваталка + header-слот -->
        <div class="vbs-grabber-zone">
          <div class="vbs-grabber-row" @pointerdown="onGrabberPointerDown">
            <span class="vbs-grabber-bar" aria-hidden="true" />
          </div>
          <div v-if="$slots.header" @pointerdown="onHeaderPointerDown">
            <slot name="header" :close="close" :snap-index="currentSnapIndex" />
          </div>
        </div>

        <!-- Скроллируемый контент -->
        <div
          ref="contentRef"
          class="vbs-content"
          :class="contentClass"
          @pointerdown="onContentPointerDown"
        >
          <slot :close="close" />
        </div>

        <!-- Фиксированный footer -->
        <div v-if="$slots.footer" class="vbs-footer" :style="footerStyle">
          <slot name="footer" :close="close" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Корневая обёртка не должна создавать собственный layout-бокс. */
.vbs-root {
  display: contents;
}

.vbs-backdrop {
  position: fixed;
  inset: 0;
  background: #000;
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.vbs-panel {
  /* Темизация через CSS-переменные — переопределяются извне без Tailwind:
     .vbs-panel { --vbs-bg: #0a0a0a; } в глобальном CSS потребителя. */
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
  /* Фолбэк для браузеров без поддержки dvh: сначала обычный vh, затем dvh —
     если юнит не распознан, вся строка игнорируется и остаётся первое
     (валидное) значение. */
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

/* Тёмная тема: автоматически по системной настройке... */
@media (prefers-color-scheme: dark) {
  .vbs-panel {
    --vbs-bg: #171717;
    --vbs-fg: #f4f4f5;
    --vbs-ring: rgba(255, 255, 255, 0.1);
    --vbs-handle-color: #52525b;
    --vbs-border-color: #262626;
  }
}
/* ...и/или вручную через класс .dark на любом предке (конвенция Tailwind) —
   не требует самого Tailwind, просто совместимо с этой практикой. */
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

.vbs-content {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
  padding-left: 1.25rem;
  padding-right: 1.25rem;
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
