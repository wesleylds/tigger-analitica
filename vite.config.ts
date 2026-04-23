import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { bbtipsLeagueCatalogByPlatform, type BbtipsLeagueCatalogEntry } from './src/data/bbtipsCatalog'
import type { Market, Period } from './src/types'

interface BbtipsEnv {
  BBTIPS_ACCESS_TOKEN?: string
  BBTIPS_CHANNEL?: string
  BBTIPS_EMAIL?: string
  BBTIPS_ENABLE_BACKGROUND_WARMUP?: string
  BBTIPS_ENABLE_BROWSER_FALLBACK?: string
  BBTIPS_ENABLE_RENDERED_MATRIX_META?: string
  BBTIPS_HEADLESS?: string
  BBTIPS_INCLUDE_DIAGNOSTICS?: string
  BBTIPS_INCLUDE_LEGACY_ODDS?: string
  BBTIPS_PASSWORD?: string
}

type BbtipsPlatform = 'Betano' | 'Bet365' | 'Express 365' | 'PlayPix'

interface BbtipsEndpointSpec {
  key: string
  market?: Market
  platform: BbtipsPlatform
  url: string
}

interface BbtipsRequestedMarket {
  code: string
  market: Market
}

const normalizeBbtipsLeagueToken = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

interface BbtipsEndpointResult {
  transport?: 'browser' | 'node'
  error?: string
  ok: boolean
  parsed: unknown | null
  status: number
  textPreview?: string
}

type BbtipsHotValidationStatus = 'idle' | 'ok' | 'rejected' | 'error'

interface BbtipsHotLeagueStatus {
  consecutiveFailures: number
  freshnessMs: number | null
  lastError: string | null
  lastObservedUpstreamAt: string | null
  lastPublishedUpdatedAt: number | null
  lastSuccessfulSyncAt: number | null
  staleReason: string | null
  validatedAt: number | null
  validationStatus: BbtipsHotValidationStatus
}

interface BbtipsLivePlatformPayload {
  diagnostics?: Record<string, unknown>
  leagues: Array<{
    current: BbtipsRawPayload | null
    future: BbtipsRawPayload | null
    id: number
    image: string
    key: string
    name: string
    sub: string
  }>
  period: Period
  platform: BbtipsPlatform
  source: 'live' | 'cache'
  updatedAt: number
}

interface BbtipsCacheEntry {
  expiresAt: number
  payload: BbtipsLivePlatformPayload
}

type BbtipsLeagueSpec = BbtipsLeagueCatalogEntry

interface BbtipsPlatformConfig {
  buildCurrentUrl: (leagueId: number, period: Period, filterCode?: string) => string
  buildFutureUrl?: (leagueId: number, period: Period, filterCode?: string) => string
  buildLegacyCurrentUrl?: (leagueId: number, period: Period, filterCode?: string) => string
  buildLegacyFutureUrl?: (leagueId: number, period: Period, filterCode?: string) => string
  pageUrl: string
  route: string
}

interface BbtipsRawColumn {
  Colunas?: BbtipsRawColumn[]
  Hora?: string | number
  Horario?: string | number
  Id?: string | number
  Minuto?: string | number
  Odd?: string | number | null
  OddsByMarket?: Record<string, string | number | null | undefined>
  Odds_Formatada?: Array<{ Odd?: string | number | null }>
  Odds?: string | null
  Resultado?: string | number | null
  Resultado_FT?: string | number | null
  Resultado_HT_Odd?: string | number | null
  SiglaA?: string | null
  SiglaB?: string | null
  TimeA?: string | null
  TimeB?: string | null
  Viradinha?: boolean | null
}

interface BbtipsRawLine {
  Colunas?: BbtipsRawColumn[]
  Hora?: string | number
}

interface BbtipsRawPayload {
  DataAtualizacao?: string
  Linhas?: BbtipsRawLine[]
  Minutos?: Array<{ Numero?: string | number }>
}

interface BbtipsRenderedMatrixMeta {
  currentRowHours: number[]
  futureRowHours: number[]
  minuteSlots: number[]
}

const bbtipsClientCacheTtlMsByPlatform: Record<BbtipsPlatform, number> = {
  Betano: 2_000,
  Bet365: 20_000,
  'Express 365': 20_000,
  PlayPix: 3_000,
}
const bbtipsRequestTimeoutMs = 20_000
const bbtipsRequestTimeoutMsByPlatform: Partial<Record<BbtipsPlatform, number>> = {
  Betano: 3_000,
  Bet365: 4_000,
  'Express 365': 4_000,
  PlayPix: 3_000,
}
const bbtipsRequestMaxAttemptsByPlatform: Partial<Record<BbtipsPlatform, number>> = {
  Betano: 1,
  Bet365: 1,
  'Express 365': 1,
  PlayPix: 1,
}
const bbtipsBrowserWarmupMs = 350
const bbtipsBrowserReadyTimeoutMs = 25_000
const bbtipsBrowserReadyPollMs = 1_000
const bbtipsBrowserAppUrl = 'https://app.bbtips.com.br/futebol/horarios'
const bbtipsBrowserBatchSize = 16
const bbtipsBrowserBatchDelayMs = 250
const bbtipsBrowserHeadless = process.env.BBTIPS_HEADLESS?.trim() === 'true'
const bbtipsBrowserRequestTimeoutMs = 30_000
const bbtipsPayloadSyncMaxDriftMsByPlatform: Record<BbtipsPlatform, number> = {
  Betano: 5 * 60 * 1000,
  Bet365: 5 * 60 * 1000,
  'Express 365': 5 * 60 * 1000,
  PlayPix: 5 * 60 * 1000,
}
const bbtipsMatrixRenderWaitMs = 1_500
const bbtipsSilentBrowserFallbackPlatforms = new Set<BbtipsPlatform>()
const bbtipsBrowserPrimaryPlatforms = new Set<BbtipsPlatform>(['Betano'])
const bbtipsHotWorkerPlatforms = new Set<BbtipsPlatform>([
  'Betano',
  'Bet365',
  'Express 365',
  'PlayPix',
])
const bbtipsSkipTimestampProbePlatforms = new Set<BbtipsPlatform>()
const bbtipsHotWorkerCadenceMsByPlatform: Partial<Record<BbtipsPlatform, number>> = {
  Betano: 4_000,
  Bet365: 10_000,
  'Express 365': 10_000,
  PlayPix: 7_000,
}
const bbtipsHotPriorityRefreshMaxAgeMsByPlatform: Partial<Record<BbtipsPlatform, number>> = {
  Bet365: 90_000,
  'Express 365': 90_000,
  PlayPix: 75_000,
}
const bbtipsHotPriorityRefreshWaitMsByPlatform: Partial<Record<BbtipsPlatform, number>> = {
  PlayPix: 500,
}
const bbtipsHotWorkerRefreshBatchSizeByPlatform: Partial<Record<BbtipsPlatform, number>> = {
  Betano: 10,
  Bet365: 5,
  'Express 365': 3,
  PlayPix: 5,
}

const normalizeBbtipsMarketName = (market: string) =>
  market
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

const bbtipsMarketFilterEntries: Array<[Market, string]> = [
  ['Ambas Marcam Sim', 'ambs'],
  ['Ambas Marcam Nao', 'ambn'],
  ['Ambas Marcam Não', 'ambn'],
  ['Ambas Marcam N?o', 'ambn'],
  ['Ambas Marcam NÃ£o', 'ambn'],
  ['Ambas Marcam NĂŁo', 'ambn'],
  ['Over 0.5', 'o05'],
  ['Over 1.5', 'o15'],
  ['Over 2.5', 'o25'],
  ['Over 3.5', 'o35'],
  ['Under 0.5', 'u05'],
  ['Under 1.5', 'u15'],
  ['Under 2.5', 'u25'],
  ['Under 3.5', 'u35'],
  ['0 gols FT', 'ge0'],
  ['1 gol FT', 'ge1'],
  ['1 gols FT', 'ge1'],
  ['2 gols FT', 'ge2'],
  ['3 gols FT', 'ge3'],
  ['4 gols FT', 'ge4'],
  ['5 gols FT', 'ge5'],
  ['Viradinha', 'vira'],
]

const bbtipsMarketFilterCodeByMarket = new Map(
  bbtipsMarketFilterEntries.map(([market, code]) => [normalizeBbtipsMarketName(market), code]),
)

const getBbtipsMarketFilterCode = (market: Market) => {
  const exactScoreMatch = market.trim().match(/^(\d+)x(\d+)$/)
  if (exactScoreMatch) {
    return `ft${exactScoreMatch[1]}${exactScoreMatch[2]}`
  }

  return bbtipsMarketFilterCodeByMarket.get(normalizeBbtipsMarketName(market)) ?? null
}

const normalizeRequestedBbtipsMarkets = (markets: string[]) => {
  const seenCodes = new Set<string>()
  const requestedMarkets: BbtipsRequestedMarket[] = []

  markets.forEach((rawMarket) => {
    const market = rawMarket.trim()
    if (!market || market === 'Selecione as Odds') return

    const code = getBbtipsMarketFilterCode(market)
    if (!code || seenCodes.has(code)) return

    seenCodes.add(code)
    requestedMarkets.push({
      code,
      market,
    })
  })

  return requestedMarkets
}

const normalizeRequestedBbtipsLeagues = (
  platform: BbtipsPlatform,
  leagues: string[],
) => {
  const normalizedTokens = new Set(
    leagues
      .map((league) => normalizeBbtipsLeagueToken(String(league ?? '')))
      .filter(Boolean),
  )

  if (normalizedTokens.size === 0) {
    return bbtipsLeagueSpecsByPlatform[platform]
  }

  const filteredLeagues = bbtipsLeagueSpecsByPlatform[platform].filter((league) =>
    getBbtipsLeagueTabLabels(platform, league).some((label) =>
      normalizedTokens.has(normalizeBbtipsLeagueToken(label)),
    ),
  )

  return filteredLeagues
}

const allowedBbtipsPeriods: Period[] = [
  '6h',
  '12h',
  '18h',
  '24h',
  '36h',
  '48h',
  '60h',
  '72h',
  '96h',
  '120h',
  '144h',
  '168h',
  '192h',
  '216h',
  '240h',
]

const normalizeRequestedBbtipsPeriod = (period: string | null | undefined): Period => {
  const normalized = String(period ?? '').trim() as Period
  return allowedBbtipsPeriods.includes(normalized) ? normalized : '12h'
}

const toBbtipsHorasParam = (period: Period) => `Horas${period.replace(/h$/i, '')}`

const bbtipsReliableUpstreamPeriods: Period[] = [
  '6h',
  '12h',
  '24h',
  '48h',
  '72h',
  '96h',
  '120h',
  '144h',
  '168h',
  '192h',
  '216h',
  '240h',
]

const getPeriodHours = (period: Period) => Number(period.replace(/h$/i, '')) || 12

const resolveBbtipsUpstreamPeriod = (requestedPeriod: Period, platform: BbtipsPlatform) => {
  const requestedHours = getPeriodHours(requestedPeriod)
  const minimumHours =
    platform === 'Bet365' || platform === 'Express 365'
      ? 24
      : platform === 'Betano' && requestedHours > 12 && requestedHours <= 24
        ? 48
        : requestedHours
  const targetHours = Math.max(requestedHours, minimumHours)
  return bbtipsReliableUpstreamPeriods.find((period) => getPeriodHours(period) >= targetHours) ?? '240h'
}

const buildBbtipsBet365GridUrl = (leagueId: number, future: boolean, period: Period, filterCode = '') =>
  `https://api.bbtips.com.br/api/futebolvirtual?liga=${leagueId}&futuro=${future ? 'true' : 'false'}&Horas=${toBbtipsHorasParam(period)}&tipoOdd=&dadosAlteracao=&filtros=${encodeURIComponent(filterCode)}&confrontos=false&hrsConfrontos=240`

const buildBbtipsBet365LegacyGridUrl = (leagueId: number, future: boolean, period: Period, filterCode = '') =>
  `https://api.bbtips.com.br/api/futebolvirtual/old?liga=${leagueId}&futuro=${future ? 'true' : 'false'}&Horas=${toBbtipsHorasParam(period)}&tipoOdd=&dadosAlteracao=&filtros=${encodeURIComponent(filterCode)}&confrontos=false&hrsConfrontos=240`

const buildBbtipsBetanoGridUrl = (leagueId: number, period: Period, filterCode = '') =>
  `https://api.bbtips.com.br/api/betanoFutebolVirtual?liga=${leagueId}&Horas=${toBbtipsHorasParam(period)}&dadosAlteracao=&filtros=${encodeURIComponent(filterCode)}`

const buildBbtipsPlayPixGridUrl = (leagueId: number, period: Period, filterCode = '') =>
  `https://api.bbtips.com.br/api/playpixFutebolVirtual?liga=${leagueId}&Horas=${toBbtipsHorasParam(period)}&dadosAlteracao=&filtros=${encodeURIComponent(filterCode)}`

const buildBbtipsBetanoUpdatedAtUrl = (leagueId: number) =>
  `https://api.bbtips.com.br/api/betanoFutebolVirtual/ultimaAtualizacao?liga=${leagueId}`

const buildBbtipsPlayPixUpdatedAtUrl = (leagueId: number) =>
  `https://api.bbtips.com.br/api/playpixFutebolVirtual/ultimaAtualizacao?liga=${leagueId}`

const buildBbtipsUpdatedAtUrl = (platform: BbtipsPlatform, leagueId: number) => {
  switch (platform) {
    case 'Betano':
      return buildBbtipsBetanoUpdatedAtUrl(leagueId)
    case 'PlayPix':
      return buildBbtipsPlayPixUpdatedAtUrl(leagueId)
    default:
      return null
  }
}

const bbtipsPlatformConfigByPlatform: Record<BbtipsPlatform, BbtipsPlatformConfig> = {
  Bet365: {
    buildCurrentUrl: (leagueId, period, oddCode) => buildBbtipsBet365GridUrl(leagueId, false, period, oddCode),
    buildFutureUrl: (leagueId, period, oddCode) => buildBbtipsBet365GridUrl(leagueId, true, period, oddCode),
    buildLegacyCurrentUrl: (leagueId, period, oddCode) => buildBbtipsBet365LegacyGridUrl(leagueId, false, period, oddCode),
    buildLegacyFutureUrl: (leagueId, period, oddCode) => buildBbtipsBet365LegacyGridUrl(leagueId, true, period, oddCode),
    pageUrl: 'https://app.bbtips.com.br/futebol/horarios',
    route: '/api/bbtips/bet365/live',
  },
  'Express 365': {
    buildCurrentUrl: (leagueId, period, oddCode) => buildBbtipsBet365GridUrl(leagueId, false, period, oddCode),
    buildFutureUrl: (leagueId, period, oddCode) => buildBbtipsBet365GridUrl(leagueId, true, period, oddCode),
    pageUrl: 'https://app.bbtips.com.br/futebol/horarios',
    route: '/api/bbtips/express/live',
  },
  Betano: {
    buildCurrentUrl: buildBbtipsBetanoGridUrl,
    pageUrl: 'https://app.bbtips.com.br/betano/futebol/horarios',
    route: '/api/bbtips/betano/live',
  },
  PlayPix: {
    buildCurrentUrl: buildBbtipsPlayPixGridUrl,
    pageUrl: 'https://app.bbtips.com.br/playpix/futebol/horarios',
    route: '/api/bbtips/playpix/live',
  },
}

const getBbtipsLeagueTabLabels = (platform: BbtipsPlatform, league: BbtipsLeagueSpec) => {
  const manualLabelsByPlatform: Partial<Record<BbtipsPlatform, Record<string, string[]>>> = {
    Betano: {
      america: ['America'],
      british: ['British'],
      campeoes: ['Campeoes', 'Campeões'],
      classicos: ['Classicos', 'Clássicos'],
      copa: ['Copa'],
      espanhola: ['Espanhola'],
      estrelas: ['Estrelas'],
      euro: ['Euro'],
      italiano: ['Italiano'],
      scudetto: ['Scudetto'],
    },
    Bet365: {
      copa: ['Copa'],
      euro: ['Euro'],
      premier: ['Premier'],
      super: ['Super'],
    },
    'Express 365': {
      express: ['Express'],
    },
    PlayPix: {
      bra: ['BRA'],
      eng: ['ENG'],
      ita: ['ITA'],
      lat: ['LAT'],
      spa: ['SPA'],
    },
  }

  const manualLabels = manualLabelsByPlatform[platform]?.[league.key] ?? []
  const aliasLabels = (league.subAliases ?? []).map((alias) => alias.trim()).filter(Boolean)

  return Array.from(
    new Set(
      [
        ...manualLabels,
        league.name,
        league.key,
        league.sub,
        league.champParam,
        ...aliasLabels,
      ]
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  )
}

const buildSyntheticBbtipsAnchorIso = (hour: number, minute = 0) => {
  const referenceDate = new Date()
  const year = referenceDate.getFullYear()
  const month = String(referenceDate.getMonth() + 1).padStart(2, '0')
  const day = String(referenceDate.getDate()).padStart(2, '0')
  const normalizedHour = String(Math.max(0, Math.min(23, Math.trunc(hour)))).padStart(2, '0')
  const normalizedMinute = String(Math.max(0, Math.min(59, Math.trunc(minute)))).padStart(2, '0')

  return `${year}-${month}-${day}T${normalizedHour}:${normalizedMinute}:00-03:00`
}

const parseBbtipsTimestamp = (rawValue: string | null | undefined) => {
  const normalizedValue = String(rawValue ?? '').trim()
  if (!normalizedValue) return Number.NaN

  const localSaoPauloMatch = normalizedValue.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
  )
  if (localSaoPauloMatch) {
    return Date.UTC(
      Number(localSaoPauloMatch[1]),
      Number(localSaoPauloMatch[2]) - 1,
      Number(localSaoPauloMatch[3]),
      Number(localSaoPauloMatch[4]) + 3,
      Number(localSaoPauloMatch[5]),
      Number(localSaoPauloMatch[6] ?? 0),
      Number(String(localSaoPauloMatch[7] ?? '0').padEnd(3, '0')),
    )
  }

  return Date.parse(normalizedValue)
}

