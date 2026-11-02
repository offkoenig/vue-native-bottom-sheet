import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createSSRApp, h, nextTick, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import BottomSheet from '../src/BottomSheet.vue'

function getPanel(): HTMLElement {
  return document.querySelector('.vbs-panel') as HTMLElement
}
/** The panel's current translateY, as written to the DOM. */
function panelY(): number {
  return parseFloat(/translate3d\(0(?:px)?, (-?[\d.]+)px/.exec(getPanel().style.transform)![1])
}

interface TouchInit {
  x?: number
  y: number
  t: number
}
function fireTouch(target: Element, type: string, { x = 100, y, t }: TouchInit, touchCount = 1) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  const touch = { identifier: 1, clientX: x, clientY: y }
  Object.defineProperties(e, {
    changedTouches: { value: [touch] },
    touches: { value: type === 'touchend' ? [] : Array(touchCount).fill(touch) },
    timeStamp: { value: t },
  })
  target.dispatchEvent(e)
  return e
}
function firePointer(target: EventTarget, type: string, y: number, t: number) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(e, {
    pointerId: { value: 1 },
    pointerType: { value: 'mouse' },
    button: { value: 0 },
    clientX: { value: 100 },
    clientY: { value: y },
    timeStamp: { value: t },
  })
  target.dispatchEvent(e)
}

