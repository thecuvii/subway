const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const gcoord = require('gcoord')

function load(file, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(output, { exports, require: name => dependencies[name] || require(name) })
  return exports
}

const { unifyTransferStations, stationDistance, trackAngleDegrees, getStationTrackDirection } = load('utils/transfer-stations.ts')
const coord = (x, y = 0) => [120 + x / 100000, 30 + y / 100000]
const line = (id, point, polyline, name = '换乘站') => ({ id, cityId: 'city', stations: [{ id: `station-${id}`, name, coord: point }], polyline })
const dataset = lines => [{ id: 'city', lines }]
const plain = value => JSON.parse(JSON.stringify(value))

test('nearby crossing aligns all members while preserving original positions, IDs and paths', () => {
  const first = line('a', coord(-100), [coord(-500), coord(500)])
  const second = line('b', coord(0, 100), [coord(0, -500), coord(0, 500)])
  const original = structuredClone([first, second])
  assert.equal(unifyTransferStations(dataset([first, second])).intersections, 1)
  for (const item of [first, second]) {
    assert.ok(stationDistance(item.stations[0].coord, coord(0)) < 0.01)
    assert.equal(item.stations[0].transferPositionMethod, 'intersection')
  }
  assert.deepEqual(plain(first.stations[0].originalCoord), original[0].stations[0].coord)
  assert.equal(first.stations[0].id, original[0].stations[0].id)
  assert.deepEqual(first.polyline, original[0].polyline)
})

test('parallel paths use a midpoint and ignore distant intersections', () => {
  const first = line('a', coord(0), [coord(-1000), coord(1000)])
  const second = line('b', coord(0, 100), [coord(-1000, 100), coord(1000, 100), coord(1000, -100)])
  const report = unifyTransferStations(dataset([first, second]))
  assert.equal(report.intersections, 0)
  assert.ok(stationDistance(first.stations[0].coord, coord(0, 50)) < 0.01)
  assert.deepEqual(plain(first.stations[0].coord), plain(second.stations[0].coord))
})

test('multiple nearby crossings choose the one closest to the station group', () => {
  const first = line('a', coord(0), [coord(-1000), coord(1000)])
  const second = line('b', coord(0, 20), [coord(0, -100), coord(0, 100), coord(100, 100), coord(100, -100)])
  unifyTransferStations(dataset([first, second]))
  assert.ok(stationDistance(first.stations[0].coord, coord(0)) < 0.01)
})

test('three-way groups reject crossings far from a participating path', () => {
  const lines = [
    line('a', coord(-100), [coord(-500), coord(500)]),
    line('b', coord(0, 100), [coord(0, -500), coord(0, 500)]),
    line('c', coord(0, 300), [coord(-500, 300), coord(500, 300)]),
  ]
  const report = unifyTransferStations(dataset(lines))
  assert.equal(report.centers, 1)
  assert.ok(stationDistance(lines[0].stations[0].coord, coord(-100 / 3, 400 / 3)) < 0.01)
})

test('same names beyond 1 km and different names stay separate', () => {
  const lines = [line('a', coord(0), []), line('b', coord(1100), []), line('c', coord(0), [], '其他站')]
  assert.equal(unifyTransferStations(dataset(lines)).groups, 0)
  assert.ok(lines.every(item => !item.stations[0].transferGroupId))
})

test('the 1 km limit accepts 999 meters and rejects 1001 meters', () => {
  const atMeters = meters => [120, 30 + meters / (Math.PI / 180 * 6371000)]
  for (const [meters, expected] of [[999, 1], [1001, 0]]) {
    const data = dataset([line('a', atMeters(0), []), line('b', atMeters(meters), [])])
    assert.equal(unifyTransferStations(data).groups, expected)
  }
})

test('the same line repeated in two regions does not create a transfer group', () => {
  const first = line('a', coord(0), [])
  const second = line('a', coord(100), [])
  assert.equal(unifyTransferStations([{ id: 'first', lines: [first] }, { id: 'second', lines: [second] }]).groups, 0)
})

test('distance chains cannot merge members more than 1 km apart and order is stable', () => {
  const makeLines = () => [line('a', coord(0), []), line('b', coord(800), []), line('c', coord(1600), [])]
  const first = makeLines()
  const second = makeLines().reverse()
  unifyTransferStations(dataset(first))
  unifyTransferStations(dataset(second))
  assert.equal(first[0].stations[0].transferGroupId, first[1].stations[0].transferGroupId)
  assert.equal(first[2].stations[0].transferGroupId, undefined)
  assert.deepEqual(plain(first.map(x => x.stations[0].coord)), plain(second.reverse().map(x => x.stations[0].coord)))
})

test('different-name transfer aliases retain their own positions', () => {
  const first = line('a', coord(0), [], '福田口岸')
  const second = line('b', coord(200), [], '落马洲')
  const data = [{ id: '4403', lines: [first] }, { id: '8100', lines: [second] }]
  assert.equal(unifyTransferStations(data).groups, 0)
  assert.ok(stationDistance(first.stations[0].coord, coord(0)) < 0.01)
  assert.ok(stationDistance(second.stations[0].coord, coord(200)) < 0.01)
})

test('vertical, reversed and repeated-point paths yield stable undirected angles', () => {
  const points = [coord(0, -200), coord(0), coord(0), coord(0, 200)]
  const direction = getStationTrackDirection(coord(0), points)
  const reverse = getStationTrackDirection(coord(0), [...points].reverse())
  assert.ok(trackAngleDegrees(direction, reverse) < 0.0001)
  assert.equal(trackAngleDegrees(direction, [100, 0]), 90)
  assert.equal(getStationTrackDirection(coord(0), [coord(0), coord(0)]), null)
})

