import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { cacheDirectory, readSources, root } from './fetch-subway.mjs'
import { assertGeometryFreshness, geometryDirectory, geometryEndpoint } from './fetch-subway-geometry.mjs'
import { parseStation } from './subway-conversion.mjs'

const nonRailTypes = new Set(['普通公交', '无轨电车', '旅游专线', '机场大巴', '社区专车', '轮渡', '索道交通'])
const sha256 = text => createHash('sha256').update(text).digest('hex')

export function parsePolyline(value) {
  if (typeof value !== 'string')
    throw new Error('Geographical polyline is missing')
  const points = value.split(';').map((pair) => {
    const station = parseStation({ si: 'path', n: 'path', sl: pair })
    return [station.lng, station.lat]
  })
  if (points.length < 2)
    throw new Error('Geographical polyline needs at least two points')
  return points
}

export function stationPathDistance(station, points) {
  const meters = Math.PI / 180 * 6371000
  const scaleX = meters * Math.cos(station.lat * Math.PI / 180)
  let nearest = Infinity
  for (let index = 1; index < points.length; index++) {
    const ax = (points[index - 1][0] - station.lng) * scaleX
    const ay = (points[index - 1][1] - station.lat) * meters
    const bx = (points[index][0] - station.lng) * scaleX
    const by = (points[index][1] - station.lat) * meters
    const dx = bx - ax
    const dy = by - ay
    const fraction = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)))
    nearest = Math.min(nearest, Math.hypot(ax + fraction * dx, ay + fraction * dy))
  }
  return nearest
}

export function convertApiLine(diagram, apiLine) {
  if (String(apiLine.id) !== String(diagram.ls))
    throw new Error('API line ID does not match catalog line ID')
  if (String(apiLine.status) !== '1')
    return { excluded: true, reason: `Source operating status is ${apiLine.status ?? 'unknown'}`, type: apiLine.type }
  if (nonRailTypes.has(apiLine.type))
    return { excluded: true, reason: `Non-rail service: ${apiLine.type}`, type: apiLine.type }
  if (!Array.isArray(apiLine.busstops) || apiLine.busstops.length < 2)
    throw new Error('API station list is incomplete')
  const orderedStops = [...apiLine.busstops].sort((first, second) => Number(first.sequence) - Number(second.sequence))
  const stations = orderedStops.map(stop => parseStation({ si: stop.id, n: stop.name, sl: stop.location }))
  const points = parsePolyline(apiLine.polyline)
  const first = stations[0]
  const last = stations[stations.length - 1]
  const endpointDistance = (station, point) => stationPathDistance(station, [point, point])
  const forward = endpointDistance(first, points[0]) + endpointDistance(last, points[points.length - 1])
  const reverse = endpointDistance(first, points[points.length - 1]) + endpointDistance(last, points[0])
  if (reverse < forward)
    points.reverse()
  const maximumStationDistance = Math.max(...stations.map(station => stationPathDistance(station, points)))
  if (maximumStationDistance > 250)
    throw new Error(`Station is ${maximumStationDistance.toFixed(0)}m away from the returned path`)
  if (Math.min(forward, reverse) > 1000)
    throw new Error('Path endpoints do not cover the station sequence')
  return {
    line: { id: String(diagram.ls), name: `${diagram.ln}${diagram.la || ''}`, color: diagram.cl, stations, polyline: [], fullPolyline: points },
    type: apiLine.type,
    operatingStatus: String(apiLine.status),
    maximumStationDistance: Math.round(maximumStationDistance * 100) / 100,
    diagramStationCount: diagram.st.filter(station => station.su === '1').length,
  }
}

