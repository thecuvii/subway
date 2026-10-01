import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { cacheDirectory, readSources, root } from './fetch-subway.mjs'

export function parseStation(station) {
  const coordinates = station.sl?.split(',').map(Number)
  if (!coordinates || coordinates.length !== 2 || coordinates.some(value => !Number.isFinite(value))
    || coordinates[0] < 70 || coordinates[0] > 140 || coordinates[1] < 10 || coordinates[1] > 60)
    throw new Error(`Invalid geographical coordinates: ${station.n} (${station.sl})`)
  if (!station.si || !station.n)
    throw new Error('Station ID or name is missing')
  return { id: String(station.si), name: station.n, lat: coordinates[1], lng: coordinates[0] }
}

export function stationsUnchanged(previous, current) {
  return previous.length === current.length && previous.every((station, index) =>
    station.name === current[index].name
    && Math.abs(station.lat - current[index].lat) < 0.000001
    && Math.abs(station.lng - current[index].lng) < 0.000001,
  )
}

export function convertCity(source, data, previous) {
  const geometry = []
  const ids = new Set()
  const lines = data.l.filter(line => line.su === '1').map((line) => {
    if (!line.ls || !line.ln || !/^[\da-f]{6}$/i.test(line.cl))
      throw new Error(`Invalid line metadata in ${source.cityname}: ${line.ln}`)
    if (ids.has(line.ls))
      throw new Error(`Duplicate line ID in ${source.cityname}: ${line.ls}`)
    ids.add(line.ls)
    const stations = line.st.filter(station => station.su === '1').map(parseStation)
    if (stations.length < 2)
      throw new Error(`Not enough visible stations: ${source.cityname} / ${line.ln}`)
    const oldLine = previous?.lines.find(candidate => candidate.id === line.ls)
    const preserveGeometry = oldLine && stationsUnchanged(oldLine.stations, stations)
      && (oldLine.fullPolyline?.length >= 2 || oldLine.polyline?.length >= 4)
    geometry.push({
      id: String(line.ls),
      name: `${line.ln}${line.la || ''}`,
      status: preserveGeometry ? 'legacy-unverified' : 'missing',
      reason: preserveGeometry ? 'Same ordered station names and coordinates; legacy path retained, not reverified.' : 'New or changed station sequence; geographical path required.',
    })
    return {
      id: String(line.ls),
      name: `${line.ln}${line.la || ''}`,
      color: line.cl,
      stations,
      polyline: preserveGeometry ? oldLine.polyline : [],
      fullPolyline: preserveGeometry ? oldLine.fullPolyline : [],
    }
  })
  if (!lines.length)
    throw new Error(`No visible lines: ${source.cityname}`)
  return {
    city: { id: source.adcode, name: previous?.name || source.cityname.replace(/特别行政区$|市$/g, ''), cityname: source.spell, lines },
    geometry,
  }
}

