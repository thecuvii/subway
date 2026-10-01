interface TransferStationReference {
  cityId: string
  name: string
}

// 每组为一个已确认的换乘站组合，城市 ID 和站名须与 datasource/data.json 一致。
// 新组合追加一组，同一站的多个别名放在同组；匹配时仍须通过距离校验。
export const TRANSFER_STATION_ALIAS_GROUPS: readonly (readonly TransferStationReference[])[] = [
  // Hangzhou East Railway Station: out-of-station interchange.
  [
    { cityId: '3301', name: '火车东站' },
    { cityId: '3301', name: '火车东站(东广场)' },
  ],
  // Futian Checkpoint / Lok Ma Chau: cross-boundary connection.
  [
    { cityId: '4403', name: '福田口岸' },
    { cityId: '8100', name: '落马洲' },
  ],
  // Hong Kong / Central.
  [
    { cityId: '8100', name: '香港' },
    { cityId: '8100', name: '中环' },
  ],
  // East Tsim Sha Tsui / Tsim Sha Tsui.
  [
    { cityId: '8100', name: '尖东' },
    { cityId: '8100', name: '尖沙咀' },
  ],
]
