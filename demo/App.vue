<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import BottomSheet from '../src/BottomSheet.vue'
import { t, lang, toggleLang } from './i18n'

/* ---------- Basic ---------- */
const basicOpen = ref(false)

/* ---------- Multiple snap points ---------- */
const multiOpen = ref(false)
const queueTracks = [
  { title: 'Midnight City', artist: 'M83', duration: '4:03', grad: 'grad-2', emoji: '🌙' },
  { title: 'Sunset Lover', artist: 'Petit Biscuit', duration: '3:48', grad: 'grad-5', emoji: '🌅' },
  { title: 'Redbone', artist: 'Childish Gambino', duration: '5:27', grad: 'grad-1', emoji: '🎸' },
  { title: 'Breathe', artist: 'Télépopmusik', duration: '4:35', grad: 'grad-4', emoji: '🌊' },
  { title: 'Nightcall', artist: 'Kavinsky', duration: '4:18', grad: 'grad-6', emoji: '🚗' },
  { title: 'Electric Feel', artist: 'MGMT', duration: '3:49', grad: 'grad-3', emoji: '⚡' },
]

/* ---------- Non-dismissible ---------- */
const nonDismissibleOpen = ref(false)

/* ---------- Custom theme ---------- */
const themeOpen = ref(false)

/* ---------- Fits its content ---------- */
const fitOpen = ref(false)
const fitItems = ref([1, 2])
function addFitItem() {
  fitItems.value.push(fitItems.value.length + 1)
}
function removeFitItem() {
  if (fitItems.value.length > 1) fitItems.value.pop()
}

/* ---------- Peek, iOS-style (fadeFromIndex + scaleBackground + grabberOnly) ---------- */
const peekOpen = ref(false)
const peekScaleBg = ref(true)
const peekGrabberOnly = ref(false)

/* ---------- Inputs & keyboard ---------- */
const inputsOpen = ref(false)
const inputsName = ref('')
const inputsMessage = ref('')
function submitInputs() {
  inputsOpen.value = false
}

/* Live visualViewport readout — for chasing the iOS keyboard-inset formula
   against real device numbers instead of guessing from spec text. */
const debugViewport = ref({ innerH: 0, vvH: 0, vvOffsetTop: 0, keyboardInset: 0 })
function updateDebugViewport() {
  if (typeof window === 'undefined') return
  const vv = window.visualViewport
  debugViewport.value = {
    innerH: window.innerHeight,
    vvH: vv ? Math.round(vv.height) : window.innerHeight,
    vvOffsetTop: vv ? Math.round(vv.offsetTop) : 0,
    keyboardInset: vv ? Math.max(Math.round(window.innerHeight - vv.offsetTop - vv.height), 0) : 0,
  }
}
onMounted(() => {
  updateDebugViewport()
  window.visualViewport?.addEventListener('resize', updateDebugViewport)
  window.visualViewport?.addEventListener('scroll', updateDebugViewport)
  window.addEventListener('resize', updateDebugViewport)
})
onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener('resize', updateDebugViewport)
  window.visualViewport?.removeEventListener('scroll', updateDebugViewport)
  window.removeEventListener('resize', updateDebugViewport)
})

/* ---------- Physics playground ---------- */
const playgroundOpen = ref(false)
const stiffness = ref(300)
const damping = ref(32)
const rubberBand = ref(0.55)
const threshold = ref(0.5)
function resetDefaults() {
  stiffness.value = 300
  damping.value = 32
  rubberBand.value = 0.55
  threshold.value = 0.5
}

/* ---------- Programmatic control ---------- */
const programmaticOpen = ref(false)
const programmaticDefaultIndex = ref(0)
const programmaticSheet = ref<InstanceType<typeof BottomSheet> | null>(null)
const programmaticSnaps = [25, 60, 100]
const programmaticStops = computed(() => [
  { percent: 25, label: t.value.programmaticStop25, grad: 'grad-5', icon: '👀' },
  { percent: 60, label: t.value.programmaticStop60, grad: 'grad-2', icon: '📋' },
  { percent: 100, label: t.value.programmaticStop100, grad: 'grad-3', icon: '🖥️' },
])

function goToSnap(index: number) {
  if (programmaticOpen.value) {
    programmaticSheet.value?.snapToIndex(index)
  } else {
    programmaticDefaultIndex.value = index
    programmaticOpen.value = true
  }
}
function closeProgrammatic() {
  programmaticSheet.value?.close()
}
</script>

