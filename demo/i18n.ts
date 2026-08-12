import { ref, computed } from 'vue'

export type Lang = 'en' | 'ru'

export const lang = ref<Lang>('en')

export function toggleLang() {
  lang.value = lang.value === 'en' ? 'ru' : 'en'
}

const messages = {
  en: {
    kicker: 'Vue 3 · Nuxt 3 · zero Tailwind dependency',
    heroTitle: 'A bottom sheet that feels native.',
    heroSubtitle:
      'Velocity-based inertia, rubber-band resistance, and real spring physics instead of CSS timing curves — everything below is the actual shipped component, not a mockup.',
    install: 'npm install vue-native-bottom-sheet',
    tryIt: 'Try every example on a touch device for the full effect — mouse drag works too.',

    examplesKicker: 'Examples',
    examplesTitle: 'Seven ways to configure it',

    basicTitle: 'Basic',
    basicDesc: 'Default snap points [50, 100]. Flick down fast enough and it closes even from a small drag.',
    basicOpen: 'Open sheet',
    basicHeader: 'Basic sheet',
    basicName: 'Alex Kim',
    basicRole: 'Product Designer · Berlin',
    basicBio:
      'Ten years turning fuzzy briefs into shipped interfaces. Currently obsessed with physically-based motion — like the spring under this very sheet.',
    basicStatProjects: 'Projects',
    basicStatFollowers: 'Followers',
    basicStatRating: 'Rating',
    basicBody:
      'Drag the handle, or scroll this content — once you\u2019re at the top, pulling down again drags the sheet instead. Try a quick downward flick.',

    multiTitle: 'Multiple snap points',
    multiDesc: 'Three stops: 25%, 60%, 100%. A slow release always settles on the nearest one.',
    multiOpen: 'Open sheet',
    multiHeader: 'Snap point {n}',
    multiBody:
      'Currently resting near snap index {n}. Drag up or down to move between stops — the queue below scrolls once you’re at 60% or 100%.',

    nonDismissibleTitle: 'Non-dismissible',
    nonDismissibleDesc: 'Backdrop click, Escape, and dragging past the lowest point all do nothing — only the button closes it.',
    nonDismissibleOpen: 'Open sheet',
    nonDismissibleHeader: 'Confirm required',
    nonDismissibleBody: 'This sheet only closes through the button below. Try the backdrop, Escape, or swiping it away — nothing happens.',
    nonDismissibleConfirm: 'Got it, close',

    themeTitle: 'Custom theme',
    themeDesc: 'Same component, different --vbs-* CSS variables — dark surface, custom accent, no Tailwind involved.',
    themeOpen: 'Open sheet',
    themeHeader: 'Dark theme',
    themeBody: 'Colors here come entirely from CSS custom properties overridden on .vbs-panel — no prop for this, just plain CSS.',

    fitTitle: 'Fits its content',
    fitDesc: '`:snap-points="[\'content\']"` — no percentage guessing. Height is measured via ResizeObserver.',
    fitOpen: 'Open sheet',
    fitHeader: 'Auto height',
    fitBody: 'This sheet is exactly as tall as its content, nothing more. Add or remove rows below — it re-springs to the new height live, while staying open.',
    fitAddItem: 'Add row',
    fitRemoveItem: 'Remove row',
    fitItem: 'Row {n}',

    peekTitle: 'Peek, iOS-style',
    peekDesc:
      'Two snap points: 20% and 90%, opens straight to 90%. `fadeFromIndex="1"` means dragging down to the 20% peek strips the backdrop entirely. `scaleBackground` shrinks and rounds the page behind it, driven by the same live translateY as the sheet.',
    peekScaleBg: 'Scale background',
    peekGrabberOnly: 'Drag only from the grabber',
    peekOpen: 'Open peek sheet',
    peekHeader: 'Nearby',
    peekPlaceName: 'Sunday Coffee Roasters',
    peekCategory: 'Cafe · Third-wave coffee',
    peekRating: '4.8',
    peekReviews: '512 reviews',
    peekOpenStatus: 'Open until 22:00',
    peekDirections: 'Directions',
    peekCall: 'Call',
    peekBody:
      'This opens straight to 90%, where the backdrop and scaled background are both fully visible. Drag it down toward the 20% peek and both fade out completely — no dimmed backdrop, no scaled background. A hard flick in either direction jumps straight to the edge instead of stepping one snap at a time.',

    inputsTitle: 'Inputs & keyboard',
    inputsDesc:
      'A real `<input>` and `<textarea>` inside the sheet — on iOS Safari, focusing one opens the keyboard and the sheet repositions itself above it via visualViewport, without a gap underneath.',
    inputsOpen: 'Open sheet',
    inputsHeader: 'Send feedback',
    inputsNameLabel: 'Name',
    inputsNamePlaceholder: 'Ada Lovelace',
    inputsMessageLabel: 'Message',
    inputsMessagePlaceholder: 'Tap here and the keyboard should push the sheet up cleanly, no matter which snap point it started on…',
    inputsSubmit: 'Send',

    playgroundKicker: 'Playground',
    playgroundTitle: 'Feel the physics change live',
    playgroundDesc:
      'Adjust the spring and drag it — the numbers below are the actual props passed to the component in real time.',
    stiffness: 'springStiffness',
    damping: 'springDamping',
    rubberBand: 'rubberBandResistance',
    threshold: 'closeThreshold',
    playgroundOpen: 'Open playground sheet',
    playgroundHeader: 'Physics playground',
    playgroundBody: 'This sheet uses whatever values the sliders on the page currently have. Close it, tweak, reopen.',
    playgroundBody2:
      'Under the hood it’s a damped harmonic oscillator, integrated once per frame with semi-implicit Euler — the same equation a real spring follows, not a pre-drawn easing curve. Your swipe’s velocity becomes its initial velocity.',
    resetDefaults: 'Reset to defaults',

    programmaticKicker: 'Programmatic control',
    programmaticTitle: 'Driven from outside, via a template ref',
    programmaticDesc: 'These buttons call sheet.value.snapToIndex(i) and sheet.value.close() directly — no swipe involved.',
    snapTo: 'Snap to {p}%',
    closeIt: 'Close',
    programmaticHeader: 'Remote controlled',
    programmaticBody: 'Opened and resized entirely from buttons outside the sheet.',
    programmaticStop25: 'Peek',
    programmaticStop60: 'Details',
    programmaticStop100: 'Full screen',

    footerNote: 'Full source, README, and physics write-up ship in the package.',
  },
  ru: {
    kicker: 'Vue 3 · Nuxt 3 · без зависимости от Tailwind',
    heroTitle: 'Шторка, которая ощущается нативно.',
    heroSubtitle:
      'Инерция по скорости свайпа, эффект «резинки» и настоящая пружинная физика вместо CSS-таймингов — всё ниже собрано из реального компонента, а не имитация.',
    install: 'npm install vue-native-bottom-sheet',
    tryIt: 'Для полного эффекта пробуйте на тач-устройстве — но и мышью тоже работает.',

    examplesKicker: 'Примеры',
    examplesTitle: 'Семь вариантов настройки',

    basicTitle: 'Базовый',
    basicDesc: 'Точки прилипания [50, 100] по умолчанию. Быстрый свайп вниз закрывает даже при небольшом протягивании.',
    basicOpen: 'Открыть шторку',
    basicHeader: 'Базовая шторка',
    basicName: 'Алекс Ким',
    basicRole: 'Продуктовый дизайнер · Берлин',
    basicBio:
      'Десять лет превращаю расплывчатые ТЗ в готовые интерфейсы. Сейчас увлечён физически достоверным движением — вроде той пружины, что под этой самой шторкой.',
    basicStatProjects: 'Проектов',
    basicStatFollowers: 'Подписчиков',
    basicStatRating: 'Рейтинг',
    basicBody:
      'Потяните за хваталку или скролльте контент — когда докрутите до верха, повторное перетягивание вниз потащит уже саму шторку. Попробуйте быстрый свайп вниз.',

    multiTitle: 'Несколько точек прилипания',
    multiDesc: 'Три остановки: 25%, 60%, 100%. Медленный релиз всегда прилипает к ближайшей.',
    multiOpen: 'Открыть шторку',
    multiHeader: 'Точка {n}',
    multiBody:
      'Сейчас примерно на точке с индексом {n}. Тяните вверх или вниз, чтобы переключаться — очередь ниже скроллится на 60% и 100%.',

    nonDismissibleTitle: 'Без закрытия жестом',
    nonDismissibleDesc: 'Клик по фону, Escape и свайп ниже нижней точки не действуют — закрывает только кнопка.',
    nonDismissibleOpen: 'Открыть шторку',
    nonDismissibleHeader: 'Нужно подтверждение',
    nonDismissibleBody: 'Эта шторка закрывается только кнопкой ниже. Попробуйте фон, Escape или смахнуть — ничего не произойдёт.',
    nonDismissibleConfirm: 'Понятно, закрыть',

    themeTitle: 'Своя тема',
    themeDesc: 'Тот же компонент, другие CSS-переменные --vbs-* — тёмная поверхность, свой акцент, без Tailwind.',
    themeOpen: 'Открыть шторку',
    themeHeader: 'Тёмная тема',
    themeBody: 'Цвета здесь целиком заданы через переопределённые CSS-переменные на .vbs-panel — без единого пропа, просто CSS.',

    fitTitle: 'Подстраивается под контент',
    fitDesc: '`:snap-points="[\'content\']"` — никаких процентов на глаз. Высота измеряется через ResizeObserver.',
    fitOpen: 'Открыть шторку',
    fitHeader: 'Авто-высота',
    fitBody: 'Эта шторка ровно такой высоты, сколько занимает контент — не больше. Добавляйте/убирайте строки ниже — она сама доедет до новой высоты, не закрываясь.',
    fitAddItem: 'Добавить строку',
    fitRemoveItem: 'Убрать строку',
    fitItem: 'Строка {n}',

    peekTitle: 'Peek в стиле iOS',
    peekDesc:
      'Две точки: 20% и 90%, открывается сразу на 90%. `fadeFromIndex="1"` значит, что при перетягивании вниз к 20% затемнение фона исчезает полностью. `scaleBackground` уменьшает и скругляет страницу позади — завязано на тот же живой translateY, что и сама шторка.',
    peekScaleBg: 'Масштабировать фон',
    peekGrabberOnly: 'Тянуть только за хваталку',
    peekOpen: 'Открыть peek-шторку',
    peekHeader: 'Рядом с вами',
    peekPlaceName: 'Sunday Coffee Roasters',
    peekCategory: 'Кофейня · спешелти-кофе',
    peekRating: '4.8',
    peekReviews: '512 отзывов',
    peekOpenStatus: 'Открыто до 22:00',
    peekDirections: 'Маршрут',
    peekCall: 'Позвонить',
    peekBody:
      'Открывается сразу на 90% — фон и затемнение уже полностью видны. Потяните вниз к 20% — оба эффекта полностью исчезают: ни затемнения, ни масштабирования фона. Резкий флик в любую сторону сразу прыгает в крайнюю точку, а не на один шаг.',

    inputsTitle: 'Поля ввода и клавиатура',
    inputsDesc:
      'Настоящие `<input>` и `<textarea>` внутри шторки — в iOS Safari фокус на поле открывает клавиатуру, и шторка сама переставляется над ней через visualViewport, без дыры снизу.',
    inputsOpen: 'Открыть шторку',
    inputsHeader: 'Обратная связь',
    inputsNameLabel: 'Имя',
    inputsNamePlaceholder: 'Ада Лавлейс',
    inputsMessageLabel: 'Сообщение',
    inputsMessagePlaceholder: 'Тапните сюда — клавиатура должна аккуратно поднять шторку, с какой бы точки она ни начинала…',
    inputsSubmit: 'Отправить',

    playgroundKicker: 'Плейграунд',
    playgroundTitle: 'Почувствуйте физику вживую',
    playgroundDesc: 'Меняйте параметры пружины и тяните шторку — цифры ниже реально передаются в компонент как пропы.',
    stiffness: 'springStiffness',
    damping: 'springDamping',
    rubberBand: 'rubberBandResistance',
    threshold: 'closeThreshold',
    playgroundOpen: 'Открыть шторку-плейграунд',
    playgroundHeader: 'Физика вживую',
    playgroundBody: 'Эта шторка использует те значения, что сейчас выставлены на слайдерах. Закройте, покрутите, откройте снова.',
    playgroundBody2:
      'Под капотом — затухающий гармонический осциллятор, интегрируемый раз за кадр методом полунеявного Эйлера, а не заранее нарисованная easing-кривая. Скорость вашего свайпа становится его начальной скоростью.',
    resetDefaults: 'Сбросить к умолчаниям',

    programmaticKicker: 'Программное управление',
    programmaticTitle: 'Управление снаружи через template ref',
    programmaticDesc: 'Эти кнопки напрямую вызывают sheet.value.snapToIndex(i) и sheet.value.close() — без единого свайпа.',
    snapTo: 'К {p}%',
    closeIt: 'Закрыть',
    programmaticHeader: 'Дистанционное управление',
    programmaticBody: 'Открыта и переключена целиком кнопками снаружи шторки.',
    programmaticStop25: 'Превью',
    programmaticStop60: 'Детали',
    programmaticStop100: 'На весь экран',

    footerNote: 'Полный исходный код, README и разбор физики — в самом пакете.',
  },
} as const

export const t = computed(() => messages[lang.value])
