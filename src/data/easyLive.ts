import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { bbtipsLeagueCatalogByPlatform } from './bbtipsCatalog'
import { marketOptions } from './staticData'
import { getStreamUrl } from '../lib/videoStreams'
import type { LeagueDefinition, Market, MatchRecord, Platform } from '../types'

type EasyProvider = 'BETANO' | 'BET365' | 'PLAYPIX'

interface EasyLeagueConfig extends LeagueDefinition {
  provider: EasyProvider
  sub: string
  subAliases?: string[]
  champParam: string
}

interface EasyRawMatch {
  subId?: string
  date?: string
  status?: string
  teamA?: string
  teamB?: string
  scoreboardFT?: { home?: number; away?: number }
  scoreboardHT?: { home?: number; away?: number }
  odds?: Record<string, number | string | null | undefined>
}

interface LiveDataState {
  records: MatchRecord[]
  loading: boolean
  error: string | null
  updatedAt: number | null
}

const socketUrl = 'wss://api.easycoanalytics.com.br'
const maxRecordsPerLeague = 2500
const virtualHourOffset = 0
const liveFlushDelayMs = 250
const realOddsStorageKey = 'tigger-easy-live-real-odds-v1'

const repairMisencodedText = (value: string) => {
  if (!/[ÃƒÃ‚ÃŠÃ”Ã•]/.test(value)) return value

  try {
    const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0))
    const decoded = new TextDecoder('utf-8').decode(bytes)
    return decoded.includes('\uFFFD') ? value : decoded
  } catch {
    return value
  }
}

const normalizeText = (value: string) =>
  repairMisencodedText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const availablePlatforms: Platform[] = ['Betano', 'Bet365', 'Express 365', 'PlayPix']

const easyLeaguesByPlatform: Record<Platform, EasyLeagueConfig[]> = bbtipsLeagueCatalogByPlatform

const flattenedLeagueCatalog = availablePlatforms.flatMap((platform) => easyLeaguesByPlatform[platform])

const getLeagueSubscribeSubs = (league: EasyLeagueConfig) =>
  [...new Set([league.sub, ...(league.subAliases ?? [])].filter(Boolean))]

const buildRecordId = (platform: Platform, leagueName: string, raw: EasyRawMatch) => {
  const rawId = String(raw.subId ?? '').trim()

  if (rawId) {
    return normalizeText(rawId)
  }

  return normalizeText(`${platform}-${leagueName}-${raw.date ?? Date.now()}`)
}

const parseOdd = (value?: number | string | null) => {
  const parsedValue = typeof value === 'string'
    ? Number(value.replace(',', '.'))
    : value

  if (typeof parsedValue !== 'number' || !Number.isFinite(parsedValue) || parsedValue < 0) {
    return null
  }

  return Number(parsedValue.toFixed(2))
}

const hasPositiveOdd = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const compactRealOdds = (odds: Record<Market, number | null>) =>
  marketOptions.reduce(
    (acc, market) => {
      const value = odds[market]
      if (hasPositiveOdd(value)) {
        acc[market] = value
      }
      return acc
    },
    {} as Partial<Record<Market, number>>,
  )

const loadStoredRealOdds = () => {
  if (typeof window === 'undefined') {
    return {} as Record<string, Partial<Record<Market, number>>>
  }

  try {
    const raw = window.localStorage.getItem(realOddsStorageKey)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as Record<string, Partial<Record<Market, number>>>
    return Object.entries(parsed).reduce(
      (acc, [recordId, odds]) => {
        const compactOdds = Object.entries(odds ?? {}).reduce(
          (oddsAcc, [market, value]) => {
            if (hasPositiveOdd(typeof value === 'number' ? value : null)) {
              oddsAcc[market as Market] = value
            }
            return oddsAcc
          },
          {} as Partial<Record<Market, number>>,
        )

        if (Object.keys(compactOdds).length > 0) {
          acc[recordId] = compactOdds
        }

        return acc
      },
      {} as Record<string, Partial<Record<Market, number>>>,
    )
  } catch {
    return {}
  }
}

const persistStoredRealOdds = (cache: Record<string, Partial<Record<Market, number>>>) => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(realOddsStorageKey, JSON.stringify(cache))
  } catch {
    // Ignore storage quota/write issues and keep the in-memory cache alive.
  }
}

const normalizeOddKey = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '')

const readRawOdd = (
  rawOdds: EasyRawMatch['odds'],
  aliases: string[],
) => {
  if (!rawOdds) return null

  for (const alias of aliases) {
    const directValue = rawOdds[alias]
    const parsedDirect = parseOdd(directValue)
    if (parsedDirect !== null) return parsedDirect
  }

  const normalizedAliases = new Set(aliases.map(normalizeOddKey))
  const matchedEntry = Object.entries(rawOdds).find(([key]) => normalizedAliases.has(normalizeOddKey(key)))

  return parseOdd(matchedEntry?.[1])
}