<template>
  <div class="page" data-vbs-background>
    <button class="lang-toggle" type="button" @click="toggleLang">
      {{ lang === 'en' ? 'RU' : 'EN' }}
    </button>

    <header class="hero">
      <p class="kicker">{{ t.kicker }}</p>
      <h1>{{ t.heroTitle }}</h1>
      <p class="subtitle">{{ t.heroSubtitle }}</p>
      <code class="install">{{ t.install }}</code>
      <p class="tryit">{{ t.tryIt }}</p>
    </header>

    <main>
      <section class="section">
        <p class="section-kicker">{{ t.examplesKicker }}</p>
        <h2>{{ t.examplesTitle }}</h2>

        <div class="grid">
          <article class="card">
            <h3>{{ t.basicTitle }}</h3>
            <p>{{ t.basicDesc }}</p>
            <button class="btn" type="button" @click="basicOpen = true">{{ t.basicOpen }}</button>
          </article>

          <article class="card">
            <h3>{{ t.multiTitle }}</h3>
            <p>{{ t.multiDesc }}</p>
            <button class="btn" type="button" @click="multiOpen = true">{{ t.multiOpen }}</button>
          </article>

          <article class="card">
            <h3>{{ t.nonDismissibleTitle }}</h3>
            <p>{{ t.nonDismissibleDesc }}</p>
            <button class="btn" type="button" @click="nonDismissibleOpen = true">
              {{ t.nonDismissibleOpen }}
            </button>
          </article>

          <article class="card">
            <h3>{{ t.themeTitle }}</h3>
            <p>{{ t.themeDesc }}</p>
            <button class="btn" type="button" @click="themeOpen = true">{{ t.themeOpen }}</button>
          </article>

          <article class="card">
            <h3>{{ t.fitTitle }}</h3>
            <p>{{ t.fitDesc }}</p>
            <button class="btn" type="button" @click="fitOpen = true">{{ t.fitOpen }}</button>
          </article>

          <article class="card">
            <h3>{{ t.peekTitle }}</h3>
            <p>{{ t.peekDesc }}</p>
            <label class="check-row">
              <input v-model="peekScaleBg" type="checkbox" />
              {{ t.peekScaleBg }}
            </label>
            <label class="check-row">
              <input v-model="peekGrabberOnly" type="checkbox" />
              {{ t.peekGrabberOnly }}
            </label>
            <button class="btn" type="button" @click="peekOpen = true">{{ t.peekOpen }}</button>
          </article>

          <article class="card">
            <h3>{{ t.inputsTitle }}</h3>
            <p>{{ t.inputsDesc }}</p>
            <button class="btn" type="button" @click="inputsOpen = true">{{ t.inputsOpen }}</button>
          </article>
        </div>
      </section>

      <section class="section">
        <p class="section-kicker">{{ t.playgroundKicker }}</p>
        <h2>{{ t.playgroundTitle }}</h2>
        <p class="section-desc">{{ t.playgroundDesc }}</p>

        <div class="playground">
          <label class="slider-row">
            <span class="slider-label">
              <code>{{ t.stiffness }}</code><b>{{ stiffness }}</b>
            </span>
            <input v-model.number="stiffness" type="range" min="80" max="800" step="10" />
          </label>

          <label class="slider-row">
            <span class="slider-label">
              <code>{{ t.damping }}</code><b>{{ damping }}</b>
            </span>
            <input v-model.number="damping" type="range" min="5" max="80" step="1" />
          </label>

          <label class="slider-row">
            <span class="slider-label">
              <code>{{ t.rubberBand }}</code><b>{{ rubberBand.toFixed(2) }}</b>
            </span>
            <input v-model.number="rubberBand" type="range" min="0.1" max="1" step="0.01" />
          </label>

          <label class="slider-row">
            <span class="slider-label">
              <code>{{ t.threshold }}</code><b>{{ threshold.toFixed(2) }}</b>
            </span>
            <input v-model.number="threshold" type="range" min="0.1" max="2" step="0.05" />
          </label>

          <div class="playground-actions">
            <button class="btn" type="button" @click="playgroundOpen = true">
              {{ t.playgroundOpen }}
            </button>
            <button class="btn btn-ghost" type="button" @click="resetDefaults">
              {{ t.resetDefaults }}
            </button>
          </div>
        </div>
      </section>

      <section class="section">
        <p class="section-kicker">{{ t.programmaticKicker }}</p>
        <h2>{{ t.programmaticTitle }}</h2>
        <p class="section-desc">{{ t.programmaticDesc }}</p>

        <div class="btn-row">
          <button
            v-for="p in programmaticSnaps"
            :key="p"
            class="btn"
            type="button"
            @click="goToSnap(programmaticSnaps.indexOf(p))"
          >
            {{ t.snapTo.replace('{p}', String(p)) }}
          </button>
          <button class="btn btn-ghost" type="button" @click="closeProgrammatic">
            {{ t.closeIt }}
          </button>
        </div>
      </section>
    </main>

    <footer class="footer">
      <p>{{ t.footerNote }}</p>
    </footer>

    <!-- ============== Sheets ============== -->

    <BottomSheet
      v-model="basicOpen"
      :snap-points="[50, 100]"
      :respect-reduced-motion="false"
      theme-color="#5b4ee5"
    >
      <template #header="{ close }">
        <div class="sheet-header">
          <h2>{{ t.basicHeader }}</h2>
          <button class="icon-btn" type="button" @click="close">✕</button>
        </div>
      </template>
      <div class="sheet-avatar-row">
        <div class="sheet-avatar grad-1">AK</div>
        <div class="sheet-avatar-info">
          <h3>{{ t.basicName }}</h3>
          <p>{{ t.basicRole }}</p>
        </div>
      </div>
      <div class="sheet-stats">
        <div class="sheet-stat"><b>24</b><span>{{ t.basicStatProjects }}</span></div>
        <div class="sheet-stat"><b>1.2k</b><span>{{ t.basicStatFollowers }}</span></div>
        <div class="sheet-stat"><b>4.9</b><span>{{ t.basicStatRating }}</span></div>
      </div>
      <p class="sheet-text">{{ t.basicBio }}</p>
      <p class="sheet-text">{{ t.basicBody }}</p>
    </BottomSheet>

    <BottomSheet v-model="multiOpen" :snap-points="[25, 60, 100]" :respect-reduced-motion="false">
      <template #header="{ close, snapIndex }">
        <div class="sheet-header">
          <h2>{{ t.multiHeader.replace('{n}', String(snapIndex)) }}</h2>
          <button class="icon-btn" type="button" @click="close">✕</button>
        </div>
      </template>
      <template #default="{ }">
        <p class="sheet-text">{{ t.multiBody.replace('{n}', '…') }}</p>
        <ul class="sheet-list">
          <li v-for="track in queueTracks" :key="track.title">
            <span class="sheet-list-thumb" :class="track.grad">{{ track.emoji }}</span>
            <div class="sheet-list-body">
              <h4>{{ track.title }}</h4>
              <p>{{ track.artist }}</p>
            </div>
            <span class="sheet-list-trail">{{ track.duration }}</span>
          </li>
        </ul>
      </template>
    </BottomSheet>

    <BottomSheet
      v-model="nonDismissibleOpen"
      :dismissible="false"
      :snap-points="[45]"
      :respect-reduced-motion="false"
    >
      <template #header>
        <div class="sheet-header">
          <h2>{{ t.nonDismissibleHeader }}</h2>
        </div>
      </template>
      <p class="sheet-text">{{ t.nonDismissibleBody }}</p>
      <template #footer="{ close }">
        <button class="btn btn-block" type="button" @click="close">
          {{ t.nonDismissibleConfirm }}
        </button>
      </template>
    </BottomSheet>

    <BottomSheet
      v-model="themeOpen"
      panel-class="theme-dark"
      :snap-points="[55]"
      :respect-reduced-motion="false"
    >
      <template #header="{ close }">
        <div class="sheet-header">
          <h2>{{ t.themeHeader }}</h2>
          <button class="icon-btn" type="button" @click="close">✕</button>
        </div>
      </template>
      <p class="sheet-text">{{ t.themeBody }}</p>
    </BottomSheet>

    <BottomSheet v-model="fitOpen" :snap-points="['content']" :respect-reduced-motion="false">
      <template #header="{ close }">
        <div class="sheet-header">
          <h2>{{ t.fitHeader }}</h2>
          <button class="icon-btn" type="button" @click="close">✕</button>
        </div>
      </template>
      <p class="sheet-text">{{ t.fitBody }}</p>
      <ul class="fit-list">
        <li v-for="n in fitItems" :key="n">{{ t.fitItem.replace('{n}', String(n)) }}</li>
      </ul>
      <template #footer>
        <div class="fit-actions">
          <button class="btn btn-ghost" type="button" @click="removeFitItem">
            {{ t.fitRemoveItem }}
          </button>
          <button class="btn" type="button" @click="addFitItem">{{ t.fitAddItem }}</button>
        </div>
      </template>
    </BottomSheet>

    <BottomSheet
      v-model="peekOpen"
      :snap-points="[20, 90]"
      :default-snap-point="1"
      :fade-from-index="1"
      :scale-background="peekScaleBg"
      :grabber-only="peekGrabberOnly"
      :respect-reduced-motion="false"
    >
      <template #header="{ close }">
        <div class="sheet-header">
          <h2>{{ t.peekHeader }}</h2>
          <button class="icon-btn" type="button" @click="close">✕</button>
        </div>
      </template>
      <div class="sheet-media"><span class="sheet-media-icon">☕</span></div>
      <h3 class="sheet-place-name">{{ t.peekPlaceName }}</h3>
      <div class="sheet-meta-row">
        <span class="stars">★★★★★</span>
        <span>{{ t.peekRating }}</span>
        <span>· {{ t.peekReviews }}</span>
        <span class="sheet-chip">{{ t.peekOpenStatus }}</span>
      </div>
      <p class="sheet-text">{{ t.peekCategory }}</p>
      <p class="sheet-text">{{ t.peekBody }}</p>
      <template #footer="{ close }">
        <div class="sheet-actions-row">
          <button class="btn btn-ghost" type="button" @click="close">{{ t.peekDirections }}</button>
          <button class="btn" type="button" @click="close">{{ t.peekCall }}</button>
        </div>
      </template>
    </BottomSheet>

    <BottomSheet v-model="inputsOpen" :snap-points="[55, 90]" :respect-reduced-motion="false">
      <template #header="{ close }">
        <div class="sheet-header">
          <h2>{{ t.inputsHeader }}</h2>
          <button class="icon-btn" type="button" @click="close">✕</button>
        </div>
      </template>
      <form class="sheet-form" @submit.prevent="submitInputs">
        <label class="sheet-field">
          <span class="sheet-field-label">{{ t.inputsNameLabel }}</span>
          <input v-model="inputsName" type="text" class="sheet-input" :placeholder="t.inputsNamePlaceholder" />
        </label>
        <label class="sheet-field">
          <span class="sheet-field-label">{{ t.inputsMessageLabel }}</span>
          <textarea
            v-model="inputsMessage"
            class="sheet-textarea"
            rows="5"
            :placeholder="t.inputsMessagePlaceholder"
          />
        </label>
      </form>
      <div class="debug-panel">
        <div>window.innerHeight: {{ debugViewport.innerH }}</div>
        <div>visualViewport.height: {{ debugViewport.vvH }}</div>
        <div>visualViewport.offsetTop: {{ debugViewport.vvOffsetTop }}</div>
        <div>keyboardInset (innerHeight − offsetTop − height): {{ debugViewport.keyboardInset }}</div>
      </div>
      <template #footer>
        <button class="btn btn-block" type="button" @click="submitInputs">{{ t.inputsSubmit }}</button>
      </template>
    </BottomSheet>

    <BottomSheet
      v-model="playgroundOpen"
      :snap-points="[60, 100]"
      :spring-stiffness="stiffness"
      :spring-damping="damping"
      :rubber-band-resistance="rubberBand"
      :close-threshold="threshold"
      :respect-reduced-motion="false"
    >
      <template #header="{ close }">
        <div class="sheet-header">
          <h2>{{ t.playgroundHeader }}</h2>
          <button class="icon-btn" type="button" @click="close">✕</button>
        </div>
      </template>
      <p class="sheet-text">{{ t.playgroundBody }}</p>
      <p class="sheet-text">{{ t.playgroundBody2 }}</p>
    </BottomSheet>

    <BottomSheet
      ref="programmaticSheet"
      v-model="programmaticOpen"
      :snap-points="programmaticSnaps"
      :default-snap-point="programmaticDefaultIndex"
      :respect-reduced-motion="false"
    >
      <template #header="{ close }">
        <div class="sheet-header">
          <h2>{{ t.programmaticHeader }}</h2>
          <button class="icon-btn" type="button" @click="close">✕</button>
        </div>
      </template>
      <p class="sheet-text">{{ t.programmaticBody }}</p>
      <ul class="sheet-list">
        <li v-for="stop in programmaticStops" :key="stop.percent">
          <span class="sheet-list-thumb" :class="stop.grad">{{ stop.icon }}</span>
          <div class="sheet-list-body">
            <h4>{{ stop.percent }}%</h4>
            <p>{{ stop.label }}</p>
          </div>
        </li>
      </ul>
    </BottomSheet>
  </div>
