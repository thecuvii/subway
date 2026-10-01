import { TRANSFER_STATION_ALIAS_GROUPS } from '~/constants/transfer-stations'
import type { Dataset, Line, Station } from '~/types'

type Coordinate = [number, number]
type Segment = [Coordinate, Coordinate]
interface StationEntry { key: string; line: Line; station: Station; alias?: number }

export const TRANSFER_DISTANCE_METERS = 1000
const INTERSECTION_CENTER_DISTANCE_METERS = 250
const PATH_DISTANCE_METERS = 250
const METERS_PER_DEGREE = Math.PI / 180 * 6371000

export function stationDistance(first: Coordinate, second: Coordinate) {
  const radians = Math.PI / 180
  const latitude = Math.sin((second[1] - first[1]) * radians / 2) ** 2
  const longitude = Math.cos(first[1] * radians) * Math.cos(second[1] * radians)
    * Math.sin((second[0] - first[0]) * radians / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, latitude + longitude)))
}

function project(point: Coordinate, origin: Coordinate): Coordinate {
  return [(point[0] - origin[0]) * METERS_PER_DEGREE * Math.cos(origin[1] * Math.PI / 180), (point[1] - origin[1]) * METERS_PER_DEGREE]
}

function unproject(point: Coordinate, origin: Coordinate): Coordinate {
  return [origin[0] + point[0] / (METERS_PER_DEGREE * Math.cos(origin[1] * Math.PI / 180)), origin[1] + point[1] / METERS_PER_DEGREE]
}

function segmentDistance(point: Coordinate, [first, second]: Segment) {
  const dx = second[0] - first[0]
  const dy = second[1] - first[1]
  const lengthSquared = dx * dx + dy * dy
  const ratio = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - first[0]) * dx + (point[1] - first[1]) * dy) / lengthSquared)) : 0
  return Math.hypot(point[0] - first[0] - ratio * dx, point[1] - first[1] - ratio * dy)
}

function cross(first: Coordinate, second: Coordinate) {
  return first[0] * second[1] - first[1] * second[0]
}

function intersect([a, b]: Segment, [c, d]: Segment): Coordinate | null {
  const first: Coordinate = [b[0] - a[0], b[1] - a[1]]
  const second: Coordinate = [d[0] - c[0], d[1] - c[1]]
  const denominator = cross(first, second)
  // Parallel and overlapping tracks do not define a unique station intersection.
  if (Math.abs(denominator) < 1e-8)
    return null
  const offset: Coordinate = [c[0] - a[0], c[1] - a[1]]
  const t = cross(offset, second) / denominator
  const u = cross(offset, first) / denominator
  return (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9)
    ? [a[0] + t * first[0], a[1] + t * first[1]]
    : null
}

function nearbySegments(entry: StationEntry, origin: Coordinate): Segment[] {
  const station = project(entry.station.originalCoord!, origin)
  const path = entry.line.polyline.map(point => project(point, origin))
  let nearest = 0
  let distance = Infinity
  for (let index = 1; index < path.length; index++) {
    const current = segmentDistance(station, [path[index - 1], path[index]])
    if (current < distance) {
      nearest = index
      distance = current
    }
  }
  if (!nearest)
    return []
  // Walk only the contiguous section around this stop, excluding distant loops.
  let start = nearest - 1
  let end = nearest
  while (start > 0 && Math.hypot(...path[start]) < TRANSFER_DISTANCE_METERS)
    start--
  while (end < path.length - 1 && Math.hypot(...path[end]) < TRANSFER_DISTANCE_METERS)
    end++
  return path.slice(start, end).map((point, index) => [point, path[start + index + 1]])
}