const stampBbtipsPayloadWithRenderedMatrix = (
  payload: BbtipsRawPayload | null | undefined,
  rowHours: number[],
  minuteSlots: number[],
  anchorHour?: number,
) => {
  if (!payload) return null

  const normalizedMinuteSlots = minuteSlots
    .map((minute) => Math.max(0, Math.min(59, Math.trunc(minute))))
    .filter((minute) => Number.isFinite(minute))
  const nextMinutes =
    normalizedMinuteSlots.length > 0
      ? normalizedMinuteSlots
      : (payload.Minutos ?? [])
          .map((entry) => Number(entry?.Numero))
          .filter((minute) => Number.isFinite(minute))

  const nextLines = (payload.Linhas ?? []).map((line, lineIndex) => {
    const renderedHour = rowHours[lineIndex]
    const nextHour =
      Number.isFinite(renderedHour)
        ? Math.max(0, Math.min(23, Math.trunc(renderedHour)))
        : line.Hora

    const nextColumns = (line.Colunas ?? []).map((column) => ({
      ...column,
      Hora: nextHour,
    }))

    return {
      ...line,
      Hora: nextHour,
      Colunas: nextColumns,
    }
  })

  return {
    ...payload,
    DataAtualizacao:
      Number.isFinite(anchorHour)
        ? buildSyntheticBbtipsAnchorIso(Number(anchorHour))
        : payload.DataAtualizacao,
    Linhas: nextLines,
    Minutos: nextMinutes.map((minute) => ({ Numero: minute })),
  } satisfies BbtipsRawPayload
}

const isValidRenderedCurrentHourSequence = (hours: number[]) =>
  hours.length > 0 &&
  hours.every((hour, index) => {
    if (index === 0) return Number.isFinite(hour)
    const previousHour = hours[index - 1]
    const delta = (previousHour - hour + 24) % 24
    return delta === 1
  })

const isValidRenderedFutureHourSequence = (hours: number[]) =>
  hours.length > 0 &&
  hours.every((hour, index) => {
    if (index === 0) return Number.isFinite(hour)
    const previousHour = hours[index - 1]
    const delta = (hour - previousHour + 24) % 24
    return delta >= 1 && delta <= 6
  })

const bbtipsLeagueSpecsByPlatform: Record<BbtipsPlatform, BbtipsLeagueSpec[]> = {
  Bet365: bbtipsLeagueCatalogByPlatform.Bet365,
  'Express 365': bbtipsLeagueCatalogByPlatform['Express 365'],
  Betano: bbtipsLeagueCatalogByPlatform.Betano,
  PlayPix: bbtipsLeagueCatalogByPlatform.PlayPix,
}

const resolvedScorePattern = /^(\d+)\s*-\s*(\d+)$/

const isRejectedBbtipsPayload = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return false

  const typedPayload = payload as { status?: unknown; title?: unknown; type?: unknown }
  const title = String(typedPayload.title ?? '').toLowerCase()
  const type = String(typedPayload.type ?? '').toLowerCase()
  const status = typeof typedPayload.status === 'number'
    ? typedPayload.status
    : Number(typedPayload.status)

  return (
    status === 401 ||
    status === 403 ||
    title.includes('unauthorized') ||
    title.includes('forbidden') ||
    type.includes('rfc7235')
  )
}

const hasResolvedBbtipsScore = (column: BbtipsRawColumn) =>
  resolvedScorePattern.test(
    String(column.Resultado_FT ?? column.Resultado ?? '')
      .replace(/\+/g, '')
      .trim(),
  )

const filterBbtipsPayloadByResolution = (
  payload: unknown,
  includeResolvedColumns: boolean,
): BbtipsRawPayload | null => {
  if (!payload || typeof payload !== 'object') return null

  const typedPayload = payload as BbtipsRawPayload
  if (isRejectedBbtipsPayload(typedPayload) || !Array.isArray(typedPayload.Linhas)) return null

  const nextLines = (typedPayload.Linhas ?? [])
    .map((line) => ({
      ...line,
      Colunas: (line.Colunas ?? []).filter((column) =>
        includeResolvedColumns ? hasResolvedBbtipsScore(column) : !hasResolvedBbtipsScore(column),
      ),
    }))
    .filter((line) => (line.Colunas ?? []).length > 0)

  return {
    ...typedPayload,
    Linhas: nextLines,
  }
}

const hasMeaningfulBbtipsValue = (value: unknown) => {
  if (value === null || value === undefined) return false

  if (typeof value === 'string') {
    return value.split(String.fromCharCode(0)).join('').trim().length > 0
  }

  return true
}

const hasBbtipsTeams = (column: BbtipsRawColumn) =>
  Boolean(String(column.TimeA ?? column.SiglaA ?? '').trim() && String(column.TimeB ?? column.SiglaB ?? '').trim())

const isBbtipsPlaceholderColumn = (column: BbtipsRawColumn) =>
  !hasBbtipsTeams(column) && !hasMeaningfulBbtipsValue(column.Resultado_FT ?? column.Resultado)

const buildBbtipsColumnIdentity = (column: BbtipsRawColumn) => {
  const rawId = String(column.Id ?? '').trim()
  if (rawId) return `id:${rawId}`

  return [
    String(column.Horario ?? '').trim(),
    String(column.Hora ?? '').trim(),
    String(column.Minuto ?? '').trim(),
    String(column.TimeA ?? column.SiglaA ?? '').trim(),
    String(column.TimeB ?? column.SiglaB ?? '').trim(),
  ].join('|')
}

const getBbtipsRawColumnHour = (line: BbtipsRawLine, column: BbtipsRawColumn) => {
  const directHour = Number(column.Hora ?? line.Hora)
  if (Number.isFinite(directHour)) {
    return String(Math.max(0, Math.min(23, Math.trunc(directHour)))).padStart(2, '0')
  }

  const horarioMatch = String(column.Horario ?? '')
    .trim()
    .match(/^(\d{1,2})[.:]/)
  if (!horarioMatch) return '00'

  const parsedHour = Number(horarioMatch[1])
  return Number.isFinite(parsedHour)
    ? String(Math.max(0, Math.min(23, Math.trunc(parsedHour)))).padStart(2, '0')
    : '00'
}

const getBbtipsRawColumnMinute = (column: BbtipsRawColumn) => {
  const directMinute = Number(column.Minuto)
  if (Number.isFinite(directMinute)) {
    return String(Math.max(0, Math.min(59, Math.trunc(directMinute)))).padStart(2, '0')
  }

  const horarioMatch = String(column.Horario ?? '')
    .trim()
    .match(/[.:](\d{2})$/)
  if (!horarioMatch) return '00'

  const parsedMinute = Number(horarioMatch[1])
  return Number.isFinite(parsedMinute)
    ? String(Math.max(0, Math.min(59, Math.trunc(parsedMinute)))).padStart(2, '0')
    : '00'
}

const buildBbtipsRawSlotIdentity = (line: BbtipsRawLine, column: BbtipsRawColumn) =>
  `${getBbtipsRawColumnHour(line, column)}:${getBbtipsRawColumnMinute(column)}`

const getBbtipsRawColumnCompletenessScore = (column: BbtipsRawColumn) => {
  let score = 0

  if (hasBbtipsTeams(column)) score += 10
  if (hasMeaningfulBbtipsValue(column.Resultado_FT ?? column.Resultado)) score += 8
  if (hasMeaningfulBbtipsValue(column.Resultado_HT_Odd)) score += 2
  if (hasMeaningfulBbtipsValue(column.Odd) || hasMeaningfulBbtipsValue(column.Odds)) score += 2
  if (hasMeaningfulBbtipsValue(column.Id)) score += 1

  return score
}

const pickPreferredBbtipsRawColumn = (
  primary: BbtipsRawColumn | null | undefined,
  fallback: BbtipsRawColumn | null | undefined,
) => {
  if (!primary) return fallback ?? null
  if (!fallback) return primary

  const primaryScore = getBbtipsRawColumnCompletenessScore(primary)
  const fallbackScore = getBbtipsRawColumnCompletenessScore(fallback)

  if (primaryScore !== fallbackScore) {
    return fallbackScore > primaryScore ? fallback : primary
  }

  return primary
}

const getRenderableBbtipsPayloadColumnCount = (payload: BbtipsRawPayload | null | undefined) =>
  (payload?.Linhas ?? []).reduce(
    (sum, line) => sum + (line.Colunas ?? []).filter((column) => !isBbtipsPlaceholderColumn(column)).length,
    0,
  )

const mergeBbtipsPayloadWithFallback = (
  primary: BbtipsRawPayload | null | undefined,
  fallback: BbtipsRawPayload | null | undefined,
) => {
  if (!primary) return fallback ?? null
  if (!fallback) return primary

  const fallbackColumnsBySlot = new Map<string, BbtipsRawColumn>()
  ;(fallback.Linhas ?? []).forEach((line) => {
    ;(line.Colunas ?? []).forEach((column) => {
      fallbackColumnsBySlot.set(buildBbtipsRawSlotIdentity(line, column), column)
    })
  })

  return {
    ...primary,
    DataAtualizacao: primary.DataAtualizacao ?? fallback.DataAtualizacao,
    Minutos: (primary.Minutos?.length ?? 0) > 0 ? primary.Minutos : fallback.Minutos,
    Linhas: (primary.Linhas ?? []).map((line) => ({
      ...line,
      Colunas: (line.Colunas ?? []).map((column) =>
        pickPreferredBbtipsRawColumn(
          column,
          fallbackColumnsBySlot.get(buildBbtipsRawSlotIdentity(line, column)),
        ) ?? column,
      ),
    })),
  }
}

const stabilizeBbtipsPayload = (
  primary: BbtipsRawPayload | null | undefined,
  fallback: BbtipsRawPayload | null | undefined,
) => {
  if (!primary) return fallback ?? null
  if (!fallback) return primary

  const primaryRenderableCount = getRenderableBbtipsPayloadColumnCount(primary)
  const fallbackRenderableCount = getRenderableBbtipsPayloadColumnCount(fallback)

  if (primaryRenderableCount === 0 && fallbackRenderableCount > 0) {
    return fallback
  }

  if (
    primaryRenderableCount > 0 &&
    fallbackRenderableCount > 0 &&
    primaryRenderableCount < Math.max(4, Math.floor(fallbackRenderableCount * 0.6))
  ) {
    return fallback
  }

  return mergeBbtipsPayloadWithFallback(primary, fallback)
}

const mergeBbtipsPayloadWithLegacyOdds = (
  payload: BbtipsRawPayload | null | undefined,
  legacyPayload: BbtipsRawPayload | null | undefined,
) => {
  if (!payload) return legacyPayload ?? null
  if (!legacyPayload) return payload

  const legacyColumnsByIdentity = new Map<string, BbtipsRawColumn>()

  ;(legacyPayload.Linhas ?? []).forEach((line) => {
    ;(line.Colunas ?? []).forEach((column) => {
      legacyColumnsByIdentity.set(buildBbtipsColumnIdentity(column), column)
    })
  })

  return {
    ...payload,
    Linhas: (payload.Linhas ?? []).map((line) => ({
      ...line,
      Colunas: (line.Colunas ?? []).map((column) => {
        const legacyColumn = legacyColumnsByIdentity.get(buildBbtipsColumnIdentity(column))

        if (!legacyColumn) {
          return column
        }

        return {
          ...legacyColumn,
          ...column,
          Odd: hasMeaningfulBbtipsValue(column.Odd) ? column.Odd : legacyColumn.Odd,
          Odds: hasMeaningfulBbtipsValue(column.Odds) ? column.Odds : legacyColumn.Odds,
          Resultado_HT_Odd: hasMeaningfulBbtipsValue(column.Resultado_HT_Odd)
            ? column.Resultado_HT_Odd
            : legacyColumn.Resultado_HT_Odd,
        }
      }),
    })),
  }
}

const parseBbtipsOddValue = (value: unknown) => {
  if (value === null || value === undefined) return null

  const match = String(value)
    .replace(',', '.')
    .match(/@?\s*([0-9]+(?:\.[0-9]+)?)/)
  if (!match) return null

  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? match[1] : null
}

const extractBbtipsMarketOddFromColumn = (column: BbtipsRawColumn) => {
  const directOdd = parseBbtipsOddValue(column.Odd)
  if (directOdd) return directOdd

  const formattedOdd = (column.Odds_Formatada ?? [])
    .map((item) => parseBbtipsOddValue(item.Odd))
    .find((value): value is string => Boolean(value))
  if (formattedOdd) return formattedOdd

  const rawOdds = String(column.Odds ?? '').trim()
  if (!rawOdds || (rawOdds.includes('|') && !/[;=@]/.test(rawOdds))) return null

  return parseBbtipsOddValue(rawOdds)
}

const mergeBbtipsPayloadWithMarketOdds = (
  payload: BbtipsRawPayload | null | undefined,
  oddsPayload: BbtipsRawPayload | null | undefined,
  market: Market,
) => {
  if (!oddsPayload) return payload ?? null

  const oddsByIdentity = new Map<string, string>()

  ;(oddsPayload.Linhas ?? []).forEach((line) => {
    ;(line.Colunas ?? []).forEach((column) => {
      const odd = extractBbtipsMarketOddFromColumn(column)
      if (odd) {
        oddsByIdentity.set(buildBbtipsColumnIdentity(column), odd)
      }
    })
  })

  const sourcePayload = payload ?? oddsPayload

  return {
    ...sourcePayload,
    Linhas: (sourcePayload.Linhas ?? []).map((line) => ({
      ...line,
      Colunas: (line.Colunas ?? []).map((column) => {
        const odd = oddsByIdentity.get(buildBbtipsColumnIdentity(column))
        if (!odd) return column

        return {
          ...column,
          OddsByMarket: {
            ...column.OddsByMarket,
            [market]: odd,
          },
        }
      }),
    })),
  }
}

const getBbtipsPayloadUpdatedAt = (payload: BbtipsRawPayload | null | undefined) => {
  const parsed = parseBbtipsTimestamp(payload?.DataAtualizacao)
  return Number.isFinite(parsed) ? parsed : null
}

const getBbtipsPayloadColumnCount = (payload: BbtipsRawPayload | null | undefined) =>
  getRenderableBbtipsPayloadColumnCount(payload)

const hasUsableBbtipsPayload = (payload: BbtipsRawPayload | null | undefined) =>
  (payload?.Linhas ?? []).some((line) => (line.Colunas ?? []).some((column) => !isBbtipsPlaceholderColumn(column)))

const pickPreferredBbtipsPayload = (
  currentPayload: BbtipsRawPayload | null | undefined,
  candidatePayload: BbtipsRawPayload | null | undefined,
) => {
  if (!currentPayload) return candidatePayload ?? null
  if (!candidatePayload) return currentPayload

  const currentUpdatedAt = getBbtipsPayloadUpdatedAt(currentPayload)
  const candidateUpdatedAt = getBbtipsPayloadUpdatedAt(candidatePayload)

  if (currentUpdatedAt !== candidateUpdatedAt) {
    if (candidateUpdatedAt === null) return currentPayload
    if (currentUpdatedAt === null) return candidatePayload
    return candidateUpdatedAt > currentUpdatedAt ? candidatePayload : currentPayload
  }

  const currentLineCount = (currentPayload.Linhas ?? []).length
  const candidateLineCount = (candidatePayload.Linhas ?? []).length
  if (currentLineCount !== candidateLineCount) {
    return candidateLineCount > currentLineCount ? candidatePayload : currentPayload
  }

  const currentColumnCount = getBbtipsPayloadColumnCount(currentPayload)
  const candidateColumnCount = getBbtipsPayloadColumnCount(candidatePayload)
  if (currentColumnCount !== candidateColumnCount) {
    return candidateColumnCount > currentColumnCount ? candidatePayload : currentPayload
  }

  return currentPayload
}

const buildBbtipsCacheKey = (
  platform: BbtipsPlatform,
  requestedMarkets: BbtipsRequestedMarket[],
  requestedPeriod: Period,
  requestedLeagues: BbtipsLeagueSpec[],
) =>
  `${platform}:${requestedPeriod}:${requestedLeagues.map((league) => league.key).sort().join('|')}:${requestedMarkets.map((market) => market.code).sort().join('|')}`

const parseBbtipsCacheKey = (cacheKey: string) => {
  const [platform, period, leagueKey = '', marketKey = ''] = cacheKey.split(':')
  if (!platform || !period) return null

  return {
    leagueKey,
    marketKey,
    period,
    platform,
  }
}

const bbtipsPersistentCacheDir = path.join(process.cwd(), 'captures', 'live-cache')
const bbtipsPersistentCacheVersion = 'v6'
const bbtipsPersistentCacheFreshMaxAgeMsByPlatform: Record<BbtipsPlatform, number> = {
  Betano: 4_000,
  Bet365: 60_000,
  'Express 365': 60_000,
  PlayPix: 6_000,
}
const bbtipsVisualFallbackMaxAgeMsByPlatform: Record<BbtipsPlatform, number> = {
  Betano: 2 * 60 * 1000,
  Bet365: 15 * 60 * 1000,
  'Express 365': 15 * 60 * 1000,
  PlayPix: 2 * 60 * 1000,
}
const bbtipsServeStaleWhileRefreshMaxAgeMsByPlatform: Record<BbtipsPlatform, number> = {
  Betano: 8_000,
  Bet365: 90_000,
  'Express 365': 90_000,
  PlayPix: 10_000,
}
const bbtipsPersistentCacheEmergencyMaxAgeMs = 24 * 60 * 60 * 1000
const bbtipsBackgroundWarmupMsByPlatform: Record<BbtipsPlatform, number> = {
  Betano: 2_000,
  Bet365: 60_000,
  'Express 365': 60_000,
  PlayPix: 3_000,
}
const bbtipsDerivedFutureReuseMaxDriftMsByPlatform: Partial<Record<BbtipsPlatform, number>> = {
  PlayPix: 5 * 60 * 1000,
}

const buildBbtipsPersistentCachePath = (cacheKey: string) =>
  path.join(bbtipsPersistentCacheDir, `${bbtipsPersistentCacheVersion}-${Buffer.from(cacheKey).toString('base64url')}.json`)