const getVirtualHour = (date: Date) => (date.getUTCHours() + virtualHourOffset) % 24

const mergeRealOddsIntoRecord = (
  record: MatchRecord,
  previousRecord?: MatchRecord,
  storedOdds?: Partial<Record<Market, number>>,
) => {
  const nextOdds = { ...record.odds }
  let changed = false

  marketOptions.forEach((market) => {
    if (hasPositiveOdd(nextOdds[market])) {
      return
    }

    const previousOdd = previousRecord?.odds[market]
    if (hasPositiveOdd(previousOdd)) {
      nextOdds[market] = previousOdd
      changed = true
      return
    }

    const storedOdd = storedOdds?.[market]
    if (hasPositiveOdd(storedOdd)) {
      nextOdds[market] = storedOdd
      changed = true
    }
  })

  if (!changed) {
    return record
  }

  return {
    ...record,
    odds: nextOdds,
  }
}

const buildTags = (
  homeGoals: number,
  awayGoals: number,
  marketOdds: Record<Market, number | null>,
): string[] => {
  const totalGoals = homeGoals + awayGoals
  const tags = ['dado real']

  if (homeGoals > 0 && awayGoals > 0) tags.push('btts quente')
  if (totalGoals >= 4) tags.push('placar esticado')
  if (totalGoals <= 1) tags.push('linha baixa')
  if (marketOdds['Over 2.5'] && marketOdds['Over 2.5'] >= 2) tags.push('odd acima de 2.00')
  if (homeGoals === awayGoals) tags.push('empate cravado')

  return tags
}

const buildTendency = (homeGoals: number, awayGoals: number) => {
  const totalGoals = homeGoals + awayGoals
  if (homeGoals > 0 && awayGoals > 0 && totalGoals >= 3) return 'btts com over forte'
  if (totalGoals >= 4) return 'janela agressiva'
  if (totalGoals <= 1) return 'linha travada'
  if (homeGoals === awayGoals) return 'equilibrio de mercado'
  return 'fluxo moderado'
}

