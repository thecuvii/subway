import { geoDistance } from 'd3-geo'
import hexRgb from 'hex-rgb'
import first from 'lodash-es/first'
import rawData from '~/datasource/data.json'
import type { Bound, Dataset, Line, Station } from '~/types'
import { unifyTransferStations } from '~/utils/transfer-stations'

export function useDataset() {
  const dataset: Dataset = rawData.map((city) => {
    const lines = city.lines.map((line) => {
      const stations = line.stations.map(station => ({ id: station.id, name: station.name, coord: transformGCJ02([station.lng, station.lat]) }))
      const polyline = (line.fullPolyline.length ? line.fullPolyline.map(p => transformGCJ02(p as [number, number])) : extractPolyline(line.polyline)) as [number, number][]
      return {
        id: line.id,
        cityId: city.id,
        name: line.name,
        bound: getLineBounds(stations),
        // FIXME alpha通道数值不对劲
        color: hexRgb(line.color, { format: 'array', alpha: 10 }),
        stations,
        polyline,
      }
    })

    return {
      id: city.id,
      name: city.name,
      bound: getCityBound(lines),
      lines,
    }
  })
  unifyTransferStations(dataset)
  for (const city of dataset) {
    for (const line of city.lines) {
      line.bound = getLineBounds(line.stations)
      line.polyline = partialPolyline(line.polyline, 3)
    }
    city.bound = getCityBound(city.lines)
  }
  return ref<Dataset>(dataset)
}

function getLineBounds(stations: Station[]) {
  const firstStation = first(stations)
  let maxLat = firstStation?.coord[1] || 0
  let minLat = maxLat
  let maxLng = firstStation?.coord[0] || 0
  let minLng = maxLng

  stations.forEach((station) => {
    const lng = station.coord[0]
    const lat = station.coord[1]
    if (lng > maxLng)
      maxLng = lng
    if (lng < minLng)
      minLng = lng
    if (lat > maxLat)
      maxLat = lat
    if (lat < minLat)
      minLat = lat
  })

  return [[minLng, minLat], [maxLng, maxLat]] as Bound
}

function getCityBound(lines: Line[]) {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity

  for (const line of lines) {
    for (const [lng, lat] of line.bound) {
      if (lng < minLng)
        minLng = lng
      if (lng > maxLng)
        maxLng = lng
      if (lat < minLat)
        minLat = lat
      if (lat > maxLat)
        maxLat = lat
    }
  }

  return [[minLng, minLat], [maxLng, maxLat]] as Bound
}

function partialPolyline(polyline: [number, number][], step: number) {
  const newPolyline = [polyline[0]]

  polyline.slice(1, polyline.length - 1).forEach((p, idx) => {
    idx % step === 0 && newPolyline.push(p)
  })

  return [...newPolyline, polyline[polyline.length - 1]]
}

/**
 * 起点/终点为换乘站的时候，polyline可能没有衔接到地铁站，手动修复一下
 */
function correctPolyline(polyline: [number, number][], stations: Station[]): [number, number][] {
  if (stations.length === 0 || polyline.length === 0)
    return polyline

  const firstStationCoord = stations[0].coord
  const lastStationCoord = stations[stations.length - 1].coord
  const polylineStart = polyline[0]
  const polylineEnd = polyline[polyline.length - 1]

  if (!firstStationCoord || !lastStationCoord || !polylineStart || !polylineEnd)
    return polyline

  const distancePolylineStartFirstStation = getDistance(polyline[0], firstStationCoord)
  const distancePolylineEndLastStation = getDistance(polyline[polyline.length - 1], lastStationCoord)

  const distancePolylineStartLastStation = getDistance(polyline[0], lastStationCoord)
  const distancePolylineEndFirstStation = getDistance(polyline[polyline.length - 1], firstStationCoord)

  if (distancePolylineStartFirstStation + distancePolylineEndLastStation < distancePolylineStartLastStation + distancePolylineEndFirstStation) {
    // polyline 和 stations 的方向一致
    polyline[0] = firstStationCoord
    polyline[polyline.length - 1] = lastStationCoord
  }
  else {
    // polyline 和 stations 的方向不一致
    polyline.reverse()
    polyline[0] = firstStationCoord
    polyline[polyline.length - 1] = lastStationCoord
  }

  return polyline
}

function correctStations(polyline: [number, number][], stations: Station[]): Station[] {
  if (stations.length === 0 || polyline.length === 0)
    return stations

  const firstStationCoord = stations[0].coord
  const lastStationCoord = stations[stations.length - 1].coord
  const polylineStart = polyline[0]
  const polylineEnd = polyline[polyline.length - 1]

  if (!firstStationCoord || !lastStationCoord || !polylineStart || !polylineEnd)
    return stations

  const distancePolylineStartFirstStation = getDistance(polyline[0], firstStationCoord)
  const distancePolylineEndLastStation = getDistance(polyline[polyline.length - 1], lastStationCoord)

  const distancePolylineStartLastStation = getDistance(polyline[0], lastStationCoord)
  const distancePolylineEndFirstStation = getDistance(polyline[polyline.length - 1], firstStationCoord)

  const correctedStations = [...stations]

  if (distancePolylineStartFirstStation + distancePolylineEndLastStation < distancePolylineStartLastStation + distancePolylineEndFirstStation) {
    // polyline 和 stations 的方向一致
    correctedStations[0].coord = polylineStart
    correctedStations[correctedStations.length - 1].coord = polylineEnd
  }
  else {
    // polyline 和 stations 的方向不一致
    correctedStations.reverse()
    correctedStations[0].coord = polylineEnd
    correctedStations[correctedStations.length - 1].coord = polylineStart
  }

  return correctedStations
}

function getDistance(coord1: [number, number], coord2: [number, number]): number {
  const distanceInRadians = geoDistance(coord1, coord2)
  const distanceInKilometers = distanceInRadians * 6371 // 地球半径大约是 6371 千米
  return distanceInKilometers
}
