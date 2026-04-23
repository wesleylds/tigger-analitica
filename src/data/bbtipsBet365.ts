import { useEffect, useMemo, useRef, useState } from 'react'
import { getStreamUrl } from '../lib/videoStreams'
import type { Market, MatchRecord, Period, Platform, TimeMode } from '../types'
import { marketOptions } from './staticData'

export interface BbtipsColumn {
  Hora?: string | number
  Horario?: string | number
  Minuto?: string | number
  TimeA?: string
  TimeB?: string
  SiglaA?: string
  SiglaB?: string
  Resultado?: string
  Resultado_FT?: string
  Resultado_HT?: string
  Resultado_HT_Odd?: string | number
  Odd?: string | number
  OddsByMarket?: Record<string, string | number | null | undefined>
  Odds_Formatada?: Array<{ Odd?: string | number | null }>
  Odds?: string
  Id?: string | number
  Viradinha?: boolean
}

export interface BbtipsLine {
  Hora?: string | number
  Colunas?: BbtipsColumn[]
}

export interface BbtipsPayload {
  DataAtualizacao?: string
  Linhas?: BbtipsLine[]
  Minutos?: Array<{ Numero?: string | number }>
}

export interface BbtipsLeaguePayload {
  key: string
  name: string
  sub: string
  image: string
  current?: BbtipsPayload | null
  future?: BbtipsPayload | null
}

export interface BbtipsLivePayload {
  period?: Period
  platform?: Platform
  receivedAt?: number
  source?: 'live' | 'cache'
  updatedAt?: number
  leagues?: BbtipsLeaguePayload[]
}

interface LiveDataState {
  payload: BbtipsLivePayload | null
  records: MatchRecord[]
  loading: boolean
  error: string | null
  updatedAt: number | null
}

export interface BbtipsMatrixAggregate {
  goals: number
  greenRate: number
  greens: number
  total: number
}

export interface BbtipsMatrixStats {
  cells: Map<string, BbtipsMatrixAggregate>
  columns: Map<number, BbtipsMatrixAggregate>
  overall: BbtipsMatrixAggregate
  rows: Map<number, BbtipsMatrixAggregate>
}

export interface BbtipsMatrixRowLayout {
  bucketStart: number
  hour: number
  hourLabel: string
  source: 'current' | 'future'
}

const hourMs = 60 * 60 * 1000
const minuteMs = 60 * 1000
const emptyScore = '0-0'
const exactPayloadCacheByRequestKey = new Map<string, BbtipsLivePayload>()
const compatiblePayloadCacheByScopeKey = new Map<string, BbtipsLivePayload>()
const payloadClockSyncMaxDriftMs = 2 * hourMs
const payloadFreshMaxAgeMsByPlatform: Record<Platform, number> = {
  Betano: 10_000,
  Bet365: 2 * minuteMs,
  'Express 365': 2 * minuteMs,
  PlayPix: 12_000,
}
/** Início da hora em UTC (ms) — chave única por “dia+hora” na matriz (evita colisão da hora virtual 0–23 em janelas longas). */
const utcHourBucketStart = (timestamp: number) => {
  const date = new Date(timestamp)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), 0, 0, 0)
}

/** Hora/minuto da grade virtual seguem o relógio de referência no Brasil, não o fuso local do browser. */
const BBTIPS_GRID_TIMEZONE = 'America/Sao_Paulo'

const bbtipsWallClock = (unixMs: number) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BBTIPS_GRID_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(unixMs))
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value)
  return {
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
  }
}

const formatBbtipsMatrixRowHourLabel = (bucketStart: number) =>
  `${new Intl.DateTimeFormat('pt-BR', {
    timeZone: BBTIPS_GRID_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).format(new Date(bucketStart))}h`

const normalizeScore = (value?: string | number | null) => {
  const score = String(value ?? '')
    .replace(/\+/g, '')
    .trim()

  const match = score.match(/^(\d+)\s*-\s*(\d+)$/)
  return match ? `${Number(match[1])}-${Number(match[2])}` : null
}

const parseScore = (score: string) => {
  const [home, away] = score.split('-').map(Number)

  return {
    away: Number.isFinite(away) ? away : 0,
    home: Number.isFinite(home) ? home : 0,
  }
}

