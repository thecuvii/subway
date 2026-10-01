import type { Dataset, Line, Station } from '~/types'

type Coordinate = [number, number]
type Segment = [Coordinate, Coordinate]
interface StationEntry { key: string; line: Line; station: Station }
interface NearbyPath { segments: Segment[]; direction: Coordinate | null }

export const TRANSFER_DISTANCE_METERS = 1000
const INTERSECTION_CENTER_DISTANCE_METERS = 250
const PATH_DISTANCE_METERS = 250
const METERS_PER_DEGREE = Math.PI / 180 * 6371000
export const PARALLEL_TRACK_ANGLE_DEGREES = 20
const DIRECTION_SAMPLE_METERS = 50

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

function localDirection(path: Coordinate[], station: Coordinate): Coordinate | null {
  const lengths = [0]
  let nearestDistance = Infinity
  let nearestAlong = 0
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1]
    const b = path[index]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const length = Math.hypot(dx, dy)
    lengths.push(lengths[index - 1] + length)
    if (!length)
      continue
    const ratio = Math.max(0, Math.min(1, ((station[0] - a[0]) * dx + (station[1] - a[1]) * dy) / length ** 2))
    const distance = Math.hypot(station[0] - a[0] - ratio * dx, station[1] - a[1] - ratio * dy)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestAlong = lengths[index - 1] + ratio * length
    }
  }
  if (path.length < 2 || lengths[lengths.length - 1] < 1)
    return null
  const pointAt = (along: number): Coordinate => {
    const index = lengths.findIndex((length, index) => index > 0 && length >= along && length > lengths[index - 1])
    const ratio = (along - lengths[index - 1]) / (lengths[index] - lengths[index - 1])
    return [path[index - 1][0] + ratio * (path[index][0] - path[index - 1][0]), path[index - 1][1] + ratio * (path[index][1] - path[index - 1][1])]
  }
  const before = pointAt(Math.max(0, nearestAlong - DIRECTION_SAMPLE_METERS))
  const after = pointAt(Math.min(lengths[lengths.length - 1], nearestAlong + DIRECTION_SAMPLE_METERS))
  const closest = pointAt(nearestAlong)
  const incoming: Coordinate = [closest[0] - before[0], closest[1] - before[1]]
  const outgoing: Coordinate = [after[0] - closest[0], after[1] - closest[1]]
  const incomingLength = Math.hypot(...incoming)
  const outgoingLength = Math.hypot(...outgoing)
  // A sharp bend or reversal has no reliable single station approach direction.
  if (incomingLength >= 10 && outgoingLength >= 10
    && (incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) / (incomingLength * outgoingLength) < 0.5)
    return null
  const direction: Coordinate = [after[0] - before[0], after[1] - before[1]]
  return Math.hypot(...direction) >= 1 ? direction : null
}

export function getStationTrackDirection(station: Coordinate, polyline: Coordinate[]) {
  return localDirection(polyline.map(point => project(point, station)), [0, 0])
}

/** Undirected angle: reversed paths describe the same track alignment. */
export function trackAngleDegrees(first: Coordinate | null, second: Coordinate | null) {
  if (!first || !second)
    return null
  const length = Math.hypot(...first) * Math.hypot(...second)
  if (!length)
    return null
  return Math.acos(Math.min(1, Math.abs(first[0] * second[0] + first[1] * second[1]) / length)) * 180 / Math.PI
}

function nearbySegments(entry: StationEntry, origin: Coordinate): NearbyPath {
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
    return { segments: [], direction: null }
  // Walk only the contiguous section around this stop, excluding distant loops.
  let start = nearest - 1
  let end = nearest
  while (start > 0 && Math.hypot(...path[start]) < TRANSFER_DISTANCE_METERS)
    start--
  while (end < path.length - 1 && Math.hypot(...path[end]) < TRANSFER_DISTANCE_METERS)
    end++
  return { segments: path.slice(start, end).map((point, index) => [point, path[start + index + 1]]), direction: localDirection(path, station) }
}

function findPosition(entries: StationEntry[]) {
  // Shared POIs and duplicate cross-city records receive only one vote.
  const coordinates = [...new Map(entries.map(entry => [entry.station.originalCoord!.join(','), entry.station.originalCoord!])).values()]
  const center: Coordinate = [coordinates.reduce((sum, point) => sum + point[0], 0) / coordinates.length, coordinates.reduce((sum, point) => sum + point[1], 0) / coordinates.length]
  if (coordinates.length === 1)
    return { coord: center, method: 'center' as const }
  const diameter = Math.max(...coordinates.flatMap(first => coordinates.map(second => stationDistance(first, second))))
  // Even a steep crossing can be unrelated to a tightly clustered station group.
  const intersectionRadius = Math.min(INTERSECTION_CENTER_DISTANCE_METERS, Math.max(25, diameter / 2))
  const paths = [...new Map(entries.map(entry => [entry.line.id, nearbySegments(entry, center)])).values()]
  let best: Coordinate | null = null
  let bestScore = Infinity
  for (let first = 0; first < paths.length; first++) {
    for (let second = first + 1; second < paths.length; second++) {
      const stationAngle = trackAngleDegrees(paths[first].direction, paths[second].direction)
      if (stationAngle === null || stationAngle <= PARALLEL_TRACK_ANGLE_DEGREES)
        continue
      for (const a of paths[first].segments) {
        for (const b of paths[second].segments) {
          const crossingAngle = trackAngleDegrees([a[1][0] - a[0][0], a[1][1] - a[0][1]], [b[1][0] - b[0][0], b[1][1] - b[0][1]])
          if (crossingAngle === null || crossingAngle <= PARALLEL_TRACK_ANGLE_DEGREES)
            continue
          const point = intersect(a, b)
          if (!point || Math.hypot(...point) > intersectionRadius + 0.01)
            continue
          if (!paths.every(path => path.segments.some(segment => segmentDistance(point, segment) <= PATH_DISTANCE_METERS)))
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
  return first.station.name === second.station.name
    && stationDistance(first.station.originalCoord!, second.station.originalCoord!) < TRANSFER_DISTANCE_METERS
}

/** Normalize display coordinates without changing provider IDs or track geometry. */
export function unifyTransferStations(dataset: Dataset) {
  const entries: StationEntry[] = dataset.flatMap(city => city.lines.flatMap(line => line.stations.map((station, index) => {
    station.originalCoord = [...(station.originalCoord || station.coord)]
    station.coord = [...station.originalCoord]
    delete station.transferGroupId
    delete station.transferPositionMethod
    return { key: `${city.id}:${line.id}:${station.id}:${index}`, line, station }
  }))).sort((first, second) => first.key.localeCompare(second.key))
  const buckets = new Map<string, StationEntry[]>()
  for (const entry of entries) {
    const key = entry.station.name
    if (!buckets.has(key))
      buckets.set(key, [])
    buckets.get(key)!.push(entry)
  }
  const assigned = new Set<StationEntry>()
  let groups = 0
  let intersections = 0
  let mergedEntries = 0
  for (const seed of entries) {
    if (assigned.has(seed))
      continue
    const candidates = buckets.get(seed.station.name)!
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