const decodeBbtipsPersistentCacheKeyFromFilename = (filename: string) => {
  const prefix = `${bbtipsPersistentCacheVersion}-`
  if (!filename.startsWith(prefix) || !filename.endsWith('.json')) {
    return null
  }

  try {
    const encoded = filename.slice(prefix.length, -'.json'.length)
    return Buffer.from(encoded, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))

const hasUsableBbtipsLivePayload = (payload: BbtipsLivePlatformPayload | null | undefined) =>
  (payload?.leagues ?? []).some(
    (league) => hasUsableBbtipsPayload(league.current) || hasUsableBbtipsPayload(league.future),
  )

const hasBbtipsMarketOdds = (
  payload: BbtipsLivePlatformPayload | null | undefined,
  requestedMarkets: BbtipsRequestedMarket[],
) => {
  if (requestedMarkets.length === 0) return true

  const marketNames = requestedMarkets.map((market) => market.market)
  return (payload?.leagues ?? []).some((league) =>
    [league.current, league.future].some((section) =>
      (section?.Linhas ?? []).some((line) =>
        (line.Colunas ?? []).some((column) =>
          marketNames.some((market) => hasMeaningfulBbtipsValue(column.OddsByMarket?.[market])),
        ),
      ),
    ),
  )
}

const isBbtipsPayloadSynchronized = (
  payload: BbtipsRawPayload | null | undefined,
  platform: BbtipsPlatform,
  maxDriftMs = bbtipsPayloadSyncMaxDriftMsByPlatform[platform],
) => {
  const timestamp = getBbtipsPayloadUpdateTimestamp(payload)
  if (!timestamp) return false

  const drift = Math.abs(Date.now() - timestamp)
  return drift <= maxDriftMs
}

const hasSynchronizedUsableBbtipsPayload = (
  payload: BbtipsRawPayload | null | undefined,
  platform: BbtipsPlatform,
  maxDriftMs = bbtipsPayloadSyncMaxDriftMsByPlatform[platform],
) =>
  hasUsableBbtipsPayload(payload) && isBbtipsPayloadSynchronized(payload, platform, maxDriftMs)

const sanitizeBbtipsLeaguePayload = (
  league: BbtipsLivePlatformPayload['leagues'][number],
) => {
  const nextCurrent = hasUsableBbtipsPayload(league.current) ? league.current : null
  const nextFuture = hasUsableBbtipsPayload(league.future) ? league.future : null

  if (!nextCurrent && !nextFuture) return null

  return {
    ...league,
    current: nextCurrent,
    future: nextFuture,
  }
}

const sanitizeBbtipsLivePayload = (
  payload: BbtipsLivePlatformPayload | null | undefined,
): BbtipsLivePlatformPayload | null => {
  if (!payload) return null

  const leagues = (payload.leagues ?? [])
    .map((league) => sanitizeBbtipsLeaguePayload(league))
    .filter((league): league is NonNullable<typeof league> => Boolean(league))

  if (leagues.length === 0) return null

  return {
    ...payload,
    leagues,
    updatedAt: resolveBbtipsLivePayloadUpdatedAt(leagues),
  }
}

const pickDisplayableBbtipsPayload = (
  platform: BbtipsPlatform,
  primary: BbtipsRawPayload | null | undefined,
  fallback: BbtipsRawPayload | null | undefined,
) => {
  const primaryFresh = hasSynchronizedUsableBbtipsPayload(primary, platform)
  const fallbackFresh = hasSynchronizedUsableBbtipsPayload(fallback, platform)
  const primaryUsable = hasUsableBbtipsPayload(primary)
  const fallbackUsable = hasUsableBbtipsPayload(fallback)

  if (primaryFresh && fallbackFresh) {
    return stabilizeBbtipsPayload(primary, fallback)
  }

  if (primaryFresh) return primary ?? null
  if (fallbackFresh) return fallback ?? null
  if (primaryUsable && fallbackUsable) return stabilizeBbtipsPayload(primary, fallback)
  if (primaryUsable) return primary ?? null
  if (fallbackUsable) return fallback ?? null
  return null
}

const getBbtipsPayloadUpdateTimestamp = (payload: BbtipsRawPayload | null | undefined) => {
  const timestamp = parseBbtipsTimestamp(payload?.DataAtualizacao)
  return Number.isFinite(timestamp) ? timestamp : 0
}

const shouldReuseDerivedBbtipsFuturePayload = (
  platform: BbtipsPlatform,
  currentPayload: BbtipsRawPayload | null | undefined,
  futurePayload: BbtipsRawPayload | null | undefined,
) => {
  if (!hasUsableBbtipsPayload(futurePayload)) return false

  const maxDriftMs = bbtipsDerivedFutureReuseMaxDriftMsByPlatform[platform]
  if (!maxDriftMs) return true
  if (!currentPayload) return true

  const currentTimestamp = getBbtipsPayloadUpdateTimestamp(currentPayload)
  const futureTimestamp = getBbtipsPayloadUpdateTimestamp(futurePayload)
  if (!currentTimestamp || !futureTimestamp) return false

  return Math.abs(currentTimestamp - futureTimestamp) <= maxDriftMs
}

const resolveBbtipsLivePayloadUpdatedAt = (
  leagues: BbtipsLivePlatformPayload['leagues'],
) => {
  const sourceTimestamp = leagues.reduce(
    (latestTimestamp, league) =>
      Math.max(
        latestTimestamp,
        getBbtipsPayloadUpdateTimestamp(league.current),
        getBbtipsPayloadUpdateTimestamp(league.future),
      ),
    0,
  )

  return sourceTimestamp || Date.now()
}

const getBbtipsLivePayloadFreshnessTimestamp = (
  payload: BbtipsLivePlatformPayload,
) => {
  const diagnosticsTimestamp = Math.max(
    Number(payload.diagnostics?.validatedAt ?? 0),
    Number(payload.diagnostics?.lastSuccessfulSyncAt ?? 0),
  )
  const upstreamTimestamp = Number(payload.updatedAt ?? 0)

  return Math.max(
    Number.isFinite(diagnosticsTimestamp) ? diagnosticsTimestamp : 0,
    Number.isFinite(upstreamTimestamp) ? upstreamTimestamp : 0,
  )
}

const getBbtipsClientCacheTtlMs = (platform: BbtipsPlatform) =>
  bbtipsClientCacheTtlMsByPlatform[platform] ?? bbtipsClientCacheTtlMsByPlatform.Betano

const getBbtipsRequestTimeoutMs = (platform: BbtipsPlatform) =>
  bbtipsRequestTimeoutMsByPlatform[platform] ?? bbtipsRequestTimeoutMs

const getBbtipsRequestMaxAttempts = (platform: BbtipsPlatform) =>
  bbtipsRequestMaxAttemptsByPlatform[platform] ?? 2

const getBbtipsPersistentCacheFreshMaxAgeMs = (platform: BbtipsPlatform) =>
  bbtipsPersistentCacheFreshMaxAgeMsByPlatform[platform] ??
  bbtipsPersistentCacheFreshMaxAgeMsByPlatform.Betano

const getBbtipsVisualFallbackMaxAgeMs = (platform: BbtipsPlatform) =>
  bbtipsVisualFallbackMaxAgeMsByPlatform[platform] ??
  bbtipsVisualFallbackMaxAgeMsByPlatform.Betano

const getBbtipsServeStaleWhileRefreshMaxAgeMs = (platform: BbtipsPlatform) =>
  bbtipsServeStaleWhileRefreshMaxAgeMsByPlatform[platform] ??
  bbtipsServeStaleWhileRefreshMaxAgeMsByPlatform.Betano

const getBbtipsHotPriorityRefreshMaxAgeMs = (platform: BbtipsPlatform) =>
  bbtipsHotPriorityRefreshMaxAgeMsByPlatform[platform] ??
  getBbtipsVisualFallbackMaxAgeMs(platform)

const getBbtipsHotPriorityRefreshWaitMs = (platform: BbtipsPlatform) =>
  bbtipsHotPriorityRefreshWaitMsByPlatform[platform] ?? 0

const getBbtipsBackgroundWarmupMs = (platform: BbtipsPlatform) =>
  bbtipsBackgroundWarmupMsByPlatform[platform] ?? bbtipsBackgroundWarmupMsByPlatform.Betano

const isBbtipsLivePayloadFreshForPlatform = (
  payload: BbtipsLivePlatformPayload | null | undefined,
  platform: BbtipsPlatform,
  now = Date.now(),
  maxAgeMs = getBbtipsPersistentCacheFreshMaxAgeMs(platform),
) => {
  if (!payload) return false

  const freshestTimestamp = getBbtipsLivePayloadFreshnessTimestamp(payload)
  if (!Number.isFinite(freshestTimestamp) || freshestTimestamp <= 0) return false

  const effectiveMaxAgeMs = payload.diagnostics?.bridgeSource === 'bbtips-hot-bridge'
    ? Math.max(maxAgeMs, 45_000)
    : maxAgeMs

  return now - freshestTimestamp <= effectiveMaxAgeMs
}

const isBbtipsLivePayloadWarmForPlatform = (
  payload: BbtipsLivePlatformPayload | null | undefined,
  platform: BbtipsPlatform,
  now = Date.now(),
) => {
  if (!payload) return false

  const freshestTimestamp = getBbtipsLivePayloadFreshnessTimestamp(payload)
  if (!Number.isFinite(freshestTimestamp) || freshestTimestamp <= 0) return false

  return now - freshestTimestamp <= getBbtipsServeStaleWhileRefreshMaxAgeMs(platform)
}

const pickFresherBbtipsLivePayload = (
  primary: BbtipsLivePlatformPayload | null | undefined,
  fallback: BbtipsLivePlatformPayload | null | undefined,
) => {
  if (!primary) return fallback ?? null
  if (!fallback) return primary

  const primaryUpdatedAt = Number(primary.updatedAt ?? 0)
  const fallbackUpdatedAt = Number(fallback.updatedAt ?? 0)
  return fallbackUpdatedAt > primaryUpdatedAt ? fallback : primary
}

type BbtipsPersistedCacheEntry = {
  cachedAt?: number
  payload?: BbtipsLivePlatformPayload
}

const unwrapBbtipsPersistentCachePayload = (
  rawEntry: BbtipsLivePlatformPayload | BbtipsPersistedCacheEntry,
): BbtipsLivePlatformPayload | null => {
  if (
    rawEntry &&
    typeof rawEntry === 'object' &&
    'payload' in rawEntry &&
    rawEntry.payload
  ) {
    return rawEntry.payload
  }

  return rawEntry as BbtipsLivePlatformPayload
}

const readBbtipsPersistentCache = (
  cacheKey: string,
  maxAgeMs = 15 * 60 * 1000,
): BbtipsLivePlatformPayload | null => {
  try {
    const cachePath = buildBbtipsPersistentCachePath(cacheKey)
    if (!existsSync(cachePath)) return null

    const rawEntry = JSON.parse(readFileSync(cachePath, 'utf8')) as BbtipsLivePlatformPayload | BbtipsPersistedCacheEntry
    const payload = sanitizeBbtipsLivePayload(unwrapBbtipsPersistentCachePayload(rawEntry))
    if (!payload) return null
    if (!hasUsableBbtipsLivePayload(payload)) return null

    const fileCachedAt = statSync(cachePath).mtimeMs
    const resolvedCachedAt =
      rawEntry &&
      typeof rawEntry === 'object' &&
      'cachedAt' in rawEntry &&
      typeof rawEntry.cachedAt === 'number'
        ? rawEntry.cachedAt
        : fileCachedAt

    if (Date.now() - resolvedCachedAt > maxAgeMs) return null

    return payload
  } catch {
    return null
  }
}

const writeBbtipsPersistentCache = (cacheKey: string, payload: BbtipsLivePlatformPayload) => {
  try {
    if (!hasUsableBbtipsLivePayload(payload)) return
    mkdirSync(bbtipsPersistentCacheDir, { recursive: true })
    writeFileSync(
      buildBbtipsPersistentCachePath(cacheKey),
      JSON.stringify({
        cachedAt: Date.now(),
        payload,
      } satisfies BbtipsPersistedCacheEntry),
      'utf8',
    )
  } catch {
    // Cache em disco e apenas aceleracao; falhas aqui nao devem derrubar a tela.
  }
}

const readLatestCompatibleBbtipsPersistentCache = (
  platform: BbtipsPlatform,
  requestedMarkets: BbtipsRequestedMarket[],
  requestedPeriod: Period,
  requestedLeagues: BbtipsLeagueSpec[],
  maxAgeMs = getBbtipsPersistentCacheFreshMaxAgeMs(platform),
): BbtipsLivePlatformPayload | null => {
  try {
    if (!existsSync(bbtipsPersistentCacheDir)) return null

    const requestedLeagueKey = requestedLeagues.map((league) => league.key).sort().join('|')
    const requestedMarketKey = requestedMarkets.map((market) => market.code).sort().join('|')
    const allowsBaseRequestMarketFallback = requestedMarketKey.length === 0
    const requestedPeriodHours = getPeriodHours(requestedPeriod)
    const candidates = readdirSync(bbtipsPersistentCacheDir)
      .map((filename) => {
        const cacheKey = decodeBbtipsPersistentCacheKeyFromFilename(filename)
        if (!cacheKey) return null

        const parsedKey = parseBbtipsCacheKey(cacheKey)
        if (!parsedKey) return null
        if (parsedKey.platform !== platform) return null
        if (parsedKey.leagueKey !== requestedLeagueKey) return null
        const marketMatches = parsedKey.marketKey === requestedMarketKey
        if (!marketMatches && !allowsBaseRequestMarketFallback) return null

        const fullPath = path.join(bbtipsPersistentCacheDir, filename)
        const payload = readBbtipsPersistentCache(cacheKey, maxAgeMs)
        if (!payload) return null

        const stat = statSync(fullPath)
        const periodHours = getPeriodHours(parsedKey.period as Period)
        return {
          cacheKey,
          filename,
          marketMatches,
          marketWidth: parsedKey.marketKey ? parsedKey.marketKey.split('|').filter(Boolean).length : 0,
          payload,
          periodDistance: Math.abs(periodHours - requestedPeriodHours),
          periodMatches: parsedKey.period === requestedPeriod,
          writtenAt: stat.mtimeMs,
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((left, right) => {
        if (left.marketMatches !== right.marketMatches) {
          return left.marketMatches ? -1 : 1
        }

        if (left.marketWidth !== right.marketWidth) {
          return left.marketWidth - right.marketWidth
        }

        if (left.periodMatches !== right.periodMatches) {
          return left.periodMatches ? -1 : 1
        }

        if (left.periodDistance !== right.periodDistance) {
          return left.periodDistance - right.periodDistance
        }

        return right.writtenAt - left.writtenAt
      })

    const best = candidates[0]
    if (!best) return null

    return {
      ...best.payload,
      source: 'cache',
    }
  } catch {
    return null
  }
}

const buildBbtipsLivePayloadFromLeagues = (
  platform: BbtipsPlatform,
  period: Period,
  leagues: BbtipsLivePlatformPayload['leagues'],
  source: 'live' | 'cache' = 'cache',
): BbtipsLivePlatformPayload | null => {
  if (leagues.length === 0) return null

  const sanitizedLeagues = leagues
    .map((league) => sanitizeBbtipsLeaguePayload(league))
    .filter((league): league is NonNullable<typeof league> => Boolean(league))

  if (sanitizedLeagues.length === 0) return null

  return {
    leagues: sanitizedLeagues,
    period,
    platform,
    source,
    updatedAt: resolveBbtipsLivePayloadUpdatedAt(sanitizedLeagues),
  }
}

const bbtipsStorageStatePath = path.join(process.cwd(), 'captures', 'bbtips-storage-state.json')
const bbtipsBrowserStatePath = path.join(process.cwd(), 'captures', 'bbtips-browser-state.json')

interface BbtipsStorageStateCookie {
  domain?: string
  expires?: number
  name?: string
  path?: string
  secure?: boolean
  value?: string
}

interface BbtipsStorageStateFile {
  cookies?: BbtipsStorageStateCookie[]
  origins?: Array<{
    localStorage?: Array<{ name?: string; value?: string }>
    origin?: string
  }>
}

type BbtipsResolvedStorageState = {
  hasAccessToken: boolean
  hasBbtipsCookie: boolean
  hasCurrentUser: boolean
  path: string
  state: BbtipsStorageStateFile
  writtenAt: number
}

const decodeJwtPayload = (token: string) => {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number }
  } catch {
    return null
  }
}

const isJwtExpired = (token: string) => {
  const payload = decodeJwtPayload(token)
  if (!payload?.exp) return false
  return payload.exp * 1000 <= Date.now() + 60_000
}

const bbtipsStorageStateCandidates = [bbtipsBrowserStatePath, bbtipsStorageStatePath]

const readBbtipsStorageStateFile = (storageStatePath: string) => {
  try {
    return JSON.parse(readFileSync(storageStatePath, 'utf8')) as BbtipsStorageStateFile
  } catch {
    return null
  }
}

const getBbtipsStorageStateOrigin = (state: BbtipsStorageStateFile | null | undefined) =>
  state?.origins?.find((entry) => entry.origin === 'https://app.bbtips.com.br') ?? null

const getBbtipsStorageStateToken = (state: BbtipsStorageStateFile | null | undefined) => {
  const bbtipsOrigin = getBbtipsStorageStateOrigin(state)
  const directToken = bbtipsOrigin?.localStorage?.find((entry) => entry.name === 'access_token')?.value?.trim()
  if (directToken) return directToken

  const currentUserRaw = bbtipsOrigin?.localStorage?.find((entry) => entry.name === 'currentUser')?.value
  if (!currentUserRaw) return null

  try {
    const parsedUser = JSON.parse(currentUserRaw) as { token?: string }
    return parsedUser.token?.trim() || null
  } catch {
    return null
  }
}

const resolveBbtipsStorageStates = (): BbtipsResolvedStorageState[] =>
  bbtipsStorageStateCandidates
    .filter((candidatePath) => existsSync(candidatePath))
    .map((candidatePath) => {
      const state = readBbtipsStorageStateFile(candidatePath)
      if (!state) return null

      const token = getBbtipsStorageStateToken(state)
      const hasCurrentUser = Boolean(
        getBbtipsStorageStateOrigin(state)?.localStorage?.some((entry) => entry.name === 'currentUser' && entry.value),
      )
      const hasBbtipsCookie = (state.cookies ?? []).some((cookie) =>
        /(^|\.)(bbtips\.com\.br|api\.bbtips\.com\.br)$/i.test(String(cookie.domain ?? '').replace(/^\./, '')) ||
        /^cf_/i.test(String(cookie.name ?? '')),
      )

      return {
        hasAccessToken: Boolean(token),
        hasBbtipsCookie,
        hasCurrentUser,
        path: candidatePath,
        state,
        writtenAt: statSync(candidatePath).mtimeMs,
      } satisfies BbtipsResolvedStorageState
    })
    .filter((entry): entry is BbtipsResolvedStorageState => Boolean(entry))
    .sort((left, right) => {
      const leftScore = Number(left.hasAccessToken) * 4 + Number(left.hasCurrentUser) * 2 + Number(left.hasBbtipsCookie)
      const rightScore = Number(right.hasAccessToken) * 4 + Number(right.hasCurrentUser) * 2 + Number(right.hasBbtipsCookie)
      if (leftScore !== rightScore) {
        return rightScore - leftScore
      }

      return right.writtenAt - left.writtenAt
    })

const readBbtipsAccessTokenFromStorageState = () => {
  const bestState = resolveBbtipsStorageStates().find((entry) => entry.hasAccessToken)
  if (!bestState) return null

  const token = getBbtipsStorageStateToken(bestState.state)
  if (!token) return null

  return {
    source: 'storage-state',
    token,
  }
}

const resolveBbtipsAccessToken = (env: BbtipsEnv) => {
  const directToken = env.BBTIPS_ACCESS_TOKEN?.trim()
  if (directToken) {
    return {
      source: 'env',
      token: directToken,
    }
  }

  return readBbtipsAccessTokenFromStorageState()
}

type BbtipsBrowserSession = {
  browser: Awaited<ReturnType<typeof import('playwright').chromium.launch>>
  context: Awaited<ReturnType<Awaited<ReturnType<typeof import('playwright').chromium.launch>>['newContext']>>
  page: Awaited<ReturnType<Awaited<ReturnType<Awaited<ReturnType<typeof import('playwright').chromium.launch>>['newContext']>>['newPage']>>
}

let bbtipsBrowserSessionPromise: Promise<BbtipsBrowserSession> | null = null
let bbtipsBrowserRequestLock: Promise<void> | null = null

const hideBbtipsBrowserWindow = () => {
  if (bbtipsBrowserHeadless || process.platform !== 'win32') return

  const script = [
    '$sig = \'[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr hWnd, int nCmdShow);\'',
    'Add-Type -MemberDefinition $sig -Name Win32Window -Namespace Native -ErrorAction SilentlyContinue',
    'Get-Process chrome -ErrorAction SilentlyContinue',
    '| Where-Object { $_.MainWindowTitle -like "BB Tips*" -or $_.MainWindowTitle -like "*bbtips*" }',
    '| ForEach-Object { [Native.Win32Window]::ShowWindowAsync($_.MainWindowHandle, 0) | Out-Null }',
  ].join('; ')

  const normalizedScript = script
    .replace(/; \|/g, ' |')
    .replace(/; ForEach/g, ' | ForEach')

  const runHide = () => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', normalizedScript],
      { windowsHide: true },
      () => undefined,
    )
  }

  runHide()
  setTimeout(runHide, 250)
  setTimeout(runHide, 750)
  setTimeout(runHide, 1_500)
  setTimeout(runHide, 3_000)
  setTimeout(runHide, 6_000)
  setTimeout(runHide, 10_000)
  setTimeout(runHide, 15_000)
}