test('parallel station approaches ignore intersections after the track bends', () => {
  const first = line('a', coord(0), [coord(0, -500), coord(0, 500)])
  const second = line('b', coord(50), [coord(50, -500), coord(50, 100), coord(-50, 300)])
  assert.equal(unifyTransferStations(dataset([first, second])).intersections, 0)
  assert.ok(stationDistance(first.stations[0].coord, coord(25)) < 0.01)
})

test('nearly parallel local directions ignore a nearby shallow crossing', () => {
  const slope = Math.tan(10 * Math.PI / 180)
  const first = line('a', coord(0), [coord(-500), coord(500)])
  const second = line('b', coord(0, 20), [coord(-500, 20 - 500 * slope), coord(500, 20 + 500 * slope)])
  assert.equal(unifyTransferStations(dataset([first, second])).intersections, 0)
  assert.ok(stationDistance(first.stations[0].coord, coord(0, 10)) < 0.01)
})

test('acute intersections farther than the station cluster fall back to its center', () => {
  const slope = Math.tan(30 * Math.PI / 180)
  const first = line('a', coord(0), [coord(-500), coord(500)])
  const second = line('b', coord(0, 50), [coord(-500, 50 - 500 * slope), coord(500, 50 + 500 * slope)])
  assert.equal(unifyTransferStations(dataset([first, second])).intersections, 0)
  assert.ok(stationDistance(first.stations[0].coord, coord(0, 25)) < 0.01)
})

test('tight bends and reversals do not supply an artificial station direction', () => {
  assert.equal(getStationTrackDirection(coord(0), [coord(-100), coord(0), coord(-100, 20)]), null)
  assert.equal(getStationTrackDirection(coord(0), [coord(-100), coord(0), coord(0, 100)]), null)
})

test('endpoint directions and short paths use the available geometry', () => {
  const direction = getStationTrackDirection(coord(0), [coord(0), coord(0, 20)])
  assert.equal(trackAngleDegrees(direction, [100, 0]), 90)
  assert.equal(getStationTrackDirection(coord(0), [coord(0)]), null)
})

test('a three-line group can use a crossing even if two member tracks are parallel', () => {
  const lines = [
    line('a', coord(-40), [coord(-300), coord(300)]),
    line('b', coord(40), [coord(-300), coord(300)]),
    line('c', coord(0, 40), [coord(0, -300), coord(0, 300)]),
  ]
  assert.equal(unifyTransferStations(dataset(lines)).intersections, 1)
  assert.ok(lines.every(line => stationDistance(line.stations[0].coord, coord(0)) < 0.01))
})

test('duplicate coordinates do not give branches extra weight in the center', () => {
  const lines = [line('a', coord(0), []), line('b', coord(0), []), line('c', coord(200), [])]
  unifyTransferStations(dataset(lines))
  assert.ok(stationDistance(lines[0].stations[0].coord, coord(100)) < 0.01)
})

test('normalizing twice retains source positions and yields the same display coordinates', () => {
  const data = dataset([line('a', coord(0), []), line('b', coord(100), [])])
  unifyTransferStations(data)
  const first = JSON.stringify(data)
  unifyTransferStations(data)
  assert.equal(JSON.stringify(data), first)
})

test('full dataset groups satisfy pairwise distance and produce consistent finite display coordinates', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../datasource/data.json'), 'utf8'))
  const data = raw.map(city => ({
    id: city.id,
    lines: city.lines.map(item => ({
      id: item.id,
      cityId: city.id,
      polyline: item.fullPolyline.map(point => gcoord.transform(point, gcoord.GCJ02, gcoord.WGS84)),
      stations: item.stations.map(station => ({ id: station.id, name: station.name, coord: gcoord.transform([station.lng, station.lat], gcoord.GCJ02, gcoord.WGS84) })),
    })),
  }))
  const report = unifyTransferStations(data)
  assert.ok(report.groups > 500)
  assert.ok(report.intersections > 0)
  const groups = new Map()
  for (const city of data) {
    for (const item of city.lines) {
      for (const station of item.stations) {
        assert.ok(station.coord.every(Number.isFinite))
        assert.ok(stationDistance(station.coord, station.originalCoord) < 1000)
        if (!station.transferGroupId)
          continue
        const group = groups.get(station.transferGroupId) || []
        for (const member of group) {
          assert.equal(station.name, member.name)
          assert.ok(stationDistance(station.originalCoord, member.originalCoord) < 1000)
          assert.deepEqual(plain(station.coord), plain(member.coord))
        }
        group.push(station)
        groups.set(station.transferGroupId, group)
      }
    }
  }
  process.stdout.write(`Transfer display normalization: ${JSON.stringify(report)}\n`)
  for (const [cityId, name, limit] of [['3100', '蓝村路', 30], ['1100', '清河站', 20], ['7101', '淡江大学', 20]]) {
    const stations = data.find(city => city.id === cityId).lines.flatMap(line => line.stations.filter(station => station.name === name))
    assert.ok(stations.length >= 2)
    assert.ok(stations.every(station => station.transferPositionMethod === 'center' && stationDistance(station.coord, station.originalCoord) < limit))
  }
  const east = data.find(city => city.id === '3301').lines.flatMap(line => line.stations)
  const station = east.find(station => station.name === '火车东站')
  const square = east.find(station => station.name === '火车东站(东广场)')
  assert.notEqual(station.transferGroupId, square.transferGroupId)
  assert.ok(stationDistance(station.coord, square.coord) > 300)
})
