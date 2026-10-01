import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import dotenv from 'dotenv'
import { cacheDirectory, readSources, root } from './fetch-subway.mjs'

export const geometryDirectory = path.join(cacheDirectory, 'geometry')
export const geometryEndpoint = 'https://restapi.amap.com/v3/bus/lineid'

export async function loadKey() {
  let local = {}
  try {
    local = dotenv.parse(await readFile(path.join(root, '.env.local')))
  }
  catch (error) {
    if (error.code !== 'ENOENT')
      throw error
  }
  const key = process.env.AMAP_WEB_SERVICE_KEY || local.AMAP_WEB_SERVICE_KEY
  if (!key)
    throw new Error('Configure AMAP_WEB_SERVICE_KEY in .env.local')
  return key
}

export async function requestLine(id, key) {
  const url = new URL(geometryEndpoint)
  url.search = new URLSearchParams({ key, id, extensions: 'all', output: 'JSON' })
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (!response.ok)
        throw new Error(`HTTP ${response.status}`)
      const text = await response.text()
      if (text.includes(key))
        throw new Error('Response unexpectedly contains credentials; refusing to cache it')
      const data = JSON.parse(text)
      if (data.status !== '1') {
        const error = new Error(`AMap rejected line query: ${data.info} (${data.infocode})`)
        // Quota, authentication and permission errors stop the batch, without repeated requests.
        error.stopBatch = true
        throw error
      }
      if (!Array.isArray(data.buslines))
        throw new Error('Invalid buslines response')
      return { fetchedAt: new Date().toISOString(), endpoint: geometryEndpoint, id, sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'), data }
    }
    catch (error) {
      if (error.stopBatch)
        throw error
      // Avoid logging fetch exceptions: they may include the request URL and API key.
      lastError = error instanceof SyntaxError ? 'Invalid JSON response' : 'Network or response validation failure'
      if (attempt < 2)
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000))
    }
  }
  throw new Error(`Line ${id}: ${lastError}`)
}

export async function fetchGeometry() {
  const key = await loadKey()
  const { manifest: sourceManifest, cities } = await readSources()
  const ids = [...new Set(cities.flatMap(({ data }) => data.l.filter(line => line.su === '1').map(line => String(line.ls))))]
  await mkdir(geometryDirectory, { recursive: true })
  const manifest = { startedAt: new Date().toISOString(), endpoint: geometryEndpoint, totalUniqueLines: ids.length, completed: [], failures: [], requestsThisRun: 0 }
  try {
    for (const id of ids) {
      const cacheFile = path.join(geometryDirectory, `${id}.json`)
      let cached
      try {
        cached = JSON.parse(await readFile(cacheFile, 'utf8'))
        if (cached.data?.status !== '1' || !Array.isArray(cached.data.buslines)
          || new Date(cached.fetchedAt) < new Date(sourceManifest.catalog.fetchedAt))
          cached = null
      }
      catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError))
          throw error
      }
      if (!cached) {
        await new Promise(resolve => setTimeout(resolve, 450))
        manifest.requestsThisRun++
        try {
          cached = await requestLine(id, key)
          await writeFile(cacheFile, `${JSON.stringify(cached)}\n`)
        }
        catch (error) {
          manifest.failures.push({ id, error: error.message })
          if (error.stopBatch)
            throw error
          continue
        }
      }
      manifest.completed.push({ id, fetchedAt: cached.fetchedAt, count: cached.data.buslines.length })
      if (manifest.completed.length % 10 === 0)
        console.log(`Geometry: ${manifest.completed.length}/${ids.length}; new requests: ${manifest.requestsThisRun}`)
    }
  }
  finally {
    manifest.finishedAt = new Date().toISOString()
    await writeFile(path.join(geometryDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  }
  if (manifest.failures.length)
    throw new Error(`${manifest.failures.length} queries failed; results saved for resuming`)
  console.log(`Saved ${manifest.completed.length} unique line responses, ${manifest.requestsThisRun} new requests.`)
  return manifest
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchGeometry().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
