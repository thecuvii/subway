<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { X } from 'lucide-vue-next'
import { Motion, Presence } from '@oku-ui/motion'
import { useAppStore } from '~/store/app.store'
import { useInteractorStore } from '~/store/interactor.store'

const emits = defineEmits<{
  (e: 'selectionChange'): void
  (e: 'close',): void
}>()

const store = useAppStore()
const { detailCity } = storeToRefs(store)
const interactorStore = useInteractorStore()
const { selectLine, setHoveringLine, isLineSelected, toggleLineMultiSelect, selectAllLines } = interactorStore
const { lineMultiSelect } = storeToRefs(interactorStore)

function selectAll() {
  if (!detailCity.value?.lines.length)
    return
  selectAllLines(detailCity.value.lines)
  emits('selectionChange')
}
</script>

<template>
  <Presence>
    <Motion
      v-if="detailCity"
      :initial="{ opacity: 0.95, y: -50 }"
      :animate="{ opacity: 1, y: 0 }"
      :exit="{ opacity: 0, y: -50 }"
      class="bg-white text-xs p-2 rounded-lg"
    >
      <h3 class="flex items-center">
        <span>{{ detailCity.name }}</span>
        <X class="ml-auto cursor-pointer hover:scale-110" :size="12" @click="() => emits('close')" />
      </h3>
      <div class="flex gap-1 mt-2">
        <button class="rounded px-2 py-1 hover:bg-zinc-100" :class="lineMultiSelect && 'bg-blue-100 text-blue-600'" :aria-pressed="lineMultiSelect" @click="() => { toggleLineMultiSelect(); emits('selectionChange') }">
          多选
        </button>
        <button class="rounded px-2 py-1 hover:bg-zinc-100" @click="selectAll">
          全选
        </button>
      </div>
      <ul class="text-zinc-600 space-y-1 mt-2">
        <li
          v-for="line in detailCity.lines" :key="line.id" class="relative rounded" :class="isLineSelected(line) && 'bg-blue-50 text-blue-600'" @click="(event) => {
            selectLine(line, event.ctrlKey)
            emits('selectionChange')
          }" @mouseenter="() => setHoveringLine(line)" @mouseleave="() => setHoveringLine(null)"
        >
          <div class="hover:bg-zinc-50 rounded px-2 py-1 flex items-center cursor-pointer">
            <div class="h-1 w-1 rounded-full mr-1" :style="{ background: `rgb(${line.color.slice(0, 3)})` }" />
            {{ line.name }}
          </div>
        </li>
      </ul>
    </Motion>
  </Presence>
</template>
