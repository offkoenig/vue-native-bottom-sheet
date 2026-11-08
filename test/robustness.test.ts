import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import BottomSheet from '../src/BottomSheet.vue'

function getPanel(): HTMLElement {
  return document.querySelector('.vbs-panel') as HTMLElement
}
function panelY(): number {
  return parseFloat(/translate3d\(0(?:px)?, (-?[\d.]+)px/.exec(getPanel().style.transform)![1])
}
function grabber(): Element {
  return document.querySelector('.vbs-grabber-row')!
}

function fireTouch(target: Element, type: string, y: number, t: number, id = 1, x = 100) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  const touch = { identifier: id, clientX: x, clientY: y }
  Object.defineProperties(e, {
    changedTouches: { value: [touch] },
    touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : [touch] },
    timeStamp: { value: t },
  })
  target.dispatchEvent(e)
  return e
}
function firePointer(target: EventTarget, type: string, init: { x?: number; y: number; t: number; buttons?: number }) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(e, {
    pointerId: { value: 1 },
    pointerType: { value: 'mouse' },
    button: { value: 0 },
    buttons: { value: init.buttons ?? 1 },
    clientX: { value: init.x ?? 100 },
    clientY: { value: init.y },
    timeStamp: { value: init.t },
  })
  target.dispatchEvent(e)
}
function pressTab(shiftKey = false) {
  const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
  document.dispatchEvent(e)
  return e
}

