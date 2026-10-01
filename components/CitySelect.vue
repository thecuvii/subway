<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { Check, List } from 'lucide-vue-next'
import { useAppStore } from '~/store/app.store'

const emits = defineEmits<{ (e: 'selection-change'): void }>()
const store = useAppStore()
const { isCitySelected, selectCity, setDetailCity, toggleCityMultiSelect, selectAllCities } = store
const { dataset, cityMultiSelect } = storeToRefs(store)
</script>

<template>
  <div class="bg-white rounded text-zinc-800 text-xs p-2 pb-2 flex flex-col flex-1 max-h-full">
    <SocialLinks />
    <div class="flex gap-1 mb-2">
      <button
        class="rounded px-2 py-1 hover:bg-zinc-100" :class="cityMultiSelect && 'bg-blue-100 text-blue-600'"
        :aria-pressed="cityMultiSelect" @click="() => { toggleCityMultiSelect(); emits('selection-change') }"
      >
        多选
      </button>
      <button class="rounded px-2 py-1 hover:bg-zinc-100" @click="() => { selectAllCities(); emits('selection-change') }">
        全选
      </button>
    </div>
    <section class="grow overflow-scroll scrollbar-none">
      <ul class="select-none">
        <li
          v-for="city in dataset" :key="city.id"
          class="group text-xs p-1 flex items-center cursor-pointer hover:bg-zinc-100 rounded"
          :class="isCitySelected(city) ? 'bg-blue-50 text-blue-600' : 'text-zinc-400'"
          @click="(event) => { selectCity(city, event.ctrlKey); emits('selection-change') }"
        >
          <span>{{ city.name }}</span>
          <span class="flex ml-auto space-x-1 items-center">
            <List v-if="isCitySelected(city)" class="hover:scale-125" :size="12" @click.stop="setDetailCity(city)" />
            <Check v-if="isCitySelected(city)" :size="12" />
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>
