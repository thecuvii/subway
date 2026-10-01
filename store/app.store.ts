import { acceptHMRUpdate, defineStore } from 'pinia'
import { useInteractorStore } from './interactor.store'
import type { City } from '~/types'

export const useAppStore = defineStore('app', () => {
  const dataset = useDataset()
  const defaultCity = dataset.value.find(city => city.id === '4401')
  const selectedCities = ref<Set<City>>(new Set(defaultCity ? [defaultCity] : []))
  const cityMultiSelect = ref(false)
  const detailCity = ref<City | null>(null)

  const isCitySelected = (city: City) => selectedCities.value.has(city)

  function syncSelection() {
    useInteractorStore().retainCities(new Set([...selectedCities.value].map(city => city.id)))
    if (detailCity.value && !isCitySelected(detailCity.value))
      detailCity.value = null
  }

  function selectCity(city: City, additive = false) {
    if (cityMultiSelect.value || additive) {
      if (isCitySelected(city))
        selectedCities.value.delete(city)
      else
        selectedCities.value.add(city)
    }
    else {
      selectedCities.value = new Set([city])
      useInteractorStore().reset()
    }
    syncSelection()
  }

  function toggleCityMultiSelect() {
    cityMultiSelect.value = !cityMultiSelect.value
    if (!cityMultiSelect.value)
      selectedCities.value = new Set([...selectedCities.value].slice(-1))
    syncSelection()
  }

  function selectAllCities() {
    cityMultiSelect.value = true
    selectedCities.value = new Set(dataset.value)
    syncSelection()
  }

  const setDetailCity = (city: City | null) => detailCity.value = city

  return {
    dataset,
    selectedCities,
    detailCity,
    cityMultiSelect,
    isCitySelected,
    selectCity,
    toggleCityMultiSelect,
    selectAllCities,
    setDetailCity,
  }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useAppStore, import.meta.hot))