const parseNumber = (value?: string | number | null) => {
  const normalizedValue = typeof value === 'string'
    ? value
      .replace('@', '')
      .replace(',', '.')
      .replace(/[^\d.-]/g, '')
    : value
  const parsed = typeof normalizedValue === 'string' ? Number(normalizedValue) : normalizedValue
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

const parsePositiveNumber = (value?: string | number | null) => {
  const parsed = parseNumber(value)

  return parsed !== null && parsed > 0 ? parsed : null
}

const hasPositiveOdd = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/** OddsByMarket pode vir como "1 gol FT" (filtro UI) ou "1 gols FT" (grade interna). */
const allowOddsByMarketKey = (market: string) =>
  marketOptions.includes(market) || market === '1 gol FT'

const normalizeTeam = (primary?: string, fallback?: string) =>
  String(primary || fallback || 'Time')
    .replace(/\s+/g, ' ')
    .trim()

const hasTeams = (column: BbtipsColumn) =>
  Boolean(String(column.TimeA ?? column.SiglaA ?? '').trim() && String(column.TimeB ?? column.SiglaB ?? '').trim())

const isPlaceholderColumn = (column: BbtipsColumn) =>
  !hasTeams(column) && !normalizeScore(column.Resultado_FT ?? column.Resultado)

const bbtipsMarketsByCode: Record<string, Market[]> = {
  ambs: ['Ambas Marcam Sim'],
  ambn: ['Ambas Marcam Não'],
  o05: ['Over 0.5'],
  o15: ['Over 1.5'],
  o25: ['Over 2.5'],
  o35: ['Over 3.5'],
  o45: ['Over 4.5'],
  o55: ['Over 5.5'],
  u05: ['Under 0.5'],
  u15: ['Under 1.5'],
  u25: ['Under 2.5'],
  u35: ['Under 3.5'],
  ge0: ['0 gols FT'],
  ge1: ['1 gols FT', '1 gol FT'],
  ge2: ['2 gols FT'],
  ge3: ['3 gols FT'],
  ge4: ['4 gols FT'],
  ge5: ['5 gols FT'],
  vira: ['Viradinha'],
}

const buildLegacyOdds = (column: BbtipsColumn) => {
  const odds = Object.fromEntries(
    marketOptions.map((market) => [market, null]),
  ) as Record<Market, number | null>
  const oddVector = String(column.Odds ?? '')
    .split('|')
    .map((value) => parsePositiveNumber(value))
  const setOdd = (market: Market, index: number) => {
    const value = oddVector[index]

    if (value !== undefined && value !== null) {
      odds[market] = value
    }
  }
  const htOdd = parsePositiveNumber(column.Resultado_HT_Odd)

  setOdd('Over 0.5', 0)
  setOdd('Over 1.5', 1)
  setOdd('Over 2.5', 2)
  setOdd('Over 3.5', 3)
  setOdd('Over 4.5', 4)
  setOdd('Under 1.5', 5)
  setOdd('Under 2.5', 6)
  setOdd('Under 3.5', 7)
  setOdd('Ambas Marcam Sim', 8)
  setOdd('Ambas Marcam Não', 9)
  setOdd('Viradinha', 10)

  if (htOdd !== null) {
    odds['Resultado HT'] = htOdd
    odds['Casa vence HT'] = htOdd
    odds['Empate HT'] = htOdd
    odds['Fora vence HT'] = htOdd
  }

  Object.entries(column.OddsByMarket ?? {}).forEach(([market, value]) => {
    if (!allowOddsByMarketKey(market)) return

    const parsedValue = parsePositiveNumber(value)
    if (parsedValue === null) return
    // Não sobrescrever odd já vinda do vetor | (grade completa tem prioridade)
    if (!hasPositiveOdd(odds[market as Market])) {
      odds[market as Market] = parsedValue
    }
  })

  return odds
}

const buildOdds = (column: BbtipsColumn) => {
  const odds = buildLegacyOdds(column)
  const oddVector = String(column.Odds ?? '')
    .split('|')
    .map((value) => parsePositiveNumber(value))
  const setOddValue = (market: Market, value?: string | number | null) => {
    const parsedValue = parsePositiveNumber(value)
    if (parsedValue !== null) {
      odds[market] = parsedValue
    }
  }
  const setOdd = (market: Market, index: number) => {
    setOddValue(market, oddVector[index])
  }
  const setOddByBbtipsCode = (code: string, value?: string | number | null) => {
    const normalizedCode = code.trim().toLowerCase()
    const exactScoreMatch = normalizedCode.match(/^ft(\d)(\d)$/)
    const markets = exactScoreMatch
      ? [`${Number(exactScoreMatch[1])}x${Number(exactScoreMatch[2])}`]
      : bbtipsMarketsByCode[normalizedCode]

    markets?.forEach((market) => setOddValue(market, value))
  }

  setOdd('Over 0.5', 0)
  setOdd('Over 1.5', 1)
  setOdd('Over 2.5', 2)
  setOdd('Over 3.5', 3)
  setOdd('Over 4.5', 4)
  setOdd('Under 1.5', 5)
  setOdd('Under 2.5', 6)
  setOdd('Under 3.5', 7)
  setOdd('Ambas Marcam Sim', 8)
  setOdd('Ambas Marcam Não', 9)
  setOdd('Viradinha', 10)

  // Vetor estendido: após os 11 campos clássicos vêm mercados extra (ex.: Over 5.5, Under 0.5).
  if (oddVector.length >= 12) {
    setOdd('Over 5.5', 11)
  }
  if (oddVector.length >= 13) {
    setOdd('Under 0.5', 12)
  }

  String(column.Odds ?? '')
    .split(/[;|]/)
    .forEach((entry) => {
      const match = entry.match(/\b([a-z]{1,5}\d{0,2}|ft\d\d)\s*(?:=|@)\s*@?\s*([0-9]+(?:[.,][0-9]+)?)/i)
      if (!match) return

      setOddByBbtipsCode(match[1], match[2])
    })

  Object.entries(column.OddsByMarket ?? {}).forEach(([market, value]) => {
    if (!allowOddsByMarketKey(market)) return
    // OddsByMarket vem do endpoint filtrado; quando o usuario pede essa odd, ela e a fonte mais especifica.
    setOddValue(market as Market, value)
  })

  if (hasPositiveOdd(odds['1 gols FT']) && !hasPositiveOdd(odds['1 gol FT'])) {
    odds['1 gol FT'] = odds['1 gols FT']
  }
  if (hasPositiveOdd(odds['1 gol FT']) && !hasPositiveOdd(odds['1 gols FT'])) {
    odds['1 gols FT'] = odds['1 gol FT']
  }

  return odds
}

const buildMarketResults = (scoreFT: string, scoreHT: string, viradinha?: boolean) => {
  const ft = parseScore(scoreFT)
  const ht = parseScore(scoreHT)
  const totalGoals = ft.home + ft.away
  const bothScore = ft.home > 0 && ft.away > 0
  const hasComeback =
    Boolean(viradinha) ||
    (ht.home < ht.away && ft.home > ft.away) ||
    (ht.home > ht.away && ft.home < ft.away)
  const marketResults = Object.fromEntries(
    marketOptions.map((market) => [market, false]),
  ) as Record<Market, boolean>

  marketResults['Resultado final'] = ft.home > ft.away
  marketResults['Resultado HT'] = ht.home > ht.away
  marketResults['Casa vence'] = ft.home > ft.away
  marketResults['Empate'] = ft.home === ft.away
  marketResults['Fora vence'] = ft.home < ft.away
  marketResults['Casa vence HT'] = ht.home > ht.away
  marketResults['Empate HT'] = ht.home === ht.away
  marketResults['Fora vence HT'] = ht.home < ht.away
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
  marketResults[`${ft.home}x${ft.away}`] = true

  return marketResults
}

const buildTendency = (scoreFT: string) => {
  const ft = parseScore(scoreFT)
  const totalGoals = ft.home + ft.away

  if (ft.home > 0 && ft.away > 0 && totalGoals >= 3) return 'btts com over forte'
  if (totalGoals >= 4) return 'janela agressiva'
  if (totalGoals <= 1) return 'linha travada'
  if (ft.home === ft.away) return 'equilibrio de mercado'
  return 'fluxo moderado'
}

const buildSequencePattern = (scoreFT: string) => {
  const ft = parseScore(scoreFT)
  const totalGoals = ft.home + ft.away
  const winnerCode = ft.home > ft.away ? 'H' : ft.home < ft.away ? 'A' : 'D'
  const goalCode = totalGoals >= 3 ? '+G' : '-G'
  const bttsCode = ft.home > 0 && ft.away > 0 ? 'BT' : 'NB'

  return `${winnerCode} ${goalCode} ${bttsCode}`
}

const buildTags = (scoreFT: string, hasLiveOdd: boolean) => {
  const ft = parseScore(scoreFT)
  const totalGoals = ft.home + ft.away
  const tags = ['dados reais']

  if (ft.home > 0 && ft.away > 0) tags.push('btts quente')
  if (totalGoals >= 4) tags.push('placar esticado')
  if (totalGoals <= 1) tags.push('linha baixa')
  if (ft.home === ft.away) tags.push('empate cravado')
  if (hasLiveOdd) tags.push('odd real')

  return tags
}

/** Mesma âncora que `normalizePayload` / grade virtual (`DataAtualizacao`). */
export const getBbtipsPayloadAnchorTimestamp = (
  payload: BbtipsPayload | null | undefined,
  fallback: number,
) => {
  const rawValue = String(payload?.DataAtualizacao ?? '').trim()
  const localSaoPauloMatch = rawValue.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
  )
  const parsed = localSaoPauloMatch
    ? Date.UTC(
      Number(localSaoPauloMatch[1]),
      Number(localSaoPauloMatch[2]) - 1,
      Number(localSaoPauloMatch[3]),
      Number(localSaoPauloMatch[4]) + 3,
      Number(localSaoPauloMatch[5]),
      Number(localSaoPauloMatch[6] ?? 0),
      Number(String(localSaoPauloMatch[7] ?? '0').padEnd(3, '0')),
    )
    : Date.parse(rawValue)
  return Number.isFinite(parsed) ? parsed : fallback
}

const getPayloadAnchor = getBbtipsPayloadAnchorTimestamp

const shouldUseSequentialClockForPayload = (
  payload: BbtipsPayload | null | undefined,
  fallbackTimestamp: number,
  referencePayload?: BbtipsPayload | null | undefined,
  maxDriftMs = payloadClockSyncMaxDriftMs,
) => {
  const payloadAnchor = getPayloadAnchor(payload, fallbackTimestamp)
  const referenceAnchor = referencePayload
    ? getPayloadAnchor(referencePayload, fallbackTimestamp)
    : fallbackTimestamp

  /**
   * Para payload `future`, se a `DataAtualizacao` dele ficar muito atrás do `current`,
   * a grade deixa de representar a próxima sequência real e passa a "puxar" horas antigas
   * como 23h/00h para o topo da matriz. Nesses casos, forçamos o relógio sequencial.
   */
  if (referenceAnchor - payloadAnchor > maxDriftMs) {
    return true
  }

  return isBbtipsPayloadClockStale(payload, referenceAnchor, maxDriftMs)
}

