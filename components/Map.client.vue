<script setup lang="ts">
import { storeToRefs } from 'pinia'

import type { LayersList } from '@deck.gl/core/typed'
import MapContainerClient from './MapContainer.client.vue'
import type { City, Line } from '~/types'
import { useAppStore } from '~/store/app.store'
import LineDetailLayer from '~/layers/line-detail.layer'
import type { MapContainer } from '~/.nuxt/components'
import LineLayer from '~/layers/lines.layer'
import StationsLayer from '~/layers/stations.layer'
import { useInteractorStore } from '~/store/interactor.store'

const mapRef = ref<InstanceType<typeof MapContainer> | null>(null)
const selectorsRef = ref<HTMLDivElement>()
const layers = ref<LayersList>()

const appStore = useAppStore()
const interactorStore = useInteractorStore()
const { dataset, selectedCities } = storeToRefs(appStore)
const { focusedLine, hoveringLine } = storeToRefs(interactorStore)
const { setDetailCity } = appStore
const { setFocusedLine, reset: resetInteractors } = interactorStore

watchEffect(async () => {
  const zoom = mapRef.value?.getZoom() || 0

  const selectedLineLayer = focusedLine.value
    ? new LineDetailLayer({
      id: 'hoveringline',
      data: focusedLine.value,
      pickable: true,
      labels: zoom >= 11,
      onClick() {
        setFocusedLine(null)
      },
    })
    : null

  const hoveringLineLayer = hoveringLine.value
    ? new LineDetailLayer({
      id: 'hoveringline',
      data: hoveringLine.value,
      pickable: true,
      onClick() {
        const line = hoveringLine.value
        if (!line)
          return
        setFocusedLine(line)
        zoomToLine(line)
      },
    })
    : null

  const cities = dataset.value.filter(city => selectedCities.value.has(city))

  const lineLayers = cities.map(city => city.lines.map(line => [new LineLayer({
    id: `${city.id}-${line.id}`,
    data: line,
    visible: !focusedLine.value,
  }), new StationsLayer({ id: `${city.id}-${line.id}-stations`, data: line, visible: !focusedLine.value && zoom >= 10 })]))

  requestAnimationFrame(() => {
    layers.value = [lineLayers, selectedLineLayer, hoveringLineLayer]
  })
})

function getBoundsPadding() {
  return {
    top: 25,
    right: 150,
    bottom: 25,
    left: (selectorsRef.value?.clientWidth || 0) + 25,
  }
}

function zoomToCity(city: City) {
  resetInteractors()
  mapRef.value?.fitBounds(city.bound, {
    padding: getBoundsPadding(),
    duration: 800,
  })
}

function zoomToLine(line: Line) {
  mapRef.value?.fitBounds(line.bound, {
    padding: getBoundsPadding(),
  })
}
</script>

<template>
  <MapContainerClient ref="mapRef" :layers="layers" />
  <section ref="selectorsRef" class="fixed left-4 z-[2] inset-y-4 flex items-start">
    <CitySelect
      @on-zoom="zoomToCity"
      @city-select="zoomToCity"
    />

    <div class="ml-3">
      <CityDetail
        @line-select="(line: Line) => {
          zoomToLine(line)
        }"
        @close="() => setDetailCity(null)"
      />
    </div>
  </section>
  <LineDetail
    @station-click="(station) => {
      mapRef?.flyTo({
        center: station.coord,
        essential: true,
        zoom: 15,
      })
    }"
  />
  <Tooltip />
</template>