</template>

<style>
:root {
  --bg: #f6f5f1;
  --ink: #18181b;
  --muted: #6b6b74;
  --accent: #5b4ee5;
  --accent-ink: #ffffff;
  --card-bg: #ffffff;
  --border: #e4e2da;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.page {
  position: relative;
  max-width: 1040px;
  margin: 0 auto;
  padding: 72px 24px 48px;
  /* scaleBackground swaps <body>'s background while dragging past
     fadeFromIndex — without its own opaque background, .page's transparent
     gaps (anywhere that isn't a .card) would let that color bleed through
     everywhere, not just around its shrunk, rounded edges. */
  background: var(--bg);
}

.lang-toggle {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10;
  border: 1px solid var(--border);
  background: var(--card-bg);
  color: var(--ink);
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}

.hero {
  text-align: center;
  max-width: 640px;
  margin: 0 auto 64px;
}

.kicker,
.section-kicker {
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
  margin: 0 0 12px;
}

.hero h1 {
  font-size: clamp(32px, 5vw, 44px);
  line-height: 1.15;
  letter-spacing: -0.02em;
  margin: 0 0 16px;
}

.subtitle {
  color: var(--muted);
  font-size: 17px;
  line-height: 1.55;
  margin: 0 0 24px;
}

.install {
  display: inline-block;
  background: var(--ink);
  color: #f6f5f1;
  padding: 10px 18px;
  border-radius: 10px;
  font-size: 14px;
}