function findPosition(entries: StationEntry[]) {
  // Shared POIs and duplicate cross-city records receive only one vote.
  const coordinates = [...new Map(entries.map(entry => [entry.station.originalCoord!.join(','), entry.station.originalCoord!])).values()]
  const center: Coordinate = [coordinates.reduce((sum, point) => sum + point[0], 0) / coordinates.length, coordinates.reduce((sum, point) => sum + point[1], 0) / coordinates.length]
  if (coordinates.length === 1)
    return { coord: center, method: 'center' as const }
  const paths = [...new Map(entries.map(entry => [entry.line.id, nearbySegments(entry, center)])).values()]
  let best: Coordinate | null = null
  let bestScore = Infinity
  for (let first = 0; first < paths.length; first++) {
    for (let second = first + 1; second < paths.length; second++) {
      for (const a of paths[first]) {
        for (const b of paths[second]) {
          const point = intersect(a, b)
          if (!point || Math.hypot(...point) > INTERSECTION_CENTER_DISTANCE_METERS)
            continue
          if (!paths.every(path => path.some(segment => segmentDistance(point, segment) <= PATH_DISTANCE_METERS)))
            continue
          const candidate = unproject(point, center)
          if (coordinates.some(coord => stationDistance(coord, candidate) >= TRANSFER_DISTANCE_METERS))
            continue
          const score = coordinates.reduce((sum, coord) => sum + stationDistance(coord, candidate) ** 2, 0)
          if (score < bestScore) {
            best = candidate
            bestScore = score
          }
        }
      }
    }
  }
  return { coord: best || center, method: best ? 'intersection' as const : 'center' as const }
}

function matches(first: StationEntry, second: StationEntry) {
  return (first.station.name === second.station.name || (first.alias !== undefined && first.alias === second.alias))
    && stationDistance(first.station.originalCoord!, second.station.originalCoord!) < TRANSFER_DISTANCE_METERS
}

/** Normalize display coordinates without changing provider IDs or track geometry. */
export function unifyTransferStations(dataset: Dataset) {
  const entries: StationEntry[] = dataset.flatMap(city => city.lines.flatMap(line => line.stations.map((station, index) => {
    station.originalCoord = [...(station.originalCoord || station.coord)]
    station.coord = [...station.originalCoord]
    delete station.transferGroupId
    delete station.transferPositionMethod
    const alias = TRANSFER_STATION_ALIAS_GROUPS.findIndex(group => group.some(item => item.cityId === city.id && item.name === station.name))
    return { key: `${city.id}:${line.id}:${station.id}:${index}`, line, station, alias: alias < 0 ? undefined : alias }
  }))).sort((first, second) => first.key.localeCompare(second.key))
  const buckets = new Map<string, StationEntry[]>()
  for (const entry of entries) {
    for (const key of [`name:${entry.station.name}`, ...(entry.alias === undefined ? [] : [`alias:${entry.alias}`])]) {
      if (!buckets.has(key))
        buckets.set(key, [])
      buckets.get(key)!.push(entry)
    }
  }
  const assigned = new Set<StationEntry>()
  let groups = 0
  let intersections = 0
  let mergedEntries = 0
  for (const seed of entries) {
    if (assigned.has(seed))
      continue
    const candidates = new Set([...buckets.get(`name:${seed.station.name}`)!, ...(seed.alias === undefined ? [] : buckets.get(`alias:${seed.alias}`)!)])
    const group = [seed]
    for (const candidate of [...candidates].sort((first, second) => first.key.localeCompare(second.key))) {
      if (candidate !== seed && !assigned.has(candidate) && group.every(member => matches(member, candidate)))
        group.push(candidate)
    }
    if (new Set(group.map(entry => entry.line.id)).size < 2) {
      assigned.add(seed)
      continue
    }
    for (const member of group)
      assigned.add(member)
    const { coord, method } = findPosition(group)
    const groupId = `transfer:${seed.key}`
    for (const { station } of group) {
      station.coord = [...coord]
      station.transferGroupId = groupId
      station.transferPositionMethod = method
    }
    groups++
    mergedEntries += group.length
    if (method === 'intersection')
      intersections++
  }
  return { groups, intersections, centers: groups - intersections, mergedEntries }
}
