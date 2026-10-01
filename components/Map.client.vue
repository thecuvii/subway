<script setup lang="ts">
import { storeToRefs } from 'pinia'
import type { LayersList, PickingInfo } from '@deck.gl/core/typed'
import MapContainerClient from './MapContainer.client.vue'
import type { Bound, Line } from '~/types'
import { useAppStore } from '~/store/app.store'
import LineDetailLayer from '~/layers/line-detail.layer'
import LineLayer from '~/layers/lines.layer'
import StationsLayer from '~/layers/stations.layer'
import { useInteractorStore } from '~/store/interactor.store'
import { hasCityLineSelection } from '~/utils/subway'

const mapRef = ref<InstanceType<typeof MapContainerClient> | null>(null)
const selectorsRef = ref<HTMLDivElement>()
const layers = shallowRef<LayersList>()
const appStore = useAppStore()
const interactorStore = useInteractorStore()
const { dataset, selectedCities } = storeToRefs(appStore)
const { focusedLines, hoveringLine } = storeToRefs(interactorStore)
const ctrlPressed = useKeyModifier('Control')
const { setDetailCity } = appStore
const { selectLine } = interactorStore

watchEffect(() => {
  const zoom = mapRef.value?.getZoom() || 0
  const selectFromMap = (line: Line, event: { srcEvent?: Event }) => {
    const additive = (event.srcEvent as MouseEvent | undefined)?.ctrlKey || false
    selectLine(line, additive)
    zoomToLines()
  }
  const selectedLineLayers = focusedLines.value.map(line => new LineDetailLayer({
    id: `selected-${line.id}`,
    data: line,
    pickable: true,
    labels: zoom >= 11,
    onClick(_info: PickingInfo, event: { srcEvent?: Event }) {
      selectFromMap(line, event)
    },
  }))
  const hoveringLineLayer = (hoveringLine.value && !interactorStore.isLineSelected(hoveringLine.value))
    ? new LineDetailLayer({
      id: `hovering-${hoveringLine.value.id}`,
      data: hoveringLine.value,
      pickable: true,
      onClick(_info: PickingInfo, event: { srcEvent?: Event }) {
        const line = hoveringLine.value
        if (line)
          selectFromMap(line, event)
      },
    })
    : null
  const cities = dataset.value.filter(city => selectedCities.value.has(city))
  const lineLayers = cities.map(city => city.lines.map(line => [
    new LineLayer({
      id: line.id,
      data: line,
      visible: (!hasCityLineSelection(focusedLines.value, city.id) || !!ctrlPressed.value) && !interactorStore.isLineSelected(line),
      onClick(_info: PickingInfo, event: { srcEvent?: Event }) {
        selectFromMap(line, event)
      },
    }),
    new StationsLayer({
      id: `${line.id}-stations`,
      data: line,
      visible: (!hasCityLineSelection(focusedLines.value, city.id) || !!ctrlPressed.value) && !interactorStore.isLineSelected(line) && zoom >= 10,
      onClick(_info: PickingInfo, event: { srcEvent?: Event }) {
        selectFromMap(line, event)
      },
    }),
  ]))
  layers.value = [lineLayers, selectedLineLayers, hoveringLineLayer]
})

function getBoundsPadding() {
  return { top: 25, right: 150, bottom: 25, left: (selectorsRef.value?.clientWidth || 0) + 25 }
}

function zoomToBounds(bounds: Bound[]) {
  if (!bounds.length)
    return
  const merged: Bound = [
    [Math.min(...bounds.map(bound => bound[0][0])), Math.min(...bounds.map(bound => bound[0][1]))],
    [Math.max(...bounds.map(bound => bound[1][0])), Math.max(...bounds.map(bound => bound[1][1]))],
  ]
  mapRef.value?.fitBounds(merged, { padding: getBoundsPadding(), duration: 800 })
}

function zoomToCities() {
  zoomToBounds([...selectedCities.value].map(city => city.bound))
}

function zoomToLines() {
  if (focusedLines.value.length)
    zoomToBounds(focusedLines.value.map(line => line.bound))
}
</script>

<template>
  <MapContainerClient ref="mapRef" :layers="layers" />
  <section ref="selectorsRef" class="fixed left-4 z-[2] inset-y-4 flex items-start">
    <CitySelect @selection-change="zoomToCities" />
    <div class="ml-3">
      <CityDetail @selection-change="zoomToLines" @close="() => setDetailCity(null)" />
    </div>
  </section>
  <LineDetail
    @station-click="(station) => {
      mapRef?.flyTo({ center: station.coord, essential: true, zoom: 15 })
    }"
  />
  <Tooltip />
</template>