.tryit {
  color: var(--muted);
  font-size: 13px;
  margin: 16px 0 0;
}

.section {
  margin: 0 0 72px;
}

.section h2 {
  font-size: 26px;
  letter-spacing: -0.01em;
  margin: 0 0 8px;
}

.section-desc {
  color: var(--muted);
  font-size: 15px;
  max-width: 560px;
  margin: 0 0 28px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-top: 24px;
}

@media (max-width: 680px) {
  .grid {
    grid-template-columns: 1fr;
  }
}

.card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 24px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}

.card h3 {
  margin: 0 0 8px;
  font-size: 17px;
}

.card p {
  color: var(--muted);
  font-size: 14px;
  line-height: 1.5;
  margin: 0 0 18px;
  min-height: 42px;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 10px;
  cursor: pointer;
}
.check-row input {
  accent-color: var(--accent);
}

.btn {
  appearance: none;
  border: none;
  background: var(--ink);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  padding: 11px 18px;
  border-radius: 10px;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.btn:hover {
  opacity: 0.88;
}
.btn:active {
  transform: scale(0.97);
}
.btn-ghost {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--border);
}
.btn-block {
  width: 100%;
}

.btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}

.playground {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 28px;
  display: grid;
  gap: 20px;
}

.slider-row {
  display: grid;
  gap: 8px;
}