const isBbtipsPayloadClockStale = (
  payload: BbtipsPayload | null | undefined,
  fallbackTimestamp: number,
  maxDriftMs = payloadClockSyncMaxDriftMs,
) => {
  const anchorTimestamp = getPayloadAnchor(payload, fallbackTimestamp)
  const referenceTimestamp =
    typeof fallbackTimestamp === 'number' && Number.isFinite(fallbackTimestamp)
      ? fallbackTimestamp
      : Date.now()

  /**
   * O BB Tips pode expor uma data virtual futura para a grade.
   * Nesse caso precisamos confiar no payload, senão a matriz "volta" para o dia atual
   * e toda a sequência dos próximos jogos fica deslocada.
   *
   * Só tratamos como clock stale quando o payload está atrasado demais em relação ao relógio
   * de referência local; estar adiantado não é erro para essa integração.
   */
  return referenceTimestamp - anchorTimestamp > maxDriftMs
}

const normalizeGridHour = (value?: string | number | null) => {
  const rawHour = parseNumber(value)
  return rawHour === null ? 0 : ((Math.trunc(rawHour) % 24) + 24) % 24
}

const normalizeHourDelta = (hour: number, anchorHour: number) => {
  let delta = hour - anchorHour

  if (delta > 12) delta -= 24
  if (delta < -12) delta += 24

  return delta
}

const getLineGridHour = (line: BbtipsLine) => {
  const columnHour = (line.Colunas ?? [])
    .map((column) => parseNumber(column.Hora))
    .find((hour): hour is number => hour !== null)

  return normalizeGridHour(line.Hora ?? columnHour)
}

const hasRenderableLineColumns = (line: BbtipsLine) =>
  (line.Colunas ?? []).some((column) => !isPlaceholderColumn(column))

const shouldCompactSplitHourLines = (platform?: Platform) =>
  platform === 'Express 365'

const columnRenderScore = (column: BbtipsColumn) => {
  let score = 0

  if (normalizeScore(column.Resultado_FT ?? column.Resultado)) score += 4
  if (hasTeams(column)) score += 2
  if (parsePositiveNumber(column.Odd) !== null || column.Odds || column.OddsByMarket) score += 1

  return score
}

const mergeRenderableColumnsByMinute = (columns: BbtipsColumn[]) => {
  const byMinute = new Map<number, BbtipsColumn>()

  columns.forEach((column) => {
    const minute = columnMinute(column)
    const existing = byMinute.get(minute)

    if (!existing || columnRenderScore(column) >= columnRenderScore(existing)) {
      byMinute.set(minute, column)
    }
  })

  return [...byMinute.values()].sort((left, right) => columnMinute(left) - columnMinute(right))
}

const compactPayloadSplitHourLines = (
  payload: BbtipsPayload | null | undefined,
): BbtipsPayload | null | undefined => {
  if (!payload?.Linhas?.length) return payload

  const buckets = new Map<number, BbtipsLine>()
  const hourOrder: number[] = []

  payload.Linhas.forEach((line) => {
    const columns = line.Colunas ?? []
    const renderableColumns = columns.filter((column) => !isPlaceholderColumn(column))
    if (renderableColumns.length === 0) return

    const hour = getLineGridHour({ ...line, Colunas: renderableColumns })
    const existing = buckets.get(hour)
    if (!existing) {
      buckets.set(hour, {
        ...line,
        Hora: hour,
        Colunas: mergeRenderableColumnsByMinute(renderableColumns),
      })
      hourOrder.push(hour)
      return
    }

    existing.Colunas = mergeRenderableColumnsByMinute([...(existing.Colunas ?? []), ...renderableColumns])
  })

  const lines = hourOrder
    .map((hour) => buckets.get(hour))
    .filter((line): line is BbtipsLine => Boolean(line))
    .map((line) => ({
      ...line,
      Colunas: mergeRenderableColumnsByMinute(line.Colunas ?? []),
    }))

  return {
    ...payload,
    Linhas: lines,
  }
}

const normalizePayloadForMatrix = (
  platform: Platform | undefined,
  payload: BbtipsPayload | null | undefined,
) =>
  shouldCompactSplitHourLines(platform)
    ? compactPayloadSplitHourLines(payload)
    : payload

interface BbtipsLineBucket {
  bucketStart: number
  hour: number
  renderable: boolean
}

const buildSequentialLineBuckets = (
  lines: BbtipsLine[],
  anchorTimestamp: number,
  source: 'current' | 'future',
): BbtipsLineBucket[] => {
  if (lines.length === 0) return []

  const anchorBucket = Math.floor(anchorTimestamp / hourMs) * hourMs

  return lines.map((line, index) => {
    const bucketStart =
      source === 'future'
        ? anchorBucket + (index + 1) * hourMs
        : anchorBucket - index * hourMs

    return {
      bucketStart,
      hour: bbtipsWallClock(bucketStart).hour,
      renderable: hasRenderableLineColumns(line),
    }
  })
}

const buildCurrentLineBuckets = (
  lines: BbtipsLine[],
  anchorTimestamp: number,
  referenceLines: BbtipsLine[] = lines,
) : BbtipsLineBucket[] => {
  if (lines.length === 0) return []

  const anchorBucket = Math.floor(anchorTimestamp / hourMs) * hourMs
  const anchorHour = bbtipsWallClock(anchorTimestamp).hour
  const currentReferenceHour = referenceLines.length > 0
    ? getLineGridHour(referenceLines[0])
    : anchorHour
  const currentReferenceBucket =
    anchorBucket + normalizeHourDelta(currentReferenceHour, anchorHour) * hourMs
  const firstHour = getLineGridHour(lines[0])
  let previousHour = firstHour
  let previousBucket = currentReferenceBucket

  return lines.map((line, index) => {
    const hour = getLineGridHour(line)

    if (index === 0) {
      previousHour = hour
      return {
        bucketStart: previousBucket,
        hour,
        renderable: hasRenderableLineColumns(line),
      }
    }

    const stepHours = ((previousHour - hour + 24) % 24) || 24
    previousBucket -= stepHours * hourMs
    previousHour = hour

    return {
      bucketStart: previousBucket,
      hour,
      renderable: hasRenderableLineColumns(line),
    }
  })
}

const buildLineBuckets = (
  lines: BbtipsLine[],
  anchorTimestamp: number,
  source: 'current' | 'future',
  referenceLines: BbtipsLine[] = lines,
  preferSequentialClock = false,
) =>
  source === 'future'
    ? buildSequentialLineBuckets(lines, anchorTimestamp, source)
    : preferSequentialClock
    ? buildSequentialLineBuckets(lines, anchorTimestamp, source)
    : buildCurrentLineBuckets(lines, anchorTimestamp, referenceLines)