describe('BottomSheet interaction', () => {
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
    document.documentElement.className = ''
  })

  describe('rendering cost', () => {
    it('does not re-render slots while dragging', async () => {
      let renders = 0
      await openAndSettle(
        {},
        {
          default: () => {
            renders++
            return h('p', 'content')
          },
        },
      )
      const before = renders
      const grabber = document.querySelector('.vbs-grabber-row')!
      const startY = panelY()
      fireTouch(grabber, 'touchstart', { y: 400, t: 0 })
      for (let i = 1; i <= 20; i++) fireTouch(grabber, 'touchmove', { y: 400 + i * 5, t: i * 16 })
      await nextTick()
      expect(panelY()).toBe(startY + 100)
      expect(renders).toBe(before)
      fireTouch(grabber, 'touchend', { y: 500, t: 500 })
    })
  })

  describe('touch handoff between sheet and content', () => {
    function content() {
      return document.querySelector('.vbs-content') as HTMLElement
    }

    it('claims the very first touchmove for a downward drag on content at scrollTop 0', async () => {
      const w = await openAndSettle()
      const startY = panelY()
      fireTouch(content(), 'touchstart', { y: 500, t: 0 })
      const first = fireTouch(content(), 'touchmove', { y: 501, t: 16 })
      expect(first.defaultPrevented).toBe(true)
      expect(w.emitted('drag-start')).toBeTruthy()
      // Already moved with the deciding event, and measured from the touch origin.
      expect(panelY()).toBe(startY + 1)
      fireTouch(content(), 'touchmove', { y: 560, t: 32 })
      expect(panelY()).toBe(startY + 60)
    })

    it('leaves the gesture to native scroll when content is scrolled down', async () => {
      const w = await openAndSettle()
      content().scrollTop = 40
      fireTouch(content(), 'touchstart', { y: 500, t: 0 })
      const first = fireTouch(content(), 'touchmove', { y: 520, t: 16 })
      const second = fireTouch(content(), 'touchmove', { y: 560, t: 32 })
      expect(first.defaultPrevented).toBe(false)
      expect(second.defaultPrevented).toBe(false)
      expect(w.emitted('drag-start')).toBeUndefined()
    })

    it('expands on an upward drag while a more-open snap point is left', async () => {
      const w = await openAndSettle()
      fireTouch(content(), 'touchstart', { y: 500, t: 0 })
      expect(fireTouch(content(), 'touchmove', { y: 490, t: 16 }).defaultPrevented).toBe(true)
      expect(w.emitted('drag-start')).toBeTruthy()
    })

    it('leaves a mostly-horizontal gesture to the slot', async () => {
      const w = await openAndSettle()
      fireTouch(content(), 'touchstart', { x: 100, y: 500, t: 0 })
      const move = fireTouch(content(), 'touchmove', { x: 130, y: 505, t: 16 })
      expect(move.defaultPrevented).toBe(false)
      expect(w.emitted('drag-start')).toBeUndefined()
    })

    it('respects a nested scroller that can still scroll back', async () => {
      const w = await openAndSettle({}, { default: () => h('div', { id: 'inner' }, [h('p', { id: 'row' }, 'row')]) })
      document.getElementById('inner')!.scrollTop = 30
      fireTouch(document.getElementById('row')!, 'touchstart', { y: 500, t: 0 })
      expect(fireTouch(document.getElementById('row')!, 'touchmove', { y: 520, t: 16 }).defaultPrevented).toBe(false)
      expect(w.emitted('drag-start')).toBeUndefined()
    })

    it('drags from buttons and links on touch', async () => {
      const w = await openAndSettle({}, { default: () => [h('button', { id: 'b' }), h('a', { id: 'l', href: '#' })] })
      const button = document.querySelector('#b')!
      fireTouch(button, 'touchstart', { y: 500, t: 0 })
      expect(fireTouch(button, 'touchmove', { y: 520, t: 16 }).defaultPrevented).toBe(true)
      expect(w.emitted('drag-start')).toHaveLength(1)
      fireTouch(button, 'touchend', { y: 520, t: 32 })
      const link = document.querySelector('#l')!
      fireTouch(link, 'touchstart', { y: 500, t: 100 })
      expect(fireTouch(link, 'touchmove', { y: 520, t: 116 }).defaultPrevented).toBe(true)
      expect(w.emitted('drag-start')).toHaveLength(2)
    })

    it('leaves range inputs and a focused text input to themselves on touch', async () => {
      const w = await openAndSettle(
        {},
        { default: () => [h('input', { id: 'r', type: 'range' }), h('input', { id: 't', type: 'text' })] },
      )
      const range = document.querySelector('#r')!
      fireTouch(range, 'touchstart', { y: 500, t: 0 })
      expect(fireTouch(range, 'touchmove', { y: 520, t: 16 }).defaultPrevented).toBe(false)
      fireTouch(range, 'touchend', { y: 520, t: 32 })
      const text = document.querySelector<HTMLInputElement>('#t')!
      text.focus()
      fireTouch(text, 'touchstart', { y: 500, t: 100 })
      expect(fireTouch(text, 'touchmove', { y: 520, t: 116 }).defaultPrevented).toBe(false)
      expect(w.emitted('drag-start')).toBeUndefined()
    })

    it('does not start a mouse drag from a button', async () => {
      const w = await openAndSettle({}, { default: () => h('button', { id: 'b' }) })
      const button = document.querySelector('#b')!
      firePointer(button, 'pointerdown', 500, 0)
      firePointer(window, 'pointermove', 540, 16)
      expect(w.emitted('drag-start')).toBeUndefined()
    })

    it('never starts a drag from a [data-vbs-no-drag] element', async () => {
      const w = await openAndSettle({}, { default: () => h('div', { id: 'slider', 'data-vbs-no-drag': '' }) })
      const slider = document.getElementById('slider')!
      fireTouch(slider, 'touchstart', { y: 500, t: 0 })
      expect(fireTouch(slider, 'touchmove', { y: 540, t: 16 }).defaultPrevented).toBe(false)
      expect(w.emitted('drag-start')).toBeUndefined()
    })

    it('ignores a pinch', async () => {
      const w = await openAndSettle()
      fireTouch(content(), 'touchstart', { y: 500, t: 0 })
      expect(fireTouch(content(), 'touchmove', { y: 520, t: 16 }, 2).defaultPrevented).toBe(false)
      expect(w.emitted('drag-start')).toBeUndefined()
    })
  })

  describe('settling', () => {
    function drag(moves: [number, number][]) {
      const grabber = document.querySelector('.vbs-grabber-row')!
      const [y0, t0] = moves[0]
      fireTouch(grabber, 'touchstart', { y: y0, t: t0 })
      for (const [y, t] of moves.slice(1)) fireTouch(grabber, 'touchmove', { y, t })
      return grabber
    }

    it('reads a pause before release as zero velocity, not a flick', async () => {
      const w = await openAndSettle()
      const grabber = drag([[400, 0], [420, 16], [440, 32]])
      fireTouch(grabber, 'touchend', { y: 440, t: 1000 })
      expect(w.emitted('drag-end')![0]).toEqual([0])
      await nextTick()
      expect(w.emitted('update:modelValue')).toBeUndefined()
    })

    it('measures only the last stretch of movement across a reversal', async () => {
      const w = await openAndSettle()
      const grabber = drag([[400, 0], [440, 40], [480, 80], [440, 100], [400, 120]])
      fireTouch(grabber, 'touchend', { y: 400, t: 125 })
      const [velocity] = w.emitted('drag-end')![0] as [number]
      expect(velocity).toBeCloseTo(-2, 5)
    })

    it('moves to the next point below where the sheet is, not below where the drag began', async () => {
      const w = await openAndSettle({ snapPoints: [25, 60, 100], defaultSnapPoint: 2 })
      const h60 = window.innerHeight * 0.4
      // From 100%, slowly down past the 60% point, then a medium downward flick → 25%, never back up to 60%.
      const grabber = drag([[0, 0], [h60 + 50, 800], [h60 + 80, 850]])
      fireTouch(grabber, 'touchend', { y: h60 + 80, t: 855 })
      await nextTick()
      const snaps = w.emitted('snap') as [number, number][]
      expect(snaps[snaps.length - 1][0]).toBe(0)
    })

    it('closes on a fast downward flick from the lowest point', async () => {
      const w = await openAndSettle()
      const grabber = drag([[400, 0], [420, 16], [440, 32]])
      fireTouch(grabber, 'touchend', { y: 440, t: 34 })
      await vi.waitFor(() => expect(w.emitted('closed')).toBeTruthy())
    })

    it('goes back to a snap point if the parent declines to close', async () => {
      const parent = mount(BottomSheet, {
        props: { modelValue: true, snapPoints: [50, 100], 'onUpdate:modelValue': () => {} },
        attachTo: document.body,
      })
      wrappers.push(parent)
      await vi.waitFor(() => expect(parent.emitted('opened')).toBeTruthy())
      const rest = panelY()
      const grabber = drag([[400, 0], [420, 16], [440, 32]])
      fireTouch(grabber, 'touchend', { y: 440, t: 34 })
      await nextTick()
      await nextTick()
      expect(panelY()).toBe(rest)
    })

    it('does not let a non-dismissible sheet be pulled freely below its lowest point', async () => {
      const w = await openAndSettle({ dismissible: false })
      const rest = panelY()
      const grabber = drag([[100, 0], [400, 300]])
      expect(panelY() - rest).toBeLessThan(300)
      expect(panelY() - rest).toBeGreaterThan(0)
      fireTouch(grabber, 'touchend', { y: 400, t: 1000 })
      await nextTick()
      expect(w.emitted('update:modelValue')).toBeUndefined()
      expect(panelY()).toBe(rest)
    })
  })

  describe('lifecycle races', () => {
    it('stays closed when closed again before the open spring has started', async () => {
      const w = open({ modelValue: false, respectReducedMotion: false })
      await w.setProps({ modelValue: true })
      await w.setProps({ modelValue: false })
      await vi.waitFor(() => expect(w.emitted('closed')).toBeTruthy(), { timeout: 3000 })
      await new Promise((r) => setTimeout(r, 100))
      expect(document.querySelector('.vbs-panel')).toBeNull()
      expect(w.emitted('opened')).toBeUndefined()
    })

    it('still emits opened when a drag interrupts the open animation', async () => {
      const w = open({ respectReducedMotion: false })
      await vi.waitFor(() => expect(document.querySelector('.vbs-grabber-row')).not.toBeNull())
      await new Promise((r) => setTimeout(r, 50))
      const grabber = document.querySelector('.vbs-grabber-row')!
      fireTouch(grabber, 'touchstart', { y: 400, t: 0 })
      fireTouch(grabber, 'touchend', { y: 400, t: 1 })
      await vi.waitFor(() => expect(w.emitted('opened')).toBeTruthy(), { timeout: 3000 })
      expect(w.emitted('opened')!.length).toBe(1)
    })

    it('abandons an in-flight drag when the parent closes the sheet', async () => {
      const w = await openAndSettle()
      const grabber = document.querySelector('.vbs-grabber-row')!
      fireTouch(grabber, 'touchstart', { y: 400, t: 0 })
      fireTouch(grabber, 'touchmove', { y: 420, t: 16 })
      await w.setProps({ modelValue: false })
      await vi.waitFor(() => expect(w.emitted('closed')).toBeTruthy())
      expect(w.emitted('drag-end')).toEqual([[0]])
      expect(document.documentElement.classList.contains('vbs-dragging')).toBe(false)
    })
  })

  describe('scroll lock', () => {
    it('holds until the last of several overlapping sheets is gone, whatever the order', async () => {
      document.body.style.position = 'relative'
      const a = await openAndSettle()
      expect(document.body.style.position).toBe('fixed')
      const b = await openAndSettle()
      await a.setProps({ modelValue: false })
      await vi.waitFor(() => expect(a.emitted('closed')).toBeTruthy())
      expect(document.body.style.position).toBe('fixed')
      await b.setProps({ modelValue: false })
      await vi.waitFor(() => expect(b.emitted('closed')).toBeTruthy())
      expect(document.body.style.position).toBe('relative')
    })

    it('releases when unmounted during the close animation', async () => {
      const w = open({ respectReducedMotion: false })
      await vi.waitFor(() => expect(document.body.style.position).toBe('fixed'))
      await w.setProps({ modelValue: false })
      wrappers.splice(wrappers.indexOf(w), 1)
      w.unmount()
      expect(document.body.style.position).toBe('')
    })

    it('reference-counts a shared lockScrollTarget', async () => {
      const shell = document.createElement('div')
      shell.style.overflow = 'auto'
      document.body.appendChild(shell)
      const a = await openAndSettle({ lockScrollTarget: shell })
      const b = await openAndSettle({ lockScrollTarget: shell })
      expect(shell.style.overflow).toBe('hidden')
      await a.setProps({ modelValue: false })
      await vi.waitFor(() => expect(a.emitted('closed')).toBeTruthy())
      expect(shell.style.overflow).toBe('hidden')
      await b.setProps({ modelValue: false })
      await vi.waitFor(() => expect(b.emitted('closed')).toBeTruthy())
      expect(shell.style.overflow).toBe('auto')
    })
  })

  describe('keyboard', () => {
    function pressTab(shiftKey = false) {
      const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
      document.dispatchEvent(e)
      return e
    }

    it('closes only the top-most sheet on Escape', async () => {
      const a = await openAndSettle()
      const b = await openAndSettle()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await nextTick()
      expect(b.emitted('update:modelValue')).toEqual([[false]])
      expect(a.emitted('update:modelValue')).toBeUndefined()
    })

    it('keeps Tab inside a panel with nothing focusable', async () => {
      await openAndSettle()
      expect(pressTab().defaultPrevented).toBe(true)
    })

    it('does not let Shift+Tab escape from the panel itself', async () => {
      await openAndSettle({}, { default: () => [h('button', { id: 'a' }), h('button', { id: 'b' })] })
      getPanel().focus()
      expect(pressTab(true).defaultPrevented).toBe(true)
      expect(document.activeElement?.id).toBe('b')
    })

    it('pulls focus in when it was left outside the panel', async () => {
      const outside = document.createElement('button')
      document.body.appendChild(outside)
      await openAndSettle({ autoFocus: false }, { default: () => h('button', { id: 'a' }) })
      outside.focus()
      expect(pressTab().defaultPrevented).toBe(true)
      expect(document.activeElement?.id).toBe('a')
    })
  })

  describe('reacting to changed snap points', () => {
    it('keeps a valid position when the snapPoints prop shrinks', async () => {
      const w = await openAndSettle({ snapPoints: [25, 60, 100], defaultSnapPoint: 2 })
      expect(panelY()).toBe(0)
      await w.setProps({ snapPoints: [40] })
      await nextTick()
      expect(panelY()).toBe(Math.round(window.innerHeight * 0.6))
    })

    it('reserves room to scroll the last of the content into view', async () => {
      await openAndSettle({ snapPoints: [40, 100] })
      const spacer = document.querySelector('.vbs-content')!.lastElementChild as HTMLElement
      expect(spacer.style.height).toBe(`${Math.round(window.innerHeight * 0.6)}px`)
    })

    it('ends the scroller at the screen edge with a single snap point', async () => {
      await openAndSettle({ snapPoints: [40] }, { default: () => h('p', { id: 'slot' }) })
      const content = document.querySelector('.vbs-content') as HTMLElement
      expect(content.style.marginBottom).toBe(`${Math.round(window.innerHeight * 0.6)}px`)
      // No spacer: the slot's wrapper is all there is
      expect(content.childElementCount).toBe(1)
    })
  })

  describe('mouse input', () => {
    it('drags from the grabber and swallows the click the drag ends in', async () => {
      const w = await openAndSettle()
      const clicks: Event[] = []
      window.addEventListener('click', (e) => clicks.push(e))
      const grabber = document.querySelector('.vbs-grabber-row')!
      const rest = panelY()
      firePointer(grabber, 'pointerdown', 300, 0)
      firePointer(window, 'pointermove', 340, 500)
      expect(panelY()).toBe(rest + 40)
      firePointer(window, 'pointerup', 340, 1000)
      expect(w.emitted('drag-end')).toEqual([[0]])
      const seen = vi.fn()
      document.body.addEventListener('click', seen)
      document.body.click()
      expect(seen).not.toHaveBeenCalled()
    })

    it('ignores anything but the primary button', async () => {
      const w = await openAndSettle()
      const e = new Event('pointerdown', { bubbles: true })
      Object.defineProperties(e, { pointerType: { value: 'mouse' }, button: { value: 2 }, pointerId: { value: 1 } })
      document.querySelector('.vbs-grabber-row')!.dispatchEvent(e)
      expect(w.emitted('drag-start')).toBeUndefined()
    })
  })

  describe('SSR', () => {
    it('renders on the server without touching browser globals', async () => {
      const app = createSSRApp({ setup: () => () => h(BottomSheet, { modelValue: ref(true).value }) })
      const win = globalThis.window
      vi.stubGlobal('window', undefined)
      try {
        await expect(renderToString(app, {})).resolves.not.toContain('vbs-panel')
      } finally {
        vi.stubGlobal('window', win)
        vi.unstubAllGlobals()
      }
    })
  })
})
