import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { useCallback } from 'react'
import { FilterBar } from './components/FilterBar'
import { TopBar } from './components/TopBar'
import {
  adminLogs,
  adminStats,
  initialAlerts,
  initialBots,
  marketOptions,
  oddBandOptions,
  planCatalog,
  profileSummary,
  timeModeOptions,
  virtualPlatformOptions,
} from './data/staticData'
import {
  bbtipsLeagueCatalog as leagueCatalog,
  getBbtipsLeagueOptionsForPlatform as getLeagueOptionsForPlatform,
} from './data/bbtipsCatalog'
import {
  buildBbtipsMatrixRowLayouts,
  buildBbtipsMatrixStatsFromRecords,
  buildMatchRecordsFromLeaguePayload,
  extractBbtipsProjectedCellKeys,
  getBbtipsPayloadAnchorTimestamp,
  mergeBbtipsMatrixStatsMissingCells,
  extractBbtipsMinuteSlots,
  prefetchBbtipsLivePayload,
  useBbtipsLiveRecords,
} from './data/bbtipsBet365'
import {
  buildPayingColumnSummaries,
  countPayingHourSlots,
} from './lib/payingHours'
import {
  botStorageKey,
  buildCriteriaList,
  createDraftFromBot,
  createDraftFromFilters,
  createInitialToggles,
  defaultCellGreenColor,
  defaultCellRedColor,
  getMatrixCellMarkerGroupKey,
  groupBy,
  leagueToggleStorageKey,
  oddMatchesBand,
  periodMsMap,
  pickNextMatrixCellMarkerTone,
  resolveLeagueMeta,
  resolveMatrixCellMarkerTone,
  scoreForTime,
  shortDateFormatter,
  type MatrixCellMarkerTone,
} from './lib/ui'
import { appConfig } from './lib/appConfig'
import {
  formatPagBankCountdown,
  isPagBankPaidStatus,
  normalizePagBankStatus,
  normalizePhoneNumber,
  normalizeTaxId,
  pagBankActivatedPlanId,
  parsePagBankCheckoutRecord,
  type PagBankCheckoutActionResult,
  type PagBankCheckoutRecord,
  type PagBankPaymentProfile,
  validatePagBankPaymentProfile,
} from './lib/pagbank'
import { supabase } from './lib/supabase'
import { AccountPage } from './pages/AccountPage'
import { AdminPage } from './pages/AdminPage'
import { AlertsPage } from './pages/AlertsPage'
import { AnalysisPage } from './pages/AnalysisPage'
import { BotsPage } from './pages/BotsPage'
import { HistoryPage } from './pages/HistoryPage'
import { LoginPage } from './pages/LoginPage'
import { PlansPage } from './pages/PlansPage'
import {
  CapturePage,
  type CaptureAccountPayload,
  type CaptureActionResult,
  type CaptureLoginPayload,
} from './pages/CapturePage'
import { RankingPage } from './pages/RankingPage'
import type {
  AlertItem,
  Bot,
  BotDraft,
  DensityMode,
  FiltersState,
  HistoryView,
  Market,
  MatchRecord,
  MatrixCell,
  NotificationChannel,
  Page,
  Plan,
  Period,
  Platform,
  TimeMode,
  ToggleKey,
} from './types'

const hasRecordStatus = (record: MatchRecord | undefined) =>
  Boolean(record && String(record.status ?? '').trim())

const normalizeStatusValue = (value: string) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const pendingStatusTokens = [
  'ao_vivo',
  'live',
  'em_andamento',
  'agendado',
  'upcoming',
  'pendente',
  'aguardando',
  'aberto',
  'iniciado',
  'intervalo',
]

const isPositiveOdd = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const buildCellOddsFromRecords = (records: Array<MatchRecord | undefined>) =>
  marketOptions.reduce(
    (acc, market) => {
      const matchedOdd = records
        .map((record) => record?.odds[market])
        .find(isPositiveOdd)

      acc[market] = matchedOdd ?? null
      return acc
    },
    {} as Record<Market, number | null>,
  )

const hourMs = 60 * 60 * 1000
const dayMs = 24 * hourMs

const normalizeLeagueToken = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const buildMinuteSlotSequence = (start: number, step: number, count: number) =>
  Array.from({ length: count }, (_, index) => start + index * step)
const buildMinuteSlotRange = (start: number) => buildMinuteSlotSequence(start, 3, 20)
const expressMinuteSlots = Array.from({ length: 60 }, (_, index) => index)

const bet365MinuteSlotsByLeague: Record<string, number[]> = {
  'copa do mundo': buildMinuteSlotRange(1),
  'euro cup': buildMinuteSlotRange(2),
  premiership: buildMinuteSlotRange(0),
  'super liga sul americana': buildMinuteSlotRange(1),
}

const playPixMinuteSlotsByLeague: Record<string, number[]> = {
  ita: buildMinuteSlotSequence(1, 2, 30),
  eng: buildMinuteSlotSequence(0, 2, 30),
  spa: buildMinuteSlotSequence(1, 2, 30),
  bra: buildMinuteSlotRange(2),
  lat: buildMinuteSlotRange(2),
}

const getForcedMinuteSlots = (platform: FiltersState['platform'], leagueName: string) => {
  if (platform === 'Express 365') {
    return expressMinuteSlots
  }
  if (platform === 'Bet365') {
    const token = normalizeLeagueToken(leagueName)
    return bet365MinuteSlotsByLeague[token] ?? buildMinuteSlotRange(1)
  }
  if (platform === 'PlayPix') {
    const token = normalizeLeagueToken(leagueName)
    return playPixMinuteSlotsByLeague[token] ?? buildMinuteSlotSequence(1, 2, 30)
  }
  return undefined
}

const mergeUniqueNumberSequence = (...groups: Array<number[] | undefined>) => {
  const seen = new Set<number>()

  return groups.flatMap((group) =>
    (group ?? []).filter((value) => {
      const normalizedValue = Math.trunc(value)
      if (seen.has(normalizedValue)) return false
      seen.add(normalizedValue)
      return true
    }),
  )
}

const buildUpcomingRecordKey = (record: MatchRecord) =>
  Number.isFinite(record.timestamp)
    ? `${record.platform}::${record.league}::${record.timestamp}`
    : record.id

const mergeUpcomingRecords = (...groups: Array<MatchRecord[] | undefined>) => {
  const byKey = new Map<string, MatchRecord>()

  groups
    .flatMap((group) => group ?? [])
    .sort((left, right) => left.timestamp - right.timestamp)
    .forEach((record) => {
      const key = buildUpcomingRecordKey(record)
      if (!byKey.has(key)) {
        byKey.set(key, record)
      }
    })

  return [...byKey.values()].sort((left, right) => left.timestamp - right.timestamp)
}

const backgroundKeepHotMsByPlatform: Partial<Record<Platform, number>> = {}

interface SelectedCellMarker {
  cell: MatrixCell
  key: string
  tone: MatrixCellMarkerTone
}

const buildAnalysisCardFilterKey = (platform: FiltersState['platform'], leagueName: string) =>
  `${platform}::${leagueName}`

const resolveDefaultLeagueForPlatform = (platform: FiltersState['platform']) =>
  getLeagueOptionsForPlatform(platform)[0] ?? ''

const filtersStorageKey = 'tigger-analytics-filters-v1'
const analysisCardFiltersStorageKey = 'tigger-analytics-card-filters-v1'
const nextGamesPeriodsStorageKey = 'tigger-analytics-next-games-periods-v1'
const matrixStateVersionStorageKey = 'tigger-analytics-matrix-state-version'
const matrixStateVersion = 'betano-copa-america-id-v5'
const activePageStorageKey = 'tigger-analytics-active-page-v1'
const historyViewStorageKey = 'tigger-analytics-history-view-v1'
const densityModeStorageKey = 'tigger-analytics-density-mode-v1'
const captureAccountsStorageKey = 'tigger-analytics-capture-accounts-v1'
const captureSessionStorageKey = 'tigger-analytics-capture-session-v1'
const capturePagePath = '/captacao'
const loginPagePath = '/login'
const captureTrialDurationMs = 5 * hourMs
const captureBillingCycleDays = 30
const captureBillingCycleMs = captureBillingCycleDays * dayMs
const captureRenewalReminderDays = 5

type InternalPage = Exclude<Page, 'capture' | 'login'>

interface CaptureAccountRecord {
  id: string
  name: string
  email: string
  password: string
  favoritePlatform: Platform
  currentPlan: Plan['id']
  notificationChannel: NotificationChannel
  notificationContact: string
  taxId: string
  phoneNumber: string
  pagBankCheckout: PagBankCheckoutRecord | null
  createdAt: number
  planActivatedAt: number | null
  planEndsAt: number | null
  trialEndsAt: number | null
}

interface CaptureSessionRecord {
  accountId: string
  signedAt: number
}

const internalPageOptions: InternalPage[] = [
  'analysis',
  'history',
  'bots',
  'ranking',
  'alerts',
  'account',
  'plans',
  'admin',
]
const historyViewOptions: HistoryView[] = ['Tabela', 'Timeline', 'Liga', 'Sequencia']
const densityModeOptions: DensityMode[] = ['Compacta', 'Confortavel']
const playPixMaxNextGamesPeriod: Period = '48h'
const playPixAllowedNextGamesPeriods = new Set<Period>(['6h', '12h', '24h', '36h', '48h'])
const resolvePlayPixNextGamesPeriod = (period: Period): Period =>
  playPixAllowedNextGamesPeriods.has(period)
    ? period
    : playPixMaxNextGamesPeriod

const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())

const readStoredChoice = <T extends string>(storageKey: string, options: readonly T[], fallback: T): T => {
  if (typeof window === 'undefined') return fallback

  const raw = window.localStorage.getItem(storageKey)
  return raw && options.includes(raw as T) ? raw as T : fallback
}

const normalizePathname = (value: string) => {
  const normalized = value.trim()

  if (!normalized || normalized === '/') return '/'
  return normalized.replace(/\/+$/, '')
}

const ensureMatrixStateVersion = () => {
  if (typeof window === 'undefined') return

  if (window.localStorage.getItem(matrixStateVersionStorageKey) === matrixStateVersion) return

  window.localStorage.removeItem(filtersStorageKey)
  window.localStorage.removeItem(analysisCardFiltersStorageKey)
  window.localStorage.removeItem(nextGamesPeriodsStorageKey)
  window.localStorage.setItem(matrixStateVersionStorageKey, matrixStateVersion)
}

const normalizeAccountEmail = (value: string) => value.trim().toLowerCase()

const isPlanId = (value: unknown): value is Plan['id'] =>
  planCatalog.some((plan) => plan.id === value)