export const buildBbtipsMatrixRowLayouts = (
  platform: Platform,
  currentPayload: BbtipsPayload | null | undefined,
  futurePayload: BbtipsPayload | null | undefined,
  fallbackTimestamp: number,
  maxPastRows = 240,
) => {
  const normalizedCurrentPayload = normalizePayloadForMatrix(platform, currentPayload)
  const normalizedFuturePayload = normalizePayloadForMatrix(platform, futurePayload)
  const currentUsesSequentialClock = shouldUseSequentialClockForPayload(normalizedCurrentPayload, fallbackTimestamp)
  const currentAnchor = currentUsesSequentialClock
    ? Date.now()
    : getPayloadAnchor(normalizedCurrentPayload, fallbackTimestamp)
  const anchorBucket = Math.floor(currentAnchor / hourMs) * hourMs
  const anchorClock = bbtipsWallClock(currentAnchor)
  const anchorHour = anchorClock.hour
  const anchorMinute = anchorClock.minute
  const resolveBucket = (hour: number, minuteSlot: number, pending: boolean) => {
    let hourDelta = normalizeHourDelta(hour, anchorHour)

    if (pending) {
      if (hourDelta < 0) hourDelta += 24
      if (hourDelta === 0 && minuteSlot < anchorMinute) hourDelta = 24
    } else if (hourDelta > 0) {
      hourDelta -= 24
    }

    return anchorBucket + hourDelta * hourMs
  }
  const resolveLineBucket = (line: BbtipsLine, pending: boolean) => {
    const columns = line.Colunas ?? []
    const firstRenderableColumn = columns.find((column) => !isPlaceholderColumn(column))
    const hour = getLineGridHour(line)
    const minuteSlot = firstRenderableColumn ? columnMinute(firstRenderableColumn) : 0
    const bucketStart = resolveBucket(hour, minuteSlot, pending)

    return {
      bucketStart,
      hour,
      renderable: hasRenderableLineColumns(line),
    }
  }
  const currentRows = normalizedCurrentPayload?.Linhas ?? []
  const currentBuckets = currentUsesSequentialClock
    ? buildLineBuckets(currentRows, currentAnchor, 'current', currentRows, true)
    : currentRows.map((line) => resolveLineBucket(line, false))

  const currentLayouts = (currentRows
    .map((_line, index) => {
      const bucket = currentBuckets[index]
      if (!bucket || !bucket.renderable) return null

      return {
        bucketStart: bucket.bucketStart,
        hour: bucket.hour,
        hourLabel: formatBbtipsMatrixRowHourLabel(bucket.bucketStart),
        source: 'current',
      } satisfies BbtipsMatrixRowLayout
    })
    .filter(Boolean) as BbtipsMatrixRowLayout[])
    .slice(0, maxPastRows)

  const futureRows = normalizedFuturePayload?.Linhas ?? []
  /**
   * Proximos jogos da BBTips ja chegam com Hora/Minuto de exibicao. Forcar relogio sequencial aqui
   * desloca a primeira linha futura e cria buracos visuais na matriz.
   */
  const futureUsesSequentialClock = false
  const futureBuckets = futureUsesSequentialClock
    ? buildLineBuckets(
        futureRows,
        currentAnchor,
        'future',
        normalizedCurrentPayload?.Linhas ?? [],
        true,
      )
    : futureRows.map((line) => resolveLineBucket(line, true))

  const futureLayouts = (futureRows
    .map((_line, index) => {
      const bucket = futureBuckets[index]
      if (!bucket || !bucket.renderable) return null

      return {
        bucketStart: bucket.bucketStart,
        hour: bucket.hour,
        hourLabel: formatBbtipsMatrixRowHourLabel(bucket.bucketStart),
        source: 'future',
      } satisfies BbtipsMatrixRowLayout
    })
    .filter(Boolean) as BbtipsMatrixRowLayout[])

  const currentLayoutBuckets = new Set(currentLayouts.map((layout) => layout.bucketStart))
  const leadingCurrentHour = currentLayouts[0]?.hour
  const leadingFutureLayouts = futureLayouts
    .filter((layout) => !currentLayoutBuckets.has(layout.bucketStart) && layout.hour !== leadingCurrentHour)
    .sort((left, right) => left.bucketStart - right.bucketStart)

  return [...leadingFutureLayouts, ...currentLayouts]
}

export const extractBbtipsMinuteSlots = (payload: BbtipsPayload | null | undefined) =>
  (payload?.Minutos ?? [])
    .map((minute) => parseNumber(minute.Numero))
    .filter((minute): minute is number => minute !== null)
    .map((minute) => Math.max(0, Math.min(59, Math.trunc(minute))))

export const extractBbtipsHourBuckets = (
  payload: BbtipsPayload | null | undefined,
  fallbackTimestamp: number,
  source: 'current' | 'future' = 'current',
  /** Igual à grade (current): força o mesmo anchor que `resolveBucket` nos registos. */
  anchorTimestampOverride?: number,
  referenceCurrentPayload?: BbtipsPayload | null | undefined,
  platform?: Platform,
) => {
  const normalizedPayload = normalizePayloadForMatrix(platform, payload)
  const normalizedReferenceCurrentPayload = normalizePayloadForMatrix(platform, referenceCurrentPayload)
  const shouldUseSequentialClock = source === 'future'
    ? false
    : shouldUseSequentialClockForPayload(
      normalizedPayload,
      fallbackTimestamp,
      undefined,
    )
  const anchorTimestamp = Number.isFinite(anchorTimestampOverride)
    ? anchorTimestampOverride!
    : getPayloadAnchor(normalizedPayload, fallbackTimestamp)
  return buildLineBuckets(
    normalizedPayload?.Linhas ?? [],
    shouldUseSequentialClock ? Date.now() : anchorTimestamp,
    source,
    source === 'future' ? (normalizedReferenceCurrentPayload?.Linhas ?? []) : (normalizedPayload?.Linhas ?? []),
    shouldUseSequentialClock,
  )
    .filter((entry) => entry.renderable)
    .map((entry) => entry.bucketStart)
}

export const extractBbtipsProjectedCellKeys = (
  payload: BbtipsPayload | null | undefined,
  fallbackTimestamp: number,
  source: 'current' | 'future' = 'current',
  anchorTimestampOverride?: number,
  referenceCurrentPayload?: BbtipsPayload | null | undefined,
  platform?: Platform,
) => {
  const normalizedPayload = normalizePayloadForMatrix(platform, payload)
  const normalizedReferenceCurrentPayload = normalizePayloadForMatrix(platform, referenceCurrentPayload)
  const rows = normalizedPayload?.Linhas ?? []
  const shouldUseSequentialClock = source === 'future'
    ? false
    : shouldUseSequentialClockForPayload(
      normalizedPayload,
      fallbackTimestamp,
      undefined,
    )
  const anchorTimestamp = Number.isFinite(anchorTimestampOverride)
    ? anchorTimestampOverride!
    : getPayloadAnchor(normalizedPayload, fallbackTimestamp)
  const lineBuckets = buildLineBuckets(
    rows,
    shouldUseSequentialClock ? Date.now() : anchorTimestamp,
    source,
    source === 'future' ? (normalizedReferenceCurrentPayload?.Linhas ?? []) : rows,
    shouldUseSequentialClock,
  )

  return rows.flatMap((line, lineIndex) => {
    const lineBucket = lineBuckets[lineIndex]
    if (!lineBucket) return []

    return (line.Colunas ?? [])
      .filter((column) => isPlaceholderColumn(column))
      .map((column) => `${lineBucket.bucketStart}-${columnMinute(column)}`)
  })
}

const lineHour = (line: BbtipsLine, column: BbtipsColumn) => {
  return normalizeGridHour(column.Hora ?? line.Hora)
}

const columnMinute = (column: BbtipsColumn) => {
  const rawMinute = parseNumber(column.Minuto)
  return rawMinute === null ? 0 : Math.max(0, Math.min(59, Math.trunc(rawMinute)))
}

