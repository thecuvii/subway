<script setup lang="ts">
// @ts-expect-error no type provided
import { MapboxMap } from '@studiometa/vue-mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox/typed'
import type { LayersList } from '@deck.gl/core/typed'
import type { Bound, Line } from '~/types'
import { useInteractorStore } from '~/store/interactor.store'

const props = defineProps<{ layers?: LayersList }>()

const config = useRuntimeConfig()
const map = ref()
const mapCenter = ref([113.863048, 22.575149])
const deckgl = ref<MapboxOverlay | null>(null)
const zoom = ref<number>(8)
const { setHoveringLine, setHoveringStation, setHoveringPosition } = useInteractorStore()

// Set bounds to China's geographical boundaries with buffer
const chinaBounds = [
  [65.0, 15.0], // Southwest coordinates (with more buffer on the left)
  [140.0, 56.0], // Northeast coordinates (with buffer)
]

watchEffect(() => {
  deckgl.value?.setProps({ layers: props.layers })
})

function onZoomend() {
  zoom.value = map.value.getZoom()
}

async function onMapCreated(mapInstance: any) {
  deckgl.value = new MapboxOverlay({
    pickingRadius: 4,
    onHover: (info) => {
      const source = info.sourceLayer?.root.props.data as Line
      const isHoveringOnStation = info.object && 'coord' in info.object
      setHoveringLine(source || null)
      if (isHoveringOnStation)
        setHoveringStation(source.stations.find(station => station.id === info.object?.id) || null, source)
      else
        setHoveringStation(null, null)

      setHoveringPosition({ x: info.x, y: info.y })
    },
    onDragStart: () => {
      setHoveringLine(null)
    },
  })
  mapInstance.addControl(deckgl.value)

  map.value = mapInstance
}

function fitBounds(bounds: Bound, config?: { padding?: number | { top?: number; right?: number;bottom?: number;left: number }; duration?: number }) {
  map.value.fitBounds(bounds, config)
}

function flyTo(config: any) {
  map.value.flyTo(config)
}

function getZoom() {
  return zoom.value
}

defineExpose({ fitBounds, flyTo, getZoom })
</script>

<template>
  <MapboxMap
    class="w-screen h-screen" :access-token="config.public['MAP_BOX_TOKEN']"
    :map-style="config.public['MAP_URL']" :center="mapCenter" :zoom="zoom" :max-bounds="chinaBounds" @mb-created="onMapCreated" @mb-zoomend="onZoomend"
  />
</template>