.slider-label {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--muted);
}
.slider-label b {
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

input[type='range'] {
  -webkit-appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: var(--border);
  outline: none;
}
input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  border: 3px solid #fff;
  box-shadow: 0 0 0 1px var(--border);
}
input[type='range']::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  border: 3px solid #fff;
  box-shadow: 0 0 0 1px var(--border);
}

.playground-actions {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

.footer {
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  padding-top: 24px;
  border-top: 1px solid var(--border);
}

/* ---- sheet content ---- */
.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px 14px;
}
.sheet-header h2 {
  font-size: 18px;
  margin: 0;
}
.icon-btn {
  appearance: none;
  border: none;
  background: var(--border);
  color: var(--ink);
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.sheet-text {
  color: var(--muted);
  font-size: 15px;
  line-height: 1.6;
  margin: 4px 0 20px;
  padding: 0 20px;
}

/* ---- richer sheet content: media hero, meta row, avatar, stats, list ---- */
.sheet-media {
  height: 168px;
  margin: 0 20px 16px;
  border-radius: 16px;
  background: linear-gradient(135deg, #7c76f5 0%, #5b4ee5 55%, #3d2fcf 100%);
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  padding: 14px;
}
.sheet-media::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 78% 22%, rgba(255, 255, 255, 0.35), transparent 55%);
}
.sheet-media-icon {
  position: relative;
  font-size: 34px;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.25));
}