const normalizePayload = (
  platform: Platform,
  league: BbtipsLeaguePayload,
  payload: BbtipsPayload | null | undefined,
  source: 'current' | 'future',
  baseTimestamp: number,
  /** Mesma âncora da grade (DataAtualizacao do payload current). Se omitido, usa o payload desta chamada. */
  anchorTimestampOverride?: number,
  referenceCurrentPayload?: BbtipsPayload | null | undefined,
) => {
  const normalizedPayload = normalizePayloadForMatrix(platform, payload)
  const normalizedReferenceCurrentPayload = normalizePayloadForMatrix(platform, referenceCurrentPayload)
  const rows = normalizedPayload?.Linhas ?? []
  const referenceAnchor =
    Number.isFinite(anchorTimestampOverride)
      ? anchorTimestampOverride!
      : source === 'future'
        ? getPayloadAnchor(normalizedReferenceCurrentPayload ?? normalizedPayload, baseTimestamp)
        : getPayloadAnchor(normalizedPayload, baseTimestamp)
  const shouldUseSequentialClock = source === 'future'
    ? false
    : shouldUseSequentialClockForPayload(
      normalizedPayload,
      referenceAnchor,
      undefined,
    )
  const anchorTimestamp = shouldUseSequentialClock
    ? referenceAnchor
    : Number.isFinite(anchorTimestampOverride)
      ? anchorTimestampOverride!
      : getPayloadAnchor(normalizedPayload, baseTimestamp)
  const anchorBucket = Math.floor(anchorTimestamp / hourMs) * hourMs
  const anchorClock = bbtipsWallClock(anchorTimestamp)
  const anchorHour = anchorClock.hour
  const anchorMinute = anchorClock.minute
  const sequentialLineBuckets = shouldUseSequentialClock
    ? buildLineBuckets(
        rows,
        anchorTimestamp,
        source,
        source === 'future' ? (normalizedReferenceCurrentPayload?.Linhas ?? []) : rows,
        true,
      )
    : null
  const resolveBucket = (hour: number, minuteSlot: number, pending: boolean) => {
    let hourDelta = normalizeHourDelta(hour, anchorHour)

    if (source === 'future' && pending) {
      if (hourDelta < 0) hourDelta += 24
      if (hourDelta === 0 && minuteSlot < anchorMinute) hourDelta = 24
    } else if (hourDelta > 0) {
      hourDelta -= 24
    }

    return anchorBucket + hourDelta * hourMs
  }
  const referenceCurrentBucketByHour =
    source === 'future' && normalizedReferenceCurrentPayload?.Linhas?.length
      ? new Map(
        normalizedReferenceCurrentPayload.Linhas
          .map((line) => {
            const renderableColumns = (line.Colunas ?? []).filter((column) => !isPlaceholderColumn(column))
            if (renderableColumns.length === 0) return null

            const hour = getLineGridHour(line)
            const firstMinute = columnMinute(renderableColumns[0])
            const maxMinute = Math.max(...renderableColumns.map((column) => columnMinute(column)))

            return [
              hour,
              {
                bucketStart: resolveBucket(hour, firstMinute, false),
                maxMinute,
              },
            ] as const
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
      )
      : null

  return rows.flatMap((line, lineIndex) => {
    const sequentialBucket = sequentialLineBuckets?.[lineIndex]?.bucketStart

    return (line.Colunas ?? [])
      .filter((column) => !isPlaceholderColumn(column))
      .map((column): MatchRecord | null => {
        const scoreFT = normalizeScore(column.Resultado_FT ?? column.Resultado)
        const scoreHT = normalizeScore(column.Resultado_HT)
        const status = scoreFT ? 'finalizado' : 'agendado'

        if (!scoreFT && source === 'current') return null

        const hour = lineHour(line, column)
        const minuteSlot = columnMinute(column)
        const referenceCurrentBucket = referenceCurrentBucketByHour?.get(hour)
        const timestampBucket =
          typeof sequentialBucket === 'number'
            ? sequentialBucket
            : source === 'future' &&
              referenceCurrentBucket &&
              minuteSlot > referenceCurrentBucket.maxMinute
              ? referenceCurrentBucket.bucketStart
            : resolveBucket(hour, minuteSlot, status !== 'finalizado')
        const recordTimestamp = timestampBucket + minuteSlot * minuteMs

        const displayScoreFT = scoreFT ?? emptyScore
        const displayScoreHT = scoreHT ?? emptyScore
        const odds = buildOdds(column)
        const rawId = String(column.Id ?? '').trim()
        const identity = rawId || `${source}-${hour}-${minuteSlot}-${column.TimeA ?? column.SiglaA}-${column.TimeB ?? column.SiglaB}`
        const homeTeam = normalizeTeam(column.TimeA, column.SiglaA)
        const awayTeam = normalizeTeam(column.TimeB, column.SiglaB)
        const streamUrl = getStreamUrl(platform, league.sub, league.name)

        return {
          id: `bbtips-${platform}-${league.key}-${identity}`,
          platform,
          league: league.name,
          leagueSub: league.sub,
          timestamp: recordTimestamp,
          hour,
          minuteSlot,
          round: rawId ? Number(rawId) : timestampBucket + minuteSlot,
          status,
          homeTeam,
          awayTeam,
          scoreHT: displayScoreHT,
          scoreFT: displayScoreFT,
          odds,
          marketResults: buildMarketResults(displayScoreFT, displayScoreHT, column.Viradinha),
          sequencePattern: buildSequencePattern(displayScoreFT),
          tendency: buildTendency(displayScoreFT),
          tags: buildTags(displayScoreFT, odds['Resultado HT'] !== null),
          videoAvailable: Boolean(streamUrl),
          streamUrl,
          leagueImage: league.image,
        }
      })
      .filter((record): record is MatchRecord => Boolean(record))
  })
}

/** Registos a partir do payload da liga (sem dedupe entre ligas — cobre células que `normalizeLivePayload` pode fundir por id). */
export const buildMatchRecordsFromLeaguePayload = (
  platform: Platform,
  league: BbtipsLeaguePayload,
  payload: BbtipsPayload | null | undefined,
  source: 'current' | 'future',
  baseTimestamp: number,
  anchorTimestampOverride?: number,
  referenceCurrentPayload?: BbtipsPayload | null | undefined,
): MatchRecord[] =>
  normalizePayload(
    platform,
    league,
    payload,
    source,
    baseTimestamp,
    anchorTimestampOverride,
    referenceCurrentPayload,
  )

const normalizeLivePayload = (platform: Platform, payload: BbtipsLivePayload) => {
  const baseTimestamp = payload.updatedAt ?? Date.now()
  const byId = new Map<string, MatchRecord>()

  ;(payload.leagues ?? []).forEach((league) => {
    /** Mesma âncora da UI: `current` (grade virtual). Evita `future` com outro DataAtualizacao e células vazias. */
    const leagueAnchor = getBbtipsPayloadAnchorTimestamp(league.current ?? null, baseTimestamp)

    normalizePayload(
      platform,
      league,
      league.current,
      'current',
      baseTimestamp,
      leagueAnchor,
      league.current,
    ).forEach((record) => {
      byId.set(record.id, record)
    })

    normalizePayload(
      platform,
      league,
      league.future,
      'future',
      baseTimestamp,
      leagueAnchor,
      league.current,
    ).forEach((record) => {
      const current = byId.get(record.id)
      if (!current || current.status !== 'finalizado') {
        byId.set(record.id, record)
      }
    })
  })

  return [...byId.values()].sort((left, right) => right.timestamp - left.timestamp)
}

const buildMatrixAggregate = (
  aggregate: Pick<BbtipsMatrixAggregate, 'goals' | 'greens' | 'total'>,
): BbtipsMatrixAggregate => ({
  ...aggregate,
  greenRate: aggregate.total > 0 ? aggregate.greens / aggregate.total : 0,
})

const upsertMatrixAggregate = (
  target: Map<string | number, Pick<BbtipsMatrixAggregate, 'goals' | 'greens' | 'total'>>,
  key: string | number,
  goals: number,
  isGreen: boolean,
) => {
  const current = target.get(key) ?? { goals: 0, greens: 0, total: 0 }
  current.goals += goals
  current.total += 1
  if (isGreen) {
    current.greens += 1
  }
  target.set(key, current)
}

const scoreForMatrixStats = (timeMode: TimeMode, scoreFT: string, scoreHT: string) =>
  timeMode === 'HT' ? scoreHT : scoreFT

export const buildBbtipsMatrixStats = (
  payload: BbtipsPayload | null | undefined,
  market: Market,
  timeMode: TimeMode,
): BbtipsMatrixStats => {
  const cells = new Map<string, Pick<BbtipsMatrixAggregate, 'goals' | 'greens' | 'total'>>()
  const columns = new Map<number, Pick<BbtipsMatrixAggregate, 'goals' | 'greens' | 'total'>>()
  const rows = new Map<number, Pick<BbtipsMatrixAggregate, 'goals' | 'greens' | 'total'>>()
  const overall = { goals: 0, greens: 0, total: 0 }

  ;(payload?.Linhas ?? []).forEach((line) => {
    ;(line.Colunas ?? []).forEach((column) => {
      const scoreFT = normalizeScore(column.Resultado_FT ?? column.Resultado)
      if (!scoreFT) return

      const scoreHT = normalizeScore(column.Resultado_HT) ?? emptyScore
      const hour = lineHour(line, column)
      const minuteSlot = columnMinute(column)
      const selectedScore = scoreForMatrixStats(timeMode, scoreFT, scoreHT)
      const selectedGoals = parseScore(selectedScore)
      const goals = selectedGoals.home + selectedGoals.away
      const marketResults = buildMarketResults(scoreFT, scoreHT, column.Viradinha)
      const isGreen = Boolean(marketResults[market])

      upsertMatrixAggregate(cells, `${hour}-${minuteSlot}`, goals, isGreen)
      upsertMatrixAggregate(columns, minuteSlot, goals, isGreen)
      upsertMatrixAggregate(rows, hour, goals, isGreen)

      overall.goals += goals
      overall.total += 1
      if (isGreen) {
        overall.greens += 1
      }
    })
  })

  return {
    cells: new Map(
      [...cells.entries()].map(([key, aggregate]) => [key, buildMatrixAggregate(aggregate)]),
    ),
    columns: new Map(
      [...columns.entries()].map(([key, aggregate]) => [key, buildMatrixAggregate(aggregate)]),
    ),
    overall: buildMatrixAggregate(overall),
    rows: new Map(
      [...rows.entries()].map(([key, aggregate]) => [key, buildMatrixAggregate(aggregate)]),
    ),
  }
}

/** Agrega estatísticas da matriz só a partir de jogos finalizados na janela temporal (alinhado ao filtro “Últimas horas”). */
export const buildBbtipsMatrixStatsFromRecords = (
  finishedRecords: MatchRecord[],
  market: Market,
  timeMode: TimeMode,
): BbtipsMatrixStats => {
  const cells = new Map<string, Pick<BbtipsMatrixAggregate, 'goals' | 'greens' | 'total'>>()
  const columns = new Map<number, Pick<BbtipsMatrixAggregate, 'goals' | 'greens' | 'total'>>()
  const rows = new Map<number, Pick<BbtipsMatrixAggregate, 'goals' | 'greens' | 'total'>>()
  const overall = { goals: 0, greens: 0, total: 0 }

  finishedRecords.forEach((record) => {
    const scoreFT = normalizeScore(record.scoreFT)
    if (!scoreFT) return

    const scoreHT = normalizeScore(record.scoreHT) ?? emptyScore
    const bucket = utcHourBucketStart(record.timestamp)
    const minuteSlot = record.minuteSlot
    const selectedScore = scoreForMatrixStats(timeMode, scoreFT, scoreHT)
    const selectedGoals = parseScore(selectedScore)
    const goals = selectedGoals.home + selectedGoals.away
    const isGreen = Boolean(record.marketResults[market])

    upsertMatrixAggregate(cells, `${bucket}-${minuteSlot}`, goals, isGreen)
    upsertMatrixAggregate(columns, minuteSlot, goals, isGreen)
    upsertMatrixAggregate(rows, bucket, goals, isGreen)

    overall.goals += goals
    overall.total += 1
    if (isGreen) {
      overall.greens += 1
    }
  })

  return {
    cells: new Map(
      [...cells.entries()].map(([key, aggregate]) => [key, buildMatrixAggregate(aggregate)]),
    ),
    columns: new Map(
      [...columns.entries()].map(([key, aggregate]) => [key, buildMatrixAggregate(aggregate)]),
    ),
    overall: buildMatrixAggregate(overall),
    rows: new Map(
      [...rows.entries()].map(([key, aggregate]) => [key, buildMatrixAggregate(aggregate)]),
    ),
  }
}

/** Preenche células que existem no payload `current` mas faltam nos registos agregados do live. */
export const mergeBbtipsMatrixStatsMissingCells = (
  primary: BbtipsMatrixStats,
  secondary: BbtipsMatrixStats,
): BbtipsMatrixStats => {
  const cells = new Map(primary.cells)
  for (const [key, aggregate] of secondary.cells) {
    if (!cells.has(key)) {
      cells.set(key, aggregate)
    }
  }
  return {
    cells,
    columns: primary.columns,
    rows: primary.rows,
    overall: primary.overall,
  }
}

const endpointPathByPlatform: Record<Platform, string> = {
  Betano: '/api/bbtips/betano/live',
  Bet365: '/api/bbtips/bet365/live',
  'Express 365': '/api/bbtips/express/live',
  PlayPix: '/api/bbtips/playpix/live',
}

const buildEndpointPath = (platform: Platform) =>
  endpointPathByPlatform[platform]

const livePayloadStoragePrefix = 'tigger-bbtips-live-payload-v1'
const livePayloadStorageMaxAgeMs = 30 * 60 * 1000
const inFlightLivePayloadByRequestMode = new Map<string, Promise<BbtipsLivePayload | null>>()
const liveRefreshMsByPlatform: Record<Platform, number> = {
  Betano: 2000,
  Bet365: 6000,
  'Express 365': 6000,
  PlayPix: 3000,
}
const hiddenLiveRefreshMsByPlatform: Record<Platform, number> = {
  Betano: 4000,
  Bet365: 15000,
  'Express 365': 15000,
  PlayPix: 6000,
}
const hiddenLiveRefreshFloorMs = 15000
const lowLatencyHiddenRefreshPlatforms = new Set<Platform>(['Betano', 'PlayPix'])

const buildLivePayloadRequestKey = (
  platform: Platform,
  requestedMarketKey: string,
  requestedPeriod: Period,
  requestedLeagueKey: string,
) => `${platform}:${requestedPeriod}:${requestedMarketKey}:${requestedLeagueKey}`

const buildCompatiblePayloadScopeKey = (platform: Platform, requestedLeagueKey: string) =>
  `${platform}:${requestedLeagueKey || '*'}`

const buildLivePayloadStorageKey = (requestKey: string) =>
  `${livePayloadStoragePrefix}:${encodeURIComponent(requestKey)}`

const readStoredLivePayload = (requestKey: string): BbtipsLivePayload | null => {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(buildLivePayloadStorageKey(requestKey))
    if (!raw) return null

    const entry = JSON.parse(raw) as { payload?: BbtipsLivePayload; savedAt?: number }
    if (!entry.payload || typeof entry.savedAt !== 'number') return null
    if (Date.now() - entry.savedAt > livePayloadStorageMaxAgeMs) return null
    if (!isBbtipsPayloadFreshEnough(entry.payload)) return null

    return entry.payload
  } catch {
    return null
  }
}

const writeStoredLivePayload = (requestKey: string, payload: BbtipsLivePayload) => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(
      buildLivePayloadStorageKey(requestKey),
      JSON.stringify({
        payload,
        savedAt: Date.now(),
      }),
    )
  } catch {
    // Local cache is an acceleration only; quota failures should not affect the matrix.
  }
}

