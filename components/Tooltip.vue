<script lang="ts" setup>
import { storeToRefs } from 'pinia'
import { useInteractorStore } from '~/store/interactor.store'
import { useAppStore } from '~/store/app.store'
import { getLineLabel, getStationLines } from '~/utils/subway'

const { hoveringPosition, hoveringLine, hoveringStation } = storeToRefs(useInteractorStore())
const { dataset } = storeToRefs(useAppStore())
const hoveringLines = computed(() => {
  if (!hoveringLine.value)
    return []
  return hoveringStation.value
    ? getStationLines(dataset.value, hoveringLine.value, hoveringStation.value)
    : [hoveringLine.value]
})
</script>

<template>
  <div v-if="hoveringLine && hoveringPosition.x >= 0" class="fixed left-0 top-0 will-change-transform z-10 text-xs bg-white/90 p-1 rounded-lg pointer-events-none" :style="{ transform: `translate(${hoveringPosition.x + 10}px, ${hoveringPosition.y + 10}px)` }">
    <div v-if="hoveringStation" class="font-semibold">
      {{ hoveringStation.name }}
    </div>
    <div v-for="line in hoveringLines" :key="line.id">
      {{ getLineLabel(dataset, line) }}
    </div>
  </div>
</template>