.sheet-place-name {
  margin: 0 0 6px;
  padding: 0 20px;
  font-size: 19px;
}

.sheet-meta-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 20px;
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--muted);
}
.sheet-meta-row .stars {
  color: #f5a623;
  letter-spacing: 1px;
}
.sheet-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  font-size: 12px;
}

.sheet-actions-row {
  display: flex;
  gap: 12px;
}
.sheet-actions-row .btn {
  flex: 1;
}

.sheet-avatar-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 20px;
  margin: 4px 0 16px;
}
.sheet-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  font-size: 17px;
  background: linear-gradient(135deg, #ff9a5a, #ff5f6d);
}
.sheet-avatar-info h3 {
  margin: 0 0 2px;
  font-size: 16px;
}
.sheet-avatar-info p {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}

.sheet-stats {
  display: flex;
  gap: 10px;
  padding: 0 20px;
  margin: 0 0 4px;
}
.sheet-stat {
  flex: 1;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 8px;
  text-align: center;
}
.sheet-stat b {
  display: block;
  font-size: 16px;
}
.sheet-stat span {
  font-size: 10.5px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sheet-list {
  list-style: none;
  margin: 0;
  padding: 0 20px 4px;
  display: grid;
  gap: 10px;
}
.sheet-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
}
.sheet-list-thumb {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.sheet-list-body {
  flex: 1;
  min-width: 0;
}
.sheet-list-body h4 {
  margin: 0 0 2px;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sheet-list-body p {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sheet-list-trail {
  font-size: 13px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.sheet-form {
  display: grid;
  gap: 16px;
  padding: 0 20px 4px;
}
.sheet-field {
  display: grid;
  gap: 6px;
}
.sheet-field-label {
  font-size: 13px;
  font-weight: 600;
}
.sheet-input,
.sheet-textarea {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--ink);
  border-radius: 10px;
  padding: 10px 12px;
  /* iOS Safari auto-zooms the page on focus for any input/textarea with a
     computed font-size under 16px — this is the threshold, not a rounder
     number. */
  font-size: 16px;
  font-family: inherit;
  outline: none;
}
.sheet-input:focus,
.sheet-textarea:focus {
  border-color: var(--accent);
}
.sheet-textarea {
  resize: vertical;
  min-height: 96px;
}

.debug-panel {
  margin: 12px 20px 0;
  padding: 10px 12px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.7;
  color: var(--muted);
}

.grad-1 {
  background: linear-gradient(135deg, #ff9a5a, #ff5f6d);
}
.grad-2 {
  background: linear-gradient(135deg, #5b4ee5, #7c76f5);
}
.grad-3 {
  background: linear-gradient(135deg, #22c55e, #16a34a);
}
.grad-4 {
  background: linear-gradient(135deg, #06b6d4, #0891b2);
}
.grad-5 {
  background: linear-gradient(135deg, #f59e0b, #d97706);
}
.grad-6 {
  background: linear-gradient(135deg, #ec4899, #db2777);
}

.fit-list {
  list-style: none;
  margin: 0 0 4px;
  padding: 0 20px;
  display: grid;
  gap: 8px;
}
.fit-list li {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 14px;
  color: var(--muted);
}
.fit-actions {
  display: flex;
  gap: 12px;
}
.fit-actions .btn {
  flex: 1;
}

/* Custom theme example — proves theming needs no prop, just CSS on panelClass */
.theme-dark {
  --vbs-bg: #141417;
  --vbs-fg: #f4f4f5;
  --vbs-ring: rgba(255, 255, 255, 0.08);
  --vbs-handle-color: #4b4b57;
  --vbs-border-color: #26262c;
}
.theme-dark .sheet-text {
  color: #a3a3ad;
}
.theme-dark .icon-btn {
  background: #26262c;
  color: #f4f4f5;
}
</style>
