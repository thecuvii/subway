import type { Dataset, Line, Station } from '~/types'

export function getLineLabel(dataset: Dataset, line: Line) {
  const city = dataset.find(city => city.id === line.cityId)
  return city ? `${city.name} · ${line.name}` : line.name
}

export function getStationLines(dataset: Dataset, line: Line, station: Station) {
  const city = dataset.find(city => city.id === line.cityId)
  return city?.lines.filter(candidate => candidate.stations.some(item => item.id === station.id || item.name === station.name)) || [line]
}

export function hasCityLineSelection(lines: Line[], cityId: string) {
  return lines.some(line => line.cityId === cityId)
}