const toMatchRecord = (platform: Platform, league: EasyLeagueConfig, raw: EasyRawMatch): MatchRecord => {
  const matchDate = new Date(raw.date ?? Date.now())
  const ftHome = Number(raw.scoreboardFT?.home ?? 0)
  const ftAway = Number(raw.scoreboardFT?.away ?? 0)
  const htHome = Number(raw.scoreboardHT?.home ?? 0)
  const htAway = Number(raw.scoreboardHT?.away ?? 0)
  const totalGoals = ftHome + ftAway
  const bothScore = ftHome > 0 && ftAway > 0
  const hasComeback =
    (htHome < htAway && ftHome > ftAway) || (htHome > htAway && ftHome < ftAway)
  const odds = Object.fromEntries(
    marketOptions.map((market) => [market, null]),
  ) as Record<Market, number | null>

  odds['Ambas Marcam Sim'] = readRawOdd(raw.odds, ['ams', 'ambasSim', 'ambasMarcamSim', 'bttsYes', 'bttsSim'])
  odds['Ambas Marcam Não'] = readRawOdd(raw.odds, ['amn', 'ambasNao', 'ambasMarcamNao', 'ambasMarcamNão', 'bttsNo', 'bttsNao'])
  odds['Over 0.5'] = readRawOdd(raw.odds, ['o05', 'over05', 'over0_5', 'over0.5', 'over_0_5'])
  odds['Over 1.5'] = readRawOdd(raw.odds, ['o15', 'over15', 'over1_5', 'over1.5', 'over_1_5'])
  odds['Over 2.5'] = readRawOdd(raw.odds, ['o25', 'over25', 'over2_5', 'over2.5', 'over_2_5'])
  odds['Over 3.5'] = readRawOdd(raw.odds, ['o35', 'over35', 'over3_5', 'over3.5', 'over_3_5'])
  odds['Under 0.5'] = readRawOdd(raw.odds, ['u05', 'under05', 'under0_5', 'under0.5', 'under_0_5'])
  odds['Under 1.5'] = readRawOdd(raw.odds, ['u15', 'under15', 'under1_5', 'under1.5', 'under_1_5'])
  odds['Under 2.5'] = readRawOdd(raw.odds, ['u25', 'under25', 'under2_5', 'under2.5', 'under_2_5'])
  odds['Under 3.5'] = readRawOdd(raw.odds, ['u35', 'under35', 'under3_5', 'under3.5', 'under_3_5'])
  odds['Resultado HT'] = readRawOdd(raw.odds, ['resultadoHT', 'resultadoHt', 'rht', 'htHome', 'casaHT', 'homeHt'])
  odds['Casa vence HT'] = odds['Resultado HT']
  odds['Empate HT'] =
    readRawOdd(raw.odds, ['empateHT', 'drawHt', 'htDraw', 'drawHT']) ?? odds['Resultado HT']
  odds['Fora vence HT'] =
    readRawOdd(raw.odds, ['foraHT', 'awayHt', 'htAway', 'awayHT']) ?? odds['Resultado HT']

  const marketResults = Object.fromEntries(
    marketOptions.map((market) => [market, false]),
  ) as Record<Market, boolean>

  marketResults['Resultado final'] = ftHome > ftAway
  marketResults['Resultado HT'] = htHome > htAway
  marketResults['Casa vence'] = ftHome > ftAway
  marketResults['Empate'] = ftHome === ftAway
  marketResults['Fora vence'] = ftHome < ftAway
  marketResults['Casa vence HT'] = htHome > htAway
  marketResults['Empate HT'] = htHome === htAway
  marketResults['Fora vence HT'] = htHome < htAway
  marketResults['Ambas Marcam Sim'] = bothScore
  marketResults['Ambas Marcam Não'] = !bothScore
  marketResults['Over 0.5'] = totalGoals >= 1
  marketResults['Over 1.5'] = totalGoals >= 2
  marketResults['Over 2.5'] = totalGoals >= 3
  marketResults['Over 3.5'] = totalGoals >= 4
  marketResults['Over 4.5'] = totalGoals >= 5
  marketResults['Over 5.5'] = totalGoals >= 6
  marketResults['Under 0.5'] = totalGoals < 1
  marketResults['Under 1.5'] = totalGoals < 2
  marketResults['Under 2.5'] = totalGoals < 3
  marketResults['Under 3.5'] = totalGoals < 4
  marketResults['Under 4.5'] = totalGoals < 5
  marketResults['Under 5.5'] = totalGoals < 6
  Array.from({ length: 7 }, (_, goals) => goals).forEach((goals) => {
    marketResults[`${goals} gols FT`] = totalGoals === goals
  })
  marketResults['Viradinha'] = hasComeback
  marketResults[`${ftHome}x${ftAway}`] = true

  const winnerCode = ftHome > ftAway ? 'H' : ftHome < ftAway ? 'A' : 'D'
  const goalCode = totalGoals >= 3 ? '+G' : '-G'
  const bttsCode = bothScore ? 'BT' : 'NB'
  const roundToken = Number(String(raw.subId ?? '').split('_')[0])
  const streamUrl = getStreamUrl(platform, league.sub, league.name)

  return {
    id: buildRecordId(platform, league.name, raw),
    platform,
    league: league.name,
    leagueSub: league.sub,
    timestamp: matchDate.getTime(),
    hour: getVirtualHour(matchDate),
    minuteSlot: matchDate.getUTCMinutes(),
    round: Number.isFinite(roundToken) ? roundToken : 0,
    status: String(raw.status ?? ''),
    homeTeam: repairMisencodedText(raw.teamA ?? 'Time A'),
    awayTeam: repairMisencodedText(raw.teamB ?? 'Time B'),
    scoreHT: `${htHome}-${htAway}`,
    scoreFT: `${ftHome}-${ftAway}`,
    odds,
    marketResults,
    sequencePattern: `${winnerCode} ${goalCode} ${bttsCode}`,
    tendency: buildTendency(ftHome, ftAway),
    tags: buildTags(ftHome, ftAway, odds),
    videoAvailable: Boolean(streamUrl),
    streamUrl,
    leagueImage: league.image,
  }
}

export const leagueCatalog = flattenedLeagueCatalog

export const getLeagueOptionsForPlatform = (platform: Platform) =>
  availablePlatforms.includes(platform) ? easyLeaguesByPlatform[platform].map((league) => league.name) : []

export const resolveLiveLeagueMeta = (leagueName: string) =>
  flattenedLeagueCatalog.find((league) => league.name === leagueName) ?? null