export async function prepareUpdate() {
  const { manifest, cities: rawCities } = await readSources()
  const previous = JSON.parse(await readFile(path.join(root, 'datasource/data.json'), 'utf8'))
  const order = new Map(previous.map((city, index) => [city.id, index]))
  const prepared = rawCities.map(({ source, data }) => {
    const oldCity = previous.find(city => city.id === source.adcode)
    const converted = convertCity(source, data, oldCity)
    const oldIds = new Set(oldCity?.lines.map(line => line.id) || [])
    const newIds = new Set(converted.city.lines.map(line => line.id))
    return {
      ...converted,
      source,
      changes: {
        id: source.adcode,
        name: converted.city.name,
        isNewCity: !oldCity,
        previousLines: oldCity?.lines.length || 0,
        currentLines: converted.city.lines.length,
        previousStationEntries: oldCity?.lines.reduce((n, line) => n + line.stations.length, 0) || 0,
        currentStationEntries: converted.city.lines.reduce((n, line) => n + line.stations.length, 0),
        addedLines: converted.city.lines.filter(line => !oldIds.has(line.id)).map(line => ({ id: line.id, name: line.name })),
        removedLines: (oldCity?.lines || []).filter(line => !newIds.has(line.id)).map(line => ({ id: line.id, name: line.name })),
        changedLines: converted.city.lines.filter(line => oldIds.has(line.id) && !stationsUnchanged(oldCity.lines.find(old => old.id === line.id).stations, line.stations)).map(line => ({ id: line.id, name: line.name })),
        missingGeometry: converted.geometry.filter(line => line.status === 'missing').length,
      },
    }
  }).sort((first, second) => (order.get(first.city.id) ?? 1000) - (order.get(second.city.id) ?? 1000))
  const candidate = prepared.map(item => item.city)
  const candidateLines = candidate.flatMap(city => city.lines)
  const missingGeometry = prepared.reduce((n, item) => n + item.changes.missingGeometry, 0)
  const report = {
    status: 'staged-not-applied',
    fetchedAt: manifest.catalog.fetchedAt,
    sourceUpdatedAt: null,
    coverage: 'All 58 regions in the fetched AMap catalog, including branches, cross-city repetitions and other rail modes. This is not a verified nationwide census of operating metro systems.',
    coordinateSystem: 'GCJ-02 (as supplied by AMap station sl)',
    previous: { regions: previous.length, lines: previous.reduce((n, city) => n + city.lines.length, 0), stationEntries: previous.flatMap(city => city.lines).reduce((n, line) => n + line.stations.length, 0) },
    candidate: { regions: candidate.length, lines: candidateLines.length, stationEntries: candidateLines.reduce((n, line) => n + line.stations.length, 0), missingGeometry, legacyGeometry: candidateLines.length - missingGeometry },
    warnings: [
      'Do not replace datasource/data.json with this candidate until missing geographical paths are resolved.',
      'Fetch date is not the source update date; source provides no uniform update timestamp.',
      'Schematic c, p and rs fields are pixel coordinates and must never be used as longitude/latitude.',
      'Source-visible entries are not independently verified as currently operating; cable cars, maglev, light rail and suburban lines are included by the source.',
      'Cross-city services and branches produce repeated lines and station records. Some neighboring municipalities are grouped into one system, e.g. New Taipei under Taipei.',
      'Existing application changes in other files are outside this data update.',
    ],
    cities: prepared.map(item => item.changes),
    geometry: prepared.map(item => ({ cityId: item.city.id, lines: item.geometry })),
    sources: manifest,
  }
  await writeFile(path.join(cacheDirectory, 'candidate.json'), `${JSON.stringify(candidate)}\n`)
  const reportDirectory = path.join(root, 'datasource/update-staging')
  await mkdir(reportDirectory, { recursive: true })
  await writeFile(path.join(reportDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  const rows = report.cities.map(city => `| ${city.name}${city.isNewCity ? '（新增）' : ''} | ${city.previousLines} → ${city.currentLines} | ${city.previousStationEntries} → ${city.currentStationEntries} | ${city.missingGeometry} |`).join('\n')
  await writeFile(path.join(reportDirectory, 'README.md'), `# 地铁数据更新暂存报告\n\n状态：仅暂存，尚未替换正式数据。\n\n采集时间：${report.fetchedAt}（UTC）。来源未提供统一的数据更新时间。\n\n来源：[高德地铁图](https://map.amap.com/subway/index.html)实际使用的城市目录与地铁图接口。接口及每份响应的 SHA-256 记录在 report.json 中。\n\n原数据：${report.previous.regions} 个城市、${report.previous.lines} 条线路记录、${report.previous.stationEntries} 条站点记录。\n\n候选数据：${report.candidate.regions} 个地区、${report.candidate.lines} 条线路记录、${report.candidate.stationEntries} 条站点记录。新增 ${report.candidate.regions - report.previous.regions} 个地区。\n\n其中 ${missingGeometry} 条线路缺少可用的地理轨迹，${report.candidate.legacyGeometry} 条保留旧轨迹（未重新核验）。缺失轨迹使用空数组表示，没有使用站点连线冒充真实轨迹。\n\n## 覆盖与局限\n\n这 58 个地区是数据源目录的覆盖范围，并非已核实的全国全部运营地铁城市清单。源中包含轻轨、磁浮、市域线及猫空缆车；跨城线路与支线会重复计数。新北等相邻城市可能归入同一个系统，数据新旧和运营状态还需要核验。\n\n源中 su 不为 1 的站点不纳入候选数据。地铁图的 c、p、rs 是示意图像素，不能用于真实地图；仅使用 sl 的经纬度。\n\n## 城市对比\n\n| 城市/地区 | 线路记录（旧 → 新） | 站点记录（旧 → 新） | 缺失轨迹 |\n|---|---|---|---|\n${rows}\n\n## 复现\n\n在项目根目录执行：\n\n\x60\x60\x60powershell\nnode scripts/fetch-subway.mjs\nnode scripts/prepare-subway-update.mjs\nnode --test tests/data-update.test.mjs\n\x60\x60\x60\n\n原始响应和候选数据保存在被 Git 忽略的 .data-cache/amap/，正式 datasource/data.json 未修改。后续可以用自己的高德 Web 服务 Key，通过官方公交线路 ID 查询获取 polyline，再检查站点顺序、路径方向和边界。全部补齐后应先备份旧数据，再应用更新并验证构建。\n`)
  console.log(JSON.stringify({ status: report.status, previous: report.previous, candidate: report.candidate }, null, 2))
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareUpdate().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