const isUsableBbtipsBrowserSession = (
  session: BbtipsBrowserSession | null | undefined,
): session is BbtipsBrowserSession =>
  Boolean(session?.browser.isConnected() && !session.page.isClosed())

const disposeBbtipsBrowserSession = async (session: BbtipsBrowserSession | null | undefined) => {
  await session?.context.close().catch(() => undefined)
  await session?.browser.close().catch(() => undefined)
}

const resolveBbtipsBrowserStorageStatePath = () => {
  return resolveBbtipsStorageStates()[0]?.path ?? null
}

const cookieDomainMatchesHost = (cookieDomain: string | undefined, hostname: string) => {
  const normalizedCookieDomain = String(cookieDomain ?? '')
    .trim()
    .replace(/^\./, '')
    .toLowerCase()
  const normalizedHost = hostname.trim().toLowerCase()

  if (!normalizedCookieDomain || !normalizedHost) return false
  return normalizedHost === normalizedCookieDomain || normalizedHost.endsWith(`.${normalizedCookieDomain}`)
}

const buildBbtipsCookieHeader = (targetUrl: string) => {
  try {
    const url = new URL(targetUrl)
    const nowSeconds = Date.now() / 1000
    const cookiePairs = resolveBbtipsStorageStates()
      .flatMap(({ state }) => state.cookies ?? [])
      .filter((cookie) =>
        Boolean(
          cookie.name &&
          cookie.value &&
          cookieDomainMatchesHost(cookie.domain, url.hostname) &&
          (!cookie.path || url.pathname.startsWith(cookie.path)) &&
          (!cookie.secure || url.protocol === 'https:') &&
          (
            typeof cookie.expires !== 'number' ||
            cookie.expires < 0 ||
            cookie.expires > nowSeconds
          ),
        ),
      )
      .map((cookie) => `${cookie.name}=${cookie.value}`)

    return cookiePairs.length > 0
      ? Array.from(new Set(cookiePairs)).join('; ')
      : null
  } catch {
    return null
  }
}

const persistBbtipsBrowserStorageState = async (session: BbtipsBrowserSession) => {
  try {
    mkdirSync(path.dirname(bbtipsBrowserStatePath), { recursive: true })
    await session.context.storageState({ path: bbtipsBrowserStatePath })
  } catch {
    // Persistir o estado so ajuda a reaproveitar a liberacao do challenge; falhas nao devem derrubar o live.
  }
}

const readBbtipsBrowserPageSnapshot = async (session: BbtipsBrowserSession) => {
  try {
    const pageSnapshot = await session.page.evaluate(() => {
      const browserGlobal = globalThis as unknown as {
        document?: {
          body?: {
            innerText?: string
          }
          title?: string
        }
        localStorage?: {
          key?: (index: number) => string | null
          length?: number
        }
        location?: {
          href?: string
        }
      }
      const localStorageKeys = Array.from(
        { length: browserGlobal.localStorage?.length ?? 0 },
        (_, index) => browserGlobal.localStorage?.key?.(index) ?? '',
      ).filter(Boolean)

      return {
        bodyPreview: browserGlobal.document?.body?.innerText?.slice(0, 800) ?? '',
        hasAccessToken: localStorageKeys.includes('access_token'),
        hasCurrentUser: localStorageKeys.includes('currentUser'),
        href: browserGlobal.location?.href ?? '',
        localStorageKeys,
        title: browserGlobal.document?.title ?? '',
      }
    })
    const bbtipsCookieNames = (await session.context.cookies()
      .then((cookies) =>
        cookies
          .filter((cookie) =>
            /(^|\.)(bbtips\.com\.br|api\.bbtips\.com\.br)$/i.test(String(cookie.domain ?? '').replace(/^\./, '')) ||
            /^cf_/i.test(String(cookie.name ?? '')),
          )
          .map((cookie) => cookie.name),
      )
      .catch(() => []))

    return {
      ...pageSnapshot,
      bbtipsCookieCount: bbtipsCookieNames.length,
      bbtipsCookieNames,
    }
  } catch {
    return {
      bodyPreview: '',
      bbtipsCookieCount: 0,
      bbtipsCookieNames: [],
      hasAccessToken: false,
      hasCurrentUser: false,
      href: session.page.url(),
      localStorageKeys: [],
      title: '',
    }
  }
}

const isBbtipsChallengeSnapshot = (snapshot: { bodyPreview: string; href: string; title: string }) =>
  /just a moment|um momento|verificacao de seguranca|verificação de segurança|cloudflare/i.test(
    `${snapshot.title}\n${snapshot.bodyPreview}\n${snapshot.href}`,
  )

const isBbtipsReadySnapshot = (snapshot: {
  bodyPreview: string
  hasAccessToken: boolean
  hasCurrentUser: boolean
  href: string
  title: string
}) =>
  !isBbtipsChallengeSnapshot(snapshot) &&
  snapshot.href.includes('app.bbtips.com.br') &&
  (snapshot.hasAccessToken || snapshot.hasCurrentUser)

const ensureBbtipsBrowserReady = async (session: BbtipsBrowserSession) => {
  const startedAt = Date.now()
  let navigated = false

  while (Date.now() - startedAt < bbtipsBrowserReadyTimeoutMs) {
    const currentUrl = session.page.url()
    if (!currentUrl || currentUrl.startsWith('about:blank') || currentUrl.includes('api.bbtips.com.br/')) {
      await session.page.goto(bbtipsBrowserAppUrl, {
        timeout: 8_000,
        waitUntil: 'domcontentloaded',
      }).catch(() => undefined)
      navigated = true
    }

    const snapshot = await readBbtipsBrowserPageSnapshot(session)
    if (isBbtipsReadySnapshot(snapshot)) {
      await persistBbtipsBrowserStorageState(session)
      return true
    }

    if (!navigated) {
      await session.page.goto(bbtipsBrowserAppUrl, {
        timeout: 8_000,
        waitUntil: 'domcontentloaded',
      }).catch(() => undefined)
      navigated = true
    }

    await session.page.waitForTimeout(bbtipsBrowserReadyPollMs)
  }

  return false
}

const isBbtipsBrowserClosedError = (error: unknown) =>
  /target page|context or browser has been closed|browser has been closed|page closed/i.test(
    error instanceof Error ? error.message : String(error),
  )

const activateBbtipsLeagueTab = async (
  page: BbtipsBrowserSession['page'],
  labels: string[],
) => {
  for (const label of labels) {
    const clicked = await page.evaluate((rawLabel) => {
      const browserGlobal = globalThis as unknown as {
        document: {
          querySelectorAll: (selector: string) => ArrayLike<any>
        }
        getComputedStyle: (element: any) => {
          display: string
          visibility: string
          opacity?: string
        }
      }
      const normalize = (value: string) =>
        value
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim()

      const target = normalize(rawLabel)
      if (!target) return false

      const isVisible = (element: any) => {
        const htmlElement = element
        const style = browserGlobal.getComputedStyle(htmlElement)
        const rect = htmlElement.getBoundingClientRect()

        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity || 1) !== 0 &&
          rect.width > 0 &&
          rect.height > 0
        )
      }

      const candidates = Array.from(browserGlobal.document.querySelectorAll('button, a, [role="button"], .nav-link, .btn'))
        .filter((element) => isVisible(element))

      const directMatch = candidates.find((element) => normalize(element.textContent || '') === target)
      const partialMatch = candidates.find((element) => normalize(element.textContent || '').includes(target))
      const candidate = directMatch ?? partialMatch
      if (!candidate) return false

      candidate.click()
      return true
    }, label)

    if (clicked) {
      await page.waitForTimeout(bbtipsMatrixRenderWaitMs)
      return true
    }
  }

  return false
}

const readBbtipsRenderedMatrixMeta = async (
  page: BbtipsBrowserSession['page'],
): Promise<BbtipsRenderedMatrixMeta | null> => {
  try {
    await page.waitForFunction(
      () => {
        const browserGlobal = globalThis as unknown as {
          document: {
            querySelectorAll: (selector: string) => ArrayLike<unknown>
          }
        }

        return browserGlobal.document.querySelectorAll('table.customTable tr').length >= 3
      },
      { timeout: 20_000 },
    )
  } catch {
    return null
  }

  return page.evaluate(() => {
    const browserGlobal = globalThis as unknown as {
      document: {
        querySelector: (selector: string) => any
      }
    }
    const table = browserGlobal.document.querySelector('table.customTable')
    if (!table) return null

    const rows = [...table.querySelectorAll('tr')]
    const headerRow = rows[1]
    const rawMinutes = headerRow
      ? [...headerRow.children]
          .slice(1)
          .map((cell) => Number.parseInt((cell.textContent || '').trim(), 10))
          .filter((value) => Number.isFinite(value))
      : []
    const scorePattern = /^\d+\s*-\s*\d+$/
    const dataRows = rows
      .slice(2)
      .map((row) => {
        const hour = Number.parseInt((row.children[0]?.textContent || '').trim(), 10)
        const scoreCount = [...row.children]
          .slice(1, -2)
          .reduce((count, cell) => (
            scorePattern.test((cell.textContent || '').replace(/\s+/g, ' ').trim())
              ? count + 1
              : count
          ), 0)

        return {
          hour,
          scoreCount,
        }
      })
      .filter((entry) => Number.isFinite(entry.hour))
    const firstResolvedRowIndex = dataRows.findIndex((entry) => entry.scoreCount > 0)
    const futureRows =
      firstResolvedRowIndex > 0
        ? dataRows.slice(0, firstResolvedRowIndex).filter((entry) => entry.scoreCount === 0)
        : []
    const currentRows = dataRows
      .slice(Math.max(firstResolvedRowIndex, 0))
      .filter((entry) => entry.scoreCount > 0)

    return {
      currentRowHours: currentRows.map((entry) => entry.hour),
      futureRowHours: futureRows.map((entry) => entry.hour),
      minuteSlots: rawMinutes,
    } satisfies BbtipsRenderedMatrixMeta
  })
}

const scrapeBbtipsRenderedMatrixMeta = async (
  platform: BbtipsPlatform,
  league: BbtipsLeagueSpec,
) => {
  void platform
  void league
  return null

  const session = await getBbtipsBrowserSession()
  const ready = await ensureBbtipsBrowserReady(session).catch(() => false)
  if (!ready) return null

  const platformConfig = bbtipsPlatformConfigByPlatform[platform]
  await session.page.goto(platformConfig.pageUrl, {
    timeout: 60_000,
    waitUntil: 'domcontentloaded',
  }).catch(() => undefined)
  await session.page.waitForTimeout(bbtipsMatrixRenderWaitMs)
  await activateBbtipsLeagueTab(session.page, getBbtipsLeagueTabLabels(platform, league)).catch(() => false)
  await session.page.waitForTimeout(bbtipsMatrixRenderWaitMs)

  return readBbtipsRenderedMatrixMeta(session.page)
}

const getBbtipsBrowserSession = async () => {
  if (bbtipsBrowserSessionPromise) {
    const currentSession = await bbtipsBrowserSessionPromise.catch(() => null)
    if (isUsableBbtipsBrowserSession(currentSession)) {
      return currentSession
    }

    bbtipsBrowserSessionPromise = null
    await disposeBbtipsBrowserSession(currentSession)
  }

  bbtipsBrowserSessionPromise = (async () => {
    const { chromium } = await import('playwright')
    const launchOptions = {
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=CalculateNativeWinOcclusion',
        '--no-first-run',
        '--no-default-browser-check',
        '--start-minimized',
        '--window-position=-32000,-32000',
        '--window-size=320,240',
      ],
      headless: bbtipsBrowserHeadless,
    }
    const browser = await chromium.launch({
      ...launchOptions,
      channel: 'chrome',
    }).catch(() => chromium.launch(launchOptions))
    const storageStatePath = resolveBbtipsBrowserStorageStatePath()
    const context = await browser.newContext(
      storageStatePath
        ? { storageState: storageStatePath }
        : undefined,
    )
    const page = await context.newPage()
    await page.setViewportSize({ width: 320, height: 240 }).catch(() => undefined)
    hideBbtipsBrowserWindow()
    await page.context().newCDPSession(page)
      .then(async (session) => {
        const { windowId } = await session.send('Browser.getWindowForTarget')
        await session.send('Browser.setWindowBounds', {
          bounds: { windowState: 'minimized' },
          windowId,
        })
      })
      .catch(() => undefined)

    await page.goto(bbtipsBrowserAppUrl, {
      timeout: 60_000,
      waitUntil: 'domcontentloaded',
    }).catch(() => undefined)
    hideBbtipsBrowserWindow()
    await page.waitForTimeout(bbtipsBrowserWarmupMs)
    await ensureBbtipsBrowserReady({
      browser,
      context,
      page,
    }).catch(() => undefined)
    hideBbtipsBrowserWindow()

    browser.on('disconnected', () => {
      bbtipsBrowserSessionPromise = null
    })

    return {
      browser,
      context,
      page,
    }
  })()

  return bbtipsBrowserSessionPromise
}

const closeBbtipsBrowserSession = async () => {
  if (!bbtipsBrowserSessionPromise) return

  const currentSessionPromise = bbtipsBrowserSessionPromise
  bbtipsBrowserSessionPromise = null

  const session = await currentSessionPromise.catch(() => null)
  await disposeBbtipsBrowserSession(session)
}

const withBbtipsBrowserRequestLock = async <T>(task: () => Promise<T>) => {
  while (bbtipsBrowserRequestLock) {
    await bbtipsBrowserRequestLock.catch(() => undefined)
  }

  let releaseLock: () => void = () => {}
  const lock = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  bbtipsBrowserRequestLock = lock

  try {
    return await task()
  } finally {
    if (bbtipsBrowserRequestLock === lock) {
      bbtipsBrowserRequestLock = null
    }
    releaseLock()
  }
}

const fetchBbtipsFromBrowser = async (
  endpoints: BbtipsEndpointSpec[],
  token: string,
  includeTextPreview: boolean,
): Promise<Record<string, BbtipsEndpointResult>> => {
  if (endpoints.length === 0) return {}

  return withBbtipsBrowserRequestLock(async () => {
    let session = await getBbtipsBrowserSession()
    hideBbtipsBrowserWindow()
    const results: Record<string, BbtipsEndpointResult> = {}
    const ready = await ensureBbtipsBrowserReady(session).catch(() => false)
    hideBbtipsBrowserWindow()
    if (!ready) {
      return Object.fromEntries(
        endpoints.map((item) => [
          item.key,
          {
            error: 'Sessao visual do BB Tips ainda esta presa na verificacao de seguranca.',
            ok: false,
            parsed: null,
            status: 0,
            transport: 'browser',
          } satisfies BbtipsEndpointResult,
        ]),
      )
    }
  const evaluateBatch = (
    activeSession: BbtipsBrowserSession,
    batch: BbtipsEndpointSpec[],
  ) => activeSession.page.evaluate(
    async ({ endpoints, includeTextPreview, requestTimeoutMs, token }) => {
      const resolveBrowserToken = () => {
        try {
          const directToken = globalThis.localStorage?.getItem('access_token')?.trim()
          if (directToken) return directToken

          const currentUserRaw = globalThis.localStorage?.getItem('currentUser')
          if (!currentUserRaw) return token

          const parsedUser = JSON.parse(currentUserRaw) as { token?: string }
          return parsedUser.token?.trim() || token
        } catch {
          return token
        }
      }

      const entries = await Promise.all(
        endpoints.map(async (item) => {
          try {
            const BrowserXMLHttpRequest = (globalThis as unknown as {
              XMLHttpRequest: new () => {
                onerror?: (() => void) | null
                onload?: (() => void) | null
                ontimeout?: (() => void) | null
                open: (method: string, url: string, async?: boolean) => void
                responseText?: string
                send: (body?: unknown) => void
                setRequestHeader: (name: string, value: string) => void
                status: number
                timeout?: number
              }
            }).XMLHttpRequest
            const authToken = resolveBrowserToken()
            const result = await new Promise<readonly [string, BbtipsEndpointResult]>((resolve) => {
              const request = new BrowserXMLHttpRequest()
              request.open('GET', item.url, true)
              request.timeout = requestTimeoutMs
              request.setRequestHeader('Accept', 'application/json, text/plain, */*')
              if (authToken) {
                request.setRequestHeader('Authorization', `Bearer ${authToken}`)
              }
              request.setRequestHeader('Content-Type', 'application/json')

              const finalize = () => {
                const text = String(request.responseText ?? '')
                let parsed: unknown | null = null

                try {
                  parsed = JSON.parse(text)
                } catch {
                  parsed = null
                }

                resolve([item.key, {
                  ok: request.status >= 200 && request.status < 300 && parsed !== null,
                  parsed,
                  status: request.status,
                  textPreview: includeTextPreview ? text.slice(0, 500) : undefined,
                  transport: 'browser',
                } satisfies BbtipsEndpointResult] as const)
              }

              request.onload = finalize
              request.onerror = () => {
                resolve([item.key, {
                  error: 'XHR browser request failed.',
                  ok: false,
                  parsed: null,
                  status: 0,
                  transport: 'browser',
                } satisfies BbtipsEndpointResult] as const)
              }
              request.ontimeout = () => {
                resolve([item.key, {
                  error: 'XHR browser request timed out.',
                  ok: false,
                  parsed: null,
                  status: 0,
                  transport: 'browser',
                } satisfies BbtipsEndpointResult] as const)
              }

              request.send(null)
            })

            return result
          } catch (error) {
            return [item.key, {
              error: error instanceof Error ? error.message : String(error),
              ok: false,
              parsed: null,
              status: 0,
              transport: 'browser',
            }] as const
          }
        }),
      )

      return Object.fromEntries(entries)
    },
    {
      endpoints: batch,
      includeTextPreview,
      requestTimeoutMs: bbtipsBrowserRequestTimeoutMs,
      token,
    },
  )

  for (let index = 0; index < endpoints.length; index += bbtipsBrowserBatchSize) {
    const batch = endpoints.slice(index, index + bbtipsBrowserBatchSize)
    let batchResults: Record<string, BbtipsEndpointResult>
    const batchPlatform = batch[0]?.platform

    try {
      if (batchPlatform) {
        const batchPageUrl = bbtipsPlatformConfigByPlatform[batchPlatform].pageUrl
        const currentPageUrl = session.page.url()
        const targetPath = new URL(batchPageUrl).pathname
        const currentPath = currentPageUrl ? new URL(currentPageUrl).pathname : ''

        if (currentPath !== targetPath) {
          await session.page.goto(batchPageUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
          })
          await session.page.waitForTimeout(bbtipsBrowserWarmupMs)
        }
      }
      batchResults = await evaluateBatch(session, batch) as Record<string, BbtipsEndpointResult>
    } catch (error) {
      if (!isBbtipsBrowserClosedError(error)) {
        throw error
      }

      bbtipsBrowserSessionPromise = null
      await disposeBbtipsBrowserSession(session)
      session = await getBbtipsBrowserSession()
      hideBbtipsBrowserWindow()
      if (batchPlatform) {
        await session.page.goto(bbtipsPlatformConfigByPlatform[batchPlatform].pageUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        })
        await session.page.waitForTimeout(bbtipsBrowserWarmupMs)
      }
      batchResults = await evaluateBatch(session, batch) as Record<string, BbtipsEndpointResult>
    }

    Object.assign(results, batchResults as Record<string, BbtipsEndpointResult>)
    hideBbtipsBrowserWindow()

    if (index + bbtipsBrowserBatchSize < endpoints.length) {
      await session.page.waitForTimeout(bbtipsBrowserBatchDelayMs)
    }
  }

    return results
  })
}

