import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { fetchSources, root } from './fetch-subway.mjs'
import { fetchGeometry } from './fetch-subway-geometry.mjs'
import { applyVerifiedUpdate, stageVerifiedUpdate } from './apply-subway-update.mjs'

const commands = new Set(['fetch', 'geometry', 'verify', 'apply', 'audit'])
const help = `Usage: pnpm data:update <command> [options]
  fetch       Download catalog and official geometry (requires AMAP_WEB_SERVICE_KEY)
  geometry    Resume geometry download using the cached catalog
  verify      Validate and stage cached data without overwriting application data
  apply       Back up and apply verified data
  audit       Check all transfer station movements
  --omit-line=cityId:lineId  Explicitly accept a missing line (apply only)
Reports and backups: .data-cache/amap/`

export function parseUpdateArgs(args) {
  if (!args.length || (args.length === 1 && ['--help', '-h'].includes(args[0])))
    return { command: 'help', omissions: new Set() }
  const [command, ...options] = args
  if (!commands.has(command))
    throw new Error(`Unknown command: ${command}`)
  const omissions = new Set()
  for (const option of options) {
    if (command !== 'apply' || !/^--omit-line=\d+:\d+$/.test(option))
      throw new Error(`Invalid option for ${command}: ${option}`)
    omissions.add(option.slice('--omit-line='.length))
  }
  return { command, omissions }
}

async function main(args) {
  const { command, omissions } = parseUpdateArgs(args)
  switch (command) {
    case 'help':
      console.log(help)
      break
    case 'fetch':
      await fetchSources()
      await fetchGeometry()
      break
    case 'geometry':
      await fetchGeometry()
      break
    case 'verify': {
      const { report } = await stageVerifiedUpdate()
      if (report.unresolved.length)
        process.exitCode = 1
      break
    }
    case 'apply':
      await applyVerifiedUpdate(omissions)
      break
    case 'audit': {
      const result = spawnSync(process.execPath, [path.join(root, 'scripts/audit-transfer-stations.cjs')], { stdio: 'inherit' })
      if (result.error)
        throw result.error
      process.exitCode = result.status ?? 1
      break
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