const rememberCompatiblePayload = (
  platform: Platform,
  requestedLeagueKey: string,
  payload: BbtipsLivePayload | null | undefined,
) => {
  if (!payload || payload.platform !== platform) return
  if (!isBbtipsPayloadFreshEnough(payload)) return

  compatiblePayloadCacheByScopeKey.set(buildCompatiblePayloadScopeKey(platform, requestedLeagueKey), payload)
}

const readCompatiblePayload = (
  platform: Platform,
  requestedLeagueKey: string,
): BbtipsLivePayload | null => {
  const scopedPayload = compatiblePayloadCacheByScopeKey.get(
    buildCompatiblePayloadScopeKey(platform, requestedLeagueKey),
  )
  if (scopedPayload && isBbtipsPayloadFreshEnough(scopedPayload)) {
    return scopedPayload
  }

  const platformPayload = compatiblePayloadCacheByScopeKey.get(buildCompatiblePayloadScopeKey(platform, ''))
  if (platformPayload && isBbtipsPayloadFreshEnough(platformPayload)) {
    return platformPayload
  }

  return null
}

const normalizeRequestedMarketKey = (markets: Market[]) =>
  [...new Set(markets.filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .join('|')

const normalizeRequestedLeagueKey = (leagues: string[]) =>
  [...new Set(leagues.map((league) => league.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .join('|')

type FetchBbtipsLivePayloadOptions = {
  allowStaleCache?: boolean
  cacheOnly?: boolean
  preferCached?: boolean
}

const fetchBbtipsLivePayload = async (
  platform: Platform,
  requestedMarkets: Market[] = [],
  requestedPeriod: Period = '12h',
  requestedLeagues: string[] = [],
  options: FetchBbtipsLivePayloadOptions = {},
) : Promise<BbtipsLivePayload | null> => {
  const { allowStaleCache = false, cacheOnly = false, preferCached = false } = options
  const requestedMarketKey = normalizeRequestedMarketKey(requestedMarkets)
  const requestedLeagueKey = normalizeRequestedLeagueKey(requestedLeagues)
  const requestKey = buildLivePayloadRequestKey(
    platform,
    requestedMarketKey,
    requestedPeriod,
    requestedLeagueKey,
  )
  const cachedPayload =
    exactPayloadCacheByRequestKey.get(requestKey) ??
    readStoredLivePayload(requestKey)

  if (cachedPayload && isBbtipsPayloadFreshEnough(cachedPayload)) {
    exactPayloadCacheByRequestKey.set(requestKey, cachedPayload)
    if (preferCached) {
      return cachedPayload
    }
  }

  const inFlightKey = `${requestKey}:${cacheOnly ? (allowStaleCache ? 'cache-stale' : 'cache') : 'live'}`
  const inFlightRequest = inFlightLivePayloadByRequestMode.get(inFlightKey)
  if (inFlightRequest) {
    return inFlightRequest
  }

  const searchParams = new URLSearchParams()
  if (!cacheOnly) {
    searchParams.set('t', String(Date.now()))
  }
  if (requestedMarketKey) {
    searchParams.set('markets', requestedMarketKey)
  }
  searchParams.set('period', requestedPeriod)
  if (cacheOnly) {
    searchParams.set('cacheOnly', 'true')
    if (allowStaleCache) {
      searchParams.set('allowStale', 'true')
    }
  }
  if (requestedLeagueKey) {
    searchParams.set('leagues', requestedLeagueKey)
  }

  const requestPromise = (async () => {
    const response = await fetch(`${buildEndpointPath(platform)}?${searchParams.toString()}`)
    if (cacheOnly && response.status === 204) {
      return null
    }

    const rawResponse = await response.text()
    const nextPayload = rawResponse
      ? JSON.parse(rawResponse) as BbtipsLivePayload & { error?: string }
      : null

    if (!response.ok) {
      throw new Error((nextPayload as { error?: string } | null)?.error ?? 'Falha ao buscar dados reais')
    }

    if (!nextPayload) {
      return null
    }

    nextPayload.receivedAt ??= Date.now()

    const payloadIsFreshEnough = isBbtipsPayloadFreshEnough(nextPayload)
    if (!payloadIsFreshEnough) {
      exactPayloadCacheByRequestKey.delete(requestKey)
      throw new Error('Fonte BB Tips desatualizada. A data da matriz ficou antiga demais para exibir com seguranca.')
    }

    if (payloadIsFreshEnough) {
      exactPayloadCacheByRequestKey.set(requestKey, nextPayload)
      rememberCompatiblePayload(platform, requestedLeagueKey, nextPayload)
      writeStoredLivePayload(requestKey, nextPayload)
    }
    return nextPayload
  })()

  inFlightLivePayloadByRequestMode.set(inFlightKey, requestPromise)

  try {
    return await requestPromise
  } finally {
    inFlightLivePayloadByRequestMode.delete(inFlightKey)
  }
}

export const prefetchBbtipsLivePayload = async (
  platform: Platform,
  requestedMarkets: Market[] = [],
  requestedPeriod: Period = '12h',
  requestedLeagues: string[] = [],
  options: FetchBbtipsLivePayloadOptions = {},
) => {
  await fetchBbtipsLivePayload(
    platform,
    requestedMarkets,
    requestedPeriod,
    requestedLeagues,
    {
      cacheOnly: options.cacheOnly ?? true,
      preferCached: options.preferCached ?? true,
    },
  )
}

const summarizeBbtipsPayloadForRender = (payload: BbtipsPayload | null | undefined) => {
  const lines = payload?.Linhas ?? []
  const firstLine = lines[0]
  const lastLine = lines[lines.length - 1]
  const summarizeLine = (line: BbtipsLine | undefined) => {
    const columns = line?.Colunas ?? []
    const firstColumn = columns[0]
    const lastColumn = columns[columns.length - 1]

    return [
      line?.Hora ?? '',
      columns.length,
      firstColumn?.Id ?? firstColumn?.Horario ?? '',
      firstColumn?.Resultado ?? '',
      firstColumn?.Odds ?? firstColumn?.Odd ?? '',
      lastColumn?.Id ?? lastColumn?.Horario ?? '',
      lastColumn?.Resultado ?? '',
      lastColumn?.Odds ?? lastColumn?.Odd ?? '',
    ].join(',')
  }

  // compute a compact hash over all column ids and final-results so
  // that per-cell placar changes (even in middle columns) change the signature
  const computeDjb2Hash = (input: string) => {
    let h = 5381
    for (let i = 0; i < input.length; i++) {
      h = (h * 33) ^ input.charCodeAt(i)
      // keep in 32-bit range
      h = h >>> 0
    }
    return h.toString(36)
  }

  const columnsSignature = lines
    .flatMap((line) => (line?.Colunas ?? []).map((col) => `${col?.Id ?? col?.Horario ?? ''}:${col?.Resultado_FT ?? col?.Resultado ?? ''}`))
    .join('|')

  const compactHash = computeDjb2Hash(columnsSignature)

  return [
    payload?.DataAtualizacao ?? '',
    lines.length,
    payload?.Minutos?.length ?? 0,
    compactHash,
    summarizeLine(firstLine),
    summarizeLine(lastLine),
  ].join('|')
}

const buildBbtipsPayloadRenderSignature = (
  payload: BbtipsLivePayload,
  requestKey: string,
) =>
  [
    requestKey,
    payload.platform ?? '',
    payload.period ?? '',
    payload.source ?? '',
    payload.updatedAt ?? '',
    ...(payload.leagues ?? []).map((league) =>
      [
        league.key,
        summarizeBbtipsPayloadForRender(league.current),
        summarizeBbtipsPayloadForRender(league.future),
      ].join(':'),
    ),
  ].join('||')

const resolveBbtipsPayloadFreshTimestamp = (payload: BbtipsLivePayload | null | undefined) => {
  if (!payload) return null

  const candidates = [
    payload.receivedAt,
    payload.updatedAt,
    ...(payload.leagues ?? []).flatMap((league) => [
      getBbtipsPayloadAnchorTimestamp(league.current, Number.NaN),
      getBbtipsPayloadAnchorTimestamp(league.future, Number.NaN),
    ]),
  ]
    .filter((value): value is number => Number.isFinite(value))

  if (candidates.length === 0) return null
  return Math.max(...candidates)
}

const isBbtipsPayloadFreshEnough = (
  payload: BbtipsLivePayload | null | undefined,
  nowTimestamp = Date.now(),
  maxAgeMs?: number,
) => {
  const resolvedMaxAgeMs =
    maxAgeMs ??
    payloadFreshMaxAgeMsByPlatform[payload?.platform ?? 'Betano']
  const freshestTimestamp = resolveBbtipsPayloadFreshTimestamp(payload)
  if (freshestTimestamp === null || !Number.isFinite(freshestTimestamp)) return true
  return nowTimestamp - freshestTimestamp <= resolvedMaxAgeMs
}

export function useBbtipsLiveRecords(
  platform: Platform,
  enabled: boolean,
  requestedMarkets: Market[] = [],
  requestedPeriod: Period = '12h',
  requestedLeagues: string[] = [],
): LiveDataState {
  const [payload, setPayload] = useState<BbtipsLivePayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const mountedRef = useRef(true)
  const hasPayloadRef = useRef(false)
  const payloadSignatureRef = useRef('')
  const requestedMarketKey = useMemo(
    () => normalizeRequestedMarketKey(requestedMarkets),
    [requestedMarkets],
  )
  const requestedLeagueKey = useMemo(
    () => normalizeRequestedLeagueKey(requestedLeagues),
    [requestedLeagues],
  )
  const requestKey = buildLivePayloadRequestKey(
    platform,
    requestedMarketKey,
    requestedPeriod,
    requestedLeagueKey,
  )

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      hasPayloadRef.current = false
      payloadSignatureRef.current = ''
      setPayload(null)
      setUpdatedAt(null)
      setError(null)
      setLoading(false)
      return undefined
    }

    let cancelled = false
    let loadInFlight = false
    let pendingImmediateReload = false
    let refreshTimer: number | null = null
    const rawCachedPayloadForRequest =
      exactPayloadCacheByRequestKey.get(requestKey) ??
      readStoredLivePayload(requestKey) ??
      readCompatiblePayload(platform, requestedLeagueKey)
    if (rawCachedPayloadForRequest) {
      exactPayloadCacheByRequestKey.set(requestKey, rawCachedPayloadForRequest)
      rememberCompatiblePayload(platform, requestedLeagueKey, rawCachedPayloadForRequest)
    }
    const cachedPayloadForRequest = isBbtipsPayloadFreshEnough(rawCachedPayloadForRequest)
      ? rawCachedPayloadForRequest
      : null

    if (!cachedPayloadForRequest && rawCachedPayloadForRequest) {
      exactPayloadCacheByRequestKey.delete(requestKey)
    }

    hasPayloadRef.current = Boolean(cachedPayloadForRequest)
    payloadSignatureRef.current = cachedPayloadForRequest
      ? buildBbtipsPayloadRenderSignature(cachedPayloadForRequest, requestKey)
      : ''
    try {
      console.debug('[bbtips] initial cached signature', { requestKey, signature: payloadSignatureRef.current })
    } catch {}
    setPayload(cachedPayloadForRequest)
    setUpdatedAt(cachedPayloadForRequest?.updatedAt ?? null)

    setError(null)
    setLoading(!cachedPayloadForRequest)
    const liveRefreshMs = liveRefreshMsByPlatform[platform] ?? liveRefreshMsByPlatform.Betano
    const hiddenRefreshMs = lowLatencyHiddenRefreshPlatforms.has(platform)
      ? (hiddenLiveRefreshMsByPlatform[platform] ?? liveRefreshMs)
      : Math.max(
          liveRefreshMs * 2,
          hiddenLiveRefreshMsByPlatform[platform] ?? hiddenLiveRefreshFloorMs,
        )
    const clearRefreshTimer = () => {
      if (refreshTimer === null) return
      window.clearTimeout(refreshTimer)
      refreshTimer = null
    }
    const scheduleNextLoad = (delayMs: number) => {
      clearRefreshTimer()
      if (cancelled) return

      refreshTimer = window.setTimeout(() => {
        void load()
      }, delayMs)
    }

    const load = async () => {
      if (cancelled) return
      if (loadInFlight) {
        pendingImmediateReload = true
        return
      }

      pendingImmediateReload = false
      loadInFlight = true
      if (!hasPayloadRef.current && !cancelled && mountedRef.current) {
        setLoading(true)
      }

      try {
        if (!hasPayloadRef.current) {
          const cachedServerPayload = await fetchBbtipsLivePayload(
            platform,
            requestedMarkets,
            requestedPeriod,
            requestedLeagues,
            {
              allowStaleCache: true,
              cacheOnly: true,
              preferCached: false,
            },
          ).catch(() => null)

          if (cachedServerPayload && !cancelled && mountedRef.current) {
            const cachedServerSignature = buildBbtipsPayloadRenderSignature(cachedServerPayload, requestKey)
            payloadSignatureRef.current = cachedServerSignature
            hasPayloadRef.current = true
            rememberCompatiblePayload(platform, requestedLeagueKey, cachedServerPayload)
            setPayload(cachedServerPayload)
            setUpdatedAt(cachedServerPayload.updatedAt ?? null)
            setError(null)
          }
        }

        const nextPayload = await fetchBbtipsLivePayload(
          platform,
          requestedMarkets,
          requestedPeriod,
          requestedLeagues,
          {
            cacheOnly: false,
            preferCached: false,
          },
        )

        if (!nextPayload) {
          if (!cancelled && mountedRef.current) {
            if (!hasPayloadRef.current) {
              const compatiblePayload = readCompatiblePayload(platform, requestedLeagueKey)
              if (compatiblePayload) {
                payloadSignatureRef.current = buildBbtipsPayloadRenderSignature(compatiblePayload, requestKey)
                hasPayloadRef.current = true
                setPayload(compatiblePayload)
                setUpdatedAt(compatiblePayload.updatedAt ?? null)
              } else {
                setPayload(null)
                setUpdatedAt(null)
              }
            }
            setError(null)
          }
          return
        }

        if (!cancelled && mountedRef.current) {
          const nextSignature = buildBbtipsPayloadRenderSignature(nextPayload, requestKey)
          try {
            console.debug('[bbtips] fetched payload signature', {
              requestKey,
              old: payloadSignatureRef.current,
              next: nextSignature,
              updatedAt: nextPayload?.updatedAt,
            })
          } catch {}

          if (payloadSignatureRef.current === nextSignature) {
            try {
              console.debug('[bbtips] signature unchanged — skipping setPayload', { requestKey })
            } catch {}
            setError(null)
            return
          }

          payloadSignatureRef.current = nextSignature
          hasPayloadRef.current = true
          rememberCompatiblePayload(platform, requestedLeagueKey, nextPayload)
          setPayload(nextPayload)
          setUpdatedAt((current) => {
            const nextUpdatedAt = nextPayload.updatedAt ?? Date.now()
            return current === nextUpdatedAt ? current : nextUpdatedAt
          })
          setError(null)
        }
      } catch (nextError) {
        if (!cancelled && mountedRef.current) {
          if (!hasPayloadRef.current) {
            setPayload(null)
            setUpdatedAt(null)
            setError(nextError instanceof Error ? nextError.message : String(nextError))
          } else {
            setError(null)
          }
        }
      } finally {
        loadInFlight = false
        if (!cancelled && mountedRef.current) {
          setLoading(false)
        }
        const shouldReloadImmediately =
          pendingImmediateReload &&
          typeof document !== 'undefined' &&
          !document.hidden

        if (shouldReloadImmediately) {
          scheduleNextLoad(0)
          return
        }

        scheduleNextLoad(typeof document !== 'undefined' && document.hidden ? hiddenRefreshMs : liveRefreshMs)
      }
    }

    void load()

    const handleVisibilityChange = () => {
      if (document.hidden) {
        scheduleNextLoad(hiddenRefreshMs)
        return
      }

      pendingImmediateReload = true
      void load()
    }
    const handleWindowFocus = () => {
      pendingImmediateReload = true
      void load()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      cancelled = true
      clearRefreshTimer()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [enabled, platform, requestedLeagueKey, requestedMarketKey, requestedPeriod, requestKey])

  const records = useMemo(
    () => (payload && (!payload.platform || payload.platform === platform) ? normalizeLivePayload(platform, payload) : []),
    [payload, platform],
  )

  return {
    payload,
    records,
    loading,
    error,
    updatedAt,
  }
}

export const useBbtipsBet365Records = (enabled: boolean) =>
  useBbtipsLiveRecords('Bet365', enabled)