const fetchOneBbtipsEndpoint = async (
  item: BbtipsEndpointSpec,
  token: string,
  includeTextPreview: boolean,
  cookieHeader?: string | null,
): Promise<readonly [string, BbtipsEndpointResult]> => {
  const maxAttempts = getBbtipsRequestMaxAttempts(item.platform)
  const requestTimeoutMs = getBbtipsRequestTimeoutMs(item.platform)
  let lastResult: BbtipsEndpointResult | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)

    try {
      const response = await fetch(item.url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          'Content-Type': 'application/json',
          Origin: 'https://app.bbtips.com.br',
          Pragma: 'no-cache',
          Referer: 'https://app.bbtips.com.br/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
          'sec-ch-ua': '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
        },
        signal: controller.signal,
      })
      const text = await response.text()
      let parsed: unknown | null = null

      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }

      const rejectedPayload = isRejectedBbtipsPayload(parsed)
      const status = rejectedPayload && parsed && typeof parsed === 'object' && 'status' in parsed
        ? Number((parsed as { status?: unknown }).status) || response.status
        : response.status

      lastResult = {
        ok: response.ok && parsed !== null && !rejectedPayload,
        parsed,
        status,
        textPreview: includeTextPreview ? text.slice(0, 500) : undefined,
        transport: 'node',
      } satisfies BbtipsEndpointResult

      const shouldRetry =
        attempt < maxAttempts &&
        !lastResult.ok &&
        [0, 408, 425, 429, 500, 502, 503, 504].includes(status)

      if (shouldRetry) {
        await sleep(250 * attempt)
        continue
      }

      return [item.key, lastResult] as const
    } catch (error) {
      lastResult = {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
        parsed: null,
        status: 0,
        transport: 'node',
      } satisfies BbtipsEndpointResult

      if (attempt < maxAttempts) {
        await sleep(250 * attempt)
        continue
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  return [item.key, lastResult ?? {
    error: 'Falha desconhecida ao consultar a fonte real.',
    ok: false,
    parsed: null,
    status: 0,
    transport: 'node',
  } satisfies BbtipsEndpointResult] as const
}

const fetchBbtipsFromApi = async (
  endpoints: BbtipsEndpointSpec[],
  token: string,
  includeTextPreview: boolean,
  options: {
    cookieHeaderByUrl?: Map<string, string | null>
    enableBrowserFallback?: boolean
  } = {},
) : Promise<Record<string, BbtipsEndpointResult>> => {
  // Node: tudo em paralelo (rápido). Puppeteer continua em lotes pequenos só no fallback 403.
  const { cookieHeaderByUrl, enableBrowserFallback = false } = options
  const shouldUseBrowserPrimary =
    enableBrowserFallback &&
    endpoints.length > 0 &&
    endpoints.every((item) => bbtipsBrowserPrimaryPlatforms.has(item.platform))

  if (shouldUseBrowserPrimary) {
    const browserResults = await fetchBbtipsFromBrowser(endpoints, token, includeTextPreview)
    const failedBrowserEntries = await Promise.all(
      endpoints
        .filter((item) => !browserResults[item.key]?.ok)
        .map((item) =>
          fetchOneBbtipsEndpoint(
            item,
            token,
            includeTextPreview,
            cookieHeaderByUrl?.get(item.url) ?? null,
          ),
        ),
    )

    if (failedBrowserEntries.length === 0) {
      return browserResults
    }

    return {
      ...browserResults,
      ...(Object.fromEntries(failedBrowserEntries) as Record<string, BbtipsEndpointResult>),
    }
  }

  const entries = await Promise.all(
    endpoints.map((item) =>
      fetchOneBbtipsEndpoint(
        item,
        token,
        includeTextPreview,
        cookieHeaderByUrl?.get(item.url) ?? null,
      ),
    ),
  )
  const nodeResults = Object.fromEntries(entries) as Record<string, BbtipsEndpointResult>
  const fallbackEligibleStatuses = new Set([0, 401, 403, 408, 425, 429, 500, 502, 503, 504])
  const blockedEndpoints = endpoints.filter((item) => {
    const result = nodeResults[item.key]
    const staleSynchronizedPayload =
      result?.ok &&
      bbtipsSilentBrowserFallbackPlatforms.has(item.platform) &&
      hasUsableBbtipsPayload(result.parsed as BbtipsRawPayload | null | undefined) &&
      !hasSynchronizedUsableBbtipsPayload(
        result.parsed as BbtipsRawPayload | null | undefined,
        item.platform,
      )

    return fallbackEligibleStatuses.has(result?.status ?? 0) || staleSynchronizedPayload
  })

  if (blockedEndpoints.length === 0 || !enableBrowserFallback) {
    return nodeResults
  }

  const browserResults = await fetchBbtipsFromBrowser(blockedEndpoints, token, includeTextPreview)

  return {
    ...nodeResults,
    ...browserResults,
  }
}

const createBbtipsLivePlugin = (env: BbtipsEnv): Plugin => {
  const cacheByKey = new Map<string, BbtipsCacheEntry>()
  const bridgeIngestEvents: Array<Record<string, unknown>> = []
  const bridgePingEvents: Array<Record<string, unknown>> = []
  const bridgeLatestPayloadByKey = new Map<string, BbtipsLivePlatformPayload>()
  const refreshPromiseByKey = new Map<string, Promise<BbtipsLivePlatformPayload>>()
  const hotLeagueStatusByKey = new Map<string, BbtipsHotLeagueStatus>()
  const hotRefreshPromiseByKey = new Map<string, Promise<void>>()
  const hotWorkerTimerByKey = new Map<string, ReturnType<typeof setTimeout>>()
  const startedHotWorkerKeys = new Set<string>()
  const hotPeriodsByPlatform = new Map<BbtipsPlatform, Set<Period>>(
    [...bbtipsHotWorkerPlatforms].map((platform) => [platform, new Set<Period>(['12h'])]),
  )
  const includeDiagnostics = env.BBTIPS_INCLUDE_DIAGNOSTICS === 'true'
  const enableBackgroundWarmup = env.BBTIPS_ENABLE_BACKGROUND_WARMUP === 'true'
  const enableBrowserFallback = env.BBTIPS_ENABLE_BROWSER_FALLBACK === 'true'
  const enableRenderedMatrixMeta = env.BBTIPS_ENABLE_RENDERED_MATRIX_META === 'true'
  const includeLegacyOdds = env.BBTIPS_INCLUDE_LEGACY_ODDS === 'true'
  const shouldUseBrowserFallbackForPlatform = (platform: BbtipsPlatform) =>
    enableBrowserFallback || bbtipsSilentBrowserFallbackPlatforms.has(platform)
  const buildHotWorkerKey = (platform: BbtipsPlatform, period: Period) => `${platform}:${period}`
  const buildHotLeagueStatusKey = (platform: BbtipsPlatform, period: Period, leagueKey: string) =>
    `${platform}:${period}:${leagueKey}`
  const getEmptyHotLeagueStatus = (): BbtipsHotLeagueStatus => ({
    consecutiveFailures: 0,
    freshnessMs: null,
    lastError: null,
    lastObservedUpstreamAt: null,
    lastPublishedUpdatedAt: null,
    lastSuccessfulSyncAt: null,
    staleReason: null,
    validatedAt: null,
    validationStatus: 'idle',
  })
  const updateHotLeagueStatus = (
    platform: BbtipsPlatform,
    period: Period,
    leagueKey: string,
    patch: Partial<BbtipsHotLeagueStatus>,
  ) => {
    const statusKey = buildHotLeagueStatusKey(platform, period, leagueKey)
    const currentStatus = hotLeagueStatusByKey.get(statusKey) ?? getEmptyHotLeagueStatus()
    const nextStatus = {
      ...currentStatus,
      ...patch,
    } satisfies BbtipsHotLeagueStatus
    hotLeagueStatusByKey.set(statusKey, nextStatus)
    return nextStatus
  }
  const rememberHotPeriod = (platform: BbtipsPlatform, period: Period) => {
    if (!bbtipsHotWorkerPlatforms.has(platform)) return

    const periods = hotPeriodsByPlatform.get(platform) ?? new Set<Period>()
    periods.add(period)
    hotPeriodsByPlatform.set(platform, periods)
  }
  const readExactBasePayload = (
    platform: BbtipsPlatform,
    requestedPeriod: Period,
    requestedLeagues: BbtipsLeagueSpec[],
    maxAgeMs: number,
  ) =>
    sanitizeBbtipsLivePayload(
      cacheByKey.get(buildBbtipsCacheKey(platform, [], requestedPeriod, requestedLeagues))?.payload ??
      readBbtipsPersistentCache(
        buildBbtipsCacheKey(platform, [], requestedPeriod, requestedLeagues),
        maxAgeMs,
      ),
    )
  const readHotLeagueSnapshot = (
    platform: BbtipsPlatform,
    requestedPeriod: Period,
    league: BbtipsLeagueSpec,
    maxAgeMs = bbtipsPersistentCacheEmergencyMaxAgeMs,
  ) => {
    const exactPayload = readExactBasePayload(platform, requestedPeriod, [league], maxAgeMs)
    return exactPayload?.leagues?.find((entry) => entry.key === league.key) ?? null
  }
  const buildHotPlatformPayload = (
    platform: BbtipsPlatform,
    requestedPeriod: Period,
    requestedLeagues: BbtipsLeagueSpec[],
    maxAgeMs: number,
  ) => {
    const exactBasePayload = readExactBasePayload(platform, requestedPeriod, requestedLeagues, maxAgeMs)
    const perLeagueSnapshotPayload = buildLeagueSnapshotFallbackPayload(
      platform,
      requestedPeriod,
      requestedLeagues,
      maxAgeMs,
    )
    const selectedPayload = pickFresherBbtipsLivePayload(exactBasePayload, perLeagueSnapshotPayload)
    return selectedPayload
      ? {
          ...selectedPayload,
          source: 'cache' as const,
        }
      : null
  }

  const getBestCachedLeaguePayload = (
    platform: BbtipsPlatform,
    requestedPeriod: Period,
    league: BbtipsLeagueSpec,
    maxAgeMs = bbtipsPersistentCacheEmergencyMaxAgeMs,
  ) => {
    const exactCacheKey = buildBbtipsCacheKey(platform, [], requestedPeriod, [league])
    const exactPayload =
      sanitizeBbtipsLivePayload(cacheByKey.get(exactCacheKey)?.payload) ??
      readBbtipsPersistentCache(exactCacheKey, maxAgeMs)
    const compatiblePayload =
      readLatestCompatibleBbtipsPersistentCache(
        platform,
        [],
        requestedPeriod,
        [league],
        maxAgeMs,
      )

    const exactLeague = exactPayload?.leagues?.find((entry) => entry.key === league.key) ?? null
    const compatibleLeague = compatiblePayload?.leagues?.find((entry) => entry.key === league.key) ?? null

    if (!exactLeague && !compatibleLeague) return null
    if (!exactLeague) return compatibleLeague
    if (!compatibleLeague) return exactLeague

    return {
      ...exactLeague,
      current: stabilizeBbtipsPayload(exactLeague.current, compatibleLeague.current),
      future: stabilizeBbtipsPayload(exactLeague.future, compatibleLeague.future),
    }
  }

  const buildLeagueSnapshotFallbackPayload = (
    platform: BbtipsPlatform,
    requestedPeriod: Period,
    requestedLeagues: BbtipsLeagueSpec[],
    maxAgeMs = bbtipsPersistentCacheEmergencyMaxAgeMs,
  ) => {
    const fallbackLeagues = requestedLeagues
      .map((league) => getBestCachedLeaguePayload(platform, requestedPeriod, league, maxAgeMs))
      .filter((league): league is NonNullable<typeof league> => Boolean(league))

    return buildBbtipsLivePayloadFromLeagues(platform, requestedPeriod, fallbackLeagues, 'cache')
  }

  const writeLeagueSnapshots = (
    platform: BbtipsPlatform,
    requestedPeriod: Period,
    leagues: BbtipsLivePlatformPayload['leagues'],
  ) => {
    leagues.forEach((leaguePayload) => {
      const leagueSpec = bbtipsLeagueSpecsByPlatform[platform].find((league) => league.key === leaguePayload.key)
      if (!leagueSpec) return
      if (!hasUsableBbtipsPayload(leaguePayload.current) && !hasUsableBbtipsPayload(leaguePayload.future)) return

      const payload = buildBbtipsLivePayloadFromLeagues(platform, requestedPeriod, [leaguePayload], 'live')
      if (!payload) return

      const cacheKey = buildBbtipsCacheKey(platform, [], requestedPeriod, [leagueSpec])
      cacheByKey.set(cacheKey, {
        expiresAt: Date.now() + getBbtipsClientCacheTtlMs(platform),
        payload,
      })
      writeBbtipsPersistentCache(cacheKey, payload)
    })
  }

  const refreshLivePayload = async (
    platform: BbtipsPlatform,
    requestedMarkets: BbtipsRequestedMarket[],
    requestedPeriod: Period,
    requestedLeagues: BbtipsLeagueSpec[],
  ) => {
    const cacheKey = buildBbtipsCacheKey(platform, requestedMarkets, requestedPeriod, requestedLeagues)
    const inFlight = refreshPromiseByKey.get(cacheKey)
    if (inFlight) {
      return inFlight
    }

    const nextRefresh = (async () => {
      const platformConfig = bbtipsPlatformConfigByPlatform[platform]
      const leagueSpecs = requestedLeagues
      const upstreamPeriod = resolveBbtipsUpstreamPeriod(requestedPeriod, platform)
      const cachedRequestedPayload =
        sanitizeBbtipsLivePayload(cacheByKey.get(cacheKey)?.payload) ??
        readBbtipsPersistentCache(cacheKey, bbtipsPersistentCacheEmergencyMaxAgeMs)
      const cachedBasePayload =
        requestedMarkets.length > 0
          ? sanitizeBbtipsLivePayload(cacheByKey.get(buildBbtipsCacheKey(platform, [], requestedPeriod, requestedLeagues))?.payload) ??
            readBbtipsPersistentCache(
              buildBbtipsCacheKey(platform, [], requestedPeriod, requestedLeagues),
              bbtipsPersistentCacheEmergencyMaxAgeMs,
            )
          : cachedRequestedPayload
      const cachedLeagueByKey = new Map<string, BbtipsLivePlatformPayload['leagues'][number]>()
      ;[...(cachedRequestedPayload?.leagues ?? []), ...(cachedBasePayload?.leagues ?? [])].forEach((league) => {
        cachedLeagueByKey.set(league.key, league)
      })
      leagueSpecs.forEach((league) => {
        if (!cachedLeagueByKey.has(league.key)) {
          const snapshotLeague = getBestCachedLeaguePayload(platform, requestedPeriod, league)
          if (snapshotLeague) {
            cachedLeagueByKey.set(league.key, snapshotLeague)
          }
        }
      })
      // Legacy ajuda a completar o vetor Odds; limite evita estourar o browser com muitos filtros.
      const includeLegacyBaseOdds =
        includeLegacyOdds
          ? requestedMarkets.length > 0 && requestedMarkets.length <= 32
          : requestedMarkets.length === 0 || requestedMarkets.length <= 32
      const endpoints = leagueSpecs.flatMap((league) => {
        const baseEndpoints: BbtipsEndpointSpec[] = []
        const cachedBaseLeague = cachedLeagueByKey.get(league.key)
        const hasCachedBaseCurrent = hasUsableBbtipsPayload(cachedBaseLeague?.current)
        const hasCachedBaseFuture = hasUsableBbtipsPayload(cachedBaseLeague?.future)
        const mustFetchBaseCurrent = requestedMarkets.length === 0 || !hasCachedBaseCurrent
        const mustFetchBaseFuture = requestedMarkets.length === 0 || !hasCachedBaseFuture

        if (mustFetchBaseCurrent) {
          baseEndpoints.push({
            key: `${league.key}:current`,
            platform,
            url: platformConfig.buildCurrentUrl(league.id, upstreamPeriod),
          })
        }

        if (mustFetchBaseCurrent && platformConfig.buildLegacyCurrentUrl && includeLegacyBaseOdds) {
          baseEndpoints.push({
            key: `${league.key}:legacy-current`,
            platform,
            url: platformConfig.buildLegacyCurrentUrl(league.id, upstreamPeriod),
          })
        }

        if (platformConfig.buildFutureUrl) {
          if (mustFetchBaseFuture) {
            baseEndpoints.push({
              key: `${league.key}:future`,
              platform,
              url: platformConfig.buildFutureUrl(league.id, upstreamPeriod),
            })
          }

          if (mustFetchBaseFuture && platformConfig.buildLegacyFutureUrl && includeLegacyBaseOdds) {
            baseEndpoints.push({
              key: `${league.key}:legacy-future`,
              platform,
              url: platformConfig.buildLegacyFutureUrl(league.id, upstreamPeriod),
            })
          }
        }

        const marketEndpoints = requestedMarkets.flatMap(({ code, market }) => {
          const currentEndpoint: BbtipsEndpointSpec[] = [{
            key: `${league.key}:market:${code}:current`,
            market,
            platform,
            url: platformConfig.buildCurrentUrl(league.id, upstreamPeriod, code),
          }]

          if (platformConfig.buildFutureUrl) {
            currentEndpoint.push({
              key: `${league.key}:market:${code}:future`,
              market,
              platform,
              url: platformConfig.buildFutureUrl(league.id, upstreamPeriod, code),
            })
          }

          return currentEndpoint
        })

        return [...baseEndpoints, ...marketEndpoints]
      })
      const tokenState = resolveBbtipsAccessToken(env)
      if (!tokenState?.token) {
        throw new Error('Sessao de dados reais indisponivel. Atualize o login local.')
      }
      if (isJwtExpired(tokenState.token)) {
        throw new Error('Sessao de dados reais expirada. Atualize o login local.')
      }

      const cookieHeaderByUrl = new Map<string, string | null>()
      endpoints.forEach((endpoint) => {
        if (!cookieHeaderByUrl.has(endpoint.url)) {
          cookieHeaderByUrl.set(endpoint.url, buildBbtipsCookieHeader(endpoint.url))
        }
      })

      const results = await fetchBbtipsFromApi(endpoints, tokenState.token, includeDiagnostics, {
        cookieHeaderByUrl,
        enableBrowserFallback: shouldUseBrowserFallbackForPlatform(platform),
      })
      const leagueEntries = []
      for (const league of leagueSpecs) {
        const currentResult = results[`${league.key}:current`]
        const futureResult = results[`${league.key}:future`]
        const legacyCurrentResult = results[`${league.key}:legacy-current`]
        const legacyFutureResult = results[`${league.key}:legacy-future`]
        const cachedBaseLeague = cachedLeagueByKey.get(league.key)
        const marketCurrentPayloads = requestedMarkets.map(
          ({ code }) => results[`${league.key}:market:${code}:current`]?.parsed as BbtipsRawPayload | null | undefined,
        )
        const marketFuturePayloads = requestedMarkets.map(
          ({ code }) => results[`${league.key}:market:${code}:future`]?.parsed as BbtipsRawPayload | null | undefined,
        )
        const liveCurrentPayload = mergeBbtipsPayloadWithLegacyOdds(
          currentResult?.parsed as BbtipsRawPayload | null | undefined,
          legacyCurrentResult?.parsed as BbtipsRawPayload | null | undefined,
        )
        const liveFuturePayload = mergeBbtipsPayloadWithLegacyOdds(
          futureResult?.parsed as BbtipsRawPayload | null | undefined,
          legacyFutureResult?.parsed as BbtipsRawPayload | null | undefined,
        )
        const preferredMarketCurrentPayload = marketCurrentPayloads.reduce(
          (selectedPayload, candidatePayload) =>
            pickPreferredBbtipsPayload(selectedPayload, candidatePayload),
          null as BbtipsRawPayload | null,
        )
        const preferredMarketFuturePayload = marketFuturePayloads.reduce(
          (selectedPayload, candidatePayload) =>
            pickPreferredBbtipsPayload(selectedPayload, candidatePayload),
          null as BbtipsRawPayload | null,
        )
        const hasLiveSourcePayload = [
          liveCurrentPayload,
          liveFuturePayload,
          ...marketCurrentPayloads,
          ...marketFuturePayloads,
        ].some((payload) => hasUsableBbtipsPayload(payload ?? null))
        const hasSynchronizedLiveSourcePayload = [
          liveCurrentPayload,
          liveFuturePayload,
          ...marketCurrentPayloads,
          ...marketFuturePayloads,
        ].some((payload) => hasSynchronizedUsableBbtipsPayload(payload ?? null, platform))
        const baseCurrentPayload = pickDisplayableBbtipsPayload(
          platform,
          liveCurrentPayload,
          hasLiveSourcePayload ? cachedBaseLeague?.current : null,
        )
        const baseFuturePayload = pickDisplayableBbtipsPayload(
          platform,
          liveFuturePayload,
          hasLiveSourcePayload ? cachedBaseLeague?.future : null,
        )
        let currentPayload = pickPreferredBbtipsPayload(baseCurrentPayload, preferredMarketCurrentPayload)
        let futurePayload = pickPreferredBbtipsPayload(baseFuturePayload, preferredMarketFuturePayload)

        requestedMarkets.forEach(({ code, market }) => {
          const marketCurrentPayload =
            results[`${league.key}:market:${code}:current`]?.parsed as BbtipsRawPayload | null | undefined
          const marketFuturePayload =
            (results[`${league.key}:market:${code}:future`]?.parsed as BbtipsRawPayload | null | undefined) ??
            (!platformConfig.buildFutureUrl ? marketCurrentPayload : null)

          currentPayload = mergeBbtipsPayloadWithMarketOdds(
            currentPayload,
            marketCurrentPayload,
            market,
          )

          futurePayload = mergeBbtipsPayloadWithMarketOdds(
            futurePayload,
            marketFuturePayload,
            market,
          )
        })

        if (hasLiveSourcePayload) {
          currentPayload = pickDisplayableBbtipsPayload(platform, currentPayload, cachedBaseLeague?.current)
          futurePayload = pickDisplayableBbtipsPayload(platform, futurePayload, cachedBaseLeague?.future)
        }

        if (platform === 'PlayPix' && currentPayload) {
          futurePayload = shouldReuseDerivedBbtipsFuturePayload(platform, currentPayload, futurePayload)
            ? futurePayload
            : currentPayload
        }

        let resolvedCurrentPayload = filterBbtipsPayloadByResolution(currentPayload, true)
        let resolvedFuturePayload =
          platform === 'Betano'
            ? filterBbtipsPayloadByResolution(currentPayload, false)
            : filterBbtipsPayloadByResolution(
              futurePayload ?? currentPayload,
              false,
            )

        const renderedMatrixMeta = enableRenderedMatrixMeta
          ? await scrapeBbtipsRenderedMatrixMeta(platform, league).catch(() => null)
          : null
        if (renderedMatrixMeta) {
          const currentLineCount = resolvedCurrentPayload?.Linhas?.length ?? 0
          const futureLineCount = resolvedFuturePayload?.Linhas?.length ?? 0
          const currentRowHours =
            renderedMatrixMeta.currentRowHours.length >= currentLineCount && currentLineCount > 0
              ? renderedMatrixMeta.currentRowHours.slice(0, currentLineCount)
              : []
          const futureRowHours =
            renderedMatrixMeta.futureRowHours.length >= futureLineCount && futureLineCount > 0
              ? renderedMatrixMeta.futureRowHours.slice(0, futureLineCount)
              : []
          const canStampCurrent =
            currentRowHours.length >= currentLineCount &&
            currentLineCount > 0 &&
            isValidRenderedCurrentHourSequence(currentRowHours)
          const canStampFuture =
            futureRowHours.length >= futureLineCount &&
            futureLineCount > 0 &&
            isValidRenderedFutureHourSequence(futureRowHours)
          const currentAnchorHour =
            currentRowHours[0] ??
            renderedMatrixMeta.currentRowHours[0] ??
            resolvedCurrentPayload?.Linhas?.[0]?.Hora

          if (canStampCurrent) {
            resolvedCurrentPayload = stampBbtipsPayloadWithRenderedMatrix(
              resolvedCurrentPayload,
              currentRowHours,
              renderedMatrixMeta.minuteSlots,
              Number(currentAnchorHour),
            )
          }
          if (canStampFuture) {
            resolvedFuturePayload = stampBbtipsPayloadWithRenderedMatrix(
              resolvedFuturePayload,
              futureRowHours,
              renderedMatrixMeta.minuteSlots,
              Number(currentAnchorHour),
            )
          }
        }

        leagueEntries.push({
          hasLiveSourcePayload,
          hasSynchronizedLiveSourcePayload,
          payload: {
            id: league.id,
            key: league.key,
            name: league.name,
            sub: league.sub,
            image: league.image,
            current: resolvedCurrentPayload,
            future: resolvedFuturePayload,
          },
        })
      }
      const leagues = leagueEntries.map((entry) => entry.payload)
      const realPayloadCount = leagueEntries.filter(
        (entry) =>
          entry.hasSynchronizedLiveSourcePayload &&
          (hasUsableBbtipsPayload(entry.payload.current) || hasUsableBbtipsPayload(entry.payload.future)),
      ).length

      if (realPayloadCount === 0) {
        const fallbackLeagues = leagueSpecs
          .map((league) => {
            const cachedLeague = getBestCachedLeaguePayload(platform, requestedPeriod, league)
            return cachedLeague
              ? {
                  ...cachedLeague,
                  id: league.id,
                  key: league.key,
                  name: league.name,
                  sub: league.sub,
                  image: league.image,
                }
              : null
          })
          .filter((league): league is BbtipsLivePlatformPayload['leagues'][number] => Boolean(league))
        const cachedPayload = buildBbtipsLivePayloadFromLeagues(
          platform,
          requestedPeriod,
          fallbackLeagues,
          'cache',
        )

        if (
          cachedPayload &&
          hasUsableBbtipsLivePayload(cachedPayload) &&
          isBbtipsLivePayloadFreshForPlatform(cachedPayload, platform)
        ) {
          cacheByKey.set(cacheKey, {
            expiresAt: Date.now() + getBbtipsClientCacheTtlMs(platform),
            payload: cachedPayload,
          })
          return cachedPayload
        }

        const failedResult = Object.entries(results).find(([, result]) => !result.ok)?.[1]
        throw new Error(
          failedResult?.status === 403
            ? 'A fonte de dados bloqueou a requisicao direta agora.'
            : `A fonte de dados nao retornou dados reais agora${failedResult ? ` (status ${failedResult.status})` : ''}.`,
        )
      }

      const payload: BbtipsLivePlatformPayload = {
        leagues,
        period: requestedPeriod,
        platform,
        source: 'live',
        updatedAt: resolveBbtipsLivePayloadUpdatedAt(leagues),
      }

      if (includeDiagnostics) {
        payload.diagnostics = Object.fromEntries(
          [
            ['auth', {
              platform,
              requestedPeriod,
              upstreamPeriod,
              requestedMarkets,
              tokenExpired: false,
              tokenSource: tokenState.source,
            }],
            ...Object.entries(results).map(([key, result]) => [
              key,
              {
                error: result.error,
                ok: result.ok,
                status: result.status,
                textPreview: result.textPreview,
                transport: result.transport,
              },
            ] as const),
          ].map(([key, result]) => [
            key,
            result,
          ]),
        )
      }

      cacheByKey.set(cacheKey, {
        expiresAt: Date.now() + getBbtipsClientCacheTtlMs(platform),
        payload,
      })
      writeBbtipsPersistentCache(cacheKey, payload)
        writeLeagueSnapshots(
        platform,
        requestedPeriod,
        leagueEntries
          .filter((entry) => entry.hasSynchronizedLiveSourcePayload)
          .map((entry) => entry.payload),
      )

      return payload
    })()
      .finally(() => {
        refreshPromiseByKey.delete(cacheKey)
      })

    refreshPromiseByKey.set(cacheKey, nextRefresh)
    return nextRefresh
  }

  const markHotLeagueFailure = (
    platform: BbtipsPlatform,
    requestedPeriod: Period,
    league: BbtipsLeagueSpec,
    errorMessage: string,
    staleReason: string,
  ) => {
    const currentStatus =
      hotLeagueStatusByKey.get(buildHotLeagueStatusKey(platform, requestedPeriod, league.key)) ??
      getEmptyHotLeagueStatus()
    const currentSnapshot = readHotLeagueSnapshot(platform, requestedPeriod, league)
    const currentSnapshotUpdatedAt = Math.max(
      getBbtipsPayloadUpdateTimestamp(currentSnapshot?.current),
      getBbtipsPayloadUpdateTimestamp(currentSnapshot?.future),
      0,
    )

    updateHotLeagueStatus(platform, requestedPeriod, league.key, {
      consecutiveFailures: currentStatus.consecutiveFailures + 1,
      freshnessMs: currentSnapshotUpdatedAt > 0 ? Date.now() - currentSnapshotUpdatedAt : null,
      lastError: errorMessage,
      staleReason,
      validationStatus: 'error',
    })
  }

  const refreshHotPlatformPeriod = async (
    platform: BbtipsPlatform,
    requestedPeriod: Period,
    priorityLeagues: BbtipsLeagueSpec[] = [],
  ) => {
    const workerKey = buildHotWorkerKey(platform, requestedPeriod)
    const inFlight = hotRefreshPromiseByKey.get(workerKey)
    if (inFlight) {
      return inFlight
    }

    const nextRefresh = (async () => {
      const leagueSpecs = normalizeRequestedBbtipsLeagues(platform, [])
      if (leagueSpecs.length === 0) return

      const tokenState = resolveBbtipsAccessToken(env)
      if (!tokenState?.token) {
        leagueSpecs.forEach((league) => {
          markHotLeagueFailure(
            platform,
            requestedPeriod,
            league,
            'Sessao local da BB Tips indisponivel para o worker quente.',
            'auth-unavailable',
          )
        })
        return
      }
      if (isJwtExpired(tokenState.token)) {
        leagueSpecs.forEach((league) => {
          markHotLeagueFailure(
            platform,
            requestedPeriod,
            league,
            'Sessao local da BB Tips expirou para o worker quente.',
            'auth-expired',
          )
        })
        return
      }

      const timestampEndpoints = leagueSpecs
        .filter(() => !bbtipsSkipTimestampProbePlatforms.has(platform))
        .map((league) => {
          const url = buildBbtipsUpdatedAtUrl(platform, league.id)
          if (!url) return null

          return {
            key: `${league.key}:updatedAt`,
            platform,
            url,
          } satisfies BbtipsEndpointSpec
        })
        .filter((endpoint): endpoint is BbtipsEndpointSpec => Boolean(endpoint))

      const leaguesToRefresh: BbtipsLeagueSpec[] = []

      if (timestampEndpoints.length === 0) {
        leaguesToRefresh.push(...leagueSpecs)
      } else {
        const timestampCookieHeaderByUrl = new Map<string, string | null>()
        timestampEndpoints.forEach((endpoint) => {
          if (!timestampCookieHeaderByUrl.has(endpoint.url)) {
            timestampCookieHeaderByUrl.set(endpoint.url, buildBbtipsCookieHeader(endpoint.url))
          }
        })
        const probeResults = await fetchBbtipsFromApi(
          timestampEndpoints,
          tokenState.token,
          includeDiagnostics,
          {
            cookieHeaderByUrl: timestampCookieHeaderByUrl,
            enableBrowserFallback: shouldUseBrowserFallbackForPlatform(platform),
          },
        )

        leagueSpecs.forEach((league) => {
        const probeResult = probeResults[`${league.key}:updatedAt`]
        if (!probeResult?.ok) {
          markHotLeagueFailure(
            platform,
            requestedPeriod,
            league,
            probeResult?.error ?? `Falha no probe de atualizacao (status ${probeResult?.status ?? 0}).`,
            'timestamp-probe-failed-refreshing-direct',
          )
          leaguesToRefresh.push(league)
          return
        }

        const rawObservedAt = String(probeResult.parsed ?? '').replace(/^"+|"+$/g, '').trim()
        if (!rawObservedAt) {
          markHotLeagueFailure(
            platform,
            requestedPeriod,
            league,
            'Probe de atualizacao veio vazio.',
            'timestamp-empty',
          )
          return
        }

        const currentStatus =
          hotLeagueStatusByKey.get(buildHotLeagueStatusKey(platform, requestedPeriod, league.key)) ??
          getEmptyHotLeagueStatus()
        const currentSnapshot = readHotLeagueSnapshot(platform, requestedPeriod, league)
        const currentSnapshotUpdatedAt = Math.max(
          getBbtipsPayloadUpdateTimestamp(currentSnapshot?.current),
          getBbtipsPayloadUpdateTimestamp(currentSnapshot?.future),
          0,
        )
        const observedAtMs = parseBbtipsTimestamp(rawObservedAt)
        const previousObservedAtMs = parseBbtipsTimestamp(currentStatus.lastObservedUpstreamAt ?? '')

        if (
          observedAtMs &&
          previousObservedAtMs &&
          observedAtMs < previousObservedAtMs
        ) {
          updateHotLeagueStatus(platform, requestedPeriod, league.key, {
            freshnessMs: currentSnapshotUpdatedAt > 0 ? Date.now() - currentSnapshotUpdatedAt : null,
            lastError: 'Probe de atualizacao regressivo rejeitado.',
            lastObservedUpstreamAt: currentStatus.lastObservedUpstreamAt,
            staleReason: 'timestamp-regressed',
            validatedAt: Date.now(),
            validationStatus: 'rejected',
          })
          return
        }

        const snapshotIsStale =
          currentSnapshotUpdatedAt > 0 &&
          Date.now() - currentSnapshotUpdatedAt > getBbtipsHotPriorityRefreshMaxAgeMs(platform)
        const needsRefresh =
          !currentSnapshot ||
          currentStatus.lastObservedUpstreamAt !== rawObservedAt ||
          snapshotIsStale

        updateHotLeagueStatus(platform, requestedPeriod, league.key, {
          freshnessMs: currentSnapshotUpdatedAt > 0 ? Date.now() - currentSnapshotUpdatedAt : null,
          lastError: null,
          lastObservedUpstreamAt: rawObservedAt,
          staleReason: needsRefresh ? (snapshotIsStale ? 'snapshot-stale' : 'upstream-changed') : null,
        })

        if (needsRefresh) {
          leaguesToRefresh.push(league)
        }
        })
      }

      const priorityLeagueKeys = new Set(priorityLeagues.map((league) => league.key))
      const limitedLeaguesToRefresh = leaguesToRefresh
        .sort((left, right) => {
          const leftIsPriority = priorityLeagueKeys.has(left.key)
          const rightIsPriority = priorityLeagueKeys.has(right.key)
          if (leftIsPriority !== rightIsPriority) {
            return leftIsPriority ? -1 : 1
          }

          const leftSnapshot = readHotLeagueSnapshot(platform, requestedPeriod, left)
          const rightSnapshot = readHotLeagueSnapshot(platform, requestedPeriod, right)
          const leftUpdatedAt = Math.max(
            getBbtipsPayloadUpdateTimestamp(leftSnapshot?.current),
            getBbtipsPayloadUpdateTimestamp(leftSnapshot?.future),
            0,
          )
          const rightUpdatedAt = Math.max(
            getBbtipsPayloadUpdateTimestamp(rightSnapshot?.current),
            getBbtipsPayloadUpdateTimestamp(rightSnapshot?.future),
            0,
          )

          return leftUpdatedAt - rightUpdatedAt
        })
        .slice(0, bbtipsHotWorkerRefreshBatchSizeByPlatform[platform] ?? 1)

      if (limitedLeaguesToRefresh.length === 0) {
        return
      }

      let refreshedPayload: BbtipsLivePlatformPayload
      try {
        refreshedPayload = await refreshLivePayload(
          platform,
          [],
          requestedPeriod,
          limitedLeaguesToRefresh,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        limitedLeaguesToRefresh.forEach((league) => {
          markHotLeagueFailure(
            platform,
            requestedPeriod,
            league,
            message,
            'refresh-failed',
          )
        })
        return
      }

      const refreshedLeagueByKey = new Map(
        (refreshedPayload.leagues ?? []).map((leaguePayload) => [leaguePayload.key, leaguePayload]),
      )

      limitedLeaguesToRefresh.forEach((league) => {
        const refreshedLeague = refreshedLeagueByKey.get(league.key)
        const currentStatus =
          hotLeagueStatusByKey.get(buildHotLeagueStatusKey(platform, requestedPeriod, league.key)) ??
          getEmptyHotLeagueStatus()
        const publishedUpdatedAt = Math.max(
          getBbtipsPayloadUpdateTimestamp(refreshedLeague?.current),
          getBbtipsPayloadUpdateTimestamp(refreshedLeague?.future),
          0,
        )

        if (!refreshedLeague || (!hasUsableBbtipsPayload(refreshedLeague.current) && !hasUsableBbtipsPayload(refreshedLeague.future))) {
          updateHotLeagueStatus(platform, requestedPeriod, league.key, {
            consecutiveFailures: currentStatus.consecutiveFailures + 1,
            freshnessMs: currentStatus.lastPublishedUpdatedAt ? Date.now() - currentStatus.lastPublishedUpdatedAt : null,
            lastError: 'Snapshot quente vazio foi rejeitado.',
            staleReason: 'empty-snapshot',
            validatedAt: Date.now(),
            validationStatus: 'rejected',
          })
          return
        }

        if (
          currentStatus.lastPublishedUpdatedAt &&
          publishedUpdatedAt > 0 &&
          publishedUpdatedAt < currentStatus.lastPublishedUpdatedAt
        ) {
          updateHotLeagueStatus(platform, requestedPeriod, league.key, {
            consecutiveFailures: currentStatus.consecutiveFailures + 1,
            freshnessMs: Date.now() - currentStatus.lastPublishedUpdatedAt,
            lastError: 'Snapshot regressivo rejeitado.',
            staleReason: 'payload-regressed',
            validatedAt: Date.now(),
            validationStatus: 'rejected',
          })
          return
        }

        const resolvedPublishedUpdatedAt = publishedUpdatedAt || refreshedPayload.updatedAt
        updateHotLeagueStatus(platform, requestedPeriod, league.key, {
          consecutiveFailures: 0,
          freshnessMs: resolvedPublishedUpdatedAt > 0 ? Date.now() - resolvedPublishedUpdatedAt : null,
          lastError: null,
          lastPublishedUpdatedAt: resolvedPublishedUpdatedAt,
          lastSuccessfulSyncAt: Date.now(),
          staleReason: null,
          validatedAt: Date.now(),
          validationStatus: 'ok',
        })
      })
    })()
      .finally(() => {
        hotRefreshPromiseByKey.delete(workerKey)
      })

    hotRefreshPromiseByKey.set(workerKey, nextRefresh)
    return nextRefresh
  }

  const scheduleHotWorker = (
    platform: BbtipsPlatform,
    requestedPeriod: Period,
    delayMs: number,
  ) => {
    const workerKey = buildHotWorkerKey(platform, requestedPeriod)
    if (!startedHotWorkerKeys.has(workerKey)) return

    const existingTimer = hotWorkerTimerByKey.get(workerKey)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const timer = setTimeout(async () => {
      hotWorkerTimerByKey.delete(workerKey)
      try {
        await refreshHotPlatformPeriod(platform, requestedPeriod)
      } catch {
        // O status por liga ja recebe o erro; o loop deve continuar.
      } finally {
        if (startedHotWorkerKeys.has(workerKey)) {
          scheduleHotWorker(
            platform,
            requestedPeriod,
            bbtipsHotWorkerCadenceMsByPlatform[platform] ?? 1_000,
          )
        }
      }
    }, delayMs)

    hotWorkerTimerByKey.set(workerKey, timer)
  }

  const ensureHotWorker = (
    platform: BbtipsPlatform,
    requestedPeriod: Period,
    initialDelayMs = 150,
  ) => {
    if (!bbtipsHotWorkerPlatforms.has(platform)) return

    rememberHotPeriod(platform, requestedPeriod)
    const workerKey = buildHotWorkerKey(platform, requestedPeriod)
    if (startedHotWorkerKeys.has(workerKey)) return

    startedHotWorkerKeys.add(workerKey)
    scheduleHotWorker(platform, requestedPeriod, initialDelayMs)
  }

  const stopHotWorkers = () => {
    startedHotWorkerKeys.clear()
    hotWorkerTimerByKey.forEach((timer) => clearTimeout(timer))
    hotWorkerTimerByKey.clear()
  }

  const readRequestBody = async (request: import('node:http').IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []

      request.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      })
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      request.on('error', reject)
    })

  const rememberBridgeEvent = (event: Record<string, unknown>) => {
    bridgeIngestEvents.unshift({
      at: new Date().toISOString(),
      ...event,
    })
    bridgeIngestEvents.splice(40)
  }

  const rememberBridgePing = (event: Record<string, unknown>) => {
    bridgePingEvents.unshift({
      at: new Date().toISOString(),
      ...event,
    })
    bridgePingEvents.splice(20)
  }

  const buildBridgePayloadKey = (
    platform: BbtipsPlatform,
    period: Period,
    leagueKey: string,
  ) => `${platform}:${period}:${leagueKey}`

  const buildBridgePlatformPayload = (
    platform: BbtipsPlatform,
    period: Period,
    leagues: BbtipsLeagueSpec[],
  ) => {
    const bridgePayloads = leagues
      .map((league) => bridgeLatestPayloadByKey.get(buildBridgePayloadKey(platform, period, league.key)))
      .filter((payload): payload is BbtipsLivePlatformPayload => Boolean(payload))
    const bridgeLeagues = bridgePayloads.flatMap((payload) => payload.leagues)
    const payload = buildBbtipsLivePayloadFromLeagues(platform, period, bridgeLeagues, 'live')
    if (!payload) return null

    const latestPing = bridgePingEvents[0]
    const latestPingErrors = Array.isArray(latestPing?.errors) ? latestPing.errors : []
    const latestHealthyPingAt = latestPingErrors.length === 0
      ? Date.parse(String(latestPing?.at ?? ''))
      : 0
    const validatedAt = Math.max(
      ...bridgePayloads.map((bridgePayload) =>
        Math.max(
          Number(bridgePayload.diagnostics?.validatedAt ?? 0),
          Number(bridgePayload.diagnostics?.lastSuccessfulSyncAt ?? 0),
        ),
      ),
      Number.isFinite(latestHealthyPingAt) ? latestHealthyPingAt : 0,
      0,
    )
    payload.diagnostics = {
      ...(payload.diagnostics ?? {}),
      bridgeSource: 'bbtips-hot-bridge',
      freshnessMs: validatedAt ? Date.now() - validatedAt : null,
      lastSuccessfulSyncAt: validatedAt || null,
      upstreamFetchedAt: payload.updatedAt,
      validatedAt: validatedAt || null,
      validationStatus: validatedAt ? 'ok' : 'unknown',
    }

    return payload
  }

  const normalizeBbtipsCellValue = (value: unknown) =>
    String(value ?? '').trim()

  const flattenBbtipsMatrixCells = (payload: BbtipsRawPayload | null | undefined) => {
    const cells = new Map<string, Record<string, unknown>>()

    ;(payload?.Linhas ?? []).forEach((line) => {
      const hour = normalizeBbtipsCellValue(line?.Hora).padStart(2, '0')
      ;(line?.Colunas ?? []).forEach((column) => {
        const minute = normalizeBbtipsCellValue(
          column?.Minuto ?? column?.Horario ?? column?.Id,
        ).padStart(2, '0')
        if (!hour || !minute) return

        const key = `${hour}:${minute}`
        const result = normalizeBbtipsCellValue(column?.Resultado_FT ?? column?.Resultado)
        const teams = [
          normalizeBbtipsCellValue(column?.SiglaA ?? column?.TimeA),
          normalizeBbtipsCellValue(column?.SiglaB ?? column?.TimeB),
        ].filter(Boolean).join(' x ')

        cells.set(key, {
          hour,
          key,
          minute,
          result,
          teams,
        })
      })
    })

    return cells
  }

  const compareBbtipsMatrices = (
    referencePayload: BbtipsRawPayload | null | undefined,
    localPayload: BbtipsRawPayload | null | undefined,
  ) => {
    const referenceCells = flattenBbtipsMatrixCells(referencePayload)
    const localCells = flattenBbtipsMatrixCells(localPayload)
    const keys = new Set([...referenceCells.keys(), ...localCells.keys()])
    const differences: Array<Record<string, unknown>> = []
    let missing = 0
    let extra = 0
    let different = 0

    ;[...keys].sort().forEach((key) => {
      const referenceCell = referenceCells.get(key)
      const localCell = localCells.get(key)

      if (!referenceCell) {
        extra += 1
        if (differences.length < 200) {
          differences.push({ key, local: localCell, type: 'extra' })
        }
        return
      }

      if (!localCell) {
        missing += 1
        if (differences.length < 200) {
          differences.push({ key, reference: referenceCell, type: 'missing' })
        }
        return
      }

      if (
        normalizeBbtipsCellValue(referenceCell.result) !== normalizeBbtipsCellValue(localCell.result) ||
        normalizeBbtipsCellValue(referenceCell.teams) !== normalizeBbtipsCellValue(localCell.teams)
      ) {
        different += 1
        if (differences.length < 200) {
          differences.push({ key, local: localCell, reference: referenceCell, type: 'different' })
        }
      }
    })

    return {
      counts: {
        different,
        extra,
        missing,
        reference: referenceCells.size,
        totalDifferences: different + extra + missing,
        tigger: localCells.size,
      },
      differences,
    }
  }

  const inferIngestedBbtipsSource = (rawUrl: string) => {
    try {
      const url = new URL(rawUrl)
      const path = url.pathname.toLowerCase()
      const leagueId = Number(url.searchParams.get('liga'))
      const horas = url.searchParams.get('Horas') ?? url.searchParams.get('horas')
      const period = normalizeRequestedBbtipsPeriod(horas?.replace(/^Horas/i, '').toLowerCase())

      if (!Number.isFinite(leagueId)) return null

      const platform: BbtipsPlatform | null =
        path.includes('betanofutebolvirtual')
          ? 'Betano'
          : path.includes('playpixfutebolvirtual')
            ? 'PlayPix'
            : path.includes('futebolvirtual')
              ? leagueId === 0
                ? 'Express 365'
                : 'Bet365'
              : null

      if (!platform) return null

      const league = bbtipsLeagueSpecsByPlatform[platform].find((candidate) => candidate.id === leagueId)
      if (!league) return null

      return {
        future: url.searchParams.get('futuro') === 'true',
        league,
        period,
        platform,
      }
    } catch {
      return null
    }
  }

  const ingestBbtipsBridgePayload = (
    sourceUrl: string,
    rawPayload: unknown,
  ) => {
    const source = inferIngestedBbtipsSource(sourceUrl)
    if (!source) {
      throw new Error('Endpoint da BBTips nao reconhecido pelo bridge.')
    }
    if (!hasUsableBbtipsPayload(rawPayload as BbtipsRawPayload | null | undefined)) {
      throw new Error('Payload capturado sem linhas utilizaveis.')
    }

    const capturedPayload = rawPayload as BbtipsRawPayload
    const { future, league, period, platform } = source
    const currentSnapshot = readHotLeagueSnapshot(platform, period, league, bbtipsPersistentCacheEmergencyMaxAgeMs)
    const nextCurrent =
      future && platform !== 'Betano' && platform !== 'PlayPix'
        ? currentSnapshot?.current ?? null
        : filterBbtipsPayloadByResolution(capturedPayload, true)
    const nextFuture =
      future && platform !== 'Betano' && platform !== 'PlayPix'
        ? filterBbtipsPayloadByResolution(capturedPayload, false)
        : filterBbtipsPayloadByResolution(capturedPayload, false)

    const leaguePayload: BbtipsLivePlatformPayload['leagues'][number] = {
      current: nextCurrent ?? currentSnapshot?.current ?? null,
      future: nextFuture ?? currentSnapshot?.future ?? null,
      id: league.id,
      image: league.image,
      key: league.key,
      name: league.name,
      sub: league.sub,
    }
    const payload = buildBbtipsLivePayloadFromLeagues(platform, period, [leaguePayload], 'live')
    if (!payload || !hasUsableBbtipsLivePayload(payload)) {
      throw new Error('Snapshot do bridge ficou vazio apos normalizacao.')
    }

    const validatedAt = Date.now()
    payload.diagnostics = {
      ...(payload.diagnostics ?? {}),
      bridgeSource: 'bbtips-hot-bridge',
      freshnessMs: 0,
      lastSuccessfulSyncAt: validatedAt,
      upstreamFetchedAt: payload.updatedAt,
      validatedAt,
      validationStatus: 'ok',
    }

    const cacheKey = buildBbtipsCacheKey(platform, [], period, [league])
    cacheByKey.set(cacheKey, {
      expiresAt: Date.now() + getBbtipsClientCacheTtlMs(platform),
      payload,
    })
    bridgeLatestPayloadByKey.set(buildBridgePayloadKey(platform, period, league.key), payload)
    writeBbtipsPersistentCache(cacheKey, payload)
    writeLeagueSnapshots(platform, period, payload.leagues)
    updateHotLeagueStatus(platform, period, league.key, {
      consecutiveFailures: 0,
      freshnessMs: 0,
      lastError: null,
      lastObservedUpstreamAt: String(payload.updatedAt),
      lastPublishedUpdatedAt: payload.updatedAt,
      lastSuccessfulSyncAt: validatedAt,
      staleReason: null,
      validatedAt,
      validationStatus: 'ok',
    })
    rememberBridgeEvent({
      league: league.key,
      platform,
      rows: payload.leagues[0]?.current?.Linhas?.length ?? 0,
      status: 'ok',
      updatedAt: payload.updatedAt,
      url: sourceUrl,
    })

    return {
      league: league.key,
      platform,
      rows: payload.leagues[0]?.current?.Linhas?.length ?? 0,
      updatedAt: payload.updatedAt,
    }
  }

  const buildHotWorkerStatusPayload = () => ({
    bridge: {
      events: bridgeIngestEvents,
      latestSnapshots: bridgeLatestPayloadByKey.size,
      pings: bridgePingEvents,
      pingReceived: bridgePingEvents.length,
      received: bridgeIngestEvents.filter((event) => event.status === 'ok').length,
    },
    generatedAt: new Date().toISOString(),
    platforms: Object.fromEntries(
      [...hotPeriodsByPlatform.entries()].map(([platform, periods]) => [
        platform,
        Object.fromEntries(
          [...periods].sort().map((period) => [
            period,
            bbtipsLeagueSpecsByPlatform[platform].map((league) => {
              const status =
                hotLeagueStatusByKey.get(buildHotLeagueStatusKey(platform, period, league.key)) ??
                getEmptyHotLeagueStatus()
              const snapshot = readHotLeagueSnapshot(platform, period, league)
              const snapshotUpdatedAt = Math.max(
                getBbtipsPayloadUpdateTimestamp(snapshot?.current),
                getBbtipsPayloadUpdateTimestamp(snapshot?.future),
                0,
              )

              return {
                consecutiveFailures: status.consecutiveFailures,
                freshnessMs: snapshotUpdatedAt > 0 ? Date.now() - snapshotUpdatedAt : status.freshnessMs,
                id: league.id,
                key: league.key,
                lastError: status.lastError,
                lastObservedUpstreamAt: status.lastObservedUpstreamAt,
                lastPublishedUpdatedAt: status.lastPublishedUpdatedAt ?? (snapshotUpdatedAt || null),
                lastSuccessfulSyncAt: status.lastSuccessfulSyncAt,
                name: league.name,
                staleReason: status.staleReason,
                validatedAt: status.validatedAt,
                validationStatus: status.validationStatus,
              }
            }),
          ]),
        ),
      ]),
    ),
  })

  const getLivePayload = async (
    platform: BbtipsPlatform,
    requestedMarkets: BbtipsRequestedMarket[],
    requestedPeriod: Period,
    requestedLeagues: BbtipsLeagueSpec[],
  ) => {
    if (bbtipsHotWorkerPlatforms.has(platform)) {
      ensureHotWorker(platform, requestedPeriod, 50)
    }

    const cacheKey = buildBbtipsCacheKey(platform, requestedMarkets, requestedPeriod, requestedLeagues)
    const inFlightRefresh = refreshPromiseByKey.get(cacheKey)
    const freshMaxAgeMs = requestedMarkets.length > 0
      ? getBbtipsVisualFallbackMaxAgeMs(platform)
      : getBbtipsPersistentCacheFreshMaxAgeMs(platform)
    const cachedPayload = sanitizeBbtipsLivePayload(cacheByKey.get(cacheKey)?.payload)
    const cached = cachedPayload
      ? {
          ...cacheByKey.get(cacheKey)!,
          payload: cachedPayload,
        }
      : null

    if (
      cached &&
      cached.expiresAt > Date.now() &&
      hasBbtipsMarketOdds(cached.payload, requestedMarkets) &&
      isBbtipsLivePayloadFreshForPlatform(cached.payload, platform, Date.now(), freshMaxAgeMs)
    ) {
      return cached.payload
    }

    const persistedPayload =
      readBbtipsPersistentCache(cacheKey, freshMaxAgeMs) ??
      readLatestCompatibleBbtipsPersistentCache(
        platform,
        requestedMarkets,
        requestedPeriod,
        requestedLeagues,
        freshMaxAgeMs,
      )

    if (
      persistedPayload &&
      hasUsableBbtipsLivePayload(persistedPayload) &&
      hasBbtipsMarketOdds(persistedPayload, requestedMarkets) &&
      isBbtipsLivePayloadFreshForPlatform(persistedPayload, platform, Date.now(), freshMaxAgeMs)
    ) {
      cacheByKey.set(cacheKey, {
        expiresAt: Date.now() + getBbtipsClientCacheTtlMs(platform),
        payload: persistedPayload,
      })
      return persistedPayload
    }

    if (bbtipsHotWorkerPlatforms.has(platform) && requestedMarkets.length === 0) {
      const requestedLeagueStatuses = requestedLeagues.map((league) =>
        hotLeagueStatusByKey.get(buildHotLeagueStatusKey(platform, requestedPeriod, league.key)) ??
        getEmptyHotLeagueStatus(),
      )
      const requestedHotPayload = buildHotPlatformPayload(
        platform,
        requestedPeriod,
        requestedLeagues,
        getBbtipsPersistentCacheFreshMaxAgeMs(platform),
      )
      const requestedHotPayloadIsFresh = Boolean(
        requestedHotPayload &&
        hasUsableBbtipsLivePayload(requestedHotPayload) &&
        isBbtipsLivePayloadFreshForPlatform(
          requestedHotPayload,
          platform,
            Date.now(),
            getBbtipsPersistentCacheFreshMaxAgeMs(platform),
          ),
      )
      const shouldPrioritizeRequestedLeagues =
        platform === 'PlayPix' &&
        requestedLeagues.length > 0 &&
        !requestedHotPayloadIsFresh &&
        requestedLeagueStatuses.some((status) => !status.lastObservedUpstreamAt)

      if (shouldPrioritizeRequestedLeagues) {
        void refreshHotPlatformPeriod(platform, requestedPeriod, requestedLeagues).catch(() => undefined)
      }

      const hotPayload = buildHotPlatformPayload(
        platform,
        requestedPeriod,
        requestedLeagues,
        getBbtipsPersistentCacheFreshMaxAgeMs(platform),
      ) ?? (
        requestedPeriod !== '12h'
          ? buildHotPlatformPayload(
            platform,
            '12h',
            requestedLeagues,
            getBbtipsPersistentCacheFreshMaxAgeMs(platform),
          )
          : null
      )
      let priorityRefreshStarted = false

      if (
        hotPayload &&
        hasUsableBbtipsLivePayload(hotPayload)
      ) {
        const shouldWaitForPriorityRefresh =
          platform === 'PlayPix' &&
          !isBbtipsLivePayloadFreshForPlatform(
            hotPayload,
            platform,
            Date.now(),
            getBbtipsHotPriorityRefreshMaxAgeMs(platform),
          )

        if (shouldWaitForPriorityRefresh) {
          const priorityRefresh = inFlightRefresh ??
            refreshLivePayload(platform, requestedMarkets, requestedPeriod, requestedLeagues)
          priorityRefreshStarted = !inFlightRefresh

          const refreshedPayload = await Promise.race([
            priorityRefresh.catch(() => null),
            sleep(getBbtipsHotPriorityRefreshWaitMs(platform)).then(() => null),
          ])

          if (
            refreshedPayload &&
            hasUsableBbtipsLivePayload(refreshedPayload) &&
            isBbtipsLivePayloadFreshForPlatform(
              refreshedPayload,
              platform,
              Date.now(),
              getBbtipsHotPriorityRefreshMaxAgeMs(platform),
            )
          ) {
            cacheByKey.set(cacheKey, {
              expiresAt: Date.now() + getBbtipsClientCacheTtlMs(platform),
              payload: refreshedPayload,
            })
            return refreshedPayload
          }
        }

        cacheByKey.set(cacheKey, {
          expiresAt: Date.now() + getBbtipsClientCacheTtlMs(platform),
          payload: hotPayload,
        })

        if (!inFlightRefresh && !priorityRefreshStarted) {
          void refreshLivePayload(platform, requestedMarkets, requestedPeriod, requestedLeagues).catch(() => undefined)
        }

        return hotPayload
      }
    }

    if (bbtipsHotWorkerPlatforms.has(platform) && requestedMarkets.length === 0) {
      void refreshHotPlatformPeriod(platform, requestedPeriod, requestedLeagues).catch(() => undefined)
      throw new Error('Snapshot quente ainda nao esta pronto; a rota nao vai bloquear esperando a API.')
    }

    const warmPayload = pickFresherBbtipsLivePayload(cachedPayload, persistedPayload)
    if (
      warmPayload &&
      hasUsableBbtipsLivePayload(warmPayload) &&
      hasBbtipsMarketOdds(warmPayload, requestedMarkets) &&
      isBbtipsLivePayloadWarmForPlatform(warmPayload, platform)
    ) {
      cacheByKey.set(cacheKey, {
        expiresAt: Date.now() + getBbtipsClientCacheTtlMs(platform),
        payload: warmPayload,
      })
      if (!inFlightRefresh) {
        void refreshLivePayload(platform, requestedMarkets, requestedPeriod, requestedLeagues).catch(() => undefined)
      }
      return warmPayload
    }

    try {
      return inFlightRefresh ??
        await refreshLivePayload(platform, requestedMarkets, requestedPeriod, requestedLeagues)
    } catch (error) {
      const emergencyPayload = pickFresherBbtipsLivePayload(persistedPayload, cachedPayload)
      const allowStaleEmergencyPayload =
        emergencyPayload &&
        hasUsableBbtipsLivePayload(emergencyPayload) &&
        hasBbtipsMarketOdds(emergencyPayload, requestedMarkets) &&
        isBbtipsLivePayloadWarmForPlatform(emergencyPayload, platform)
      if (allowStaleEmergencyPayload) {
        return emergencyPayload
      }

      throw error
    }
  }

  return {
    name: 'bbtips-live',
    configureServer(server) {
      const bridgeCorsMiddleware = (
        request: import('node:http').IncomingMessage,
        response: import('node:http').ServerResponse,
        next: () => void,
      ) => {
        if (!String(request.url ?? '').startsWith('/api/bbtips/')) {
          next()
          return
        }

        response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        response.setHeader('Access-Control-Allow-Origin', '*')
        response.setHeader('Access-Control-Allow-Private-Network', 'true')

        if (request.method === 'OPTIONS') {
          response.statusCode = 204
          response.end()
          return
        }

        next()
      }
      ;(server.middlewares as unknown as {
        stack?: Array<{ handle: typeof bridgeCorsMiddleware; route: string }>
      }).stack?.unshift({
        handle: bridgeCorsMiddleware,
        route: '',
      })

      const hotStartupPlatforms: BbtipsPlatform[] = ['Bet365', 'Express 365', 'Betano', 'PlayPix']
      const startupWarmupPlatforms: BbtipsPlatform[] = enableBackgroundWarmup
        ? ['Bet365', 'Express 365', 'Betano', 'PlayPix']
        : []
      const backgroundWarmupPlatforms: BbtipsPlatform[] = enableBackgroundWarmup
        ? ['Bet365', 'Express 365', 'Betano', 'PlayPix']
        : []
      const warmCorePayload = (platform: BbtipsPlatform) => {
        void refreshLivePayload(
          platform,
          [],
          '12h',
          normalizeRequestedBbtipsLeagues(platform, []),
        ).catch(() => undefined)
      }

      const startupWarmupTimer = startupWarmupPlatforms.length > 0
        ? setTimeout(() => {
          startupWarmupPlatforms.forEach((platform) => {
            warmCorePayload(platform)
          })
        }, 1_500)
        : null
      const hotStartupTimer = setTimeout(() => {
        hotStartupPlatforms.forEach((platform, index) => {
          ensureHotWorker(platform, '12h', 150 + index * 500)
        })
      }, 750)
      const backgroundWarmupTimers = backgroundWarmupPlatforms
        .map((platform) =>
          setInterval(() => {
            warmCorePayload(platform)
          }, getBbtipsBackgroundWarmupMs(platform)))

      server.httpServer?.once('close', () => {
        if (startupWarmupTimer) {
          clearTimeout(startupWarmupTimer)
        }
        clearTimeout(hotStartupTimer)
        backgroundWarmupTimers.forEach((timer) => clearInterval(timer))
        stopHotWorkers()
        void closeBbtipsBrowserSession()
      })

      server.middlewares.use('/api/bbtips/status', (_request, response) => {
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify(buildHotWorkerStatusPayload()))
      })

      server.middlewares.use('/api/bbtips/compare', (request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8')

        try {
          const requestUrl = new URL(request.url ?? '', 'http://localhost')
          const rawPlatform = requestUrl.searchParams.get('platform') ?? 'Betano'
          const platform = (['Bet365', 'Express 365', 'Betano', 'PlayPix'] as BbtipsPlatform[])
            .find((candidate) => candidate.toLowerCase() === rawPlatform.toLowerCase()) ?? 'Betano'
          const requestedPeriod = normalizeRequestedBbtipsPeriod(requestUrl.searchParams.get('period'))
          const requestedLeague = requestUrl.searchParams.get('league')
          const league =
            bbtipsLeagueSpecsByPlatform[platform].find((candidate) =>
              candidate.key === requestedLeague ||
              String(candidate.id) === requestedLeague ||
              candidate.sub === requestedLeague ||
              candidate.name.toLowerCase() === String(requestedLeague ?? '').toLowerCase(),
            ) ?? bbtipsLeagueSpecsByPlatform[platform][0]

          const referencePayload = bridgeLatestPayloadByKey.get(
            buildBridgePayloadKey(platform, requestedPeriod, league.key),
          )
          const localPayload = buildHotPlatformPayload(
            platform,
            requestedPeriod,
            [league],
            getBbtipsVisualFallbackMaxAgeMs(platform),
          )
          const referenceLeague = referencePayload?.leagues?.find((entry) => entry.key === league.key)
          const localLeague = localPayload?.leagues?.find((entry) => entry.key === league.key)
          const current = compareBbtipsMatrices(referenceLeague?.current, localLeague?.current)
          const future = compareBbtipsMatrices(referenceLeague?.future, localLeague?.future)

          response.statusCode = 200
          response.end(JSON.stringify({
            current,
            future,
            league: {
              id: league.id,
              key: league.key,
              name: league.name,
            },
            period: requestedPeriod,
            platform,
            reference: {
              available: Boolean(referencePayload),
              updatedAt: referencePayload?.updatedAt ?? null,
            },
            status: current.counts.totalDifferences + future.counts.totalDifferences === 0 ? 'ok' : 'diff',
            tigger: {
              available: Boolean(localPayload),
              updatedAt: localPayload?.updatedAt ?? null,
            },
          }))
        } catch (error) {
          response.statusCode = 400
          response.end(JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            ok: false,
          }))
        }
      })

      server.middlewares.use('/api/bbtips/bridge-snippet', (_request, response) => {
        response.statusCode = 200
        response.setHeader('Access-Control-Allow-Origin', '*')
        response.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        response.end(readFileSync(path.join(process.cwd(), 'scripts', 'bbtips-live-bridge-snippet.js'), 'utf8'))
      })

      server.middlewares.use('/api/bbtips/bridge-ping', async (request, response, next) => {
        if (request.method !== 'POST') {
          next()
          return
        }

        response.setHeader('Access-Control-Allow-Origin', '*')
        response.setHeader('Content-Type', 'application/json; charset=utf-8')

        try {
          const body = await readRequestBody(request)
          const parsed = JSON.parse(body) as {
            href?: unknown
            state?: Record<string, unknown>
            title?: unknown
            userAgent?: unknown
          }
          rememberBridgePing({
            errors: Array.isArray(parsed.state?.errors) ? parsed.state.errors.slice(0, 5) : [],
            href: String(parsed.href ?? '').slice(0, 300),
            matched: Number(parsed.state?.matched ?? 0),
            polled: Number(parsed.state?.polled ?? 0),
            sent: Number(parsed.state?.sent ?? 0),
            title: String(parsed.title ?? '').slice(0, 120),
          })
          response.statusCode = 200
          response.end(JSON.stringify({ ok: true }))
        } catch (error) {
          response.statusCode = 400
          response.end(JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            ok: false,
          }))
        }
      })

      server.middlewares.use('/api/bbtips/ingest', async (request, response, next) => {
        if (request.method !== 'POST') {
          next()
          return
        }

        response.setHeader('Access-Control-Allow-Origin', '*')
        response.setHeader('Content-Type', 'application/json; charset=utf-8')

        try {
          const body = await readRequestBody(request)
          const parsed = JSON.parse(body) as { payload?: unknown; url?: unknown }
          const sourceUrl = String(parsed.url ?? '')
          const result = ingestBbtipsBridgePayload(sourceUrl, parsed.payload)

          response.statusCode = 200
          response.end(JSON.stringify({ ok: true, ...result }))
        } catch (error) {
          rememberBridgeEvent({
            error: error instanceof Error ? error.message : String(error),
            status: 'error',
          })
          response.statusCode = 400
          response.end(JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            ok: false,
          }))
        }
      })

      ;(['Bet365', 'Express 365', 'Betano', 'PlayPix'] as const).forEach((platform) => {
        server.middlewares.use(bbtipsPlatformConfigByPlatform[platform].route, async (request, response) => {
          let requestedMarkets: BbtipsRequestedMarket[] = []
          let requestedPeriod: Period = '12h'
          let requestedLeagues: BbtipsLeagueSpec[] = normalizeRequestedBbtipsLeagues(platform, [])

          try {
            const requestUrl = new URL(request.url ?? '', 'http://localhost')
            requestedMarkets = normalizeRequestedBbtipsMarkets(
              requestUrl.searchParams.getAll('markets').flatMap((market) => market.split('|')),
            )
            requestedPeriod = normalizeRequestedBbtipsPeriod(requestUrl.searchParams.get('period'))
            requestedLeagues = normalizeRequestedBbtipsLeagues(
              platform,
              requestUrl.searchParams.getAll('leagues').flatMap((league) => league.split('|')),
            )
            if (bbtipsHotWorkerPlatforms.has(platform)) {
              ensureHotWorker(platform, requestedPeriod, 50)
            }
            if (requestUrl.searchParams.get('cacheOnly') === 'true') {
              const cacheKey = buildBbtipsCacheKey(platform, requestedMarkets, requestedPeriod, requestedLeagues)
              const allowStaleCache = requestUrl.searchParams.get('allowStale') === 'true'
              const cacheOnlyMaxAgeMs = requestedMarkets.length > 0
                ? getBbtipsVisualFallbackMaxAgeMs(platform)
                : getBbtipsPersistentCacheFreshMaxAgeMs(platform)
              const cachedPayload =
                buildBridgePlatformPayload(platform, requestedPeriod, requestedLeagues) ??
                sanitizeBbtipsLivePayload(cacheByKey.get(cacheKey)?.payload) ??
                (bbtipsHotWorkerPlatforms.has(platform)
                  ? buildHotPlatformPayload(platform, requestedPeriod, requestedLeagues, cacheOnlyMaxAgeMs)
                    ?? (
                      requestedPeriod !== '12h'
                        ? buildHotPlatformPayload(platform, '12h', requestedLeagues, cacheOnlyMaxAgeMs)
                        : null
                    )
                  : null) ??
                readBbtipsPersistentCache(cacheKey, cacheOnlyMaxAgeMs) ??
                readLatestCompatibleBbtipsPersistentCache(
                  platform,
                  requestedMarkets,
                  requestedPeriod,
                  requestedLeagues,
                  cacheOnlyMaxAgeMs,
                ) ??
                buildLeagueSnapshotFallbackPayload(platform, requestedPeriod, requestedLeagues, cacheOnlyMaxAgeMs)

              if (
                !cachedPayload ||
                !hasUsableBbtipsLivePayload(cachedPayload) ||
                (!allowStaleCache && !hasBbtipsMarketOdds(cachedPayload, requestedMarkets)) ||
                !isBbtipsLivePayloadFreshForPlatform(cachedPayload, platform, Date.now(), cacheOnlyMaxAgeMs)
              ) {
                response.statusCode = 204
                response.end()
                return
              }

              cacheByKey.set(cacheKey, {
                expiresAt: Date.now() + getBbtipsClientCacheTtlMs(platform),
                payload: cachedPayload,
              })
              response.statusCode = 200
              response.setHeader('Content-Type', 'application/json; charset=utf-8')
              response.end(JSON.stringify(cachedPayload))
              return
            }
            const payload = await getLivePayload(platform, requestedMarkets, requestedPeriod, requestedLeagues)
            response.statusCode = 200
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(JSON.stringify(payload))
          } catch (error) {
            console.error(`[bbtips-live] ${platform} route failed`, error)
            try {
              const cacheKey = buildBbtipsCacheKey(platform, requestedMarkets, requestedPeriod, requestedLeagues)
              const fallbackMaxAgeMs = requestedMarkets.length > 0
                ? getBbtipsVisualFallbackMaxAgeMs(platform)
                : getBbtipsPersistentCacheFreshMaxAgeMs(platform)
              const fallback = sanitizeBbtipsLivePayload(
                readBbtipsPersistentCache(cacheKey, fallbackMaxAgeMs) ??
                readLatestCompatibleBbtipsPersistentCache(platform, requestedMarkets, requestedPeriod, requestedLeagues, fallbackMaxAgeMs) ??
                buildLeagueSnapshotFallbackPayload(platform, requestedPeriod, requestedLeagues, fallbackMaxAgeMs),
              )
              if (
                fallback &&
                hasUsableBbtipsLivePayload(fallback) &&
                (requestedMarkets.length > 0 || hasBbtipsMarketOdds(fallback, requestedMarkets)) &&
                isBbtipsLivePayloadFreshForPlatform(
                  fallback,
                  platform,
                  Date.now(),
                  fallbackMaxAgeMs,
                )
              ) {
                cacheByKey.set(cacheKey, {
                  expiresAt: Date.now() + getBbtipsClientCacheTtlMs(platform),
                  payload: fallback,
                })
                response.statusCode = 200
                response.setHeader('Content-Type', 'application/json; charset=utf-8')
                response.end(JSON.stringify(fallback))
                return
              }
            } catch {
              // ignore fallback errors and return original 502 below
            }

            response.statusCode = 502
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(JSON.stringify({
              error: 'A matriz real do BB Tips nao ficou disponivel agora. Nenhum cache antigo foi exibido.',
              platform,
              source: 'live',
              updatedAt: Date.now(),
            }))
          }
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '') as BbtipsEnv

  return {
    plugins: [react(), createBbtipsLivePlugin(env)],
    server: {
      watch: {
        ignored: [
          '**/bbtips_chunks/**',
          '**/captures/**',
          '**/dist/**',
          '**/*.log',
          '**/tmp_*',
        ],
      },
    },
  }
})
