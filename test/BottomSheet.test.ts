import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import BottomSheet from '../src/BottomSheet.vue'

// The component teleports its panel/backdrop to <body>, outside the
// mounted wrapper's own root — query the real DOM for them, not the wrapper.
function getPanel(): HTMLElement | null {
  return document.querySelector('.vbs-panel')
}
function getBackdrop(): HTMLElement | null {
  return document.querySelector('.vbs-backdrop')
}

describe('BottomSheet', () => {
  let wrapper: VueWrapper | null = null

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    // lockScroll mutates <body> inline styles directly (outside Vue's own
    // subtree) — reset it so one test's scroll-lock state can't leak into
    // the next.
    document.body.removeAttribute('style')
    document.body.innerHTML = ''
  })

  it('renders nothing while closed', async () => {
    wrapper = mount(BottomSheet, { props: { modelValue: false } })
    await nextTick()
    expect(getPanel()).toBeNull()
  })

  it('opens with the expected dialog accessibility attributes', async () => {
    wrapper = mount(BottomSheet, { props: { modelValue: true, ariaLabel: 'Test panel' } })
    await vi.waitFor(() => expect(getPanel()).not.toBeNull())
    const panel = getPanel()!
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(panel.getAttribute('aria-label')).toBe('Test panel')
  })

  it('emits "opened" once the open sequence settles', async () => {
    wrapper = mount(BottomSheet, { props: { modelValue: true } })
    await vi.waitFor(() => expect(wrapper!.emitted('opened')).toBeTruthy())
  })

  it('closes on backdrop click by default', async () => {
    wrapper = mount(BottomSheet, { props: { modelValue: true } })
    await vi.waitFor(() => expect(getBackdrop()).not.toBeNull())
    getBackdrop()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => expect(wrapper!.emitted('update:modelValue')).toBeTruthy())
    expect(wrapper!.emitted('update:modelValue')![0]).toEqual([false])
  })

  it('ignores backdrop click when closeOnBackdropClick is false', async () => {
    wrapper = mount(BottomSheet, { props: { modelValue: true, closeOnBackdropClick: false } })
    await vi.waitFor(() => expect(getBackdrop()).not.toBeNull())
    getBackdrop()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(wrapper!.emitted('update:modelValue')).toBeUndefined()
  })

  it('ignores backdrop click and Escape when dismissible is false', async () => {
    wrapper = mount(BottomSheet, { props: { modelValue: true, dismissible: false } })
    await vi.waitFor(() => expect(getBackdrop()).not.toBeNull())
    getBackdrop()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper!.emitted('update:modelValue')).toBeUndefined()
  })

  it('closes on Escape by default', async () => {
    wrapper = mount(BottomSheet, { props: { modelValue: true } })
    await vi.waitFor(() => expect(getPanel()).not.toBeNull())
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await vi.waitFor(() => expect(wrapper!.emitted('update:modelValue')).toBeTruthy())
  })

  it('exposes close(), which emits update:modelValue(false)', async () => {
    wrapper = mount(BottomSheet, { props: { modelValue: true } })
    await vi.waitFor(() => expect(getPanel()).not.toBeNull())
    ;(wrapper!.vm as unknown as { close: () => void }).close()
    await nextTick()
    expect(wrapper!.emitted('update:modelValue')![0]).toEqual([false])
  })

  it('exposes snapToIndex(), which emits snap with the resolved percent', async () => {
    wrapper = mount(BottomSheet, { props: { modelValue: true, snapPoints: [25, 60, 100] } })
    await vi.waitFor(() => expect(wrapper!.emitted('opened')).toBeTruthy())
    ;(wrapper!.vm as unknown as { snapToIndex: (i: number) => void }).snapToIndex(2)
    await vi.waitFor(() => expect(wrapper!.emitted('snap')).toBeTruthy())
    const snapEvents = wrapper!.emitted('snap') as [number, number][]
    const [index, percent] = snapEvents[snapEvents.length - 1]
    expect(index).toBe(2)
    expect(percent).toBe(100)
  })
})
