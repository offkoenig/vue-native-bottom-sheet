/**
 * Публичные типы пакета. Вынесены в отдельный файл (а не объявлены инлайново
 * внутри BottomSheet.vue), чтобы:
 *  1. Их можно было импортировать в сам компонент через `defineProps<BottomSheetProps>()`.
 *  2. Их можно было переэкспортировать из index.ts для потребителей пакета,
 *     которым нужно, например, типизировать свой собственный проп как
 *     `BottomSheetProps['snapPoints']`.
 */

/** То же, что принимает Vue в `:class` — строка, объект или массив (рекурсивно). */
export type ClassValue = string | Record<string, boolean> | ClassValue[]

export interface BottomSheetProps {
  /** Точки прилипания в процентах высоты вьюпорта (0–100). Порядок не важен — сортируются автоматически. */
  snapPoints?: number[]
  /** Индекс точки из snapPoints, до которой шторка открывается по умолчанию. */
  defaultSnapPoint?: number
  /** Порог скорости свайпа (px/мс), после которого срабатывает «инерционный» переход/закрытие. */
  closeThreshold?: number
  /** Коэффициент сопротивления (0..1) эффекта «резинки» при перетягивании выше верхней точки. 0.55 — константа из WebKit/UIScrollView. */
  rubberBandResistance?: number
  /** Жёсткость пружины settle-анимации. Больше — быстрее и «туже». */
  springStiffness?: number
  /** Демпфирование пружины. Больше — меньше «отскок» в конце анимации. */
  springDamping?: number
  /** Масса тела пружины (обычно можно не трогать). */
  springMass?: number
  /** Уважать ли системную настройку prefers-reduced-motion (мгновенные переходы вместо пружины). По умолчанию true — как и должно быть для реального продакшн-приложения. Отключайте только осознанно (например, в демо/шоукейсе, где сама анимация — предмет показа). */
  respectReducedMotion?: boolean
  /** Показывать затемнённый backdrop. */
  showBackdrop?: boolean
  /** Максимальная непрозрачность backdrop (0..1) в полностью открытом состоянии. */
  backdropOpacity?: number
  /** Закрывать по клику на backdrop. */
  closeOnBackdropClick?: boolean
  /** Закрывать по Escape. */
  closeOnEscape?: boolean
  /** Если false — шторку нельзя закрыть свайпом/backdrop/Escape, только программно (v-model, slot-проп close или ref). */
  dismissible?: boolean
  /** Блокировать скролл body, пока шторка открыта (с учётом особенностей iOS Safari). */
  lockBodyScroll?: boolean
  /** aria-label диалога. */
  ariaLabel?: string
  /** Базовый z-index (backdrop = zIndex, сама панель = zIndex + 1). */
  zIndex?: number
  /** Доп. классы на корневой элемент панели — способ добавить свои (в т.ч. Tailwind/UnoCSS) классы поверх встроенных стилей. */
  panelClass?: ClassValue
  /** Доп. классы на скроллируемую область контента. */
  contentClass?: ClassValue
  /** Доп. классы на backdrop. */
  backdropClass?: ClassValue
}

export interface BottomSheetEmits {
  /** Анимация открытия завершена. */
  opened: []
  /** Анимация закрытия завершена (панель удалена из DOM). */
  closed: []
  /** Панель «прилипла» к одной из snapPoints (не к закрытому состоянию). */
  snap: [index: number, percent: number]
  /** Начался жест перетаскивания. */
  'drag-start': []
  /** Жест перетаскивания завершён; velocity в px/мс (+ вниз, − вверх). */
  'drag-end': [velocity: number]
}

/** Что доступно через template ref (defineExpose). */
export interface BottomSheetExposed {
  /** Закрыть программно (эквивалент v-model = false, но без аргументов — безопасно для @click). */
  close: () => void
  /** Мгновенно «прилипнуть» к snap-точке по индексу, не закрывая и не открывая заново. */
  snapToIndex: (index: number) => void
}
