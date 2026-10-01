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