export async function stageVerifiedUpdate() {
  const { manifest, cities: rawCities } = await readSources()
  const originalText = await readFile(path.join(root, 'datasource/data.json'), 'utf8')
  const original = JSON.parse(originalText)
  const originalOrder = new Map(original.map((city, index) => [city.id, index]))
  const cities = []
  const evidence = []
  const unresolved = []
  const excluded = []
  for (const { source, data } of rawCities) {
    const previous = original.find(city => city.id === source.adcode)
    const city = { id: source.adcode, name: previous?.name || source.cityname.replace(/特别行政区$|市$/g, ''), cityname: source.spell, lines: [] }
    for (const diagram of data.l.filter(line => line.su === '1')) {
      try {
        const cached = JSON.parse(await readFile(path.join(geometryDirectory, `${diagram.ls}.json`), 'utf8'))
        assertGeometryFreshness(cached, manifest.catalog.fetchedAt)
        if (cached.sha256 && cached.sha256 !== sha256(JSON.stringify(cached.data)))
          throw new Error('Geometry cache checksum mismatch')
        if (cached.data.status !== '1')
          throw new Error('API query was not successful')
        const apiLine = cached.data.buslines.find(line => String(line.id) === String(diagram.ls))
        if (!apiLine)
          throw new Error('No matching line returned by official API')
        const converted = convertApiLine(diagram, apiLine)
        if (converted.excluded) {
          excluded.push({ cityId: city.id, city: city.name, id: diagram.ls, name: diagram.ln, ...converted })
          continue
        }
        city.lines.push(converted.line)
        evidence.push({ cityId: city.id, id: diagram.ls, type: converted.type, operatingStatus: converted.operatingStatus, fetchedAt: cached.fetchedAt, endpoint: geometryEndpoint, sha256: sha256(JSON.stringify(cached.data)), maximumStationDistanceMeters: converted.maximumStationDistance, diagramStationCount: converted.diagramStationCount, apiStationCount: converted.line.stations.length })
      }
      catch (error) {
        unresolved.push({ cityId: city.id, city: city.name, id: diagram.ls, name: diagram.ln, error: error.code === 'ENOENT' ? 'Geometry response not downloaded' : error.message })
      }
    }
    if (city.lines.length)
      cities.push(city)
  }
  cities.sort((first, second) => (originalOrder.get(first.id) ?? 1000) - (originalOrder.get(second.id) ?? 1000))
  const lines = cities.flatMap(city => city.lines)
  const report = {
    status: unresolved.length ? 'incomplete-not-applied' : 'verified-staged',
    originalSha256: sha256(originalText),
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: null,
    catalog: manifest,
    coordinateSystem: 'GCJ-02',
    scope: 'Operating rail services returned by the AMap subway catalog and official line-ID API; branches and cross-city repetitions retained; non-rail and non-operating entries excluded. Nationwide completeness is not independently guaranteed.',
    previous: { regions: original.length, lines: original.flatMap(city => city.lines).length, stationEntries: original.flatMap(city => city.lines).reduce((n, line) => n + line.stations.length, 0) },
    candidate: { regions: cities.length, lines: lines.length, stationEntries: lines.reduce((n, line) => n + line.stations.length, 0), uniqueStationIds: new Set(lines.flatMap(line => line.stations.map(station => station.id))).size, pathPoints: lines.reduce((n, line) => n + line.fullPolyline.length, 0) },
    excluded,
    unresolved,
    evidence,
    cities: cities.map((city) => {
      const old = original.find(previous => previous.id === city.id)
      return { id: city.id, name: city.name, newCity: !old, oldLines: old?.lines.length || 0, lines: city.lines.length, oldStationEntries: old?.lines.reduce((n, line) => n + line.stations.length, 0) || 0, stationEntries: city.lines.reduce((n, line) => n + line.stations.length, 0) }
    }),
  }
  await writeFile(path.join(cacheDirectory, 'verified-candidate.json'), `${JSON.stringify(cities, null, 2)}\n`)
  await writeFile(path.join(cacheDirectory, 'geometry-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ status: report.status, previous: report.previous, candidate: report.candidate, excluded: excluded.length, unresolved: unresolved.length }, null, 2))
  return { report, cities, originalText }
}

export async function applyVerifiedUpdate(allowedOmissions = new Set()) {
  const { report, cities, originalText } = await stageVerifiedUpdate()
  const unapproved = report.unresolved.filter(line => !allowedOmissions.has(`${line.cityId}:${line.id}`))
  if (unapproved.length)
    throw new Error(`Refusing to overwrite application data: ${unapproved.length} unresolved lines without an explicit --omit-line=cityId:lineId; see .data-cache/amap/geometry-report.json`)
  if (cities.length < report.previous.regions || report.candidate.lines < report.previous.lines)
    throw new Error('Updated coverage unexpectedly shrank; manual review is required')
  const currentText = await readFile(path.join(root, 'datasource/data.json'), 'utf8')
  if (sha256(currentText) !== report.originalSha256)
    throw new Error('Application data changed while staging; retry before applying')
  const backupDirectory = path.join(cacheDirectory, 'backups')
  await mkdir(backupDirectory, { recursive: true })
  await writeFile(path.join(backupDirectory, `${report.originalSha256}.json`), originalText, { flag: 'wx' }).catch((error) => {
    if (error.code !== 'EEXIST')
      throw error
  })
  const newText = `${JSON.stringify(cities, null, 2)}\n`
  const temporary = path.join(root, 'datasource/data.json.tmp')
  await writeFile(temporary, newText)
  await rename(temporary, path.join(root, 'datasource/data.json'))
  report.status = report.unresolved.length ? 'applied-with-documented-gaps' : 'applied'
  report.approvedOmissions = report.unresolved.map(line => `${line.cityId}:${line.id}`)
  report.appliedAt = new Date().toISOString()
  report.appliedSha256 = sha256(newText)
  await writeFile(path.join(root, 'datasource/metadata.json'), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(path.join(cacheDirectory, 'geometry-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Applied update; old data backed up as .data-cache/amap/backups/${report.originalSha256}.json`)
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const omissions = new Set(process.argv.filter(argument => argument.startsWith('--omit-line=')).map(argument => argument.slice('--omit-line='.length)))
  const action = process.argv.includes('--apply') ? () => applyVerifiedUpdate(omissions) : stageVerifiedUpdate
  action().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
