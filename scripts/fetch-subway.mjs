import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const sourceBase = 'https://map.amap.com/service/subway'
export const cacheDirectory = path.join(root, '.data-cache', 'amap')

export async function fetchJson(url) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (!response.ok)
        throw new Error(`HTTP ${response.status}`)
      const text = await response.text()
      const data = JSON.parse(text)
      if (!data || typeof data !== 'object')
        throw new Error('Empty source response')
      return { data, text, fetchedAt: new Date().toISOString(), sha256: createHash('sha256').update(text).digest('hex') }
    }
    catch (error) {
      lastError = error
      if (attempt < 2)
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000))
    }
  }
  throw new Error(`Unable to fetch ${url}: ${lastError.message}`)
}

export function cityUrl(city) {
  return `${sourceBase}?srhdata=${encodeURIComponent(`${city.adcode}_drw_${city.spell}.json`)}`
}

export async function fetchSources() {
  await mkdir(cacheDirectory, { recursive: true })
  const catalogUrl = `${sourceBase}?srhdata=citylist.json`
  const catalog = await fetchJson(catalogUrl)
  if (!Array.isArray(catalog.data.citylist) || catalog.data.citylist.length < 41)
    throw new Error('City catalog is incomplete')
  await writeFile(path.join(cacheDirectory, 'citylist.json'), catalog.text)
  const sources = []
  const failures = []
  for (const city of catalog.data.citylist) {
    try {
      const source = await fetchJson(cityUrl(city))
      if (String(source.data.i) !== city.adcode || !Array.isArray(source.data.l))
        throw new Error('City ID or line list is invalid')
      await writeFile(path.join(cacheDirectory, `${city.adcode}.json`), source.text)
      sources.push({ ...city, url: cityUrl(city), fetchedAt: source.fetchedAt, sha256: source.sha256, lines: source.data.l.length })
      console.log(`${city.cityname}: ${source.data.l.length} lines`)
    }
    catch (error) {
      failures.push({ ...city, error: error.message })
      console.error(`${city.cityname}: ${error.message}`)
    }
  }
  const manifest = {
    source: 'AMap Subway website city catalog and diagram data',
    catalog: { url: catalogUrl, fetchedAt: catalog.fetchedAt, sha256: catalog.sha256 },
    note: 'Fetch time is not the source update date. Diagram c/p coordinates are schematic pixels, not geographical coordinates.',
    sources,
    failures,
  }
  await writeFile(path.join(cacheDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  if (failures.length)
    throw new Error(`${failures.length} cities failed; do not apply an incomplete update`)
  return manifest
}

export async function readSources() {
  const manifest = JSON.parse(await readFile(path.join(cacheDirectory, 'manifest.json'), 'utf8'))
  if (manifest.failures.length)
    throw new Error('Cached source download has failures')
  const cities = []
  for (const source of manifest.sources) {
    const text = await readFile(path.join(cacheDirectory, `${source.adcode}.json`), 'utf8')
    if (createHash('sha256').update(text).digest('hex') !== source.sha256)
      throw new Error(`Source cache checksum mismatch: ${source.cityname}`)
    cities.push({ source, data: JSON.parse(text) })
  }
  return { manifest, cities }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchSources().then(manifest => console.log(`Downloaded ${manifest.sources.length} regions; no application data overwritten.`)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