export function useEasyLiveRecords(activePlatform: Platform, enabled = true): LiveDataState {
  const [recordsByLeague, setRecordsByLeague] = useState<Record<string, MatchRecord[]>>({})
  const [loadedKeys, setLoadedKeys] = useState<Record<string, true>>({})
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const recordsCacheRef = useRef<Record<string, MatchRecord[]>>({})
  const loadedKeysRef = useRef<Record<string, true>>({})
  const realOddsCacheRef = useRef<Record<string, Partial<Record<Market, number>>>>({})
  const realOddsDirtyRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      recordsCacheRef.current = {}
      loadedKeysRef.current = {}
      queueMicrotask(() => {
        setRecordsByLeague({})
        setLoadedKeys({})
        setError(null)
        setUpdatedAt(null)
      })
      return undefined
    }

    recordsCacheRef.current = {}
    loadedKeysRef.current = {}
    realOddsCacheRef.current = loadStoredRealOdds()
    realOddsDirtyRef.current = false

    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flushState = () => {
      flushTimer = null
      if (realOddsDirtyRef.current) {
        persistStoredRealOdds(realOddsCacheRef.current)
        realOddsDirtyRef.current = false
      }
      setRecordsByLeague({ ...recordsCacheRef.current })
      setLoadedKeys({ ...loadedKeysRef.current })
      setUpdatedAt(Date.now())
    }

    const scheduleFlush = () => {
      if (flushTimer) return
      flushTimer = setTimeout(flushState, liveFlushDelayMs)
    }

    const sockets = [activePlatform].flatMap((platform) =>
      easyLeaguesByPlatform[platform].map((league) => {
        const socket = io(socketUrl, {
          transports: ['websocket'],
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1200,
        })

        socket.on('connect', () => {
          getLeagueSubscribeSubs(league).forEach((sub) => {
            socket.emit('subscribe', {
              provider: league.provider,
              sub,
            })
          })
        })

        socket.on('connect_error', (nextError: Error) => {
          setError(nextError.message)
        })

        socket.on('update', (payload: EasyRawMatch | EasyRawMatch[]) => {
          const rawMatches = (Array.isArray(payload) ? payload : [payload]).filter(
            (match) => String(match.status ?? '').trim() && String(match.subId ?? '').trim(),
          )

          if (rawMatches.length === 0) {
            return
          }

          const groupedKey = `${platform}:${league.name}`
          const mergedById = new Map<string, MatchRecord>()

          ;(recordsCacheRef.current[groupedKey] ?? []).forEach((record) => {
            mergedById.set(record.id, record)
          })

          rawMatches
            .map((match) => toMatchRecord(platform, league, match))
            .sort((left, right) => right.timestamp - left.timestamp)
            .forEach((record) => {
              const previousRecord = mergedById.get(record.id)
              const mergedRecord = mergeRealOddsIntoRecord(
                record,
                previousRecord,
                realOddsCacheRef.current[record.id],
              )
              const compactOdds = compactRealOdds(mergedRecord.odds)
              const currentStoredOdds = realOddsCacheRef.current[mergedRecord.id] ?? {}
              const compactOddsKeys = Object.keys(compactOdds)
              const storedOddsKeys = Object.keys(currentStoredOdds)
              const shouldPersistOdds =
                compactOddsKeys.length > 0 &&
                (compactOddsKeys.length !== storedOddsKeys.length ||
                  compactOddsKeys.some((market) => currentStoredOdds[market as Market] !== compactOdds[market as Market]))

              if (shouldPersistOdds) {
                realOddsCacheRef.current = {
                  ...realOddsCacheRef.current,
                  [mergedRecord.id]: compactOdds,
                }
                realOddsDirtyRef.current = true
              }

              mergedById.set(mergedRecord.id, mergedRecord)
            })

          recordsCacheRef.current = {
            ...recordsCacheRef.current,
            [groupedKey]: [...mergedById.values()]
              .sort((left, right) => right.timestamp - left.timestamp)
              .slice(0, maxRecordsPerLeague),
          }
          loadedKeysRef.current = {
            ...loadedKeysRef.current,
            [groupedKey]: true,
          }
          setError(null)
          scheduleFlush()
        })

        return socket
      }),
    )

    return () => {
      if (flushTimer) {
        clearTimeout(flushTimer)
      }

      sockets.forEach((socket) => {
        socket.disconnect()
      })
    }
  }, [activePlatform, enabled])

  const records = useMemo(
    () =>
      Object.values(recordsByLeague)
        .flat()
        .filter((record) => record.platform === activePlatform)
        .sort((left, right) => right.timestamp - left.timestamp),
    [activePlatform, recordsByLeague],
  )

  const expectedLeagues = easyLeaguesByPlatform[activePlatform]?.length ?? 0
  const loadedCount = Object.keys(loadedKeys).filter((key) =>
    key.startsWith(`${activePlatform}:`),
  ).length
  const loading = loadedCount < expectedLeagues

  return {
    records,
    loading,
    error,
    updatedAt,
  }
}