const formatCurrencyBRL = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`

const resolveFunctionInvokeErrorMessage = async (
  error: unknown,
  fallback: string,
) => {
  if (!error || typeof error !== 'object') {
    return fallback
  }

  const candidate = error as {
    context?: {
      clone?: () => {
        json?: () => Promise<unknown>
        text?: () => Promise<string>
      }
      json?: () => Promise<unknown>
      text?: () => Promise<string>
    }
    message?: string
  }

  const context = candidate.context
  const readableContext = context?.clone ? context.clone() : context

  if (readableContext?.json) {
    try {
      const payload = await readableContext.json()
      if (payload && typeof payload === 'object') {
        const payloadRecord = payload as Record<string, unknown>
        if (typeof payloadRecord.error === 'string' && payloadRecord.error.trim()) {
          return payloadRecord.error.trim()
        }
        if (typeof payloadRecord.message === 'string' && payloadRecord.message.trim()) {
          return payloadRecord.message.trim()
        }
      }
    } catch {
      // tenta cair para text/message
    }
  }

  if (readableContext?.text) {
    try {
      const text = await readableContext.text()
      if (text.trim()) {
        return text.trim()
      }
    } catch {
      // ignora e cai para message
    }
  }

  if (
    typeof candidate.message === 'string' &&
    candidate.message.trim() &&
    candidate.message.trim() !== 'Edge Function returned a non-2xx status code'
  ) {
    return candidate.message.trim()
  }

  return fallback
}

const isNotificationChannel = (value: unknown): value is NotificationChannel =>
  value === 'WhatsApp' || value === 'Telegram'

const normalizeNotificationContact = (channel: NotificationChannel, value: string) =>
  (channel === 'WhatsApp' ? value.replace(/[^\d+() -]/g, '') : value).trim()

const validateNotificationContact = (channel: NotificationChannel, value: string) => {
  const normalized = normalizeNotificationContact(channel, value)

  if (!normalized) {
    return 'Escolha se o aviso sera por WhatsApp ou Telegram e informe o contato.'
  }

  if (channel === 'WhatsApp' && normalized.replace(/\D/g, '').length < 10) {
    return 'Informe um WhatsApp valido para o aviso de renovacao.'
  }

  if (channel === 'Telegram' && normalized.replace(/\s/g, '').length < 4) {
    return 'Informe um Telegram valido para o aviso de renovacao.'
  }

  return null
}

const formatNotificationContact = (channel: NotificationChannel, value: string) => {
  const normalized = normalizeNotificationContact(channel, value)

  if (!normalized) {
    return 'Nao definido'
  }

  if (channel === 'Telegram' && !normalized.startsWith('@') && /^[A-Za-z0-9_]+$/.test(normalized)) {
    return `@${normalized}`
  }

  return normalized
}

const readStoredCaptureAccounts = (): CaptureAccountRecord[] => {
  if (typeof window === 'undefined') return []

  const raw = window.localStorage.getItem(captureAccountsStorageKey)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((entry, index) => {
      if (!entry || typeof entry !== 'object') return []

      const candidate = entry as Partial<CaptureAccountRecord>
      const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
      const email = typeof candidate.email === 'string' ? normalizeAccountEmail(candidate.email) : ''
      const password = typeof candidate.password === 'string' ? candidate.password : ''
      const favoritePlatform =
        candidate.favoritePlatform && virtualPlatformOptions.includes(candidate.favoritePlatform)
          ? candidate.favoritePlatform
          : profileSummary.favoritePlatform
      const currentPlan = isPlanId(candidate.currentPlan) ? candidate.currentPlan : 'Free'
      const notificationChannel = isNotificationChannel(candidate.notificationChannel)
        ? candidate.notificationChannel
        : 'WhatsApp'
      const notificationContact =
        typeof candidate.notificationContact === 'string'
          ? normalizeNotificationContact(notificationChannel, candidate.notificationContact)
          : ''
      const taxId = typeof candidate.taxId === 'string' ? normalizeTaxId(candidate.taxId) : ''
      const phoneNumber =
        typeof candidate.phoneNumber === 'string'
          ? normalizePhoneNumber(candidate.phoneNumber)
          : notificationChannel === 'WhatsApp'
            ? normalizePhoneNumber(notificationContact)
            : ''
      const pagBankCheckout = parsePagBankCheckoutRecord(candidate.pagBankCheckout)
      const createdAt =
        typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
          ? candidate.createdAt
          : Date.now() - index
      const planActivatedAt =
        typeof candidate.planActivatedAt === 'number' && Number.isFinite(candidate.planActivatedAt)
          ? candidate.planActivatedAt
          : currentPlan !== 'Free'
            ? createdAt
            : null
      const planEndsAt =
        typeof candidate.planEndsAt === 'number' && Number.isFinite(candidate.planEndsAt)
          ? candidate.planEndsAt
          : planActivatedAt !== null
            ? planActivatedAt + captureBillingCycleMs
            : null
      const trialEndsAt =
        typeof candidate.trialEndsAt === 'number' && Number.isFinite(candidate.trialEndsAt)
          ? candidate.trialEndsAt
          : null

      if (!name || !email || !password) {
        return []
      }

      return [
        {
          id:
            typeof candidate.id === 'string' && candidate.id.trim().length > 0
              ? candidate.id
              : `account-${createdAt}-${index}`,
          name,
          email,
          password,
          favoritePlatform,
          currentPlan,
          notificationChannel,
          notificationContact,
          taxId,
          phoneNumber,
          pagBankCheckout,
          createdAt,
          planActivatedAt,
          planEndsAt,
          trialEndsAt,
        },
      ]
    })
  } catch {
    return []
  }
}

const readStoredCaptureSession = (): CaptureSessionRecord | null => {
  if (typeof window === 'undefined') return null

  const raw = window.localStorage.getItem(captureSessionStorageKey)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<CaptureSessionRecord>

    if (!parsed || typeof parsed.accountId !== 'string' || !parsed.accountId.trim()) {
      return null
    }

    return {
      accountId: parsed.accountId,
      signedAt:
        typeof parsed.signedAt === 'number' && Number.isFinite(parsed.signedAt)
          ? parsed.signedAt
          : Date.now(),
    }
  } catch {
    return null
  }
}

const resolveInitialActivePage = (): Page =>
  typeof window !== 'undefined'
    ? normalizePathname(window.location.pathname) === capturePagePath
      ? 'capture'
      : normalizePathname(window.location.pathname) === loginPagePath
        ? 'login'
        : readStoredChoice(activePageStorageKey, internalPageOptions, 'analysis')
    : 'analysis'

const isTrialActiveForAccount = (
  account: Pick<CaptureAccountRecord, 'trialEndsAt'> | null | undefined,
  referenceTimestamp = Date.now(),
) => typeof account?.trialEndsAt === 'number' && account.trialEndsAt > referenceTimestamp

const isPaidPlanExpiredForAccount = (
  account:
    | Pick<CaptureAccountRecord, 'createdAt' | 'currentPlan' | 'planActivatedAt' | 'planEndsAt'>
    | null
    | undefined,
  referenceTimestamp = Date.now(),
) => {
  if (!account || account.currentPlan === 'Free') return false

  const fallbackActivatedAt = account.planActivatedAt ?? account.createdAt
  const planEndsAt = account.planEndsAt ?? fallbackActivatedAt + captureBillingCycleMs
  return planEndsAt <= referenceTimestamp
}

const createDefaultFilters = (
  platform: FiltersState['platform'] = profileSummary.favoritePlatform,
  leagueName?: string,
): FiltersState => {
  const safePlatform = virtualPlatformOptions.includes(platform) ? platform : profileSummary.favoritePlatform
  const leagueOptions = getLeagueOptionsForPlatform(safePlatform)
  const safeLeague =
    leagueName && leagueOptions.includes(leagueName)
      ? leagueName
      : resolveDefaultLeagueForPlatform(safePlatform)

  return {
    platform: safePlatform,
    league: safeLeague,
    timeMode: 'FT',
    market: 'Ambas Marcam Sim',
    oddBand: 'Selecione as Odds',
    oddsView: 'Selecione as Odds',
    oddSequence: [],
    period: '12h',
    greenColor: defaultCellGreenColor,
    redColor: defaultCellRedColor,
  }
}

const sanitizeStoredFilters = (
  value: Partial<FiltersState> | null | undefined,
  fallbackPlatform: FiltersState['platform'] = profileSummary.favoritePlatform,
  fallbackLeague?: string,
): FiltersState => {
  const defaultFilters = createDefaultFilters(fallbackPlatform, fallbackLeague)
  const safePlatform =
    value?.platform && virtualPlatformOptions.includes(value.platform)
      ? value.platform
      : defaultFilters.platform
  const leagueOptions = getLeagueOptionsForPlatform(safePlatform)
  const safeLeague =
    value?.league && leagueOptions.includes(value.league)
      ? value.league
      : defaultFilters.league

  return {
    platform: safePlatform,
    league: safeLeague,
    timeMode:
      value?.timeMode && timeModeOptions.includes(value.timeMode)
        ? value.timeMode
        : defaultFilters.timeMode,
    market:
      value?.market && marketOptions.includes(value.market)
        ? value.market
        : defaultFilters.market,
    oddBand:
      value?.oddBand && oddBandOptions.includes(value.oddBand)
        ? value.oddBand
        : defaultFilters.oddBand,
    oddsView:
      value?.oddsView &&
      (value.oddsView === 'Selecione as Odds' || marketOptions.includes(value.oddsView))
        ? value.oddsView
        : defaultFilters.oddsView,
    oddSequence: Array.isArray(value?.oddSequence)
      ? value.oddSequence.filter((market): market is Market => marketOptions.includes(market))
      : defaultFilters.oddSequence,
    period:
      value?.period && Object.prototype.hasOwnProperty.call(periodMsMap, value.period)
        ? value.period
        : defaultFilters.period,
    greenColor: isHexColor(value?.greenColor) ? value.greenColor : defaultFilters.greenColor,
    redColor: isHexColor(value?.redColor) ? value.redColor : defaultFilters.redColor,
  }
}

const readStoredFilters = (fallbackPlatform: FiltersState['platform']) => {
  if (typeof window === 'undefined') {
    return createDefaultFilters(fallbackPlatform)
  }

  const raw = window.localStorage.getItem(filtersStorageKey)
  if (!raw) {
    return createDefaultFilters(fallbackPlatform)
  }

  try {
    return sanitizeStoredFilters(JSON.parse(raw) as Partial<FiltersState>, fallbackPlatform)
  } catch {
    return createDefaultFilters(fallbackPlatform)
  }
}

const readStoredAnalysisCardFilters = () => {
  if (typeof window === 'undefined') return {}

  const raw = window.localStorage.getItem(analysisCardFiltersStorageKey)
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<FiltersState>>
    return Object.values(parsed).reduce(
      (acc, value) => {
        const safeFilters = sanitizeStoredFilters(value)
        acc[buildAnalysisCardFilterKey(safeFilters.platform, safeFilters.league)] = safeFilters
        return acc
      },
      {} as Record<string, FiltersState>,
    )
  } catch {
    return {}
  }
}

const readStoredNextGamesPeriods = () => {
  if (typeof window === 'undefined') return {}

  const raw = window.localStorage.getItem(nextGamesPeriodsStorageKey)
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as Record<string, Period>
    return Object.entries(parsed).reduce(
      (acc, [key, value]) => {
        if (Object.prototype.hasOwnProperty.call(periodMsMap, value)) {
          acc[key] = value
        }
        return acc
      },
      {} as Record<string, Period>,
    )
  } catch {
    return {}
  }
}

const shouldFetchBbtipsMarketOdds = (market: Market | undefined) =>
  Boolean(market && market !== 'Selecione as Odds')

const createAnalysisCardFilters = (
  baseFilters: FiltersState,
  platform: FiltersState['platform'],
  leagueName: string,
  override?: Partial<FiltersState>,
): FiltersState => {
  const overridePeriod = override?.period
  const nextPeriod =
    overridePeriod && Object.prototype.hasOwnProperty.call(periodMsMap, overridePeriod)
      ? overridePeriod
      : baseFilters.period

  return {
    platform,
    league: leagueName,
    timeMode: override?.timeMode ?? baseFilters.timeMode,
    market: override?.market ?? baseFilters.market,
    oddBand: override?.oddBand ?? baseFilters.oddBand,
    oddsView: override?.oddsView ?? baseFilters.oddsView,
    oddSequence: override?.oddSequence ?? baseFilters.oddSequence ?? [],
    period: nextPeriod,
    greenColor: override?.greenColor ?? baseFilters.greenColor ?? defaultCellGreenColor,
    redColor: override?.redColor ?? baseFilters.redColor ?? defaultCellRedColor,
  }
}

const isFinishedStatus = (record: MatchRecord | undefined) =>
  Boolean(
    record &&
      normalizeStatusValue(record.status).length > 0 &&
      !pendingStatusTokens.some((token) => normalizeStatusValue(record.status).includes(token)),
  )

function buildNextRankingMatchIds(
  leagueFinishedRecords: MatchRecord[],
  rows: Array<{ cells: MatrixCell[] }>,
  market: Market,
) {
  const teamStats = new Map<
    string,
    { firstSeenOrder: number; teamName: string; totalGames: number; totalSuccess: number }
  >()
  let teamOrder = 0

  leagueFinishedRecords.forEach((record) => {
    const isGreen = Number(Boolean(record.marketResults[market]))

    ;[record.homeTeam, record.awayTeam].forEach((teamName) => {
      const current =
        teamStats.get(teamName) ??
        {
          firstSeenOrder: teamOrder++,
          teamName,
          totalGames: 0,
          totalSuccess: 0,
        }
      current.totalGames += 1
      current.totalSuccess += isGreen
      teamStats.set(teamName, current)
    })
  })

  const rankingTeamNames = new Set(
    [...teamStats.values()]
      .map((stats) => ({
        firstSeenOrder: stats.firstSeenOrder,
        successPercent: stats.totalGames ? Math.round((stats.totalSuccess / stats.totalGames) * 100) : 0,
        teamName: stats.teamName,
      }))
      .sort((left, right) => {
        if (right.successPercent !== left.successPercent) {
          return right.successPercent - left.successPercent
        }
        return left.firstSeenOrder - right.firstSeenOrder
      })
      .slice(0, 5)
      .map((entry) => entry.teamName),
  )

  const nextRankingMatchIds: string[] = []
  const nextRankingDualMatchIds: string[] = []

  rows
    .flatMap((row) => row.cells)
    .map((cell) => cell.upcoming)
    .filter((record): record is MatchRecord => Boolean(record && !isFinishedStatus(record)))
    .forEach((record) => {
      const rankedTeamsInMatch = Number(rankingTeamNames.has(record.homeTeam)) + Number(rankingTeamNames.has(record.awayTeam))

      if (rankedTeamsInMatch >= 1) {
        nextRankingMatchIds.push(record.id)
      }

      if (rankedTeamsInMatch >= 2) {
        nextRankingDualMatchIds.push(record.id)
      }
    })

  return {
    nextRankingDualMatchIds,
    nextRankingMatchIds,
  }
}

const toUtcHourStart = (timestamp: number) => {
  const date = new Date(timestamp)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), 0, 0, 0)
}

const MAX_MATRIX_HOUR_ROWS = 240

/** Rótulo único por linha em janelas longas (hora BR + dia). */
const formatMatrixRowHourLabel = (bucketStart: number) =>
  `${new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).format(new Date(bucketStart))}h`

const buildRollingHourBuckets = (referenceTimestamp: number, period: Period) => {
  const periodDuration = periodMsMap[period] ?? periodMsMap['12h']
  const periodHours = Math.max(1, Math.min(Math.ceil(periodDuration / hourMs), MAX_MATRIX_HOUR_ROWS))
  const refBucket = toUtcHourStart(referenceTimestamp)
  return Array.from({ length: periodHours }, (_, index) => refBucket - index * hourMs)
}

function buildMatrixRowsForRecords(
  records: MatchRecord[],
  market: Market,
  timeMode: TimeMode,
  period: Period,
  referenceTimestamp: number,
  fallbackRecords: MatchRecord[] = records,
  activeHourBuckets?: number[],
  forcedMinuteSlots?: number[],
) {
  type MatrixRow = {
    hour: number
    hourLabel?: string
    cells: MatrixCell[]
    greens: number
    goals: number
    total: number
    greenRate: number
  }

  const usableRecords = records.filter((record) => hasRecordStatus(record))
  const recordsByBucketStart = [...usableRecords, ...fallbackRecords]
    .filter((record) => hasRecordStatus(record) && Number.isFinite(record.timestamp))
    .sort((left, right) => right.timestamp - left.timestamp)
    .reduce((acc, record) => {
      const bucketStart = toUtcHourStart(record.timestamp)
      if (!acc.has(bucketStart)) {
        acc.set(bucketStart, record)
      }
      return acc
    }, new Map<number, MatchRecord>())
  const getBucketDisplayHour = (bucketStart: number) =>
    recordsByBucketStart.get(bucketStart)?.hour ?? new Date(bucketStart).getUTCHours()
  const buckets = groupBy(
    usableRecords,
    (record) => `${toUtcHourStart(record.timestamp)}-${record.minuteSlot}`,
  )
  const finishedFallbackRecords = fallbackRecords.filter(
    (record) => hasRecordStatus(record) && isFinishedStatus(record),
  )
  const fallbackBuckets = groupBy(
    finishedFallbackRecords,
    (record) => `${toUtcHourStart(record.timestamp)}-${record.minuteSlot}`,
  )
  const finishedRecords = usableRecords.filter((record) => isFinishedStatus(record))
  const sequenceRecords = finishedRecords
  const minuteRemainderSource = sequenceRecords.length > 0 ? sequenceRecords : records
  const minuteRemainderFrequency = minuteRemainderSource.reduce(
    (acc, record) => {
      acc[record.minuteSlot % 3] += 1
      return acc
    },
    [0, 0, 0],
  )
  const dominantMinuteRemainder =
    minuteRemainderFrequency[1] >= minuteRemainderFrequency[0] &&
    minuteRemainderFrequency[1] >= minuteRemainderFrequency[2]
      ? 1
      : minuteRemainderFrequency[2] >= minuteRemainderFrequency[0]
        ? 2
        : 0

  const sequenceReferenceTimestamp = sequenceRecords[0]?.timestamp ?? referenceTimestamp
  const latestSettledRecord = sequenceRecords[0]
  const latestSettledTimestamp = latestSettledRecord?.timestamp ?? -Infinity
  const settledHourBuckets =
    activeHourBuckets && activeHourBuckets.length > 0
      ? activeHourBuckets
      : buildRollingHourBuckets(sequenceReferenceTimestamp, period)
  const latestActiveHourBucket = settledHourBuckets[0] ?? toUtcHourStart(sequenceReferenceTimestamp)
  const latestSettledMinuteSlot =
    latestSettledRecord?.minuteSlot ?? new Date(sequenceReferenceTimestamp).getUTCMinutes()
  const upcomingRecordsById = new Map<string, MatchRecord>()
  ;[...usableRecords, ...fallbackRecords].forEach((record) => {
    if (hasRecordStatus(record) && !isFinishedStatus(record)) {
      upcomingRecordsById.set(record.id, record)
    }
  })

  const upcomingRecords = [...upcomingRecordsById.values()]
    .filter(
      (record) =>
        Number.isFinite(record.timestamp) && record.timestamp > latestSettledTimestamp,
    )
    .sort((left, right) => left.timestamp - right.timestamp)
  const activeMinuteSlots =
    forcedMinuteSlots && forcedMinuteSlots.length > 0
      ? forcedMinuteSlots
      : Array.from({ length: 20 }, (_, index) => dominantMinuteRemainder + index * 3)
  const selectedUpcomingRecords = upcomingRecords
    .filter((record) => activeMinuteSlots.includes(record.minuteSlot))
  const latestBucketUpcomingByMinuteSlot = new Map<number, MatchRecord>()

  selectedUpcomingRecords
    .filter((record) => toUtcHourStart(record.timestamp) === latestActiveHourBucket)
    .forEach((record) => {
      const currentRecord = latestBucketUpcomingByMinuteSlot.get(record.minuteSlot)

      if (!currentRecord || record.timestamp < currentRecord.timestamp) {
        latestBucketUpcomingByMinuteSlot.set(record.minuteSlot, record)
      }
    })

  const buildCellsForBucket = (bucketStart: number, allowFallback = true): MatrixCell[] =>
    activeMinuteSlots.map((minuteSlot) => {
      const bucketKey = `${bucketStart}-${minuteSlot}`
      const periodBucket = buckets.get(bucketKey) ?? []
      const periodFinishedBucket = periodBucket.filter((record) => isFinishedStatus(record))
      const canUseHistoricalFallback =
        allowFallback && (bucketStart !== latestActiveHourBucket || minuteSlot <= latestSettledMinuteSlot)
      const fallbackBucket =
        !canUseHistoricalFallback || periodFinishedBucket.length > 0
          ? []
          : fallbackBuckets.get(bucketKey) ?? []
      const finishedBucket = periodFinishedBucket.length > 0 ? periodFinishedBucket : fallbackBucket
      const historicalOdds = finishedBucket
        .map((record) => record.odds[market])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
      const fallbackOdd = finishedBucket[0]?.odds[market]
      const averageOdd = historicalOdds.length
        ? historicalOdds.reduce((sum, value) => sum + value, 0) / historicalOdds.length
        : typeof fallbackOdd === 'number' && Number.isFinite(fallbackOdd) && fallbackOdd > 0
          ? fallbackOdd
          : null
      const greens = finishedBucket.filter((record) => record.marketResults[market]).length
      const total = finishedBucket.length
      const goals = finishedBucket.reduce((sum, record) => {
        const score = timeMode === 'HT' ? record.scoreHT : record.scoreFT
        const [home, away] = score.split('-').map(Number)

        return sum + (Number.isFinite(home) ? home : 0) + (Number.isFinite(away) ? away : 0)
      }, 0)
      const upcoming =
        bucketStart === latestActiveHourBucket && minuteSlot > latestSettledMinuteSlot
          ? latestBucketUpcomingByMinuteSlot.get(minuteSlot)
          : undefined
      const latest = periodFinishedBucket[0] ?? (canUseHistoricalFallback ? finishedBucket[0] : undefined)
      const cellOdds = buildCellOddsFromRecords([
        upcoming,
        latest,
        ...periodFinishedBucket,
        ...fallbackBucket,
      ])

      return {
        hour: getBucketDisplayHour(bucketStart),
        minuteSlot,
        greens,
        goals,
        total,
        greenRate: total ? greens / total : 0,
        isProjectedUpcoming: false,
        averageOdd,
        odds: cellOdds,
        latest,
        upcoming,
      }
    })

  const buildRow = (bucketStart: number, hourLabel?: string, allowFallback = true): MatrixRow => {
    const cells = buildCellsForBucket(bucketStart, allowFallback)
    const rowGreens = cells.reduce((sum, cell) => sum + cell.greens, 0)
    const rowTotal = cells.reduce((sum, cell) => sum + cell.total, 0)
    const rowGoals = cells.reduce((sum, cell) => sum + cell.goals, 0)

    return {
      hour: getBucketDisplayHour(bucketStart),
      hourLabel,
      cells,
      greens: rowGreens,
      goals: rowGoals,
      total: rowTotal,
      greenRate: rowTotal ? rowGreens / rowTotal : 0,
    }
  }

  const labelPeriodHours = Math.min(
    Math.ceil((periodMsMap[period] ?? periodMsMap['12h']) / hourMs),
    MAX_MATRIX_HOUR_ROWS,
  )
  const extendedRowLabels = labelPeriodHours > 24

  return settledHourBuckets.map((bucketStart) =>
    buildRow(
      bucketStart,
      extendedRowLabels ? formatMatrixRowHourLabel(bucketStart) : undefined,
    ),
  )
}

const buildBbtipsLiveMatrixRows = (
  records: MatchRecord[],
  market: Market,
  rowLayouts: Array<{ bucketStart: number; hour: number; hourLabel: string }>,
  minuteSlots: number[],
  stats: ReturnType<typeof buildBbtipsMatrixStatsFromRecords>,
  payloadFinishedByCell?: Map<string, MatchRecord>,
  payloadUpcomingByCell?: Map<string, MatchRecord>,
  projectedCellKeys?: Set<string>,
) => {
  const latestByCellKey = new Map<string, MatchRecord>()
  const upcomingByCellKey = new Map<string, MatchRecord>()
  const realPopulatedBuckets = new Set<number>()
  const maxRealMinuteByBucket = new Map<number, number>()
  const sparseBoundaryCellThreshold = 4
  const minimumLeadingUpcomingCells = 5
  /** Hora da grade virtual (API), alinhada ao bucket UTC — não usar getHours() do bucket (fuso local). */
  const registerRealBucket = (cellKey: string) => {
    const [bucketToken] = cellKey.split('-', 1)
    const bucketStart = Number(bucketToken)

    if (Number.isFinite(bucketStart)) {
      realPopulatedBuckets.add(bucketStart)
    }
  }
  const registerRealMinute = (bucketStart: number, minuteSlot: number) => {
    if (!Number.isFinite(bucketStart) || !Number.isFinite(minuteSlot)) return
    const currentMinute = maxRealMinuteByBucket.get(bucketStart)
    if (currentMinute === undefined || minuteSlot > currentMinute) {
      maxRealMinuteByBucket.set(bucketStart, minuteSlot)
    }
  }
  const emptyStats = {
    goals: 0,
    greenRate: 0,
    greens: 0,
    total: 0,
  }

  records
    .filter((record) => hasRecordStatus(record) && isFinishedStatus(record))
    .sort((left, right) => right.timestamp - left.timestamp)
    .forEach((record) => {
      const bucket = toUtcHourStart(record.timestamp)
      const key = `${bucket}-${record.minuteSlot}`
      if (!latestByCellKey.has(key)) {
        latestByCellKey.set(key, record)
        registerRealBucket(key)
        registerRealMinute(bucket, record.minuteSlot)
      }
    })

  records
    .filter((record) => hasRecordStatus(record) && !isFinishedStatus(record))
    .sort((left, right) => left.timestamp - right.timestamp)
    .forEach((record) => {
      const bucket = toUtcHourStart(record.timestamp)
      const key = `${bucket}-${record.minuteSlot}`
      if (!latestByCellKey.has(key) && !upcomingByCellKey.has(key)) {
        upcomingByCellKey.set(key, record)
        registerRealBucket(key)
        registerRealMinute(bucket, record.minuteSlot)
      }
    })

  payloadFinishedByCell?.forEach((record, cellKey) => {
    if (!latestByCellKey.has(cellKey)) {
      latestByCellKey.set(cellKey, record)
      registerRealBucket(cellKey)
      registerRealMinute(toUtcHourStart(record.timestamp), record.minuteSlot)
    }
  })
  payloadUpcomingByCell?.forEach((record, cellKey) => {
    if (!latestByCellKey.has(cellKey) && !upcomingByCellKey.has(cellKey)) {
      upcomingByCellKey.set(cellKey, record)
      registerRealBucket(cellKey)
      registerRealMinute(toUtcHourStart(record.timestamp), record.minuteSlot)
    }
  })

  const rows = rowLayouts.map((layout) => {
    const { bucketStart, hour, hourLabel } = layout
    const cells = minuteSlots.map((minuteSlot) => {
      const cellKey = `${bucketStart}-${minuteSlot}`
      const latest = latestByCellKey.get(cellKey)
      const upcoming = latest ? undefined : upcomingByCellKey.get(cellKey)
      const lastRealMinuteInBucket = maxRealMinuteByBucket.get(bucketStart) ?? -1
      const isProjectedUpcoming = Boolean(
        !latest &&
          !upcoming &&
          projectedCellKeys?.has(cellKey) &&
          (
            !realPopulatedBuckets.has(bucketStart) ||
            minuteSlot > lastRealMinuteInBucket
          ),
      )
      const cellStats = stats.cells.get(cellKey) ?? emptyStats
      const cellOdds = buildCellOddsFromRecords([upcoming, latest])
      const averageOdd =
        [upcoming?.odds[market], latest?.odds[market]].find(isPositiveOdd) ?? null

      return {
        hour,
        minuteSlot,
        greens: cellStats.greens,
        goals: cellStats.goals,
        total: cellStats.total,
        greenRate: cellStats.greenRate,
        isProjectedUpcoming: Boolean(upcoming) || isProjectedUpcoming,
        averageOdd,
        odds: cellOdds,
        latest,
        upcoming,
      }
    })
    const greens = cells.reduce((sum, cell) => sum + cell.greens, 0)
    const goals = cells.reduce((sum, cell) => sum + cell.goals, 0)
    const total = cells.reduce((sum, cell) => sum + cell.total, 0)

    return {
      hour,
      hourLabel,
      cells,
      greens,
      goals,
      total,
      greenRate: total ? greens / total : 0,
    }
  })

  const compactRows = rows.filter((row) =>
    row.cells.some((cell) => Boolean(cell.latest || cell.upcoming || cell.isProjectedUpcoming)),
  )

  while (compactRows.length > 1) {
    const leadingRow = compactRows[0]
    const settledCells = leadingRow.cells.filter((cell) => Boolean(cell.latest)).length
    const upcomingCells = leadingRow.cells.filter((cell) => Boolean(cell.upcoming)).length

    if (settledCells > 0 || upcomingCells >= minimumLeadingUpcomingCells) {
      break
    }

    compactRows.shift()
  }

  while (compactRows.length > 1) {
    const trailingRow = compactRows[compactRows.length - 1]
    const populatedCells = trailingRow.cells.filter(
      (cell) => Boolean(cell.latest || cell.upcoming || cell.isProjectedUpcoming),
    ).length
    const hasPendingCells = trailingRow.cells.some(
      (cell) => Boolean(cell.upcoming || cell.isProjectedUpcoming),
    )

    if (hasPendingCells || populatedCells >= sparseBoundaryCellThreshold) {
      break
    }

    compactRows.pop()
  }

  return compactRows
}

const normalizeToggleState = (value?: Partial<Record<ToggleKey, boolean>>) => {
  const defaults = createInitialToggles()

  return Object.keys(defaults).reduce(
    (acc, key) => {
      const typedKey = key as ToggleKey
      const nextValue = value?.[typedKey]
      acc[typedKey] = typeof nextValue === 'boolean' ? nextValue : defaults[typedKey]
      return acc
    },
    {} as Record<ToggleKey, boolean>,
  )
}

function App() {
  ensureMatrixStateVersion()

  const [captureAccounts, setCaptureAccounts] = useState<CaptureAccountRecord[]>(() =>
    readStoredCaptureAccounts(),
  )
  const [authSession, setAuthSession] = useState<CaptureSessionRecord | null>(() =>
    readStoredCaptureSession(),
  )
  const initialSessionAccount =
    authSession
      ? captureAccounts.find((account) => account.id === authSession.accountId) ?? null
      : null
  const defaultPlatform = initialSessionAccount?.favoritePlatform ?? profileSummary.favoritePlatform
  const [activePage, setActivePage] = useState<Page>(() => resolveInitialActivePage())
  const [menuOpen, setMenuOpen] = useState(false)
  const searchQuery = ''
  const [filters, setFilters] = useState<FiltersState>(() => readStoredFilters(defaultPlatform))
  const [lastSelectedLeagueByPlatform, setLastSelectedLeagueByPlatform] = useState<Partial<Record<Platform, string>>>(() => ({
    [defaultPlatform]: readStoredFilters(defaultPlatform).league,
  }))
  const [analysisCardFilters, setAnalysisCardFilters] = useState<Record<string, FiltersState>>(() => readStoredAnalysisCardFilters())
  const [nextGamesPeriodsByLeague, setNextGamesPeriodsByLeague] = useState<Record<string, Period>>(() => readStoredNextGamesPeriods())
  const requestedBbtipsMarkets = useMemo(() => {
    const requestedMarkets = new Set<Market>()
    const activeLeagueKey = buildAnalysisCardFilterKey(filters.platform, filters.league)
    const addMarket = (market: Market | undefined) => {
      if (!market || !shouldFetchBbtipsMarketOdds(market)) return
      requestedMarkets.add(market)
    }

    addMarket(filters.oddsView)
    filters.oddSequence.forEach(addMarket)
    Object.entries(analysisCardFilters).forEach(([key, cardFilters]) => {
      if (key !== activeLeagueKey) return
      addMarket(cardFilters.oddsView)
      cardFilters.oddSequence.forEach(addMarket)
    })

    return [...requestedMarkets]
  }, [analysisCardFilters, filters.league, filters.oddSequence, filters.oddsView, filters.platform])
  const requestedBbtipsPeriod = useMemo(() => {
    const activeLeagueKey = buildAnalysisCardFilterKey(filters.platform, filters.league)

    const cardPeriod = Object.entries(analysisCardFilters).reduce((selectedPeriod, [key, cardFilters]) => {
      if (key !== activeLeagueKey) {
        return selectedPeriod
      }

      return (periodMsMap[cardFilters.period] ?? 0) > (periodMsMap[selectedPeriod] ?? 0)
        ? cardFilters.period
        : selectedPeriod
    }, filters.period)
    const nextGamesPeriod = nextGamesPeriodsByLeague[activeLeagueKey] ?? filters.period

    return (periodMsMap[nextGamesPeriod] ?? 0) > (periodMsMap[cardPeriod] ?? 0)
      ? nextGamesPeriod
      : cardPeriod
  }, [analysisCardFilters, filters.league, filters.period, filters.platform, nextGamesPeriodsByLeague])
  const bbtipsLiveData = useBbtipsLiveRecords(
    filters.platform,
    true,
    requestedBbtipsMarkets,
    requestedBbtipsPeriod,
    filters.league ? [filters.league] : [],
  )
  const matchRecords = bbtipsLiveData.records
  const bbtipsPayloadByLeague = useMemo(
    () =>
      new Map(
        (bbtipsLiveData.payload?.leagues ?? []).map((league) => [league.name, league]),
      ),
    [bbtipsLiveData.payload],
  )
  const [renderedAt] = useState(() => Date.now())
  const [leagueToggles, setLeagueToggles] = useState<Record<string, Record<ToggleKey, boolean>>>(() => {
    if (typeof window === 'undefined') return {}

    const raw = window.localStorage.getItem(leagueToggleStorageKey)
    if (!raw) return {}

    try {
      const parsed = JSON.parse(raw) as Record<string, Partial<Record<ToggleKey, boolean>>>
      return Object.entries(parsed).reduce(
        (acc, [leagueName, value]) => {
          acc[leagueName] = normalizeToggleState(value)
          return acc
        },
        {} as Record<string, Record<ToggleKey, boolean>>,
      )
    } catch {
      return {}
    }
  })
  const [historyView, setHistoryView] = useState<HistoryView>(() => readStoredChoice(historyViewStorageKey, historyViewOptions, 'Tabela'))
  const [densityMode, setDensityMode] = useState<DensityMode>(() => readStoredChoice(densityModeStorageKey, densityModeOptions, 'Compacta'))
  const [selectedCell, setSelectedCell] = useState<MatrixCell | null>(null)
  const [selectedCellMarkers, setSelectedCellMarkers] = useState<SelectedCellMarker[]>([])
  const [selectedRecord, setSelectedRecord] = useState<MatchRecord | null>(null)
  const [uiResetVersion, setUiResetVersion] = useState(0)
  const [alerts, setAlerts] = useState<AlertItem[]>(initialAlerts)
  const [currentPlan, setCurrentPlan] = useState<Plan['id']>(
    () => initialSessionAccount?.currentPlan ?? profileSummary.currentPlan,
  )
  const [bots, setBots] = useState<Bot[]>(() => {
    if (typeof window === 'undefined') return initialBots
    const raw = window.localStorage.getItem(botStorageKey)
    if (!raw) return initialBots
    try {
      return JSON.parse(raw) as Bot[]
    } catch {
      return initialBots
    }
  })
  const [editingBotId, setEditingBotId] = useState<string | null>(initialBots[0]?.id ?? null)
  const [botDraft, setBotDraft] = useState<BotDraft>(() =>
    initialBots[0] ? createDraftFromBot(initialBots[0]) : createDraftFromFilters(filters),
  )
  const [notificationPrefs, setNotificationPrefs] = useState({
    telegram: true,
    push: true,
    email: false,
  })
  const authenticatedAccount = useMemo(
    () =>
      authSession
        ? captureAccounts.find((account) => account.id === authSession.accountId) ?? null
        : null,
    [authSession, captureAccounts],
  )
  const sessionFavoritePlatform = authenticatedAccount?.favoritePlatform ?? profileSummary.favoritePlatform
  const sessionProfileName = authenticatedAccount?.name ?? profileSummary.name
  const sessionProfileEmail = authenticatedAccount?.email ?? profileSummary.email
  const sessionTaxId = authenticatedAccount?.taxId ?? ''
  const sessionPhoneNumber = authenticatedAccount?.phoneNumber ?? ''
  const activePagBankCheckout = authenticatedAccount?.pagBankCheckout ?? null
  const sessionTrialActive = isTrialActiveForAccount(authenticatedAccount)
  const paidPlanExpired = useMemo(
    () => isPaidPlanExpiredForAccount(authenticatedAccount),
    [authenticatedAccount],
  )
  const renewalContactLabel = useMemo(
    () =>
      authenticatedAccount
        ? formatNotificationContact(
            authenticatedAccount.notificationChannel,
            authenticatedAccount.notificationContact,
          )
        : 'Nao definido',
    [authenticatedAccount],
  )
  const currentPlanLabel = useMemo(() => {
    if (sessionTrialActive) return 'Teste 5h'
    if (paidPlanExpired) return 'Renovacao pendente'
    if (currentPlan === 'Free') return 'Pix pendente'
    if (currentPlan === 'Premium') return 'Premium ativo'
    return 'Cliente ativo'
  }, [currentPlan, paidPlanExpired, sessionTrialActive])
  const paymentAmountLabel = useMemo(() => formatCurrencyBRL(appConfig.pixAmount), [])
  const paymentAmountCents = useMemo(() => Math.round(appConfig.pixAmount * 100), [])
  const monthlyPlanEndsAt = useMemo(() => {
    if (!authenticatedAccount || authenticatedAccount.currentPlan === 'Free') {
      return null
    }

    const fallbackActivatedAt = authenticatedAccount.planActivatedAt ?? authenticatedAccount.createdAt
    return authenticatedAccount.planEndsAt ?? fallbackActivatedAt + captureBillingCycleMs
  }, [authenticatedAccount])
  const monthlyPlanDaysRemaining = useMemo(() => {
    if (!monthlyPlanEndsAt) return null
    return Math.max(0, Math.ceil((monthlyPlanEndsAt - Date.now()) / dayMs))
  }, [monthlyPlanEndsAt])
  const monthlyPlanCountdownLabel = useMemo(() => {
    if (!monthlyPlanEndsAt) {
      return `${captureBillingCycleDays} dias por ativacao`
    }

    if ((monthlyPlanDaysRemaining ?? 0) <= 0) {
      return 'Ciclo expirado'
    }

    return monthlyPlanDaysRemaining === 1
      ? '1 dia restante'
      : `${monthlyPlanDaysRemaining} dias restantes`
  }, [monthlyPlanDaysRemaining, monthlyPlanEndsAt])
  const renewalReminderActive = Boolean(
    authenticatedAccount &&
      !sessionTrialActive &&
      currentPlan !== 'Free' &&
      !paidPlanExpired &&
      monthlyPlanDaysRemaining !== null &&
      monthlyPlanDaysRemaining <= captureRenewalReminderDays,
  )
  const renewalReminderTitle = useMemo(() => {
    if (!renewalReminderActive || monthlyPlanDaysRemaining === null) {
      return ''
    }

    return monthlyPlanDaysRemaining === 1
      ? 'Seu plano vence amanha.'
      : `Faltam ${monthlyPlanDaysRemaining} dias para renovar o plano.`
  }, [monthlyPlanDaysRemaining, renewalReminderActive])
  const renewalReminderDescription = useMemo(() => {
    if (!renewalReminderActive || !authenticatedAccount) {
      return ''
    }

    return `O aviso aparece sempre que voce entrar no site enquanto faltarem ${captureRenewalReminderDays} dias ou menos. Contato salvo: ${authenticatedAccount.notificationChannel} ${renewalContactLabel}.`
  }, [authenticatedAccount, renewalContactLabel, renewalReminderActive])
  const accountAccessState = useMemo(() => {
    if (sessionTrialActive) {
      return {
        description:
          'Seu teste esta ativo e a area interna segue liberada. Se quiser, ja da para pagar antes para nao interromper a rotina depois.',
        label: 'Teste ativo',
        tone: 'trial' as const,
      }
    }

    if (paidPlanExpired) {
      return {
        description: `Seu ciclo mensal de ${captureBillingCycleDays} dias terminou. Renove por ${paymentAmountLabel} para liberar novamente a area interna.`,
        label: 'Renovacao pendente',
        tone: 'pending' as const,
      }
    }

    if (currentPlan === 'Free') {
      if (activePagBankCheckout && activePagBankCheckout.status === 'pending') {
        return {
          description: `Seu checkout do PagBank ja foi criado e fica valido por mais ${formatPagBankCountdown(activePagBankCheckout.expiresAt).toLowerCase()}.`,
          label: 'Aguardando pagamento',
          tone: 'pending' as const,
        }
      }

      if (activePagBankCheckout && activePagBankCheckout.status === 'under_review') {
        return {
          description:
            'Seu pagamento foi sinalizado e agora estamos aguardando o comprovante para validar a liberacao manual.',
          label: 'Aguardando confirmacao',
          tone: 'pending' as const,
        }
      }

      return {
        description:
          'A conta esta pronta, mas ainda depende do Pix para manter a continuidade da area interna sem bloqueio.',
        label: 'Aguardando pagamento',
        tone: 'pending' as const,
      }
    }

    return {
      description:
        `Seu acesso interno ja esta liberado. O ciclo mensal vale ${captureBillingCycleDays} dias e hoje restam ${monthlyPlanCountdownLabel.toLowerCase()}.`,
      label: currentPlan === 'Premium' ? 'Premium ativo' : 'Acesso liberado',
      tone: 'active' as const,
    }
  }, [
    activePagBankCheckout,
    currentPlan,
    monthlyPlanCountdownLabel,
    paidPlanExpired,
    paymentAmountLabel,
    sessionTrialActive,
  ])
  const paymentCheckoutEnabled = Boolean(
    authenticatedAccount && (currentPlan === 'Free' || paidPlanExpired),
  )
  const pendingPaymentApprovals = useMemo(
    () =>
      captureAccounts
        .filter((account) => account.pagBankCheckout?.status === 'under_review')
        .map((account) => ({
          accountId: account.id,
          amountLabel: formatCurrencyBRL((account.pagBankCheckout?.amountCents ?? paymentAmountCents) / 100),
          email: account.email,
          name: account.name,
          orderId: account.pagBankCheckout?.orderId ?? 'Sem pedido',
          referenceId: account.pagBankCheckout?.referenceId ?? 'Sem referencia',
          requestedAtLabel: account.pagBankCheckout?.lastCheckedAt
            ? new Date(account.pagBankCheckout.lastCheckedAt).toLocaleString('pt-BR')
            : 'Agora',
          statusLabel: 'Aguardando comprovante',
        })),
    [captureAccounts, paymentAmountCents],
  )
  const requiresPayment = Boolean(
    authenticatedAccount && !sessionTrialActive && (currentPlan === 'Free' || paidPlanExpired),
  )
  const paymentGatewayReady = Boolean(supabase)

  useEffect(() => {
    window.localStorage.setItem(botStorageKey, JSON.stringify(bots))
  }, [bots])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(captureAccountsStorageKey, JSON.stringify(captureAccounts))
  }, [captureAccounts])

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (!authSession) {
      window.localStorage.removeItem(captureSessionStorageKey)
      return
    }

    window.localStorage.setItem(captureSessionStorageKey, JSON.stringify(authSession))
  }, [authSession])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (activePage === 'capture' || activePage === 'login') return
    window.localStorage.setItem(activePageStorageKey, activePage)
  }, [activePage])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(filtersStorageKey, JSON.stringify(filters))
  }, [filters])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(analysisCardFiltersStorageKey, JSON.stringify(analysisCardFilters))
  }, [analysisCardFilters])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(nextGamesPeriodsStorageKey, JSON.stringify(nextGamesPeriodsByLeague))
  }, [nextGamesPeriodsByLeague])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(leagueToggleStorageKey, JSON.stringify(leagueToggles))
  }, [leagueToggles])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(historyViewStorageKey, historyView)
  }, [historyView])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(densityModeStorageKey, densityMode)
  }, [densityMode])

  useEffect(() => {
    if (authSession && !authenticatedAccount) {
      setAuthSession(null)
    }
  }, [authSession, authenticatedAccount])

  useEffect(() => {
    const nextPlan = authenticatedAccount?.currentPlan ?? profileSummary.currentPlan

    if (currentPlan !== nextPlan) {
      setCurrentPlan(nextPlan)
    }
  }, [authenticatedAccount, currentPlan])

  useEffect(() => {
    if (!authSession) return

    setCaptureAccounts((current) => {
      let changed = false
      const next = current.map((account) => {
        if (account.id !== authSession.accountId || account.currentPlan === currentPlan) {
          return account
        }

        changed = true
        const nextPlanActivatedAt =
          currentPlan === 'Free'
            ? null
            : account.currentPlan === 'Free'
              ? Date.now()
              : account.planActivatedAt ?? Date.now()

        return {
          ...account,
          currentPlan,
          planActivatedAt: nextPlanActivatedAt,
          planEndsAt:
            currentPlan === 'Free'
              ? null
              : (nextPlanActivatedAt ?? Date.now()) + captureBillingCycleMs,
        }
      })

      return changed ? next : current
    })
  }, [authSession, currentPlan])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const targetPath =
      activePage === 'capture'
        ? capturePagePath
        : activePage === 'login'
          ? loginPagePath
          : '/'
    const currentPath = normalizePathname(window.location.pathname)

    if (currentPath !== targetPath) {
      window.history.replaceState({}, '', targetPath)
    }
  }, [activePage])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handlePopState = () => {
      setActivePage(
        normalizePathname(window.location.pathname) === capturePagePath
          ? 'capture'
          : normalizePathname(window.location.pathname) === loginPagePath
            ? 'login'
            : readStoredChoice(activePageStorageKey, internalPageOptions, 'analysis'),
      )
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (
      requiresPayment &&
      activePage !== 'capture' &&
      activePage !== 'login' &&
      activePage !== 'plans'
    ) {
      setActivePage('plans')
    }
  }, [activePage, requiresPayment])

  const nowTimestamp = useMemo(
    () =>
      matchRecords.find((record) => record.platform === filters.platform)?.timestamp ??
      matchRecords[0]?.timestamp ??
      renderedAt,
    [filters.platform, matchRecords, renderedAt],
  )
  const leagueOptions = useMemo(
    () => getLeagueOptionsForPlatform(filters.platform),
    [filters.platform],
  )

  const handleLeaguePrefetch = useCallback(
    (leagueName: string) => {
      if (!leagueName || leagueName === filters.league) return
      const isServerHotPlatform =
        filters.platform === 'Betano' || filters.platform === 'PlayPix'

      void prefetchBbtipsLivePayload(
        filters.platform,
        requestedBbtipsMarkets,
        requestedBbtipsPeriod,
        [leagueName],
        isServerHotPlatform
          ? {
              cacheOnly: true,
              preferCached: true,
            }
          : undefined,
      ).catch(() => undefined)
    },
    [filters.league, filters.platform, requestedBbtipsMarkets, requestedBbtipsPeriod],
  )
  useEffect(() => {
    setLastSelectedLeagueByPlatform((current) =>
      current[filters.platform] === filters.league
        ? current
        : {
            ...current,
            [filters.platform]: filters.league,
          },
    )
  }, [filters.league, filters.platform])
  useEffect(() => {
    if (activePage !== 'analysis') return undefined
    if (bbtipsLiveData.records.length === 0 || leagueOptions.length < 2) return undefined
    if (filters.platform === 'Betano' || filters.platform === 'PlayPix') return undefined

    let cancelled = false
    const timers: number[] = []
    const warmupLeagueOptions = leagueOptions.filter((leagueName) => leagueName !== filters.league)

    warmupLeagueOptions.forEach((leagueName, index) => {
      const timer = window.setTimeout(() => {
        if (cancelled || document.hidden) return
        handleLeaguePrefetch(leagueName)
      }, 250 + index * 250)
      timers.push(timer)
    })

    return () => {
      cancelled = true
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [activePage, bbtipsLiveData.records.length, filters.league, handleLeaguePrefetch, leagueOptions])
  useEffect(() => {
    if (activePage !== 'analysis') return undefined

    const hotPlatforms = (Object.keys(backgroundKeepHotMsByPlatform) as Platform[])
      .filter((platform) => platform !== filters.platform)

    if (hotPlatforms.length === 0) return undefined

    let cancelled = false
    const timers = new Map<Platform, number>()
    const refreshPlatform = (platform: Platform) => {
      if (cancelled || document.hidden) return

      const targetLeague =
        lastSelectedLeagueByPlatform[platform] ??
        resolveDefaultLeagueForPlatform(platform)

      if (!targetLeague) return

      void prefetchBbtipsLivePayload(
        platform,
        requestedBbtipsMarkets,
        requestedBbtipsPeriod,
        [targetLeague],
        {
          cacheOnly: false,
          preferCached: false,
        },
      ).catch(() => undefined)
    }
    const schedulePlatformRefresh = (platform: Platform, delayMs: number) => {
      const cadenceMs = backgroundKeepHotMsByPlatform[platform] ?? 7000
      const timer = window.setTimeout(() => {
        refreshPlatform(platform)
        schedulePlatformRefresh(platform, cadenceMs)
      }, delayMs)
      timers.set(platform, timer)
    }
    const triggerHotRefresh = () => {
      hotPlatforms.forEach((platform) => refreshPlatform(platform))
    }
    const handleVisibilityChange = () => {
      if (document.hidden) return
      triggerHotRefresh()
    }
    const handleWindowFocus = () => {
      triggerHotRefresh()
    }

    hotPlatforms.forEach((platform, index) => {
      schedulePlatformRefresh(platform, 400 + index * 350)
    })

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      cancelled = true
      timers.forEach((timer) => window.clearTimeout(timer))
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [
    activePage,
    filters.platform,
    lastSelectedLeagueByPlatform,
    requestedBbtipsMarkets,
    requestedBbtipsPeriod,
  ])

  const handleFiltersChange = (next: FiltersState) => {
    const validLeagueOptions = getLeagueOptionsForPlatform(next.platform)
    const platformChanged = next.platform !== filters.platform
    const fallbackLeague = validLeagueOptions[0] ?? ''
    const resolvedLeague = validLeagueOptions.includes(next.league) ? next.league : fallbackLeague

    setFilters({
      ...next,
      league: resolvedLeague,
      period: periodMsMap[next.period] ? next.period : '12h',
    })

    if (platformChanged) {
      setSelectedCell(null)
      setSelectedCellMarkers([])
    }
  }

  const handleFiltersReset = () => {
    const resetFilters = createDefaultFilters(filters.platform, filters.league)

    handleFiltersChange(resetFilters)
    setAnalysisCardFilters({})
    setNextGamesPeriodsByLeague({})
    setLeagueToggles({})
    setSelectedCell(null)
    setSelectedCellMarkers([])
    setUiResetVersion((current) => current + 1)
  }

  const getAnalysisFiltersForLeague = useCallback(
    (leagueName: string, platform = filters.platform) =>
      analysisCardFilters[buildAnalysisCardFilterKey(platform, leagueName)] ??
      createAnalysisCardFilters(filters, platform, leagueName),
    [analysisCardFilters, filters],
  )

  const handleAnalysisCardFiltersChange = (leagueName: string, next: FiltersState) => {
    const platform = filters.platform
    const key = buildAnalysisCardFilterKey(platform, leagueName)

    setAnalysisCardFilters((current) => ({
      ...current,
      [key]: createAnalysisCardFilters(filters, platform, leagueName, next),
    }))
  }

  const getNextGamesPeriodForLeague = useCallback(
    (leagueName: string, platform = filters.platform) => {
      if (platform === 'PlayPix') {
        const stored = nextGamesPeriodsByLeague[buildAnalysisCardFilterKey(platform, leagueName)] ??
          getAnalysisFiltersForLeague(leagueName, platform).period
        return resolvePlayPixNextGamesPeriod(stored)
      }

      return nextGamesPeriodsByLeague[buildAnalysisCardFilterKey(platform, leagueName)] ??
        getAnalysisFiltersForLeague(leagueName, platform).period
    },
    [filters.platform, getAnalysisFiltersForLeague, nextGamesPeriodsByLeague],
  )

  const handleNextGamesPeriodChange = (leagueName: string, next: Period) => {
    const platform = filters.platform
    const key = buildAnalysisCardFilterKey(platform, leagueName)
    const resolved = platform === 'PlayPix'
      ? resolvePlayPixNextGamesPeriod(next)
      : periodMsMap[next] ? next : getAnalysisFiltersForLeague(leagueName, platform).period

    setNextGamesPeriodsByLeague((current) => ({
      ...current,
      [key]: resolved,
    }))
  }

  const toggleSelectedCellMarker = (cell: MatrixCell, timeMode: TimeMode = filters.timeMode) => {
    const key = getMatrixCellMarkerGroupKey(cell, timeMode)

    setSelectedCellMarkers((current) => {
      const existingIndex = current.findIndex((entry) => entry.key === key)
      if (existingIndex >= 0) {
        const next = current.filter((entry) => entry.key !== key)
        setSelectedCell((active) =>
          active && getMatrixCellMarkerGroupKey(active, timeMode) === key
            ? next[next.length - 1]?.cell ?? null
            : active,
        )
        return next
      }

      setSelectedCell(cell)
      return [
        ...current,
        {
          cell,
          key,
          tone: pickNextMatrixCellMarkerTone(current.map((entry) => entry.tone.id)),
        },
      ]
    })
  }

  const selectedCellMarkerMap = useMemo(
    () =>
      selectedCellMarkers.reduce(
        (acc, entry) => {
          acc[entry.key] = resolveMatrixCellMarkerTone(entry.tone.id) ?? entry.tone
          return acc
        },
        {} as Record<string, MatrixCellMarkerTone>,
      ),
    [selectedCellMarkers],
  )

  const contextRecords = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const periodDuration = periodMsMap[filters.period] ?? periodMsMap['12h']
    const contextReferenceTimestamp =
      matchRecords.find(
        (record) =>
          record.platform === filters.platform &&
          record.league === filters.league,
      )?.timestamp ?? nowTimestamp
    const minTimestamp = contextReferenceTimestamp - periodDuration

    return matchRecords.filter((record) => {
      if (record.platform !== filters.platform) return false
      if (record.timestamp < minTimestamp) return false
      if (record.league !== filters.league) return false

      if (!normalizedQuery) return true

      const bag = [
        record.league,
        record.homeTeam,
        record.awayTeam,
        record.scoreFT,
        record.scoreHT,
        record.sequencePattern,
        record.tendency,
        ...record.tags,
      ]
        .join(' ')
        .toLowerCase()

      return bag.includes(normalizedQuery)
    })
  }, [filters.league, filters.period, filters.platform, matchRecords, nowTimestamp, searchQuery])

  const filteredRecords = useMemo(
    () =>
      contextRecords.filter((record) =>
        isFinishedStatus(record) &&
        oddMatchesBand(record.odds[filters.market], filters.oddBand),
      ),
    [contextRecords, filters.market, filters.oddBand],
  )

  const analysisCards = useMemo(
    () => {
      const analysisLeagueNames = filters.league ? [filters.league] : []

      return analysisLeagueNames
        .map((leagueName) => {
          const cardFilters = getAnalysisFiltersForLeague(leagueName)
          const nextGamesSelectedPeriod = getNextGamesPeriodForLeague(leagueName)
          const leagueMeta = resolveLeagueMeta(leagueName) ?? leagueCatalog[0]
          const leagueAllRecords = matchRecords.filter(
            (record) => record.platform === filters.platform && record.league === leagueName,
          )
          const leagueAllFinishedRecords = leagueAllRecords.filter((record) => isFinishedStatus(record))
          const anchorFallback = bbtipsLiveData.updatedAt ?? nowTimestamp
          const liveLeaguePayload = bbtipsPayloadByLeague.get(leagueName)
          const currentLeaguePayload = liveLeaguePayload?.current ?? null
          const futureLeaguePayload = liveLeaguePayload?.future ?? null
          /** Ancora da grade = DataAtualizacao do payload, nao o timestamp do ultimo jogo. */
          const gridAnchorTimestamp = currentLeaguePayload
            ? getBbtipsPayloadAnchorTimestamp(currentLeaguePayload, anchorFallback)
            : leagueAllFinishedRecords[0]?.timestamp ?? nowTimestamp
          const payloadBaseTs = currentLeaguePayload
            ? getBbtipsPayloadAnchorTimestamp(currentLeaguePayload, anchorFallback)
            : anchorFallback
          const payloadCurrentRecords =
            liveLeaguePayload && currentLeaguePayload
              ? buildMatchRecordsFromLeaguePayload(
                filters.platform,
                liveLeaguePayload,
                currentLeaguePayload,
                'current',
                payloadBaseTs,
                gridAnchorTimestamp,
                currentLeaguePayload,
              )
              : []
          const payloadFutureRecords =
            liveLeaguePayload && futureLeaguePayload
              ? buildMatchRecordsFromLeaguePayload(
                filters.platform,
                liveLeaguePayload,
                futureLeaguePayload,
                'future',
                anchorFallback,
                gridAnchorTimestamp,
                currentLeaguePayload,
              )
              : []
          const payloadProjectedCellKeys = new Set([
            ...extractBbtipsProjectedCellKeys(
              currentLeaguePayload,
              gridAnchorTimestamp,
              'current',
              gridAnchorTimestamp,
              undefined,
              filters.platform,
            ),
            ...extractBbtipsProjectedCellKeys(
              futureLeaguePayload,
              gridAnchorTimestamp,
              'future',
              gridAnchorTimestamp,
              currentLeaguePayload,
              filters.platform,
            ),
          ])
          const payloadAllRaw = [...payloadCurrentRecords, ...payloadFutureRecords]
          const rawUpcomingRecords = payloadFutureRecords
            .filter((record) => hasRecordStatus(record) && !isFinishedStatus(record))
            .sort((left, right) => left.timestamp - right.timestamp)
          const periodDuration = periodMsMap[cardFilters.period] ?? periodMsMap['12h']
          const periodHoursCap = Math.min(
            Math.max(1, Math.ceil(periodDuration / hourMs)),
            MAX_MATRIX_HOUR_ROWS,
          )
          const matrixRowLayouts = buildBbtipsMatrixRowLayouts(
            filters.platform,
            currentLeaguePayload,
            futureLeaguePayload,
            gridAnchorTimestamp,
            periodHoursCap,
          )
          const referenceHourBucket = matrixRowLayouts.find((row) => row?.source === 'current')?.bucketStart
            ?? toUtcHourStart(gridAnchorTimestamp)
          const windowStart = referenceHourBucket - periodDuration
          const leagueRecordsInPeriod = leagueAllRecords.filter((record) => record.timestamp >= windowStart)
          const leagueFinishedHistoryRecords = leagueAllRecords.filter((record) => isFinishedStatus(record))
          const resolvedRowLayouts: Array<{ bucketStart: number; hour: number; hourLabel: string }> = matrixRowLayouts.length > 0
            ? matrixRowLayouts
            : [{
                bucketStart: referenceHourBucket,
                hour: new Date(referenceHourBucket).getUTCHours(),
                hourLabel: formatMatrixRowHourLabel(referenceHourBucket),
              }]
          const resolvedHourBuckets = resolvedRowLayouts.map((row) => row.bucketStart)
          const activeHourBucketSet = new Set(resolvedRowLayouts.map((row) => row.bucketStart))
          const leagueFinishedInPeriod = leagueRecordsInPeriod.filter((record) => isFinishedStatus(record))
          const leagueRecordsForMatrix = leagueRecordsInPeriod.filter(
            (record) =>
              Number.isFinite(record.timestamp) &&
              activeHourBucketSet.has(toUtcHourStart(record.timestamp)),
          )
          const leagueWindowRecords = leagueRecordsForMatrix
          const traderRecords = leagueWindowRecords.filter((record) => isFinishedStatus(record))
          const leagueWindowFinishedRecords = traderRecords
          const recordsForCard = leagueWindowRecords
          const fallbackRecordsForCard = leagueRecordsForMatrix
          const minuteSlotsFromPayload = [...new Set(payloadAllRaw.map((record) => record.minuteSlot))].sort(
            (left, right) => left - right,
          )
          const resolvedMinuteSlots = mergeUniqueNumberSequence(
            minuteSlotsFromPayload,
            extractBbtipsMinuteSlots(currentLeaguePayload),
            extractBbtipsMinuteSlots(futureLeaguePayload),
            getForcedMinuteSlots(filters.platform, leagueName),
          )
          const cardReferenceTimestamp = recordsForCard[0]?.timestamp ?? nowTimestamp
          const payloadFinishedByCell = new Map<string, MatchRecord>()
          const payloadUpcomingByCell = new Map<string, MatchRecord>()
          const activeProjectedCellKeys = new Set<string>()
          payloadAllRaw.forEach((record) => {
            if (!Number.isFinite(record.timestamp)) return

            const bucket = toUtcHourStart(record.timestamp)
            if (!activeHourBucketSet.has(bucket)) return

            const key = `${bucket}-${record.minuteSlot}`

            if (isFinishedStatus(record)) {
              if (!payloadFinishedByCell.has(key)) {
                payloadFinishedByCell.set(key, record)
              }
              return
            }

            const currentRecord = payloadUpcomingByCell.get(key)
            if (!currentRecord || record.timestamp < currentRecord.timestamp) {
              payloadUpcomingByCell.set(key, record)
            }
          })
          payloadProjectedCellKeys.forEach((cellKey) => {
            const [bucketToken] = cellKey.split('-', 1)
            const bucketStart = Number(bucketToken)
            if (!Number.isFinite(bucketStart) || !activeHourBucketSet.has(bucketStart)) return
            activeProjectedCellKeys.add(cellKey)
          })
          const payloadUpcomingRecords = mergeUpcomingRecords(
            [...payloadUpcomingByCell.values()],
            rawUpcomingRecords,
          )
          const leagueUpcomingRecords =
            payloadUpcomingRecords.length > 0
              ? payloadUpcomingRecords
              : leagueAllRecords
                  .filter((record) => hasRecordStatus(record) && !isFinishedStatus(record))
                  .sort((left, right) => left.timestamp - right.timestamp)
          const matrixStatsFromRecords = buildBbtipsMatrixStatsFromRecords(
            leagueFinishedInPeriod,
            cardFilters.market,
            cardFilters.timeMode,
          )
          const matrixStatsFromPayload = buildBbtipsMatrixStatsFromRecords(
            [...payloadFinishedByCell.values()],
            cardFilters.market,
            cardFilters.timeMode,
          )
          const matrixStats = mergeBbtipsMatrixStatsMissingCells(
            matrixStatsFromRecords,
            matrixStatsFromPayload,
          )
          const rows =
            liveLeaguePayload
              ? buildBbtipsLiveMatrixRows(
                recordsForCard,
                cardFilters.market,
                resolvedRowLayouts,
                resolvedMinuteSlots,
                matrixStats,
                payloadFinishedByCell,
                payloadUpcomingByCell,
                activeProjectedCellKeys,
              )
              : buildMatrixRowsForRecords(
                recordsForCard,
                cardFilters.market,
                cardFilters.timeMode,
                cardFilters.period,
                cardReferenceTimestamp,
                fallbackRecordsForCard,
                resolvedHourBuckets,
                resolvedMinuteSlots,
              )
          const rowMatrixTotals = rows.reduce(
            (acc, row) => {
              acc.greens += row.greens
              acc.total += row.total
              return acc
            },
            { greens: 0, total: 0 },
          )
          const overallGreens = rowMatrixTotals.total > 0
            ? rowMatrixTotals.greens
            : leagueWindowFinishedRecords.filter((record) => record.marketResults[cardFilters.market]).length
          const overallTotal = rowMatrixTotals.total > 0
            ? rowMatrixTotals.total
            : leagueWindowFinishedRecords.length
          const distributionRate = overallTotal ? overallGreens / overallTotal : 0
          const payingHours = countPayingHourSlots(buildPayingColumnSummaries(rows))
          const {
            nextRankingDualMatchIds,
            nextRankingMatchIds,
          } = buildNextRankingMatchIds(
            leagueFinishedInPeriod,
            rows,
            cardFilters.market,
          )
          const bestCells = rows
            .flatMap((row) => row.cells)
            .filter((cell) => cell.total > 0)
            .sort((left, right) => {
              if (right.greenRate !== left.greenRate) return right.greenRate - left.greenRate
              return right.total - left.total
            })
            .slice(0, 5)

          return {
            leagueName,
            descriptor: leagueMeta.descriptor,
            filters: cardFilters,
            nextGamesAnchorTimestamp: referenceHourBucket,
            nextGamesHistoryRecords: leagueFinishedHistoryRecords,
            nextGamesSelectedPeriod,
            rankingRecords: leagueFinishedInPeriod,
            rows,
            traderRecords,
            upcomingRecords: leagueUpcomingRecords,
            overallGreens,
            overallTotal,
            distributionRate,
            payingHours,
            nextRankingMatchIds,
            nextRankingDualMatchIds,
            bestCells,
          }
        })

    },
    [
      getAnalysisFiltersForLeague,
      getNextGamesPeriodForLeague,
      bbtipsPayloadByLeague,
      bbtipsLiveData.updatedAt,
      filters.league,
      filters.platform,
      matchRecords,
      nowTimestamp,
    ],
  )

  const timelineGroups = useMemo(() => {
    const grouped = groupBy(filteredRecords.slice(0, 180), (record) =>
      shortDateFormatter.format(record.timestamp),
    )
    return [...grouped.entries()].slice(0, 6)
  }, [filteredRecords])

  const leagueGroups = useMemo(
    () =>
      [...groupBy(filteredRecords.slice(0, 180), (record) => record.league).entries()].map(
        ([league, records]) => ({
          league,
          total: records.length,
          greens: records.filter((record) => record.marketResults[filters.market]).length,
          lastScore: records[0] ? scoreForTime(records[0], filters.timeMode) : '--',
        }),
      ),
    [filteredRecords, filters.market, filters.timeMode],
  )

  const sequenceGroups = useMemo(
    () =>
      [...groupBy(filteredRecords.slice(0, 180), (record) => record.sequencePattern).entries()]
        .map(([label, records]) => ({
          label,
          total: records.length,
          latest: records[0],
          greens: records.filter((record) => record.marketResults[filters.market]).length,
        }))
        .sort((left, right) => right.total - left.total)
        .slice(0, 8),
    [filteredRecords, filters.market],
  )

  const activePlan = planCatalog.find((plan) => plan.id === currentPlan) ?? planCatalog[1]
  const botLimitReached = bots.length >= activePlan.botsLimit
  const activeHistoryRecord =
    filteredRecords.find((record) => record.id === selectedRecord?.id) ?? filteredRecords[0] ?? null

  const createBotFromContext = (
    title: string,
    extraCriteria: string[],
    leagueOverride = filters.league,
  ) => {
    if (botLimitReached) {
      setActivePage('plans')
      return
    }

    const nextBot: Bot = {
      id: `bot-${Date.now()}`,
      name: title,
      description: 'Bot salvo a partir da leitura visual corrente.',
      platform: filters.platform,
      league: leagueOverride,
      market: filters.market,
      period: filters.period,
      criteria: [filters.oddBand, filters.timeMode, ...extraCriteria].filter(Boolean),
      status: 'Ativo',
      priority: 'Alta',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    setBots((current) => [nextBot, ...current])
    setEditingBotId(nextBot.id)
    setBotDraft(createDraftFromBot(nextBot))
    setActivePage('bots')
  }

  const getLeagueToggleState = (leagueName: string) =>
    leagueToggles[leagueName] ?? createInitialToggles()

  const toggleLeagueFlag = (leagueName: string, key: ToggleKey) => {
    setLeagueToggles((current) => {
      const currentLeagueToggles = normalizeToggleState(current[leagueName])

      return {
        ...current,
        [leagueName]: {
          ...currentLeagueToggles,
          [key]: !currentLeagueToggles[key],
        },
      }
    })
  }

  const openClientAreaForPlatform = (
    platform: Platform,
    planId: Plan['id'],
    allowFreeAccess = false,
  ) => {
    if (planId === 'Free' && !allowFreeAccess) {
      setActivePage('plans')
      return
    }

    setFilters(createDefaultFilters(platform, resolveDefaultLeagueForPlatform(platform)))
    setCurrentPlan(planId)
    setSelectedCell(null)
    setSelectedCellMarkers([])
    setMenuOpen(false)
    setActivePage('ranking')
  }

  const persistPagBankProfile = useCallback(
    ({ phoneNumber, taxId }: PagBankPaymentProfile): CaptureActionResult => {
      if (!authenticatedAccount) {
        return {
          ok: false,
          message: 'Entre novamente para atualizar os dados de pagamento.',
        }
      }

      const normalizedProfile = {
        phoneNumber: normalizePhoneNumber(phoneNumber),
        taxId: normalizeTaxId(taxId),
      }
      const profileError = validatePagBankPaymentProfile(normalizedProfile)

      if (profileError) {
        return {
          ok: false,
          message: profileError,
        }
      }

      setCaptureAccounts((current) =>
        current.map((account) =>
          account.id === authenticatedAccount.id
            ? {
                ...account,
                phoneNumber: normalizedProfile.phoneNumber,
                taxId: normalizedProfile.taxId,
              }
            : account,
        ),
      )

      return {
        ok: true,
        message: 'Dados do PagBank atualizados para o checkout.',
      }
    },
    [authenticatedAccount],
  )

  const updatePagBankCheckoutForAccount = useCallback((accountId: string, checkout: PagBankCheckoutRecord | null) => {
    setCaptureAccounts((current) =>
      current.map((account) =>
        account.id === accountId
          ? {
              ...account,
              pagBankCheckout: checkout,
            }
          : account,
      ),
    )
  }, [])

  const markPagBankCheckoutUnderReview = useCallback(
    (accountId: string): PagBankCheckoutActionResult => {
      const targetAccount = captureAccounts.find((account) => account.id === accountId)
      if (!targetAccount?.pagBankCheckout) {
        return {
          ok: false,
          message: 'Nao existe um checkout aberto para marcar como enviado.',
        }
      }

      const nextCheckout: PagBankCheckoutRecord = {
        ...targetAccount.pagBankCheckout,
        lastCheckedAt: Date.now(),
        status: 'under_review',
      }

      updatePagBankCheckoutForAccount(accountId, nextCheckout)

      return {
        ok: true,
        checkout: nextCheckout,
        message: 'Pagamento marcado como enviado. Agora o cliente pode mandar o comprovante no Telegram.',
      }
    },
    [captureAccounts, updatePagBankCheckoutForAccount],
  )

  const activatePaidAccount = useCallback(
    (accountId: string, paidAt = Date.now()) => {
      setCaptureAccounts((current) =>
        current.map((account) =>
          account.id === accountId
            ? {
                ...account,
                currentPlan: pagBankActivatedPlanId,
                pagBankCheckout: account.pagBankCheckout
                  ? {
                      ...account.pagBankCheckout,
                      lastCheckedAt: paidAt,
                      paidAt,
                      status: 'paid',
                    }
                  : null,
                planActivatedAt: paidAt,
                planEndsAt: paidAt + captureBillingCycleMs,
              }
            : account,
        ),
      )

      if (authSession?.accountId === accountId) {
        setCurrentPlan(pagBankActivatedPlanId)
      }
    },
    [authSession],
  )

  const handleCreatePagBankOrder = useCallback(
    async (profile: PagBankPaymentProfile): Promise<PagBankCheckoutActionResult> => {
      if (!authenticatedAccount) {
        return {
          ok: false,
          message: `Entre novamente para gerar o checkout do ${appConfig.paymentProviderLabel}.`,
        }
      }

      if (!paymentGatewayReady || !supabase) {
        return {
          ok: false,
          message: `A integracao ${appConfig.paymentProviderLabel} ainda nao foi configurada neste ambiente.`,
        }
      }

      const saveProfileResult = persistPagBankProfile(profile)
      if (!saveProfileResult.ok) {
        return saveProfileResult
      }

      const normalizedProfile = {
        phoneNumber: normalizePhoneNumber(profile.phoneNumber),
        taxId: normalizeTaxId(profile.taxId),
      }

      const { data, error } = await supabase.functions.invoke('create-pagbank-order', {
        body: {
          accountId: authenticatedAccount.id,
          amountCents: paymentAmountCents,
          customerEmail: authenticatedAccount.email,
          customerName: authenticatedAccount.name,
          customerPhone: normalizedProfile.phoneNumber,
          customerTaxId: normalizedProfile.taxId,
          expiresInMinutes: 30,
        },
      })

      if (error) {
        return {
          ok: false,
          message: await resolveFunctionInvokeErrorMessage(
            error,
            `Nao foi possivel abrir o checkout do ${appConfig.paymentProviderLabel}.`,
          ),
        }
      }

      const checkout = parsePagBankCheckoutRecord({
        amountCents:
          typeof data?.amountCents === 'number' && Number.isFinite(data.amountCents)
            ? data.amountCents
            : paymentAmountCents,
        chargeId: typeof data?.chargeId === 'string' ? data.chargeId : null,
        createdAt: Date.now(),
        expiresAt: Date.parse(String(data?.expiresAt ?? '')) || Date.now() + 30 * 60 * 1000,
        lastCheckedAt: Date.now(),
        orderId: String(data?.orderId ?? ''),
        paidAt: data?.paidAt ? Date.parse(String(data.paidAt)) || null : null,
        provider: data?.provider === 'asaas' ? 'asaas' : 'pagbank',
        qrCodeImageUrl: typeof data?.qrCodeImageUrl === 'string' ? data.qrCodeImageUrl : null,
        qrCodeText: String(data?.qrCodeText ?? ''),
        referenceId: String(data?.referenceId ?? ''),
        status: normalizePagBankStatus(data?.status),
      })

      if (!checkout) {
        return {
          ok: false,
          message: `O ${appConfig.paymentProviderLabel} nao devolveu um QR Code valido para esse pedido.`,
        }
      }

      updatePagBankCheckoutForAccount(authenticatedAccount.id, checkout)

      return {
        ok: true,
        checkout,
        message:
          appConfig.pagBankEnv === 'production'
            ? `Checkout ${appConfig.paymentProviderLabel} criado. O QR Code fica ativo por 30 minutos.`
            : `Checkout ${appConfig.paymentProviderLabel} criado em ambiente de teste. O QR Code fica ativo por 30 minutos.`,
      }
    },
    [authenticatedAccount, paymentAmountCents, paymentGatewayReady, persistPagBankProfile, updatePagBankCheckoutForAccount],
  )

  const handleRefreshPagBankOrder = useCallback(
    async (): Promise<PagBankCheckoutActionResult> => {
      if (!authenticatedAccount || !authenticatedAccount.pagBankCheckout) {
        return {
          ok: false,
          message: `Nao existe um checkout do ${appConfig.paymentProviderLabel} aberto para esta conta.`,
        }
      }

      if (!paymentGatewayReady || !supabase) {
        return {
          ok: false,
          message: `A integracao ${appConfig.paymentProviderLabel} ainda nao foi configurada neste ambiente.`,
        }
      }

      const { data, error } = await supabase.functions.invoke('check-pagbank-order', {
        body: {
          accountId: authenticatedAccount.id,
          expiresAt: new Date(authenticatedAccount.pagBankCheckout.expiresAt).toISOString(),
          orderId: authenticatedAccount.pagBankCheckout.orderId,
        },
      })

      if (error) {
        return {
          ok: false,
          message: await resolveFunctionInvokeErrorMessage(
            error,
            'Nao foi possivel consultar o status do pagamento.',
          ),
        }
      }

      const checkout =
        parsePagBankCheckoutRecord({
          ...authenticatedAccount.pagBankCheckout,
          amountCents:
            typeof data?.amountCents === 'number' && Number.isFinite(data.amountCents)
              ? data.amountCents
              : authenticatedAccount.pagBankCheckout.amountCents,
          chargeId:
            typeof data?.chargeId === 'string' && data.chargeId.trim()
              ? data.chargeId
              : authenticatedAccount.pagBankCheckout.chargeId,
          expiresAt:
            Date.parse(String(data?.expiresAt ?? '')) || authenticatedAccount.pagBankCheckout.expiresAt,
          lastCheckedAt: Date.now(),
          orderId: String(data?.orderId ?? authenticatedAccount.pagBankCheckout.orderId),
          paidAt: data?.paidAt ? Date.parse(String(data.paidAt)) || null : authenticatedAccount.pagBankCheckout.paidAt,
          qrCodeImageUrl:
            typeof data?.qrCodeImageUrl === 'string' && data.qrCodeImageUrl.trim()
              ? data.qrCodeImageUrl
              : authenticatedAccount.pagBankCheckout.qrCodeImageUrl,
          qrCodeText:
            typeof data?.qrCodeText === 'string' && data.qrCodeText.trim()
              ? data.qrCodeText
              : authenticatedAccount.pagBankCheckout.qrCodeText,
          referenceId: String(data?.referenceId ?? authenticatedAccount.pagBankCheckout.referenceId),
          status: normalizePagBankStatus(data?.status),
        }) ?? {
          ...authenticatedAccount.pagBankCheckout,
          lastCheckedAt: Date.now(),
          status:
            Date.now() >= authenticatedAccount.pagBankCheckout.expiresAt
              ? 'expired'
              : authenticatedAccount.pagBankCheckout.status,
        }

      updatePagBankCheckoutForAccount(authenticatedAccount.id, checkout)

      if (isPagBankPaidStatus(checkout.status)) {
        const paidAt = checkout.paidAt ?? Date.now()
        activatePaidAccount(authenticatedAccount.id, paidAt)
        return {
          ok: true,
          checkout: {
            ...checkout,
            paidAt,
            status: 'paid',
          },
          message: `Pagamento confirmado no ${appConfig.paymentProviderLabel}. O acesso foi liberado por 30 dias.`,
        }
      }

      return {
        ok: true,
        checkout,
        message:
          checkout.status === 'expired'
            ? 'Esse QR Code expirou. Gere um novo pedido para continuar.'
            : `Ainda nao apareceu como pago no ${appConfig.paymentProviderLabel}. Se voce acabou de pagar, tente novamente em instantes.`,
      }
    },
    [activatePaidAccount, authenticatedAccount, paymentGatewayReady, updatePagBankCheckoutForAccount],
  )

  const handleMarkPaymentSent = useCallback((): PagBankCheckoutActionResult => {
    if (!authenticatedAccount) {
      return {
        ok: false,
        message: 'Entre novamente para informar o envio do pagamento.',
      }
    }

    return markPagBankCheckoutUnderReview(authenticatedAccount.id)
  }, [authenticatedAccount, markPagBankCheckoutUnderReview])

  useEffect(() => {
    if (!authenticatedAccount?.pagBankCheckout) return

    if (authenticatedAccount.currentPlan === 'Free' && authenticatedAccount.pagBankCheckout.status === 'paid') {
      activatePaidAccount(
        authenticatedAccount.id,
        authenticatedAccount.pagBankCheckout.paidAt ?? authenticatedAccount.planActivatedAt ?? Date.now(),
      )
      return
    }

    if (
      authenticatedAccount.pagBankCheckout.status === 'pending' &&
      authenticatedAccount.pagBankCheckout.expiresAt <= Date.now()
    ) {
      updatePagBankCheckoutForAccount(authenticatedAccount.id, {
        ...authenticatedAccount.pagBankCheckout,
        lastCheckedAt: Date.now(),
        status: 'expired',
      })
    }
  }, [activatePaidAccount, authenticatedAccount, updatePagBankCheckoutForAccount])

  const handleStartTrial = (payload: CaptureAccountPayload): CaptureActionResult => {
    const email = normalizeAccountEmail(payload.email)
    const name = payload.name.trim()
    const password = payload.password
    const notificationChannel = payload.notificationChannel
    const notificationContact = normalizeNotificationContact(
      notificationChannel,
      payload.notificationContact,
    )

    if (!name || !email || !password) {
      return {
        ok: false,
        message: 'Preencha os campos principais para liberar o teste.',
      }
    }

    const notificationContactError = validateNotificationContact(
      notificationChannel,
      notificationContact,
    )

    if (notificationContactError) {
      return {
        ok: false,
        message: notificationContactError,
      }
    }

    if (password.length < 6) {
      return {
        ok: false,
        message: 'Use uma senha com pelo menos 6 caracteres.',
      }
    }

    if (captureAccounts.some((account) => account.email === email)) {
      return {
        ok: false,
        message: 'Esse email ja esta cadastrado. Entre com a conta existente para continuar.',
      }
    }

    const now = Date.now()
    const nextAccount: CaptureAccountRecord = {
      id: `account-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      email,
      password,
      favoritePlatform: payload.favoritePlatform,
      currentPlan: 'Free',
      notificationChannel,
      notificationContact,
      taxId: '',
      phoneNumber: notificationChannel === 'WhatsApp' ? normalizePhoneNumber(notificationContact) : '',
      pagBankCheckout: null,
      createdAt: now,
      planActivatedAt: null,
      planEndsAt: null,
      trialEndsAt: now + captureTrialDurationMs,
    }

    setCaptureAccounts((current) => [nextAccount, ...current])
    setAuthSession({
      accountId: nextAccount.id,
      signedAt: now,
    })
    setCurrentPlan(nextAccount.currentPlan)
    openClientAreaForPlatform(nextAccount.favoritePlatform, nextAccount.currentPlan, true)

    return {
      ok: true,
      message: 'Teste liberado com sucesso. Sua janela gratuita fica ativa por 5 horas.',
    }
  }

  const handleCreateAccount = (payload: CaptureAccountPayload): CaptureActionResult => {
    const email = normalizeAccountEmail(payload.email)
    const name = payload.name.trim()
    const password = payload.password
    const notificationChannel = payload.notificationChannel
    const notificationContact = normalizeNotificationContact(
      notificationChannel,
      payload.notificationContact,
    )

    if (!name || !email || !password) {
      return {
        ok: false,
        message: 'Preencha nome, email e senha para criar a conta.',
      }
    }

    const notificationContactError = validateNotificationContact(
      notificationChannel,
      notificationContact,
    )

    if (notificationContactError) {
      return {
        ok: false,
        message: notificationContactError,
      }
    }

    if (password.length < 6) {
      return {
        ok: false,
        message: 'Use uma senha com pelo menos 6 caracteres.',
      }
    }

    if (captureAccounts.some((account) => account.email === email)) {
      return {
        ok: false,
        message: 'Ja existe uma conta com esse email. Basta entrar para seguir.',
      }
    }

    const now = Date.now()
    const nextAccount: CaptureAccountRecord = {
      id: `account-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      email,
      password,
      favoritePlatform: payload.favoritePlatform,
      currentPlan: 'Free',
      notificationChannel,
      notificationContact,
      taxId: '',
      phoneNumber: notificationChannel === 'WhatsApp' ? normalizePhoneNumber(notificationContact) : '',
      pagBankCheckout: null,
      createdAt: now,
      planActivatedAt: null,
      planEndsAt: null,
      trialEndsAt: null,
    }

    setCaptureAccounts((current) => [nextAccount, ...current])
    setAuthSession({
      accountId: nextAccount.id,
      signedAt: now,
    })
    setCurrentPlan(nextAccount.currentPlan)
    setActivePage('plans')

    return {
      ok: true,
      message: 'Conta criada com sucesso. Agora e so concluir o Pix de R$ 19,90 para liberar a area interna.',
    }
  }

  const handleCaptureLogin = (payload: CaptureLoginPayload): CaptureActionResult => {
    const email = normalizeAccountEmail(payload.email)
    const account = captureAccounts.find((entry) => entry.email === email)

    if (!account) {
      return {
        ok: false,
        message: 'Nao encontramos uma conta com esse email.',
      }
    }

    if (account.password !== payload.password) {
      return {
        ok: false,
        message: 'A senha nao confere com essa conta.',
      }
    }

    setAuthSession({
      accountId: account.id,
      signedAt: Date.now(),
    })
    setCurrentPlan(account.currentPlan)

    if (isTrialActiveForAccount(account)) {
      openClientAreaForPlatform(account.favoritePlatform, account.currentPlan, true)
    } else if (!isPaidPlanExpiredForAccount(account) && account.currentPlan !== 'Free') {
      openClientAreaForPlatform(account.favoritePlatform, account.currentPlan)
    } else {
      setActivePage('plans')
    }

    return {
      ok: true,
      message: isTrialActiveForAccount(account)
        ? 'Login confirmado. Seu teste continua ativo.'
        : !isPaidPlanExpiredForAccount(account) && account.currentPlan !== 'Free'
          ? 'Login confirmado. Seu acesso pago segue liberado.'
          : 'Login confirmado. Sua conta esta pronta, mas o acesso esta aguardando pagamento.',
    }
  }

  const handleAccountUpdate = (payload: CaptureAccountPayload): CaptureActionResult => {
    if (!authSession || !authenticatedAccount) {
      return {
        ok: false,
        message: 'Entre novamente para atualizar os dados da conta.',
      }
    }

    const nextName = payload.name.trim()
    const nextEmail = normalizeAccountEmail(payload.email)
    const nextPassword = payload.password.trim()
    const nextNotificationChannel = payload.notificationChannel
    const nextNotificationContact = normalizeNotificationContact(
      nextNotificationChannel,
      payload.notificationContact,
    )

    if (!nextName || !nextEmail) {
      return {
        ok: false,
        message: 'Nome e email precisam estar preenchidos para salvar a conta.',
      }
    }

    const notificationContactError = validateNotificationContact(
      nextNotificationChannel,
      nextNotificationContact,
    )

    if (notificationContactError) {
      return {
        ok: false,
        message: notificationContactError,
      }
    }

    if (nextPassword.length > 0 && nextPassword.length < 6) {
      return {
        ok: false,
        message: 'Se for trocar a senha, use pelo menos 6 caracteres.',
      }
    }

    const emailInUse = captureAccounts.some(
      (account) => account.email === nextEmail && account.id !== authenticatedAccount.id,
    )

    if (emailInUse) {
      return {
        ok: false,
        message: 'Esse email ja esta sendo usado em outra conta.',
      }
    }

    setCaptureAccounts((current) =>
      current.map((account) =>
        account.id === authenticatedAccount.id
          ? {
              ...account,
              email: nextEmail,
              favoritePlatform: payload.favoritePlatform,
              name: nextName,
              notificationChannel: nextNotificationChannel,
              notificationContact: nextNotificationContact,
              phoneNumber:
                nextNotificationChannel === 'WhatsApp' && !account.phoneNumber
                  ? normalizePhoneNumber(nextNotificationContact)
                  : account.phoneNumber,
              password: nextPassword.length > 0 ? nextPassword : account.password,
            }
          : account,
      ),
    )

    return {
      ok: true,
      message: 'Conta atualizada com sucesso. O perfil ja ficou salvo com os novos dados.',
    }
  }

  const handleLogout = () => {
    setAuthSession(null)
    setMenuOpen(false)
    setActivePage('capture')
  }

  const openCapturePage = () => {
    setActivePage('capture')

    if (typeof window !== 'undefined' && normalizePathname(window.location.pathname) !== capturePagePath) {
      window.history.pushState({}, '', capturePagePath)
    }
  }

  const openLoginPage = () => {
    setActivePage('login')

    if (typeof window !== 'undefined' && normalizePathname(window.location.pathname) !== loginPagePath) {
      window.history.pushState({}, '', loginPagePath)
    }
  }

  const openPlansPage = () => {
    setActivePage('plans')

    if (typeof window !== 'undefined' && normalizePathname(window.location.pathname) !== '/') {
      window.history.pushState({}, '', '/')
    }
  }

  const handleLogoutToLogin = () => {
    setAuthSession(null)
    setMenuOpen(false)
    openLoginPage()
  }

  const isPublicAuthPage = activePage === 'capture' || activePage === 'login'

  return (
    <div className={`app-shell ${isPublicAuthPage ? 'app-shell-capture' : ''}`}>
      {!isPublicAuthPage && (
        <TopBar
          activePage={activePage}
          currentPlan={currentPlanLabel}
          menuOpen={menuOpen}
          onLogout={handleLogout}
          profileName={sessionProfileName}
          setActivePage={setActivePage}
          setMenuOpen={setMenuOpen}
          onSelectVirtualMenu={(item) => {
            handleFiltersChange({
              ...filters,
              league: resolveDefaultLeagueForPlatform(item),
              platform: item,
            })
            setActivePage('analysis')
          }}
        />
      )}

      <main className={isPublicAuthPage ? 'capture-shell' : 'content-shell'}>
        {activePage === 'capture' ? (
          <CapturePage
            currentPlatform={filters.platform}
            currentUserName={authenticatedAccount?.name ?? null}
            isAuthenticated={Boolean(authenticatedAccount)}
            onContinueToClientArea={() =>
              openClientAreaForPlatform(sessionFavoritePlatform, currentPlan, sessionTrialActive)
            }
            onCreateAccount={handleCreateAccount}
            onLogin={handleCaptureLogin}
            onOpenLoginPage={openLoginPage}
            onOpenPlansPage={openPlansPage}
            onSelectPlatform={(platform) => {
              handleFiltersChange({
                ...filters,
                league: resolveDefaultLeagueForPlatform(platform),
                platform,
              })
            }}
            onStartTrial={handleStartTrial}
            paymentAmountLabel={paymentAmountLabel}
            paymentRequired={requiresPayment}
          />
        ) : activePage === 'login' ? (
          <LoginPage
            currentUserName={authenticatedAccount?.name ?? null}
            isAuthenticated={Boolean(authenticatedAccount)}
            paymentRequired={requiresPayment}
            onContinueToClientArea={() =>
              openClientAreaForPlatform(sessionFavoritePlatform, currentPlan, sessionTrialActive)
            }
            onLogin={handleCaptureLogin}
            onLogout={handleLogoutToLogin}
            onOpenCapture={openCapturePage}
            onOpenPlansPage={openPlansPage}
          />
        ) : (
          <>
            {renewalReminderActive && (
              <section className="renewal-reminder-banner">
                <div className="renewal-reminder-copy">
                  <span className="eyebrow">renovacao</span>
                  <strong>{renewalReminderTitle}</strong>
                  <p>{renewalReminderDescription}</p>
                </div>

                <div className="renewal-reminder-actions">
                  <span className="account-soft-pill">{renewalContactLabel}</span>
                  <button
                    type="button"
                    className="solid-button"
                    onClick={() => setActivePage('plans')}
                  >
                    Ir para planos
                  </button>
                </div>
              </section>
            )}

            {['analysis', 'history', 'bots', 'ranking', 'alerts'].includes(activePage) && (
              !['analysis', 'ranking'].includes(activePage) && (
                <FilterBar
                  filters={filters}
                  leagueOptions={leagueOptions}
                  onChange={handleFiltersChange}
                />
              )
            )}

            {activePage === 'analysis' && (
          <AnalysisPage
            key={`analysis-${uiResetVersion}`}
            cards={analysisCards}
            dataSourceError={bbtipsLiveData.error}
            leagueOptions={leagueOptions}
            platform={filters.platform}
            selectedLeague={filters.league}
            onSelectLeague={(leagueName) => handleFiltersChange({ ...filters, league: leagueName })}
            onPrefetchLeague={handleLeaguePrefetch}
            onChangeCardFilters={handleAnalysisCardFiltersChange}
            onResetFilters={handleFiltersReset}
            onChangeNextGamesPeriod={handleNextGamesPeriodChange}
            selectedCell={selectedCell}
            selectedCellMarkerMap={selectedCellMarkerMap}
            onCellClick={toggleSelectedCellMarker}
            getNextGamesPeriod={getNextGamesPeriodForLeague}
            getToggleState={getLeagueToggleState}
            toggleFlag={toggleLeagueFlag}
          />
        )}

        {activePage === 'history' && (
          <HistoryPage
            densityMode={densityMode}
            filters={filters}
            historyHighlights={filteredRecords.slice(0, 180)}
            historyView={historyView}
            leagueGroups={leagueGroups}
            onCreateAlert={() =>
              activeHistoryRecord &&
              setAlerts((current) => [
                {
                  id: `alert-${Date.now()}`,
                  name: `Alerta ${activeHistoryRecord.league}`,
                  criterion: `${activeHistoryRecord.sequencePattern} | ${filters.market}`,
                  origin: 'Historico',
                  timestamp: Date.now(),
                  status: 'Ativo',
                },
                ...current,
              ])
            }
            onCreateBot={() =>
              activeHistoryRecord &&
              createBotFromContext(`Bot ${activeHistoryRecord.league}`, [
                activeHistoryRecord.sequencePattern,
                activeHistoryRecord.tendency,
              ])
            }
            onDensityModeChange={setDensityMode}
            onHistoryViewChange={setHistoryView}
            onOpenBots={() => setActivePage('bots')}
            selectedRecord={activeHistoryRecord}
            sequenceGroups={sequenceGroups}
            setSelectedRecord={setSelectedRecord}
            timelineGroups={timelineGroups}
          />
        )}

        {activePage === 'bots' && (
          <BotsPage
            activePlan={activePlan}
            botDraft={botDraft}
            botLimitReached={botLimitReached}
            bots={bots}
            filters={filters}
            isEditing={Boolean(editingBotId)}
            leagueOptions={leagueOptions}
            onCreateFromCurrentFilters={() => {
              setEditingBotId(null)
              setBotDraft(createDraftFromFilters(filters))
            }}
            onDelete={(id) => {
              setBots((current) => current.filter((bot) => bot.id !== id))
              setEditingBotId(null)
              setBotDraft(createDraftFromFilters(filters))
            }}
            onDraftChange={setBotDraft}
            onDuplicate={(bot) => {
              if (botLimitReached) return
              const duplicate = {
                ...bot,
                id: `bot-${Date.now()}`,
                name: `${bot.name} copia`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              }
              setBots((current) => [duplicate, ...current])
            }}
            onSave={() => {
              const nextBot: Bot = {
                id: editingBotId ?? `bot-${Date.now()}`,
                name: botDraft.name,
                description: botDraft.description,
                platform: botDraft.platform,
                league: botDraft.league,
                market: botDraft.market,
                period: botDraft.period,
                criteria: buildCriteriaList(botDraft),
                status: botDraft.status,
                priority: botDraft.priority,
                createdAt: bots.find((bot) => bot.id === editingBotId)?.createdAt ?? Date.now(),
                updatedAt: Date.now(),
              }

              setBots((current) => {
                const exists = current.some((bot) => bot.id === nextBot.id)
                if (exists) {
                  return current.map((bot) => (bot.id === nextBot.id ? nextBot : bot))
                }
                return [nextBot, ...current]
              })
              setEditingBotId(nextBot.id)
              setBotDraft(createDraftFromBot(nextBot))
            }}
            onSelect={(id) => {
              setEditingBotId(id)
              const selectedBot = bots.find((bot) => bot.id === id)
              if (selectedBot) {
                setBotDraft(createDraftFromBot(selectedBot))
              }
            }}
            onToggleStatus={(id) =>
              setBots((current) =>
                current.map((bot) =>
                  bot.id === id
                    ? {
                        ...bot,
                        status: bot.status === 'Ativo' ? 'Pausado' : 'Ativo',
                      }
                    : bot,
                ),
              )
            }
          />
        )}

        {activePage === 'ranking' && (
          <RankingPage
            currentPlatform={filters.platform}
            onOpenCurrentAnalysis={() => setActivePage('analysis')}
            onSelectPlatform={(platform) => {
              handleFiltersChange({
                ...filters,
                league: resolveDefaultLeagueForPlatform(platform),
                platform,
              })
            }}
          />
        )}

        {activePage === 'alerts' && (
          <AlertsPage
            alerts={alerts}
            notificationPrefs={notificationPrefs}
            onOpenAnalysis={() => setActivePage('analysis')}
            onOpenBots={() => setActivePage('bots')}
            onToggleAlert={(id) =>
              setAlerts((current) =>
                current.map((alert) =>
                  alert.id === id
                    ? {
                        ...alert,
                        status: alert.status === 'Ativo' ? 'Silenciado' : 'Ativo',
                      }
                    : alert,
                ),
              )
            }
            onTogglePreference={(key) =>
              setNotificationPrefs((current) => ({
                ...current,
                [key]: !current[key as keyof typeof current],
              }))
            }
          />
        )}

        {activePage === 'account' && (
          <AccountPage
            key={`${authenticatedAccount?.id ?? 'profile'}-${sessionProfileEmail}-${sessionFavoritePlatform}`}
            billingCycleDays={captureBillingCycleDays}
            createdAt={authenticatedAccount?.createdAt ?? null}
            currentPlan={currentPlanLabel}
            accessStatusDescription={accountAccessState.description}
            accessStatusLabel={accountAccessState.label}
            accessTone={accountAccessState.tone}
            favoritePlatform={sessionFavoritePlatform}
            name={sessionProfileName}
            email={sessionProfileEmail}
            isTrialActive={sessionTrialActive}
            notificationChannel={authenticatedAccount?.notificationChannel ?? 'WhatsApp'}
            notificationContact={authenticatedAccount?.notificationContact ?? ''}
            onLogout={handleLogout}
            onOpenPlans={() => setActivePage('plans')}
            onUpdateAccount={handleAccountUpdate}
            paymentAmountLabel={paymentAmountLabel}
            paymentAvailable={paymentCheckoutEnabled}
            planCountdownLabel={monthlyPlanCountdownLabel}
            planEndsAt={monthlyPlanEndsAt}
            trialEndsAt={authenticatedAccount?.trialEndsAt ?? null}
          />
        )}

        {activePage === 'plans' && (
          <PlansPage
            accessStatusDescription={accountAccessState.description}
            accessStatusLabel={accountAccessState.label}
            accessTone={accountAccessState.tone}
            activeCheckout={activePagBankCheckout}
            billingCycleDays={captureBillingCycleDays}
            currentPlan={currentPlanLabel}
            onCreatePagBankOrder={handleCreatePagBankOrder}
            onOpenAccount={() => setActivePage('account')}
            onRefreshPagBankOrder={handleRefreshPagBankOrder}
            onSavePaymentProfile={persistPagBankProfile}
            pagBankEnv={appConfig.pagBankEnv}
            paymentAmountLabel={paymentAmountLabel}
            paymentAvailable={paymentCheckoutEnabled}
            paymentGatewayReady={paymentGatewayReady}
            paymentProviderLabel={appConfig.paymentProviderLabel}
            paymentProfile={{
              phoneNumber: sessionPhoneNumber,
              taxId: sessionTaxId,
            }}
            planCountdownLabel={monthlyPlanCountdownLabel}
            planEndsAt={monthlyPlanEndsAt}
            supportTelegramLink={appConfig.supportTelegramLink}
            userName={sessionProfileName}
            onMarkPaymentSent={handleMarkPaymentSent}
          />
        )}

        {activePage === 'admin' && (
          <AdminPage
            logs={adminLogs}
            onApprovePayment={(accountId) => activatePaidAccount(accountId, Date.now())}
            pendingPayments={pendingPaymentApprovals}
            stats={adminStats}
          />
        )}
          </>
        )}
      </main>

    </div>
  )
}

export default App
