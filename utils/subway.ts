import type { Dataset, Line, Station } from '~/types'
import { TRANSFER_STATION_ALIAS_GROUPS } from '~/constants/transfer-stations'

export const TRANSFER_DISTANCE_METERS = 1000

function getStationDistanceMeters(first: Station, second: Station) {
  const radians = Math.PI / 180
  const latitudeDifference = (second.coord[1] - first.coord[1]) * radians
  const longitudeDifference = (second.coord[0] - first.coord[0]) * radians
  const haversine = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(first.coord[1] * radians) * Math.cos(second.coord[1] * radians) * Math.sin(longitudeDifference / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, haversine)))
}

export function getLineLabel(dataset: Dataset, line: Line) {
  const city = dataset.find(city => city.id === line.cityId)
  return city ? `${city.name} · ${line.name}` : line.name
}

export function getStationLines(dataset: Dataset, line: Line, station: Station) {
  const aliasGroup = TRANSFER_STATION_ALIAS_GROUPS.find(group =>
    group.some(alias => alias.cityId === line.cityId && alias.name === station.name),
  )
  const lines = dataset.flatMap(city => city.lines.filter(candidate => candidate.stations.some(item =>
    (item.name === station.name || aliasGroup?.some(alias => alias.cityId === candidate.cityId && alias.name === item.name))
    && getStationDistanceMeters(item, station) < TRANSFER_DISTANCE_METERS,
  )))
  const uniqueLines = [...new Map(lines.map(candidate => [`${candidate.cityId}:${candidate.name}`, candidate])).values()]
  return uniqueLines.length ? uniqueLines : [line]
}

export function hasCityLineSelection(lines: Line[], cityId: string) {
  return lines.some(line => line.cityId === cityId)
}
