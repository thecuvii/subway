import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { convertCity, parseStation, stationsUnchanged } from '../scripts/prepare-subway-update.mjs'
import { convertApiLine, parsePolyline, stationPathDistance } from '../scripts/apply-subway-update.mjs'

const station = (si, n, sl, su = '1') => ({ si, n, sl, su })
const source = { adcode: '3306', cityname: '绍兴市', spell: 'shaoxing' }
const rawLine = { ls: 'line-1', ln: '1号线', la: '', cl: 'FF0000', su: '1', c: ['900 800', '700 600'], st: [station('a', '甲', '120.3,30.1'), station('b', '乙', '120.4,30.2')] }

test('uses geographical sl coordinates and excludes hidden stations and lines', () => {
  const data = { l: [{ ...rawLine, st: [...rawLine.st, station('hidden', '未开放', '120.5,30.3', '0')] }, { ...rawLine, ls: 'hidden-line', su: '0' }] }
  const result = convertCity(source, data)
  assert.equal(result.city.lines.length, 1)
  assert.deepEqual(result.city.lines[0].stations, [{ id: 'a', name: '甲', lat: 30.1, lng: 120.3 }, { id: 'b', name: '乙', lat: 30.2, lng: 120.4 }])
  assert.deepEqual(result.city.lines[0].fullPolyline, [])
  assert.deepEqual(result.city.lines[0].polyline, [])
  assert.equal(result.geometry[0].status, 'missing')
})

test('rejects malformed or schematic coordinates instead of silently plotting them', () => {
  for (const coordinate of ['900,800', 'NaN,30', '120,', '', '120,30,40'])
    assert.throws(() => parseStation(station('a', '甲', coordinate)))
})

test('retains legacy geometry only when station sequence and coordinates are unchanged', () => {
  const stations = rawLine.st.map(parseStation)
  const old = { id: '3306', name: '绍兴', lines: [{ id: 'line-1', stations, polyline: [], fullPolyline: [[120.3, 30.1], [120.4, 30.2]] }] }
  assert.equal(convertCity(source, { l: [rawLine] }, old).geometry[0].status, 'legacy-unverified')
  const extension = { ...rawLine, st: [...rawLine.st, station('c', '丙', '120.5,30.3')] }
  const extended = convertCity(source, { l: [extension] }, old)
  assert.equal(extended.geometry[0].status, 'missing')
  assert.deepEqual(extended.city.lines[0].fullPolyline, [])
  assert.equal(stationsUnchanged(stations, [...stations].reverse()), false)
  assert.equal(stationsUnchanged(stations, [{ ...stations[0], lng: 120.31 }, stations[1]]), false)
})

test('rejects duplicate line IDs and invalid source metadata', () => {
  assert.throws(() => convertCity(source, { l: [rawLine, rawLine] }), /Duplicate line ID/)
  assert.throws(() => convertCity(source, { l: [{ ...rawLine, cl: 'invalid' }] }), /Invalid line metadata/)
  assert.throws(() => convertCity(source, { l: [{ ...rawLine, st: [rawLine.st[0]] }] }), /Not enough/)
})

const apiLine = {
  id: 'line-1',
  status: '1',
  type: '地铁',
  polyline: '120.3,30.1;120.35,30.15;120.4,30.2',
  busstops: [{ id: 'api-a', name: '甲', location: '120.3,30.1', sequence: '1' }, { id: 'api-b', name: '乙', location: '120.4,30.2', sequence: '2' }],
}

test('official geometry uses API stops, sorts sequence and corrects reverse paths', () => {
  const result = convertApiLine(rawLine, { ...apiLine, polyline: '120.4,30.2;120.35,30.15;120.3,30.1', busstops: [...apiLine.busstops].reverse() })
  assert.deepEqual(result.line.fullPolyline[0], [120.3, 30.1])
  assert.equal(result.line.stations[0].id, 'api-a')
  assert.equal(result.maximumStationDistance, 0)
  assert.deepEqual(result.line.polyline, [])
})

test('planned, stopped and non-rail services cannot enter the operating rail dataset', () => {
  for (const status of ['0', '2', '3', undefined])
    assert.equal(convertApiLine(rawLine, { ...apiLine, status }).excluded, true)
  assert.equal(convertApiLine(rawLine, { ...apiLine, type: '索道交通' }).excluded, true)
  assert.throws(() => convertApiLine(rawLine, { ...apiLine, id: 'another-line' }), /does not match/)
})

test('rejects empty paths and stations not covered by the returned geometry', () => {
  assert.throws(() => parsePolyline(''), /Invalid geographical/)
  assert.throws(() => parsePolyline('120.3,30.1'), /at least two/)
  assert.throws(() => convertApiLine(rawLine, { ...apiLine, polyline: '121,31;121.1,31.1' }), /away from/)
  assert.throws(() => convertApiLine(rawLine, { ...apiLine, busstops: [] }), /incomplete/)
})

test('station coverage checks the path segments rather than only sampled vertices', () => {
  assert.ok(stationPathDistance({ lng: 120.35, lat: 30.1 }, [[120.3, 30.1], [120.4, 30.1]]) < 0.000001)
  assert.ok(stationPathDistance({ lng: 120.35, lat: 30.11 }, [[120.3, 30.1], [120.4, 30.1]]) > 1000)
})

test('application dataset matches provenance and contains only verified geographical paths', () => {
  const text = readFileSync(new URL('../datasource/data.json', import.meta.url), 'utf8')
  const dataset = JSON.parse(text)
  const metadata = JSON.parse(readFileSync(new URL('../datasource/metadata.json', import.meta.url), 'utf8'))
  assert.equal(createHash('sha256').update(text).digest('hex'), metadata.appliedSha256)
  const lines = dataset.flatMap(city => city.lines)
  assert.equal(dataset.length, metadata.candidate.regions)
  assert.equal(lines.length, metadata.candidate.lines)
  assert.equal(lines.reduce((count, line) => count + line.stations.length, 0), metadata.candidate.stationEntries)
  assert.equal(metadata.evidence.length, lines.length)
  const present = new Set()
  for (const city of dataset) {
    for (const line of city.lines) {
      const identity = `${city.id}:${line.id}`
      assert.equal(present.has(identity), false, `Duplicate line identity: ${identity}`)
      present.add(identity)
      assert.match(line.color, /^[\da-f]{6}$/i)
      assert.ok(line.fullPolyline.length >= 2, identity)
      assert.equal(line.polyline.length, 0, identity)
      for (const point of line.fullPolyline)
        assert.ok(point.length === 2 && point.every(Number.isFinite), identity)
      for (const station of line.stations)
        assert.ok(stationPathDistance(station, line.fullPolyline) <= 250, `${identity}: ${station.name}`)
    }
  }
  for (const evidence of metadata.evidence) {
    assert.equal(evidence.operatingStatus, '1')
    assert.ok(present.has(`${evidence.cityId}:${evidence.id}`))
  }
  for (const omission of metadata.approvedOmissions)
    assert.equal(present.has(omission), false)
})
