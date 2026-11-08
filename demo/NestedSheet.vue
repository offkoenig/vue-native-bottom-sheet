<script setup lang="ts">
import { computed, ref } from 'vue'
import BottomSheet from '../src/BottomSheet.vue'
import { t } from './i18n'

// One level of the "nested sheets" demo. Each level renders the next one
// inside its own slot, so the chain is unbounded: the child is only mounted
// once it's first asked for, and closes together with its parent.
const props = defineProps<{ depth: number }>()
const open = defineModel<boolean>({ required: true })

const childOpen = ref(false)
const childMounted = ref(false)
function openChild() {
  childMounted.value = true
  childOpen.value = true
}

// Heights cycle so every new level visibly lands on top of the previous one.
const height = computed(() => 85 - ((props.depth - 1) % 4) * 12)
const grad = computed(() => `grad-${((props.depth - 1) % 6) + 1}`)
</script>

<template>
  <BottomSheet v-model="open" :snap-points="[height]" :respect-reduced-motion="false">
    <template #header="{ close }">
      <div class="sheet-header">
        <h2>{{ t.nestedHeader.replace('{n}', String(depth)) }}</h2>
        <button class="icon-btn" type="button" @click="close">✕</button>
      </div>
    </template>
    <div class="sheet-avatar-row">
      <div class="sheet-avatar" :class="grad">{{ depth }}</div>
      <div class="sheet-avatar-info">
        <h3>{{ t.nestedLevel.replace('{n}', String(depth)) }}</h3>
        <p>{{ t.nestedLevelHint }}</p>
      </div>
    </div>
    <p class="sheet-text">{{ t.nestedBody }}</p>
    <template #footer>
      <button class="btn btn-block" type="button" @click="openChild">
        {{ t.nestedOpenNext.replace('{n}', String(depth + 1)) }}
      </button>
    </template>
    <NestedSheet v-if="childMounted" v-model="childOpen" :depth="depth + 1" />
  </BottomSheet>
</template>