describe('BottomSheet robustness', () => {
  const wrappers: VueWrapper[] = []
  function open(props: Record<string, unknown> = {}, slots: Record<string, () => unknown> = {}) {
    const w = mount(BottomSheet, {
      props: { modelValue: true, snapPoints: [50, 100], ...props },
      slots: slots as never,
      attachTo: document.body,
    })
    wrappers.push(w)
    return w
  }
  async function openAndSettle(props: Record<string, unknown> = {}, slots: Record<string, () => unknown> = {}) {
    const w = open(props, slots)
    await vi.waitFor(() => expect(w.emitted('opened')).toBeTruthy())
    await nextTick()
    return w
  }

  afterEach(() => {
    wrappers.splice(0).forEach((w) => w.unmount())
    document.body.removeAttribute('style')
    document.body.innerHTML = ''
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove())
    document.documentElement.className = ''
  })

  describe('focus', () => {
    it('does not take focus back from where the parent moved it after closing', async () => {
      const opener = document.createElement('button')
      const other = document.createElement('input')
      document.body.append(opener, other)
      opener.focus()
      // A real close animation, so there's time for focus to move during it.
      const w = open({ respectReducedMotion: false })
      await vi.waitFor(() => expect(w.emitted('opened')).toBeTruthy(), { timeout: 3000 })
      await w.setProps({ modelValue: false })
      // The parent focuses a field right as it closes the sheet.
      other.focus()
      await vi.waitFor(() => expect(w.emitted('closed')).toBeTruthy(), { timeout: 3000 })
      expect(document.activeElement).toBe(other)
    })

    it('hands focus back to the opener when it was left in the panel', async () => {
      const opener = document.createElement('button')
      document.body.append(opener)
      opener.focus()
      const w = await openAndSettle({}, { default: () => h('button', { id: 'inside' }) })
      ;(document.querySelector('#inside') as HTMLElement).focus()
      await w.setProps({ modelValue: false })
      await vi.waitFor(() => expect(w.emitted('closed')).toBeTruthy())
      expect(document.activeElement).toBe(opener)
    })

    it('restores focus to the opener when unmounted while open', async () => {
      const opener = document.createElement('button')
      document.body.append(opener)
      opener.focus()
      const w = await openAndSettle()
      expect(document.activeElement).toBe(getPanel())
      wrappers.splice(wrappers.indexOf(w), 1)
      w.unmount()
      expect(document.activeElement).toBe(opener)
    })

    it('restores focus before emitting closed, so a closed handler can still move it', async () => {
      const opener = document.createElement('button')
      const target = document.createElement('input')
      document.body.append(opener, target)
      opener.focus()
      const w = await openAndSettle({ onClosed: () => target.focus() })
      await w.setProps({ modelValue: false })
      await vi.waitFor(() => expect(w.emitted('closed')).toBeTruthy())
      expect(document.activeElement).toBe(target)
    })
  })

  describe('focus trap', () => {
    it('ignores a tabindex="-1" element as the last stop', async () => {
      await openAndSettle({}, {
        default: () => [h('button', { id: 'a' }), h('button', { id: 'b' }), h('button', { id: 'c', tabindex: -1 })],
      })
      ;(document.querySelector('#b') as HTMLElement).focus()
      expect(pressTab().defaultPrevented).toBe(true)
      expect(document.activeElement?.id).toBe('a')
    })

    it('moves on from an element Tab cannot reach instead of leaving the dialog', async () => {
      await openAndSettle({}, {
        default: () => [h('button', { id: 'a' }), h('button', { id: 'b' }), h('div', { id: 'c', tabindex: -1 })],
      })
      ;(document.querySelector('#c') as HTMLElement).focus()
      expect(pressTab().defaultPrevented).toBe(true)
      expect(document.activeElement?.id).toBe('a')
      ;(document.querySelector('#c') as HTMLElement).focus()
      expect(pressTab(true).defaultPrevented).toBe(true)
      expect(document.activeElement?.id).toBe('b')
    })
  })

  describe('autoFocus: input', () => {
    it('focuses the first visible field, skipping a hidden one before it', async () => {
      // happy-dom has no layout, so `display: none` doesn't null offsetParent there.
      const hide = (vnode: { el: unknown }) =>
        Object.defineProperty(vnode.el as HTMLElement, 'offsetParent', { get: () => null })
      await openAndSettle({ autoFocus: 'input' }, {
        default: () => [h('input', { id: 'hidden', onVnodeMounted: hide }), h('input', { id: 'shown' })],
      })
      expect(document.activeElement?.id).toBe('shown')
    })
  })

  describe('gestures', () => {
    it('ends a mouse drag whose button was released outside the window', async () => {
      const w = await openAndSettle()
      const rest = panelY()
      firePointer(grabber(), 'pointerdown', { y: 300, t: 0 })
      firePointer(window, 'pointermove', { y: 340, t: 500 })
      expect(panelY()).toBe(rest + 40)
      // No pointerup ever came; the next move has no buttons pressed.
      firePointer(window, 'pointermove', { y: 600, t: 1000, buttons: 0 })
      expect(w.emitted('drag-end')).toBeTruthy()
      expect(panelY()).toBe(rest)
      expect(document.documentElement.classList.contains('vbs-dragging')).toBe(false)
    })

    it('keeps a mouse flick whose last move was only sideways', async () => {
      const w = await openAndSettle()
      firePointer(grabber(), 'pointerdown', { y: 300, t: 0 })
      firePointer(window, 'pointermove', { y: 310, t: 10 })
      firePointer(window, 'pointermove', { y: 330, t: 20 })
      firePointer(window, 'pointermove', { x: 104, y: 330, t: 24 })
      firePointer(window, 'pointerup', { y: 330, t: 26 })
      const [velocity] = w.emitted('drag-end')![0] as [number]
      expect(velocity).toBeCloseTo(30 / 24, 5)
    })

    it('recovers from a touch whose touchend never reached the panel', async () => {
      const w = await openAndSettle()
      const rest = panelY()
      fireTouch(grabber(), 'touchstart', 400, 0, 1)
      fireTouch(grabber(), 'touchmove', 450, 16, 1)
      expect(panelY()).toBe(rest + 50)
      // Finger 1 lifted over a node that had been removed from the DOM: no touchend here.
      fireTouch(grabber(), 'touchstart', 400, 2000, 2)
      expect(w.emitted('drag-end')).toHaveLength(1)
      // The new touch is a gesture of its own.
      expect(w.emitted('drag-start')).toHaveLength(2)
      fireTouch(grabber(), 'touchmove', 420, 2016, 2)
      fireTouch(grabber(), 'touchend', 420, 3000, 2)
      await nextTick()
      expect(panelY()).toBe(rest)
    })

    it('still ignores a second finger while the first is down', async () => {
      const w = await openAndSettle()
      fireTouch(grabber(), 'touchstart', 400, 0, 1)
      const e = new Event('touchstart', { bubbles: true, cancelable: true })
      Object.defineProperties(e, {
        changedTouches: { value: [{ identifier: 2, clientX: 0, clientY: 0 }] },
        touches: { value: [{ identifier: 1, clientX: 100, clientY: 400 }, { identifier: 2, clientX: 0, clientY: 0 }] },
        timeStamp: { value: 10 },
      })
      grabber().dispatchEvent(e)
      expect(w.emitted('drag-end')).toBeUndefined()
      fireTouch(grabber(), 'touchend', 400, 20, 1)
    })
  })

  describe('snapToIndex', () => {
    it('opens to an index requested in the same tick as opening', async () => {
      const w = open({ modelValue: false, snapPoints: [25, 60, 100] })
      await w.setProps({ modelValue: true })
      ;(w.vm as unknown as { snapToIndex: (i: number) => void }).snapToIndex(2)
      await vi.waitFor(() => expect(w.emitted('opened')).toBeTruthy())
      expect(panelY()).toBe(0)
    })

    it('ignores a non-finite index', async () => {
      const w = await openAndSettle()
      const rest = panelY()
      ;(w.vm as unknown as { snapToIndex: (i: number) => void }).snapToIndex(NaN)
      await nextTick()
      expect(panelY()).toBe(rest)
    })
  })

  describe('invalid numeric props', () => {
    it('drops non-finite snap points and rounds a fractional defaultSnapPoint', async () => {
      await openAndSettle({ snapPoints: [NaN, 50, 100], defaultSnapPoint: 0.6 })
      expect(panelY()).toBe(0)
    })

    it('rounds a fractional fadeFromIndex instead of rendering NaN opacity', async () => {
      await openAndSettle({ fadeFromIndex: 0.4 })
      const opacity = (document.querySelector('.vbs-backdrop') as HTMLElement).style.opacity
      expect(Number.isNaN(parseFloat(opacity))).toBe(false)
    })
  })

  describe('nested sheets', () => {
    function zOf(label: string): number {
      return Number(document.querySelector<HTMLElement>(`.vbs-panel[aria-label="${label}"]`)!.style.zIndex)
    }

    it('puts the newest sheet on top, whatever order the sheets were declared in', async () => {
      const b = open({ modelValue: false, ariaLabel: 'B' })
      const a = await openAndSettle({ ariaLabel: 'A' })
      await b.setProps({ modelValue: true })
      await vi.waitFor(() => expect(b.emitted('opened')).toBeTruthy())
      expect(zOf('B')).toBeGreaterThan(zOf('A'))
      // A lower sheet reopened goes back on top.
      await a.setProps({ modelValue: false })
      await vi.waitFor(() => expect(a.emitted('closed')).toBeTruthy())
      await a.setProps({ modelValue: true })
      await vi.waitFor(() => expect(a.emitted('opened')).toHaveLength(2))
      expect(zOf('A')).toBeGreaterThan(zOf('B'))
    })

    it('goes back to its own zIndex once nothing else is on screen', async () => {
      const a = await openAndSettle({ ariaLabel: 'A' })
      const b = await openAndSettle({ ariaLabel: 'B' })
      expect(zOf('B')).toBe(63)
      await b.setProps({ modelValue: false })
      await a.setProps({ modelValue: false })
      await vi.waitFor(() => expect(b.emitted('closed')).toBeTruthy())
      await b.setProps({ modelValue: true })
      await vi.waitFor(() => expect(b.emitted('opened')).toHaveLength(2))
      expect(zOf('B')).toBe(61)
    })

    it('opens ten levels deep, each over the last, and unwinds them one Escape at a time', async () => {
      const DEPTH = 10
      const Level: Component = defineComponent({
        name: 'Level',
        props: { depth: { type: Number, required: true } },
        setup(props) {
          const isOpen = ref(false)
          return () =>
            h('div', [
              h('button', { class: `open-${props.depth}`, onClick: () => (isOpen.value = true) }),
              props.depth < DEPTH
                ? h(
                    BottomSheet,
                    {
                      modelValue: isOpen.value,
                      'onUpdate:modelValue': (v: boolean) => (isOpen.value = v),
                      ariaLabel: `L${props.depth + 1}`,
                    },
                    { default: () => h(Level, { depth: props.depth + 1 }) },
                  )
                : null,
            ])
        },
      })
      wrappers.push(mount(Level, { props: { depth: 0 }, attachTo: document.body }))

      for (let i = 0; i < DEPTH; i++) {
        const button = await vi.waitFor(() => document.querySelector<HTMLElement>(`.open-${i}`)!)
        button.focus()
        button.click()
        await vi.waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe(`L${i + 1}`))
      }
      const zs = Array.from({ length: DEPTH }, (_, i) => zOf(`L${i + 1}`))
      expect(zs).toEqual([...zs].sort((x, y) => x - y))
      expect(new Set(zs).size).toBe(DEPTH)
      expect(document.body.style.position).toBe('fixed')

      for (let i = DEPTH - 1; i >= 0; i--) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        await vi.waitFor(() => expect(document.querySelectorAll('.vbs-panel')).toHaveLength(i))
        // Focus is back on the button that opened the sheet that just closed.
        expect(document.activeElement?.className).toBe(`open-${i}`)
      }
      expect(document.body.style.position).toBe('')
    })

    it('closes a sheet nested in another one along with it', async () => {
      const inner = vi.fn()
      const outer = await openAndSettle({ ariaLabel: 'outer' }, {
        default: () => h(BottomSheet, { modelValue: true, ariaLabel: 'inner', 'onUpdate:modelValue': inner }),
      })
      await vi.waitFor(() => expect(document.querySelectorAll('.vbs-panel')).toHaveLength(2))
      await outer.setProps({ modelValue: false })
      await nextTick()
      expect(inner).toHaveBeenCalledWith(false)
    })

    it('hands focus to what opened the chain when the sheet in the middle closed first', async () => {
      const opener = document.createElement('button')
      document.body.append(opener)
      opener.focus()
      const b = open({ modelValue: false, ariaLabel: 'B' })
      const a = await openAndSettle({ ariaLabel: 'A' }, { default: () => h('button', { id: 'open-b' }) })
      ;(document.querySelector('#open-b') as HTMLElement).focus()
      await b.setProps({ modelValue: true })
      await vi.waitFor(() => expect(b.emitted('opened')).toBeTruthy())
      // The sheet underneath closes from code while B stays up…
      await a.setProps({ modelValue: false })
      await vi.waitFor(() => expect(a.emitted('closed')).toBeTruthy())
      // …so B's own opener is gone by the time B closes.
      await b.setProps({ modelValue: false })
      await vi.waitFor(() => expect(b.emitted('closed')).toBeTruthy())
      expect(document.activeElement).toBe(opener)
    })
  })

  describe('backdrops of stacked sheets', () => {
    /** Backdrop opacities, top-most sheet first. */
    function opacities(): number[] {
      return Array.from(document.querySelectorAll<HTMLElement>('.vbs-backdrop'))
        .sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex))
        .map((el) => Number(el.style.opacity))
    }
    /** How dark the page under all of them is. */
    function pageDim(): number {
      return 1 - opacities().reduce((light, o) => light * (1 - o), 1)
    }
    const full = { snapPoints: [100] }

    it('dims the page as much as one sheet does, however many are open', async () => {
      for (let i = 0; i < 10; i++) await openAndSettle(full)
      expect(pageDim()).toBeCloseTo(0.45, 6)
      // The top backdrop does it all, dimming the sheets underneath too.
      expect(opacities()[0]).toBeCloseTo(0.45, 6)
      expect(opacities().slice(1).every((o) => o === 0)).toBe(true)
    })

    it('hands the dimming over continuously while the top sheet is dragged', async () => {
      await openAndSettle(full)
      await openAndSettle(full)
      const grabbers = document.querySelectorAll('.vbs-grabber-row')
      const top = grabbers[grabbers.length - 1]
      fireTouch(top, 'touchstart', 0, 0)
      for (const fraction of [0.25, 0.5, 0.75]) {
        fireTouch(top, 'touchmove', window.innerHeight * fraction, 16)
        const [upper, lower] = opacities()
        expect(upper).toBeCloseTo(0.45 * (1 - fraction), 6)
        expect(lower).toBeGreaterThan(0)
        expect(pageDim()).toBeCloseTo(0.45, 6)
      }
      fireTouch(top, 'touchend', window.innerHeight * 0.75, 2000)
    })

    it('gives the dimming back to the sheet underneath once the top one closes', async () => {
      await openAndSettle(full)
      const b = await openAndSettle(full)
      await b.setProps({ modelValue: false })
      await vi.waitFor(() => expect(b.emitted('closed')).toBeTruthy())
      expect(opacities()).toEqual([0.45])
    })

    it('keeps the darker of the two when the lower sheet asks for more', async () => {
      await openAndSettle({ ...full, backdropOpacity: 0.7 })
      await openAndSettle(full)
      expect(opacities()[0]).toBeCloseTo(0.45, 6)
      expect(pageDim()).toBeCloseTo(0.7, 6)
    })

    it('leaves the lower backdrop alone under a sheet without one', async () => {
      await openAndSettle(full)
      await openAndSettle({ ...full, showBackdrop: false })
      expect(opacities()).toEqual([0.45])
    })
  })

  describe('scaleBackground with overlapping sheets', () => {
    function background() {
      const el = document.createElement('div')
      el.setAttribute('data-vbs-background', '')
      el.style.transform = 'rotate(1deg)'
      document.body.append(el)
      document.body.style.background = 'white'
      return el
    }
    const props = { scaleBackground: true, snapPoints: [100] }

    it('keeps the page scaled until the last sheet closes, in either order', async () => {
      const el = background()
      const a = await openAndSettle({ ...props, scaleBackgroundColor: 'red' })
      const scaled = el.style.transform
      expect(scaled).toContain('scale(')
      const b = await openAndSettle({ ...props, scaleBackgroundColor: 'blue' })
      expect(el.style.transform).toBe(scaled)
      expect(document.body.style.background).toBe('blue')

      // The outer sheet closes first: the inner one still holds the scale.
      await a.setProps({ modelValue: false })
      await vi.waitFor(() => expect(a.emitted('closed')).toBeTruthy())
      expect(el.style.transform).toBe(scaled)
      expect(el.style.transformOrigin).not.toBe('')

      await b.setProps({ modelValue: false })
      await vi.waitFor(() => expect(b.emitted('closed')).toBeTruthy())
      expect(el.style.transform).toBe('rotate(1deg)')
      expect(el.style.transformOrigin).toBe('')
      expect(el.style.clipPath).toBe('')
      expect(document.body.style.background).toBe('white')
    })

    it('hands the background back to the outer sheet when the inner one closes', async () => {
      const el = background()
      await openAndSettle({ ...props, scaleBackgroundColor: 'red' })
      const scaled = el.style.transform
      const b = await openAndSettle({ ...props, scaleBackgroundColor: 'blue' })
      await b.setProps({ modelValue: false })
      await vi.waitFor(() => expect(b.emitted('closed')).toBeTruthy())
      expect(el.style.transform).toBe(scaled)
      expect(document.body.style.background).toBe('red')
    })
  })

  describe('theme-color', () => {
    function metaContents() {
      return Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((m) => m.getAttribute('content'))
    }

    it('restores the page value whatever order overlapping sheets close in', async () => {
      const meta = document.createElement('meta')
      meta.name = 'theme-color'
      meta.content = '#fff'
      document.head.append(meta)
      const a = await openAndSettle({ themeColor: '#aaa' })
      const b = await openAndSettle({ themeColor: '#bbb' })
      expect(metaContents()).toEqual(['#bbb'])
      await a.setProps({ modelValue: false })
      await vi.waitFor(() => expect(a.emitted('closed')).toBeTruthy())
      expect(metaContents()).toEqual(['#bbb'])
      await b.setProps({ modelValue: false })
      await vi.waitFor(() => expect(b.emitted('closed')).toBeTruthy())
      expect(metaContents()).toEqual(['#fff'])
    })

    it('tints separate light and dark tags, and removes a tag it created', async () => {
      for (const scheme of ['light', 'dark']) {
        const meta = document.createElement('meta')
        meta.name = 'theme-color'
        meta.media = `(prefers-color-scheme: ${scheme})`
        meta.content = scheme
        document.head.append(meta)
      }
      const w = await openAndSettle({ themeColor: '#123' })
      expect(metaContents()).toEqual(['#123', '#123'])
      await w.setProps({ modelValue: false })
      await vi.waitFor(() => expect(w.emitted('closed')).toBeTruthy())
      expect(metaContents()).toEqual(['light', 'dark'])

      document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove())
      await w.setProps({ modelValue: true })
      await nextTick()
      expect(metaContents()).toEqual(['#123'])
      await w.setProps({ modelValue: false })
      await nextTick()
      expect(metaContents()).toEqual([])
    })
  })
})
