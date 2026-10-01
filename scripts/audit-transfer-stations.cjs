const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const ts = require('typescript')
const gcoord = require('gcoord')

const root = path.resolve(__dirname, '..')
function load(file, dependencies = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(output, { exports, require: name => dependencies[name] || require(name) })
  return exports
}

function pathPosition(point, points) {
  const scaleY = Math.PI / 180 * 6371000
  const scaleX = scaleY * Math.cos(point[1] * Math.PI / 180)
  let distance = Infinity
  let alongMeters = 0
  let length = 0
  for (let index = 1; index < points.length; index++) {
    const ax = (points[index - 1][0] - point[0]) * scaleX
    const ay = (points[index - 1][1] - point[1]) * scaleY
    const dx = (points[index][0] - points[index - 1][0]) * scaleX
    const dy = (points[index][1] - points[index - 1][1]) * scaleY
    const segmentLength = Math.hypot(dx, dy)
    const fraction = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (segmentLength ** 2 || 1)))
    const current = Math.hypot(ax + fraction * dx, ay + fraction * dy)
    if (current < distance) {
      distance = current
      alongMeters = length + fraction * segmentLength
    }
    length += segmentLength
  }
  return { distance, alongMeters }
}

const aliases = load('constants/transfer-stations.ts')
const { unifyTransferStations, stationDistance } = load('utils/transfer-stations.ts', { '~/constants/transfer-stations': aliases })
const dataText = fs.readFileSync(path.join(root, 'datasource/data.json'), 'utf8')
const dataset = JSON.parse(dataText).map(city => ({
  id: city.id,
  name: city.name,
  lines: city.lines.map(line => ({
    id: line.id,
    name: line.name,
    cityId: city.id,
    polyline: line.fullPolyline.map(point => gcoord.transform(point, gcoord.GCJ02, gcoord.WGS84)),
    stations: line.stations.map(station => ({ id: station.id, name: station.name, coord: gcoord.transform([station.lng, station.lat], gcoord.GCJ02, gcoord.WGS84) })),
  })),
}))
const normalization = unifyTransferStations(dataset)
const groups = new Map()
for (const city of dataset) {
  for (const line of city.lines) {
    for (const station of line.stations) {
      if (!station.transferGroupId)
        continue
      const sourcePosition = pathPosition(station.originalCoord, line.polyline)
      const mergedPosition = pathPosition(station.coord, line.polyline)
      const group = groups.get(station.transferGroupId) || {
        id: station.transferGroupId,
        method: station.transferPositionMethod,
        coord: station.coord,
        members: [],
      }
      group.members.push({
        city: city.name,
        cityId: city.id,
        line: line.name,
        lineId: line.id,
        name: station.name,
        stationId: station.id,
        originalCoord: station.originalCoord,
        movementMeters: stationDistance(station.originalCoord, station.coord),
        originalPathDistanceMeters: sourcePosition.distance,
        mergedPathDistanceMeters: mergedPosition.distance,
        alongPathMovementMeters: Math.abs(mergedPosition.alongMeters - sourcePosition.alongMeters),
      })
      groups.set(group.id, group)
    }
  }
}
const results = [...groups.values()].map((group) => {
  let diameter = 0
  for (const first of group.members) {
    for (const second of group.members)
      diameter = Math.max(diameter, stationDistance(first.originalCoord, second.originalCoord))
  }
  const maxMovement = Math.max(...group.members.map(member => member.movementMeters))
  const maxPathDistance = Math.max(...group.members.map(member => member.mergedPathDistanceMeters))
  return {
    ...group,
    diameterMeters: diameter,
    maxMovementMeters: maxMovement,
    maxPathDistanceMeters: maxPathDistance,
    maxAlongPathMovementMeters: Math.max(...group.members.map(member => member.alongPathMovementMeters)),
    flags: [...(maxMovement > 250 ? ['movement-over-250m'] : []), ...(maxPathDistance > 100 ? ['off-path-over-100m'] : []), ...((group.method === 'intersection' && diameter < 50 && maxMovement > 100) ? ['intersection-moves-already-close-stops'] : [])],
  }
}).sort((first, second) => second.maxMovementMeters - first.maxMovementMeters)
const thresholds = [50, 100, 250, 500, 750, 1000]
const report = {
  auditedAt: new Date().toISOString(),
  dataSha256: crypto.createHash('sha256').update(dataText).digest('hex'),
  algorithmSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'utils/transfer-stations.ts'))).digest('hex'),
  coordinateSystem: 'WGS84',
  normalization,
  summary: {
    movementCounts: Object.fromEntries(thresholds.map(threshold => [`over${threshold}Meters`, results.filter(group => group.maxMovementMeters > threshold).length])),
    pathDistanceCounts: Object.fromEntries(thresholds.map(threshold => [`over${threshold}Meters`, results.filter(group => group.maxPathDistanceMeters > threshold).length])),
    maxMovementMeters: results[0].maxMovementMeters,
    maxPathDistanceMeters: Math.max(...results.map(group => group.maxPathDistanceMeters)),
    closeStopsMovedByIntersection: results.filter(group => group.flags.includes('intersection-moves-already-close-stops')).length,
  },
  groups: results,
}
fs.writeFileSync(path.join(root, 'datasource/update-staging/transfer-audit.json'), `${JSON.stringify(report, null, 2)}\n`)
const compact = group => ({ names: [...new Set(group.members.map(member => `${member.city} ${member.name}`))], method: group.method, movement: Math.round(group.maxMovementMeters), offPath: Math.round(group.maxPathDistanceMeters), diameter: Math.round(group.diameterMeters), members: group.members.map(member => ({ line: member.line, movement: Math.round(member.movementMeters), offPath: Math.round(member.mergedPathDistanceMeters) })) })
process.stdout.write(`${JSON.stringify({ summary: report.summary, largestMovement: results.slice(0, 12).map(compact), largestPathDistance: [...results].sort((a, b) => b.maxPathDistanceMeters - a.maxPathDistanceMeters).slice(0, 8).map(compact), closeStopIntersections: results.filter(group => group.flags.includes('intersection-moves-already-close-stops')).slice(0, 8).map(compact) }, null, 2)}\n`)
