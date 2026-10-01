import { acceptHMRUpdate, defineStore } from 'pinia'
import type { Line, Station } from '~/types'

export const useInteractorStore = defineStore('interactor', () => {
  const focusedLines = ref<Line[]>([])
  const lineMultiSelect = ref(false)
  const hoveringLine = ref<Line | null>(null)
  const hoveringStation = ref<Station | null>(null)
  const hoveringPosition = ref({ x: -1, y: -1 })

  const isLineSelected = (line: Line) => focusedLines.value.some(item => item.id === line.id)

  function clearHover() {
    hoveringLine.value = null
    hoveringStation.value = null
  }

  function selectLine(line: Line, additive = false) {
    if (isLineSelected(line))
      focusedLines.value = focusedLines.value.filter(item => item.id !== line.id)
    else if (lineMultiSelect.value || additive)
      focusedLines.value = [...focusedLines.value, line]
    else
      focusedLines.value = [line]

    clearHover()
  }

  function toggleLineMultiSelect() {
    lineMultiSelect.value = !lineMultiSelect.value
    if (!lineMultiSelect.value)
      focusedLines.value = focusedLines.value.slice(-1)
  }

  function selectAllLines(lines: Line[]) {
    lineMultiSelect.value = true
    const allSelected = areAllLinesSelected(lines)
    const cityIds = new Set(lines.map(line => line.cityId))
    focusedLines.value = [...focusedLines.value.filter(line => !cityIds.has(line.cityId)), ...(allSelected ? [] : lines)]
    clearHover()
  }

  function areAllLinesSelected(lines: Line[]) {
    return lines.length > 0 && lines.every(isLineSelected)
  }

  function retainCities(cityIds: Set<string>) {
    focusedLines.value = focusedLines.value.filter(line => cityIds.has(line.cityId))
    clearHover()
  }

  function setHoveringLine(line: Line | null) {
    hoveringLine.value = line
  }

  function setHoveringStation(station: Station | null, line: Line | null) {
    hoveringStation.value = station
    if (station && line)
      setHoveringLine(line)
  }

  function setHoveringPosition(position: { x: number; y: number }) {
    hoveringPosition.value = position
  }

  function reset() {
    focusedLines.value = []
    clearHover()
    hoveringPosition.value = { x: -1, y: -1 }
  }

  return {
    focusedLines,
    lineMultiSelect,
    hoveringLine,
    hoveringStation,
    hoveringPosition,
    isLineSelected,
    selectLine,
    toggleLineMultiSelect,
    selectAllLines,
    areAllLinesSelected,
    retainCities,
    setHoveringLine,
    setHoveringStation,
    setHoveringPosition,
    reset,
  }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useInteractorStore, import.meta.hot))
