import { lazy, Suspense, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { CustomSelect } from '../components/CustomSelect'
import { FilterBar } from '../components/FilterBar'
import { bbtipsLeagueCatalogByPlatform } from '../data/bbtipsCatalog'
import { periodOptions, resultFtMarkets, resultHtMarkets } from '../data/staticData'
import { TraderPanel } from '../components/TraderPanel'
import { TrendPanel } from '../components/TrendPanel'
import { MaximaPanel } from '../components/MaximaPanel'
import { RankingPanel } from '../components/RankingPanel'
import {
  formatHour,
  getMatrixCellMarkerGroupKey,
  percentageFormatter,
  periodLabelMap,
  periodMsMap,
  scoreForTime,
  type MatrixCellMarkerTone,
} from '../lib/ui'
import {
  buildPayingColumnSummaries,
  buildPayingHourSlots,
} from '../lib/payingHours'
import {
  buildNextRankingHighlights,
  getRankingLimitPhrase,
  getRankingScopeLabel,
  type RankingLimit,
  type RankingScope,
} from '../lib/teamRanking'
import { getPlatformLabel } from '../lib/platformLabel'
import type {
  FiltersState,
  Market,
  MatchRecord,
  MatrixCell,
  Period,
  ToggleKey,
} from '../types'

const StreamPlayer = lazy(() =>
  import('../components/StreamPlayer').then((module) => ({ default: module.StreamPlayer })),
)

interface AnalysisRow {
  hour: number
  hourLabel?: string
  cells: MatrixCell[]
  greens: number
  goals: number
  total: number
  greenRate: number
}

interface AnalysisCardData {
  bestCells: MatrixCell[]
  descriptor: string
  distributionRate: number
  filters: FiltersState
  nextGamesAnchorTimestamp: number
  nextGamesHistoryRecords: MatchRecord[]
  nextGamesSelectedPeriod: Period
  rankingRecords: MatchRecord[]
  leagueName: string
  overallGreens: number
  overallTotal: number
  payingHours: number
  nextRankingMatchIds?: string[]
  nextRankingDualMatchIds?: string[]
  upcomingRecords: MatchRecord[]
  rows: AnalysisRow[]
  traderRecords: MatchRecord[]
}

interface AnalysisPageProps {
  cards: AnalysisCardData[]
  dataSourceError: string | null
  leagueOptions: string[]
  platform: FiltersState['platform']
  selectedLeague: string
  onSelectLeague: (leagueName: string) => void
  onPrefetchLeague?: (leagueName: string) => void
  onChangeCardFilters: (leagueName: string, next: FiltersState) => void
  onResetFilters: () => void
  onChangeNextGamesPeriod: (leagueName: string, next: Period) => void
  selectedCell: MatrixCell | null
  selectedCellMarkerMap: Record<string, MatrixCellMarkerTone>
  onCellClick: (cell: MatrixCell, timeMode: FiltersState['timeMode']) => void
  getNextGamesPeriod: (leagueName: string) => Period
  getToggleState: (leagueName: string) => Record<ToggleKey, boolean>
  toggleFlag: (leagueName: string, key: ToggleKey) => void
}

const switchItems: Array<{ key: ToggleKey; label: string }> = [
  { key: 'showVideo', label: 'Video' },
  { key: 'showTeams', label: 'Times' },
  { key: 'nextRanking', label: 'Radar Top 5' },
  { key: 'payingHours', label: 'Horas fortes' },
]

type OddSequenceSelectValue = '' | Market

const oddSequenceOptions: Array<{
  chipLabel: string
  group: string
  label: string
  shortLabel: string
  value: Market
}> = [
  {
    chipLabel: 'Ambas Sim',
    group: 'Ambas',
    label: 'Ambas Marcam Sim',
    shortLabel: 'BT',
    value: 'Ambas Marcam Sim',
  },
  {
    chipLabel: 'Ambas Não',
    group: 'Ambas',
    label: 'Ambas Marcam Não',
    shortLabel: 'BN',
    value: 'Ambas Marcam Não',
  },
  { chipLabel: 'Over 0.5', group: 'Over/Under', label: 'Over 0.5', shortLabel: 'O05', value: 'Over 0.5' },
  { chipLabel: 'Over 1.5', group: 'Over/Under', label: 'Over 1.5', shortLabel: 'O15', value: 'Over 1.5' },
  { chipLabel: 'Over 2.5', group: 'Over/Under', label: 'Over 2.5', shortLabel: 'O25', value: 'Over 2.5' },
  { chipLabel: 'Over 3.5', group: 'Over/Under', label: 'Over 3.5', shortLabel: 'O35', value: 'Over 3.5' },
  { chipLabel: 'Under 0.5', group: 'Over/Under', label: 'Under 0.5', shortLabel: 'U05', value: 'Under 0.5' },
  { chipLabel: 'Under 1.5', group: 'Over/Under', label: 'Under 1.5', shortLabel: 'U15', value: 'Under 1.5' },
  { chipLabel: 'Under 2.5', group: 'Over/Under', label: 'Under 2.5', shortLabel: 'U25', value: 'Under 2.5' },
  { chipLabel: 'Under 3.5', group: 'Over/Under', label: 'Under 3.5', shortLabel: 'U35', value: 'Under 3.5' },
]

const oddSequenceOptionMap = new Map(oddSequenceOptions.map((option) => [option.value, option]))

const normalizeQuickLeagueName = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const quickLeagueShortLabelByKey: Record<string, string> = {
  america: 'America',
  british: 'British',
  bra: 'BRA',
  brasileirao: 'Brasileirao',
  campeoes: 'Campeoes',
  classicos: 'Classicos',
  copa: 'Copa',
  eng: 'ENG',
  espanhola: 'Espanhola',
  ita: 'ITA',
  express: 'Express',
  estrelas: 'Estrelas',
  euro: 'Euro',
  italiano: 'Italiano',
  lat: 'LAT',
  premier: 'Premier',
  scudetto: 'Scudetto',
  spa: 'SPA',
  split: 'Split',
  super: 'Super',
}

const quickLeagueLabelMap = Object.fromEntries(
  (Object.entries(bbtipsLeagueCatalogByPlatform) as Array<[FiltersState['platform'], typeof bbtipsLeagueCatalogByPlatform.Betano]>)
    .flatMap(([, leagues]) =>
      leagues.map((league) => [
        normalizeQuickLeagueName(league.name),
        quickLeagueShortLabelByKey[league.key] ?? league.name,
      ] as const),
    ),
)

const quickLeagueOrderByPlatform = Object.fromEntries(
  (Object.entries(bbtipsLeagueCatalogByPlatform) as Array<[FiltersState['platform'], typeof bbtipsLeagueCatalogByPlatform.Betano]>)
    .map(([platform, leagues]) => [
      platform,
      leagues.map((league) => quickLeagueShortLabelByKey[league.key] ?? league.name),
    ]),
) as Record<FiltersState['platform'], string[]>

const getQuickLeagueLabel = (leagueName: string) =>
  quickLeagueLabelMap[normalizeQuickLeagueName(leagueName)] ??
  leagueName
    .replace(/^Liga\s+/i, '')
    .replace(/^Campeonato\s+/i, '')
    .replace(/\s+Betano$/i, '')
    .replace(/\s+Bet365$/i, '')
    .replace(/\s+PlayPix$/i, '')
    .replace(/\s+Express 365$/i, '')

type SelectedOddLine = {
  market: Market
  value: string
}

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

const getMetricTone = (value: number) => {
  if (value >= 0.56) return 'is-positive'
  if (value >= 0.46) return 'is-neutral'
  return 'is-negative'
}

const formatSelectedColumnRate = (value: number) => `${(value * 100).toFixed(2)} %`

const exactScoreMarketPattern = /^\d+x\d+$/
const ftScopedResultMarkets = new Set<Market>(resultFtMarkets)
const htScopedResultMarkets = new Set<Market>(resultHtMarkets)

const usesResultPalette = (market: string) =>
  market === 'Resultado final'

const parseScorePair = (score: string) => {
  const [home, away] = score.split(/[x-]/i).map(Number)

  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return null
  }

  return { away, home }
}

const getResultTone = (record: MatchRecord, market: string) => {
  const score = market === 'Resultado HT' ? record.scoreHT : record.scoreFT
  const parsed = parseScorePair(score)

  if (!parsed) return null

  const totalGoals = parsed.home + parsed.away

  if (totalGoals <= 1) return 'is-result-white'
  if (parsed.home === parsed.away) return parsed.home >= 2 ? 'is-result-green' : 'is-result-yellow'
  if (parsed.home > parsed.away) return 'is-result-red'
  if (parsed.home === 0) return totalGoals >= 4 ? 'is-result-green' : 'is-result-black'
  return totalGoals >= 5 ? 'is-result-green' : 'is-result-black'
}

const normalizeExactScore = (score: string) => score.replace(/\s+/g, '').replace('-', 'x').toLowerCase()

const isExactScoreMarket = (market: string) => exactScoreMarketPattern.test(market)

const matchesExactScoreMarket = (record: MatchRecord | undefined, market: string) =>
  Boolean(record && isExactScoreMarket(market) && normalizeExactScore(record.scoreFT) === normalizeExactScore(market))

const getOutcomeMarketState = (record: MatchRecord | undefined, market: Market) => {
  if (!record) return null
  if (market === 'Resultado HT' || ftScopedResultMarkets.has(market) || htScopedResultMarkets.has(market)) {
    return record.marketResults[market] ? 'is-green' : 'is-red'
  }
  return null
}

const resolveMatrixDisplayTimeMode = (
  market: Market,
  timeMode: FiltersState['timeMode'],
): FiltersState['timeMode'] => {
  if (htScopedResultMarkets.has(market)) return 'HT'
  if (ftScopedResultMarkets.has(market) || isExactScoreMarket(market)) return 'FT'
  return timeMode
}

const getReadableTextColor = (hexColor: string) => {
  const hex = hexColor.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#ffffff'

  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000

  return luminance > 150 ? '#10151c' : '#ffffff'
}

const hasStatusRecord = (record: MatchRecord | undefined) =>
  Boolean(record && String(record.status ?? '').trim())

const isFinishedRecord = (record: MatchRecord | undefined) =>
  Boolean(
    record &&
      normalizeStatusValue(record.status).length > 0 &&
      !pendingStatusTokens.some((token) => normalizeStatusValue(record.status).includes(token)),
  )

const getVideoRecord = (card: AnalysisCardData, selectedCell: MatrixCell | null) => {
  const selectedRecord = selectedCell?.upcoming ?? selectedCell?.latest
  if (selectedRecord?.league === card.leagueName) {
    return selectedRecord
  }

  const upcomingRecords = card.rows
    .flatMap((row) => row.cells)
    .map((cell) => {
      const latest = hasStatusRecord(cell.latest as MatchRecord | undefined)
        ? cell.latest as MatchRecord
        : undefined

      return cell.upcoming ?? (latest && !isFinishedRecord(latest) ? latest : undefined)
    })
    .filter(Boolean) as MatchRecord[]

  const liveRecord = upcomingRecords[0]
  if (liveRecord) {
    return liveRecord
  }

  const cardRecords = card.rows
    .flatMap((row) => row.cells)
    .map((cell) => cell.latest)
    .filter(Boolean) as MatchRecord[]

  return card.bestCells.find((cell) => cell.latest)?.latest ?? cardRecords[0] ?? null
}



type NextGamesStatTone = 'direct' | 'home' | 'away'

interface NextGamesStatCard {
  averageGoals: number
  bttsNoRate: number
  bttsYesRate: number
  sampleSize: number
  subtitle: string
  title: string
  tone: NextGamesStatTone
}

type NextGamesDirectOutcome = 'home' | 'draw' | 'away'

interface NextGamesDirectInsight {
  awayWins: number
  draws: number
  homeWins: number
  recentScores: Array<{
    label: string
    outcome: NextGamesDirectOutcome
  }>
}

const nextGamesStatToneLabel: Record<NextGamesStatTone, string> = {
  away: 'FORA',
  direct: 'H2H',
  home: 'CASA',
}

const nextGamesHourOptions: Array<{ label: string; value: Period }> = periodOptions.map((option) => ({
  label: periodLabelMap[option],
  value: option,
}))

const normalizeTeamName = (teamName: string) =>
  teamName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const getScoreGoals = (record: MatchRecord) => {
  const parsed = parseScorePair(record.scoreFT)
  return parsed ? parsed.home + parsed.away : 0
}

const isBttsRecord = (record: MatchRecord) => {
  const parsed = parseScorePair(record.scoreFT)
  return Boolean(parsed && parsed.home > 0 && parsed.away > 0)
}

const isTeamMatch = (record: MatchRecord, teamName: string) => {
  const target = normalizeTeamName(teamName)
  return normalizeTeamName(record.homeTeam) === target || normalizeTeamName(record.awayTeam) === target
}

const isDirectMatch = (record: MatchRecord, homeTeam: string, awayTeam: string) => {
  const home = normalizeTeamName(homeTeam)
  const away = normalizeTeamName(awayTeam)
  const recordHome = normalizeTeamName(record.homeTeam)
  const recordAway = normalizeTeamName(record.awayTeam)

  return (recordHome === home && recordAway === away) || (recordHome === away && recordAway === home)
}

const pluralizeGames = (count: number) => count + ' ' + (count === 1 ? 'jogo analisado' : 'jogos analisados')

const formatMatrixCellOddValue = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '-'
  }

  return value.toFixed(2).replace(/\.?0+$/, '')
}

const formatMatrixSequenceOddValue = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '-'
  }

  return value.toFixed(2).replace(/\.?0+$/, '')
}

const formatMatrixRowLabel = (hourLabel: string | undefined, hour: number) => {
  const fallbackHour = `${String(hour).padStart(2, '0')}h`

  if (!hourLabel) {
    return { primary: fallbackHour, secondary: null as string | null }
  }

  const normalized = hourLabel.replace(',', ' ').replace(/\s+/g, ' ').trim()
  const match = normalized.match(/^(\d{2}\/\d{2})\s+(\d{2}h)$/i)

  if (match) {
    return {
      primary: match[2],
      secondary: match[1],
    }
  }

  return {
    primary: hourLabel,
    secondary: null as string | null,
  }
}

const readPositiveOddValue = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null

const oddMarketAliasKeys = (market: Market): Market[] =>
  market === '1 gol FT' ? ['1 gol FT', '1 gols FT'] : [market]

/** Prioriza `cell.odds` (agregado upcoming/latest/fallback); o registro exibido pode vir sem essa odd. */
const getMatrixCellOddValue = (
  cell: MatrixCell,
  market: Market,
  record?: MatchRecord,
) => {
  for (const key of oddMarketAliasKeys(market)) {
    const v =
      readPositiveOddValue(cell.odds?.[key]) ??
      readPositiveOddValue(record?.odds[key])
    if (v !== null) return v
  }
  return null
}

const renderMatrixOddSequence = (
  record: MatchRecord,
  cellOdds: MatrixCell['odds'] | undefined,
  markets: Market[],
  selectedOddLine: SelectedOddLine | null,
  onToggleOddLine: (market: Market, value: string) => void,
) => (
  <span className={`cell-odd-sequence ${markets.length === 1 ? 'is-single-market' : 'is-multi-market'}`}>
    {markets.map((market) => {
      const isSingleMarket = markets.length === 1
      const option = oddSequenceOptionMap.get(market)
      const marketCode = option?.shortLabel ?? market
      const value = formatMatrixSequenceOddValue(
        oddMarketAliasKeys(market).reduce<number | null>(
          (acc, key) =>
            acc ??
            readPositiveOddValue(cellOdds?.[key]) ??
            readPositiveOddValue(record.odds[key]),
          null,
        ),
      )
      const isSelectable = value !== '-'
      const isSelected = Boolean(
        isSelectable &&
          selectedOddLine &&
          selectedOddLine.market === market &&
          selectedOddLine.value === value,
      )

      if (!isSelectable) {
        return (
          <span
            key={market}
            className={`cell-odd-line is-loading ${isSingleMarket ? 'is-single-market' : 'is-multi-market'}`}
            aria-label={`${marketCode} carregando`}
          >
            {!isSingleMarket && <span className="cell-odd-code">{marketCode}</span>}
            <span className="cell-odd-loading-bar" />
          </span>
        )
      }

      return (
        <span
          key={market}
          className={`cell-odd-line is-selectable ${isSingleMarket ? 'is-single-market' : 'is-multi-market'} ${isSelected ? 'is-selected-odd' : ''}`}
          onClick={(event) => {
            event.stopPropagation()
            onToggleOddLine(market, value)
          }}
          title={`Marcar ${marketCode}@${value}`}
        >
          {isSingleMarket ? (
            <span className="cell-odd-number is-prefixed">@{value}</span>
          ) : (
            <>
              <span className="cell-odd-code">{marketCode}</span>
              <span className="cell-odd-number">{value}</span>
            </>
          )}
        </span>
      )
    })}
  </span>
)

const renderMatrixScoreValue = (record: MatchRecord, timeMode: FiltersState['timeMode']) => {
  if (timeMode !== 'FT + HT') {
    return <span className="cell-score-value">{scoreForTime(record, timeMode)}</span>
  }

  return (
    <span className="cell-score-lines" aria-label={`FT ${record.scoreFT} | HT ${record.scoreHT}`}>
      <span className="cell-score-line">{record.scoreFT}</span>
      <span className="cell-score-line is-secondary">{record.scoreHT}</span>
    </span>
  )
}

function OddSequenceFilter({
  filters,
  onChange,
}: {
  filters: FiltersState
  onChange: (next: FiltersState) => void
}) {
  const selectedMarkets = filters.oddSequence ?? []
  const availableOptions = oddSequenceOptions.filter((option) => !selectedMarkets.includes(option.value))
  const selectOptions: Array<{ group?: string; label: string; value: OddSequenceSelectValue }> = [
    { label: 'Escolher odd', value: '' },
    ...availableOptions.map((option) => ({
      group: option.group,
      label: option.label,
      value: option.value,
    })),
  ]

  const addMarket = (value: OddSequenceSelectValue) => {
    if (!value || selectedMarkets.includes(value)) return

    onChange({
      ...filters,
      oddsView: 'Selecione as Odds',
      oddSequence: [...selectedMarkets, value],
    })
  }

  const removeMarket = (market: Market) => {
    onChange({
      ...filters,
      oddSequence: selectedMarkets.filter((selectedMarket) => selectedMarket !== market),
    })
  }

  return (
    <section className="odd-sequence-filter" aria-label="Filtro ODD">
      <div className="odd-sequence-body is-compact">
        <label className="odd-sequence-select-field" aria-label="Adicionar mercado na sequencia">
          <CustomSelect
            menuTheme="dark"
            searchable
            searchPlaceholder="Buscar odd..."
            value=""
            options={selectOptions}
            onChange={addMarket}
          />
        </label>
        <div className="odd-sequence-selection-panel">
          <div className={`odd-sequence-chip-row ${selectedMarkets.length === 0 ? 'is-empty' : ''}`}>
            {selectedMarkets.map((market) => {
              const option = oddSequenceOptionMap.get(market)
              return (
                <button
                  key={market}
                  type="button"
                  className="odd-sequence-chip"
                  onClick={() => removeMarket(market)}
                >
                  <span aria-hidden="true">×</span>
                  {option?.chipLabel ?? option?.label ?? market}
                </button>
              )
            })}
          </div>
          {selectedMarkets.length > 0 && (
            <button
              type="button"
              className="odd-sequence-clear"
              onClick={() =>
                onChange({
                  ...filters,
                  oddSequence: [],
                })
              }
            >
              Limpar sequencia
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

const buildNextGamesStatCard = (
  records: MatchRecord[],
  title: string,
  subtitle: string,
  tone: NextGamesStatTone,
): NextGamesStatCard => {
  const sample = records
  const bttsYes = sample.filter(isBttsRecord).length
  const totalGoals = sample.reduce((sum, record) => sum + getScoreGoals(record), 0)
  const sampleSize = sample.length

  return {
    averageGoals: sampleSize ? totalGoals / sampleSize : 0,
    bttsNoRate: sampleSize ? (sampleSize - bttsYes) / sampleSize : 0,
    bttsYesRate: sampleSize ? bttsYes / sampleSize : 0,
    sampleSize,
    subtitle,
    title,
    tone,
  }
}

const buildNextGamesDirectInsight = (
  records: MatchRecord[],
  homeTeam: string,
  awayTeam: string,
): NextGamesDirectInsight => {
  const home = normalizeTeamName(homeTeam)
  const away = normalizeTeamName(awayTeam)
  const normalizedResults = records
    .map((record) => {
      const parsed = parseScorePair(record.scoreFT)
      if (!parsed) return null

      const recordHome = normalizeTeamName(record.homeTeam)
      const recordAway = normalizeTeamName(record.awayTeam)

      let normalizedHomeGoals = parsed.home
      let normalizedAwayGoals = parsed.away

      if (recordHome === away && recordAway === home) {
        normalizedHomeGoals = parsed.away
        normalizedAwayGoals = parsed.home
      } else if (recordHome !== home || recordAway !== away) {
        return null
      }

      const outcome: NextGamesDirectOutcome =
        normalizedHomeGoals === normalizedAwayGoals
          ? 'draw'
          : normalizedHomeGoals > normalizedAwayGoals
            ? 'home'
            : 'away'

      return {
        label: `${normalizedHomeGoals}-${normalizedAwayGoals}`,
        outcome,
      }
    })
    .filter((value): value is { label: string; outcome: NextGamesDirectOutcome } => Boolean(value))

  return {
    awayWins: normalizedResults.filter((entry) => entry.outcome === 'away').length,
    draws: normalizedResults.filter((entry) => entry.outcome === 'draw').length,
    homeWins: normalizedResults.filter((entry) => entry.outcome === 'home').length,
    recentScores: normalizedResults.slice(0, 6),
  }
}

const getUniqueUpcomingRecords = (card: AnalysisCardData) => {
  const upcomingMap = new Map<string, MatchRecord>()
  const rowUpcomingRecords = card.rows
    .flatMap((row) => row.cells)
    .map((cell) => {
      const latest = hasStatusRecord(cell.latest as MatchRecord | undefined)
        ? cell.latest as MatchRecord
        : undefined

      return cell.upcoming ?? (latest && !isFinishedRecord(latest) ? latest : undefined)
    })
    .filter((record): record is MatchRecord => Boolean(record))
  const sourceRecords = [...card.upcomingRecords, ...rowUpcomingRecords]

  ;[...sourceRecords]
    .sort((left, right) => left.timestamp - right.timestamp)
    .forEach((record) => {
      const key = Number.isFinite(record.timestamp)
        ? `${record.platform}::${record.league}::${record.timestamp}`
        : record.id

      if (!upcomingMap.has(key)) {
        upcomingMap.set(key, record)
      }
    })

  return [...upcomingMap.values()]
}

function NextGamesPanel({
  card,
  historyPeriod,
  onChangeHistoryPeriod,
  platform,
}: {
  card: AnalysisCardData
  historyPeriod: Period
  onChangeHistoryPeriod: (next: Period) => void
  platform: FiltersState['platform']
}) {
  const isPlayPix = platform === 'PlayPix'
  const playPixAllowedPeriods = new Set<Period>(['6h', '12h', '24h', '36h', '48h'])
  const safePlayPixPeriod = playPixAllowedPeriods.has(historyPeriod)
    ? historyPeriod
    : '48h'
  const resolvedHistoryPeriod: Period = isPlayPix ? safePlayPixPeriod : historyPeriod
  const allowedHourOptions = isPlayPix
    ? nextGamesHourOptions.filter((option) => playPixAllowedPeriods.has(option.value))
    : nextGamesHourOptions
  const upcomingRecords = useMemo(() => getUniqueUpcomingRecords(card), [card])
  const historyDurationMs = periodMsMap[resolvedHistoryPeriod] ?? periodMsMap['240h']
  const finishedHistoryRecords = useMemo(
    () =>
      card.nextGamesHistoryRecords
        .filter((record) => isFinishedRecord(record))
        .sort((left, right) => right.timestamp - left.timestamp),
    [card.nextGamesHistoryRecords],
  )
  const visibleUpcomingRecords = useMemo(() => {
    const anchorTimestamp = card.nextGamesAnchorTimestamp
    const windowEnd = anchorTimestamp + historyDurationMs

    return upcomingRecords.filter(
      (record) =>
        Number.isFinite(record.timestamp) &&
        record.timestamp >= anchorTimestamp &&
        record.timestamp <= windowEnd,
    )
  }, [card.nextGamesAnchorTimestamp, historyDurationMs, upcomingRecords])

  if (upcomingRecords.length === 0) {
    return (
      <section className="next-games-panel is-empty">
        <div className="next-games-empty-state">
          <strong>Próximos Jogos</strong>
          <p>Assim que chegarem jogos pendentes reais, eles aparecem aqui com as estatísticas do confronto.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="next-games-panel">
      <header className="next-games-header">
        <div className="next-games-title-row">
          <span className="next-games-icon" aria-hidden="true">?</span>
          <div>
            <h3>Próximos Jogos — Estatísticas de Confronto</h3>
            <p>{`Baseado nos jogos finalizados dentro do recorte de ${periodLabelMap[resolvedHistoryPeriod]}`}</p>
          </div>
        </div>
        <div className="next-games-header-tools">
          <label className="next-games-period-filter">
            <span>Ultimas horas</span>
            <CustomSelect
              menuTheme="dark"
              value={resolvedHistoryPeriod}
              options={allowedHourOptions}
              onChange={(next) => onChangeHistoryPeriod(next)}
            />
          </label>
        </div>
      </header>

      {visibleUpcomingRecords.length === 0 ? (
        <div className="next-games-empty-range">
          Nenhum próximo jogo encontrado dentro de {periodLabelMap[resolvedHistoryPeriod]}.
        </div>
      ) : (
      <div className="next-games-grid">
        {visibleUpcomingRecords.map((record) => {
          const historyWindowStart = record.timestamp - historyDurationMs
          const recordsInHistoryWindow = finishedHistoryRecords.filter(
            (finished) => finished.timestamp >= historyWindowStart && finished.timestamp <= record.timestamp,
          )
          const directRecords = recordsInHistoryWindow.filter((finished) =>
            isDirectMatch(finished, record.homeTeam, record.awayTeam),
          )
          const homeRecords = recordsInHistoryWindow.filter((finished) => isTeamMatch(finished, record.homeTeam))
          const awayRecords = recordsInHistoryWindow.filter((finished) => isTeamMatch(finished, record.awayTeam))
          const directCount = directRecords.length
          const homeCount = homeRecords.length
          const awayCount = awayRecords.length
          const directInsight = buildNextGamesDirectInsight(
            directRecords,
            record.homeTeam,
            record.awayTeam,
          )
          const statCards = [
            buildNextGamesStatCard(
              directRecords,
              'Confrontos Diretos',
              pluralizeGames(directCount),
              'direct',
            ),
            buildNextGamesStatCard(
              homeRecords,
              record.homeTeam,
              pluralizeGames(homeCount) + ' na forma recente',
              'home',
            ),
            buildNextGamesStatCard(
              awayRecords,
              record.awayTeam,
              pluralizeGames(awayCount) + ' na forma recente',
              'away',
            ),
          ]

          return (
            <article className="next-game-card" key={record.id}>
              <div className="next-game-meta-row">
                <span className="next-game-time">Hora {formatHour(record.hour, record.minuteSlot)}</span>
                <span className="next-game-league">{getQuickLeagueLabel(card.leagueName)}</span>
              </div>

              <div className="next-game-matchup">
                <div className="next-game-matchup-team is-home">
                  <span className="next-game-side-label">Casa</span>
                  <strong>{record.homeTeam}</strong>
                </div>
                <span className="next-game-matchup-vs">vs</span>
                <div className="next-game-matchup-team is-away">
                  <span className="next-game-side-label">Fora</span>
                  <strong>{record.awayTeam}</strong>
                </div>
              </div>

              <div className="next-game-stat-grid">
                {statCards.map((stat) => (
                  <div className={'next-game-stat-card is-' + stat.tone} key={record.id + '-' + stat.tone}>
                    <div className="next-game-stat-head">
                      <span className="next-game-stat-icon" aria-hidden="true">
                        {nextGamesStatToneLabel[stat.tone]}
                      </span>
                      <div>
                        <strong title={stat.title}>{stat.title}</strong>
                        <small>{stat.subtitle}</small>
                      </div>
                    </div>

                    {stat.tone === 'direct' && (
                      <>
                        {stat.sampleSize > 0 ? (
                          <>
                            <div className="next-game-direct-breakdown">
                              <div className="next-game-direct-pill is-home" title={record.homeTeam}>
                                <span>Casa</span>
                                <strong>{directInsight.homeWins}</strong>
                                <small>{record.homeTeam}</small>
                              </div>
                              <div className="next-game-direct-pill is-draw" title="Empates">
                                <span>Empates</span>
                                <strong>{directInsight.draws}</strong>
                                <small>Equilibrio</small>
                              </div>
                              <div className="next-game-direct-pill is-away" title={record.awayTeam}>
                                <span>Fora</span>
                                <strong>{directInsight.awayWins}</strong>
                                <small>{record.awayTeam}</small>
                              </div>
                            </div>

                            <div className="next-game-direct-history">
                              <span className="next-game-direct-history-label">Ultimos placares H2H</span>
                              <div className="next-game-direct-score-row">
                                {directInsight.recentScores.map((entry, index) => (
                                  <span
                                    key={`${record.id}-direct-score-${index}`}
                                    className={`next-game-direct-score is-${entry.outcome}`}
                                  >
                                    {entry.label}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="next-game-direct-empty">
                            Sem confrontos diretos suficientes no recorte atual.
                          </div>
                        )}
                      </>
                    )}

                    <div className="next-game-metric-row">
                      <span>Média de Gols</span>
                      <strong>{stat.averageGoals.toFixed(1)}</strong>
                    </div>
                    <div className="next-game-progress-line">
                      <span>Ambas Marcam (sim)</span>
                      <strong>{percentageFormatter.format(stat.bttsYesRate)}</strong>
                      <i style={{ width: Math.round(stat.bttsYesRate * 100) + '%' }} />
                    </div>
                    <div className="next-game-progress-line is-no">
                      <span>Ambas Não Marcam</span>
                      <strong>{percentageFormatter.format(stat.bttsNoRate)}</strong>
                      <i style={{ width: Math.round(stat.bttsNoRate * 100) + '%' }} />
                    </div>
                  </div>
                ))}
              </div>
            </article>
          )
        })}
      </div>
      )}
    </section>
  )
}

const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  currency: 'BRL',
  style: 'currency',
})

const decimalFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
})

const parseDecimalInput = (value: string, fallback: number) => {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : fallback
}

const parseOddInput = (value: string, fallback: number) => {
  const normalized = value.replace(',', '.').trim()
  const parsed = Number(normalized)

  if (!Number.isFinite(parsed)) return fallback
  if (!normalized.includes('.') && parsed >= 100) return parsed / 100
  if (parsed >= 20) return parsed / 100
  return parsed
}

const formatCurrencyCompact = (value: number) =>
  moneyFormatter.format(value).replace(/\u00a0/g, ' ')

const martingaleOddDefaults = ['1.69', '1.75', '1.80', '1.80', '1.80', '1.80', '1.80']

function MartingaleCalculatorPanel() {
  const [entryCount, setEntryCount] = useState(3)
  const [anchorOddInput, setAnchorOddInput] = useState('1.78')
  const [anchorStakeInput, setAnchorStakeInput] = useState('10')
  const [stepOddInputs, setStepOddInputs] = useState(martingaleOddDefaults)

  const anchorOdd = Math.max(parseOddInput(anchorOddInput, 1.78), 1.01)
  const anchorStake = Math.max(parseDecimalInput(anchorStakeInput, 10), 0)
  const guaranteedProfit = anchorStake * Math.max(anchorOdd - 1, 0.01)
  const cycleRows = Array.from({ length: Math.max(entryCount - 1, 0) }).reduce<{
    invested: number
    rows: Array<{
      betNumber: number
      odd: number
      oddInput: string
      returnAmount: number
      stake: number
    }>
  }>(
    (state, _, index) => {
      const oddInput = stepOddInputs[index] ?? '1.80'
      const odd = Math.max(parseOddInput(oddInput, 1.8), 1.01)
      const stake = (state.invested + guaranteedProfit) / Math.max(odd - 1, 0.01)
      const returnAmount = stake * odd

      return {
        invested: state.invested + stake,
        rows: [
          ...state.rows,
          {
            betNumber: index + 2,
            odd,
            oddInput,
            returnAmount,
            stake,
          },
        ],
      }
    },
    { invested: anchorStake, rows: [] },
  )
  const totalInvested = cycleRows.invested
  const roi = totalInvested ? guaranteedProfit / totalInvested : 0

  const updateStepOdd = (index: number, value: string) => {
    setStepOddInputs((current) => {
      const next = [...current]
      next[index] = value
      return next
    })
  }

  return (
    <section className="martingale-panel easy-model">
      <header className="martingale-easy-header">
        <span className="martingale-icon" aria-hidden="true">M</span>
        <div>
          <h3>Calculadora Martingale</h3>
          <p>Lucro fixo independente de qual entrada ganhar</p>
        </div>
      </header>

      <div className="martingale-cycle-card">
        <div>
          <strong>Entradas no ciclo</strong>
          <span>Numero de apostas</span>
        </div>
        <select value={entryCount} onChange={(event) => setEntryCount(Number(event.target.value))}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => (
            <option key={count} value={count}>{count}</option>
          ))}
        </select>
      </div>

      <div className="martingale-anchor-card">
        <div className="martingale-anchor-head">
          <div>
            <span>1</span>
            <strong>Entrada ancora</strong>
          </div>
          <small>BASE DO CICLO</small>
        </div>

        <div className="martingale-anchor-grid">
          <label>
            <span>Odd</span>
            <input value={anchorOddInput} inputMode="decimal" onChange={(event) => setAnchorOddInput(event.target.value)} />
            <small>Digite ex: 178 {'->'} 1.78</small>
          </label>
          <label>
            <span>Valor</span>
            <div className="martingale-money-input">
              <i>R$</i>
              <input value={anchorStakeInput} inputMode="decimal" onChange={(event) => setAnchorStakeInput(event.target.value)} />
            </div>
          </label>
        </div>

        <div className="martingale-anchor-profit">
          <span>Lucro se ganhar aqui</span>
          <strong>{formatCurrencyCompact(guaranteedProfit)}</strong>
        </div>
      </div>

      {cycleRows.rows.length > 0 && (
        <div className="martingale-easy-table-wrap">
          <table className="martingale-easy-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Odd</th>
                <th>Apostar</th>
                <th>Retorno</th>
              </tr>
            </thead>
            <tbody>
              {cycleRows.rows.map((row, index) => (
                <tr key={row.betNumber}>
                  <td>{row.betNumber}</td>
                  <td>
                    <input value={row.oddInput} inputMode="decimal" onChange={(event) => updateStepOdd(index, event.target.value)} />
                  </td>
                  <td>{decimalFormatter.format(row.stake)}</td>
                  <td>{decimalFormatter.format(row.returnAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="martingale-result-grid">
        <article className="is-profit">
          <span>Lucro garantido</span>
          <strong>{formatCurrencyCompact(guaranteedProfit)}</strong>
        </article>
        <article>
          <span>Total investido</span>
          <strong>{formatCurrencyCompact(totalInvested)}</strong>
        </article>
        <article className="is-roi">
          <span>ROI do ciclo</span>
          <strong>{percentageFormatter.format(roi)}</strong>
        </article>
      </div>

      <div className="martingale-guarantee-bar">
        <span>Lucro liquido garantido em qualquer entrada vencedora</span>
        <strong>{formatCurrencyCompact(guaranteedProfit)}</strong>
      </div>
    </section>
  )
}
function AnalysisCard({
  card,
  filters,
  nextGamesPeriod,
  onChangeFilters,
  onResetFilters,
  onChangeNextGamesPeriod,
  selectedCell,
  selectedCellMarkerMap,
  onCellClick,
  toggleFlag,
  toggleState,
}: {
  card: AnalysisCardData
  filters: FiltersState
  nextGamesPeriod: Period
  onChangeFilters: (next: FiltersState) => void
  onResetFilters: () => void
  onChangeNextGamesPeriod: (next: Period) => void
  selectedCell: MatrixCell | null
  selectedCellMarkerMap: Record<string, MatrixCellMarkerTone>
  onCellClick: (cell: MatrixCell, timeMode: FiltersState['timeMode']) => void
  toggleState: Record<ToggleKey, boolean>
  toggleFlag: (key: ToggleKey) => void
}) {
  const redRate = Math.max(1 - card.distributionRate, 0)
  const [highlightedMaximaSlots, setHighlightedMaximaSlots] = useState<string[]>([])
  const [selectedMinuteSlots, setSelectedMinuteSlots] = useState<number[]>([])
  const [selectedOddLine, setSelectedOddLine] = useState<SelectedOddLine | null>(null)
  const [nextRankingScope, setNextRankingScope] = useState<RankingScope>('all')
  const [nextRankingLimit, setNextRankingLimit] = useState<RankingLimit>(5)
  const activeSelectedOddLine = selectedOddLine && (filters.oddSequence ?? []).includes(selectedOddLine.market)
    ? selectedOddLine
    : null
  const highlightedMaximaSet = useMemo(() => new Set(highlightedMaximaSlots), [highlightedMaximaSlots])
  const nextRankingHighlights = useMemo(
    () => buildNextRankingHighlights(
      card.rankingRecords,
      card.rows,
      filters.market,
      nextRankingScope,
      nextRankingLimit,
      card.upcomingRecords,
    ),
    [card.rows, card.rankingRecords, card.upcomingRecords, filters.market, nextRankingLimit, nextRankingScope],
  )
  const nextRankingSet = useMemo(
    () => new Set(nextRankingHighlights.nextRankingMatchIds),
    [nextRankingHighlights.nextRankingMatchIds],
  )
  const nextRankingDualSet = useMemo(
    () => new Set(nextRankingHighlights.nextRankingDualMatchIds),
    [nextRankingHighlights.nextRankingDualMatchIds],
  )
  const columnSummaries = buildPayingColumnSummaries(card.rows)
  const isDenseMinuteGrid = columnSummaries.length > 30
  const payingHourSlots = buildPayingHourSlots(columnSummaries)
  const availableMinuteSlotSet = new Set(columnSummaries.map((summary) => summary.minuteSlot))
  const selectedMinuteSet = new Set(selectedMinuteSlots.filter((minuteSlot) => availableMinuteSlotSet.has(minuteSlot)))
  const hasSelectedColumns = selectedMinuteSet.size > 0
  const selectedColumnStats = card.rows.reduce(
    (acc, row) => {
      const selectedCellsWithData = row.cells.filter(
        (cell) => selectedMinuteSet.has(cell.minuteSlot) && cell.total > 0,
      )

      if (selectedCellsWithData.length === 0) return acc

      acc.total += 1
      if (selectedCellsWithData.some((cell) => cell.greens > 0)) {
        acc.greens += 1
      }

      return acc
    },
    { greens: 0, total: 0 },
  )
  const selectedColumnRate = selectedColumnStats.total
    ? selectedColumnStats.greens / selectedColumnStats.total
    : 0
  const selectedOddMatchCount = useMemo(() => {
    if (!activeSelectedOddLine) return 0

    return card.rows.reduce((count, row) => (
      count + row.cells.filter((cell) => {
        const latestRaw = cell.latest as MatchRecord | undefined
        const latest = hasStatusRecord(latestRaw) ? latestRaw : undefined
        const displayRecord = cell.upcoming ?? latest

        return (
          formatMatrixSequenceOddValue(
            getMatrixCellOddValue(cell, activeSelectedOddLine.market, displayRecord),
          ) === activeSelectedOddLine.value
        )
      }).length
    ), 0)
  }, [activeSelectedOddLine, card.rows])
  const selectedColumnSegments = columnSummaries.reduce(
    (segments, summary) => {
      const selected = selectedMinuteSet.has(summary.minuteSlot)
      const lastSegment = segments[segments.length - 1]

      if (lastSegment && lastSegment.selected === selected) {
        lastSegment.colSpan += 1
      } else {
        segments.push({
          colSpan: 1,
          key: `${summary.minuteSlot}-${selected ? 'selected' : 'idle'}`,
          selected,
        })
      }

      return segments
    },
    [] as Array<{ colSpan: number; key: string; selected: boolean }>,
  )
  const videoRecord = getVideoRecord(card, selectedCell)
  const videoStreamUrl = videoRecord?.streamUrl
  const visibleSwitchItems = switchItems.filter(
    (toggle) => toggle.key !== 'showVideo' || Boolean(videoRecord?.videoAvailable),
  )

  const openFooterTab = (key: ToggleKey) => {
    const footerKeys: ToggleKey[] = ['detailCells', 'altReading', 'showMaxima', 'showRanking', 'showNextGames', 'showMartingale']
    const isActive = toggleState[key]

    footerKeys.forEach((footerKey) => {
      if (footerKey !== key && toggleState[footerKey]) {
        toggleFlag(footerKey)
      }
    })

    toggleFlag(key)

    if (isActive) {
      return
    }
  }

  const toggleSelectedMinuteSlot = (minuteSlot: number) => {
    setSelectedMinuteSlots((current) =>
      current.includes(minuteSlot)
        ? current.filter((slot) => slot !== minuteSlot)
        : [...current, minuteSlot].sort((left, right) => left - right),
    )
  }

  const toggleSelectedOddLine = (market: Market, value: string) => {
    setSelectedOddLine((current) =>
      current && current.market === market && current.value === value
        ? null
        : { market, value },
    )
  }

  const activeFooterTab = toggleState.detailCells
    ? 'detailCells'
    : toggleState.altReading
      ? 'altReading'
      : toggleState.showMaxima
        ? 'showMaxima'
        : toggleState.showRanking
          ? 'showRanking'
          : toggleState.showNextGames
            ? 'showNextGames'
            : toggleState.showMartingale
              ? 'showMartingale'
              : null
  const cardColorStyle = {
    '--analysis-cell-green': filters.greenColor,
    '--analysis-cell-green-fg': getReadableTextColor(filters.greenColor),
    '--analysis-cell-red': filters.redColor,
    '--analysis-cell-red-fg': getReadableTextColor(filters.redColor),
  } as CSSProperties
  const hasOddSequence = (filters.oddSequence ?? []).length > 0
  const scoreDisplayTimeMode = resolveMatrixDisplayTimeMode(filters.market, filters.timeMode)
  const selectedOddLabel = activeSelectedOddLine
    ? `${oddSequenceOptionMap.get(activeSelectedOddLine.market)?.shortLabel ?? activeSelectedOddLine.market}@${activeSelectedOddLine.value}`
    : ''
  const rankingLimitPhrase = getRankingLimitPhrase(nextRankingLimit)
  const rankingSingleLegend =
    nextRankingScope === 'all'
      ? '1 ranqueado'
      : `${getRankingScopeLabel(nextRankingScope)} • ${rankingLimitPhrase}`
  const rankingDoubleLegend = '2 ranqueados'

  return (
    <article className="analysis-surface" style={cardColorStyle}>
      <div className="analysis-head compact-model">
        <div className="analysis-head-copy">
          <h2>{card.leagueName}</h2>
          <p>{`${getPlatformLabel(filters.platform)} • ${card.descriptor}`}</p>
        </div>
      </div>

      <div className="analysis-filter-shell integrated">
        <FilterBar
          compact
          filters={filters}
          leagueOptions={[card.leagueName]}
          onChange={onChangeFilters}
          onReset={onResetFilters}
          oddsMode="display"
          showColorControls
          showLeague={false}
        />
      </div>

      <div className="analysis-toolbar-panel">
        <div className="analysis-toolbar-block analysis-toolbar-block-controls">
          <div className="analysis-toolbar-block-head">
            <span className="analysis-toolbar-eyebrow">Leituras rapidas</span>
            <strong>Controles da matrix</strong>
          </div>

          <div className="analysis-controls">
          <div className="switch-row">
            {visibleSwitchItems.map((toggle) => (
              <button
                key={`${card.leagueName}-${toggle.key}`}
                type="button"
                className={`switch-control ${toggleState[toggle.key] ? 'is-active' : ''}`}
                aria-pressed={toggleState[toggle.key]}
                onClick={() => toggleFlag(toggle.key)}
              >
                <span className="switch-control-main">
                  {toggle.key === 'showVideo' && <span className="switch-icon video" aria-hidden="true" />}
                  <span className="switch-control-copy">
                    <span className="switch-control-label">{toggle.label}</span>
                    <span className="switch-control-state">
                      {toggleState[toggle.key] ? 'Ativo' : 'Inativo'}
                    </span>
                  </span>
                </span>
                <span className={`switch-toggle ${toggleState[toggle.key] ? 'active' : ''}`}>
                  <span className="switch-knob" />
                </span>
              </button>
            ))}
          </div>

          {toggleState.nextRanking && (
            <div className="analysis-ranking-tools" aria-label="Opcoes do ranking nos proximos">
              <span className="analysis-toolbar-inline-label">Legenda do radar</span>
              <div className="analysis-ranking-legend" aria-label="Legenda do ranking nos proximos">
                <span className="analysis-ranking-legend-item">
                  <i className="analysis-ranking-legend-swatch is-single" aria-hidden="true" />
                  {rankingSingleLegend}
                </span>
                {nextRankingScope === 'all' && (
                  <span className="analysis-ranking-legend-item">
                    <i className="analysis-ranking-legend-swatch is-double" aria-hidden="true" />
                    {rankingDoubleLegend}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        </div>

        <div className="analysis-toolbar-block analysis-toolbar-block-sequence">
          <OddSequenceFilter filters={filters} onChange={onChangeFilters} />
        </div>
      </div>

      {toggleState.showVideo && videoRecord && videoStreamUrl && (
        <section className="analysis-video-shell" aria-label={`Video ${card.leagueName}`}>
          <div className="analysis-video-stage">
            <Suspense fallback={<div className="analysis-video-status"><strong>Preparando video...</strong></div>}>
              <StreamPlayer
                key={`${videoRecord.id}-${videoStreamUrl}`}
                poster={videoRecord.leagueImage}
                streamUrl={videoStreamUrl}
                title={`${videoRecord.homeTeam} x ${videoRecord.awayTeam}`}
              />
            </Suspense>
          </div>
        </section>
      )}

      <section className={`matrix-panel reference ${isDenseMinuteGrid ? 'is-dense-minute-grid' : ''}`}>
        <div className="matrix-panel-head">
          {activeSelectedOddLine && hasOddSequence && (
            <div className="odd-selection-status">
              <span>
                Odd marcada: <strong>{selectedOddLabel}</strong>
              </span>
              <span>{selectedOddMatchCount} encontrada{selectedOddMatchCount === 1 ? '' : 's'}</span>
              <button type="button" onClick={() => setSelectedOddLine(null)}>
                Limpar
              </button>
            </div>
          )}

          <div className="analysis-percent-wrap">
            <div className="analysis-percent-bar">
              <div
                className="analysis-percent-side is-green"
                style={{ width: `${Math.max(card.distributionRate * 100, 8)}%` }}
              >
                {percentageFormatter.format(card.distributionRate)}
              </div>
              <div
                className="analysis-percent-side is-red"
                style={{ width: `${Math.max(redRate * 100, 8)}%` }}
              >
                {percentageFormatter.format(redRate)}
              </div>
            </div>
          </div>
        </div>
        <div className="matrix-wrap">
          <table className={`matrix-table reference ${isDenseMinuteGrid ? 'is-dense-minute-grid' : ''} ${toggleState.showTeams ? 'is-teams-view' : ''} ${hasOddSequence ? 'is-odd-sequence-view' : ''} ${activeSelectedOddLine ? 'has-odd-selection' : ''} ${hasSelectedColumns ? 'has-selected-columns' : ''}`}>
            <colgroup>
              <col className="matrix-col-side" />
              {columnSummaries.map((summary) => (
                <col key={`${card.leagueName}-col-${summary.minuteSlot}`} className="matrix-col-slot" />
              ))}
              <col className="matrix-col-rate" />
              <col className="matrix-col-total" />
              <col className="matrix-col-total" />
            </colgroup>
            <thead>
              <tr className="matrix-meta-row">
                <th className="matrix-side-head">
                  <span>Hora</span>
                  <span>Minuto</span>
                </th>
                {columnSummaries.map((summary) => {
                  const isSelectedColumn = selectedMinuteSet.has(summary.minuteSlot)
                  return (
                  <th
                    key={`${card.leagueName}-meta-${summary.minuteSlot}`}
                    className={`matrix-column-meta ${isSelectedColumn ? 'is-column-selected' : hasSelectedColumns ? 'is-column-muted' : ''}`}
                  >
                    <strong className={getMetricTone(summary.rate)}>
                      {summary.total ? percentageFormatter.format(summary.rate) : '--'}
                    </strong>
                    <small>{summary.greens}</small>
                  </th>
                  )
                })}
                <th className="matrix-summary-head">%</th>
                <th className="matrix-summary-head">Greens</th>
                <th className="matrix-summary-head">Total</th>
              </tr>
              <tr className="matrix-minute-row">
                <th className="matrix-side-subhead" />
                {columnSummaries.map((summary) => {
                  const isSelectedColumn = selectedMinuteSet.has(summary.minuteSlot)
                  return (
                  <th
                    key={`${card.leagueName}-minute-${summary.minuteSlot}`}
                    className={isSelectedColumn ? 'is-column-selected' : hasSelectedColumns ? 'is-column-muted' : ''}
                  >
                    <button
                      type="button"
                      className={`matrix-minute-button ${isSelectedColumn ? 'active' : ''}`}
                      aria-label={`Selecionar coluna ${String(summary.minuteSlot).padStart(2, '0')}`}
                      aria-pressed={isSelectedColumn}
                      onClick={() => toggleSelectedMinuteSlot(summary.minuteSlot)}
                    >
                      {String(summary.minuteSlot).padStart(2, '0')}
                    </button>
                  </th>
                  )
                })}
                <th />
                <th />
                <th />
              </tr>
              {hasSelectedColumns && (
                <tr className="matrix-selected-row">
                  <th className="matrix-selected-clear-cell">
                    <button type="button" onClick={() => setSelectedMinuteSlots([])}>
                      Limpar
                    </button>
                  </th>
                  {selectedColumnSegments.map((segment, segmentIndex) => (
                    <th
                      key={`${card.leagueName}-selected-${segment.key}-${segmentIndex}`}
                      colSpan={segment.colSpan}
                      className={segment.selected ? 'matrix-selected-rate-cell' : 'matrix-selected-empty-cell'}
                    >
                      {segment.selected && (
                        <span className="matrix-selected-rate-badge">
                          {selectedColumnStats.total ? formatSelectedColumnRate(selectedColumnRate) : '--'}
                        </span>
                      )}
                    </th>
                  ))}
                  <th colSpan={3} className="matrix-selected-total-cell">
                    {selectedColumnStats.greens}/{selectedColumnStats.total}
                  </th>
                </tr>
              )}
            </thead>

            <tbody>
              {card.rows.map((row, rowIndex) => (
                (() => {
                  const rowLabel = formatMatrixRowLabel(row.hourLabel, row.hour)
                  return (
                    <tr
                      key={`${card.leagueName}-matrix-row-${rowIndex}`}
                      className={toggleState.showTeams ? 'matrix-teams-row' : undefined}
                    >
                      <th className="matrix-row-head">
                        <span className={`matrix-row-label ${rowLabel.secondary ? 'has-secondary' : ''}`}>
                          <span className="matrix-row-time">{rowLabel.primary}</span>
                          {rowLabel.secondary && <span className="matrix-row-date">{rowLabel.secondary}</span>}
                        </span>
                      </th>
                      {row.cells.map((cell) => {
                    const latestRaw = cell.latest as MatchRecord | undefined
                    const latest = hasStatusRecord(latestRaw) ? latestRaw : undefined
                    const isFinished = isFinishedRecord(latest)
                    const upcoming = cell.upcoming ?? (latest && !isFinished ? latest : undefined)
                    const isProjectedUpcoming = Boolean(cell.isProjectedUpcoming)
                    const hasPendingProjection = Boolean(upcoming || isProjectedUpcoming)
                    const displayRecord = upcoming ?? latest
                    const resultTone =
                      latest && isFinished && usesResultPalette(filters.market)
                        ? getResultTone(latest, filters.market)
                        : null
                    const outcomeMarketState =
                      latest && isFinished
                        ? getOutcomeMarketState(latest, filters.market)
                        : null
                    const exactScoreState =
                      latest && isFinished && isExactScoreMarket(filters.market)
                        ? matchesExactScoreMarket(latest, filters.market)
                          ? 'is-exact-score-hit'
                          : 'is-exact-score-miss'
                        : null
                    const cellState =
                      !displayRecord && !hasPendingProjection
                        ? 'is-empty'
                        : hasPendingProjection
                          ? 'is-pending'
                          : exactScoreState ?? outcomeMarketState ?? resultTone ?? (cell.greenRate >= 0.5 ? 'is-green' : 'is-red')
                    const markerKey = getMatrixCellMarkerGroupKey(cell, scoreDisplayTimeMode)
                    const markerTone = selectedCellMarkerMap[markerKey]
                    const isSelected = Boolean(markerTone)
                    const isCombinedTimeMode = scoreDisplayTimeMode === 'FT + HT'
                    const oddSequenceMarkets = filters.oddSequence ?? []
                    const shouldShowOddSequence = oddSequenceMarkets.length > 0
                    const shouldShowCellOdd = !shouldShowOddSequence && filters.oddsView !== 'Selecione as Odds'
                    const shouldShowCellOddDetails = shouldShowOddSequence || shouldShowCellOdd
                    const isMaximaHighlight = Boolean(
                      toggleState.showMaxima && highlightedMaximaSet.has(`${cell.hour}-${cell.minuteSlot}`),
                    )
                    const isNextRankingDual = toggleState.nextRanking && upcoming && nextRankingDualSet.has(upcoming.id)
                    const isNextRanking = toggleState.nextRanking && upcoming && nextRankingSet.has(upcoming.id) && !isNextRankingDual
                    const isPayingSlot = payingHourSlots.has(cell.minuteSlot)
                    const isColumnSelected = selectedMinuteSet.has(cell.minuteSlot)
                    const columnSelectionClass = isColumnSelected
                      ? 'is-column-selected'
                      : hasSelectedColumns
                        ? 'is-column-muted'
                        : ''
                    const cellMatchLabel = displayRecord ? `${displayRecord.homeTeam} x ${displayRecord.awayTeam}` : ''
                    const cellOddValue = shouldShowCellOdd
                      ? getMatrixCellOddValue(cell, filters.oddsView, displayRecord)
                      : null
                    const cellOddLabel = shouldShowCellOdd
                      ? formatMatrixCellOddValue(cellOddValue)
                      : null
                    const cellOddDisplayLabel = shouldShowCellOdd && cellOddLabel && cellOddLabel !== '-'
                      ? `@${cellOddLabel}`
                      : cellOddLabel
                    const cellOddContent = shouldShowOddSequence
                      ? displayRecord
                        ? renderMatrixOddSequence(displayRecord, cell.odds, oddSequenceMarkets, activeSelectedOddLine, toggleSelectedOddLine)
                        : <span className="cell-odd-value">-</span>
                      : <span className={`cell-odd-value ${shouldShowCellOdd && cellOddDisplayLabel !== '-' ? 'is-prefixed' : ''}`}>{cellOddDisplayLabel}</span>
                    const isSelectedOddMatch = Boolean(
                      shouldShowOddSequence &&
                        activeSelectedOddLine &&
                        displayRecord &&
                        formatMatrixSequenceOddValue(
                          getMatrixCellOddValue(cell, activeSelectedOddLine.market, displayRecord),
                        ) === activeSelectedOddLine.value,
                    )
                    const oddSelectionClass = activeSelectedOddLine && shouldShowOddSequence
                      ? isSelectedOddMatch
                        ? 'is-odd-search-match'
                        : 'is-odd-search-muted'
                      : ''
                    const payingStateClass = !toggleState.payingHours || isNextRanking || isNextRankingDual
                      ? ''
                      : isPayingSlot
                        ? 'is-paying-visible'
                        : 'is-paying-muted'
                    const cellAssistiveLabel =
                      displayRecord
                        ? `${cellMatchLabel}${upcoming ? '' : ` | ${scoreForTime(latest ?? displayRecord, scoreDisplayTimeMode)}`} | ${percentageFormatter.format(cell.greenRate)}`
                        : isProjectedUpcoming
                          ? `Proximo horario ${String(cell.hour).padStart(2, '0')}:${String(cell.minuteSlot).padStart(2, '0')}`
                          : 'Sem leitura'
                    const selectionStyle = markerTone
                      ? ({
                          '--cell-callout-bg': markerTone.calloutBackground,
                          '--cell-callout-fg': markerTone.calloutForeground,
                          '--cell-marker-bg': markerTone.background,
                          '--cell-marker-color': markerTone.accent,
                          '--cell-marker-fg': markerTone.foreground,
                          '--cell-marker-ring': markerTone.ring,
                        } as CSSProperties)
                      : undefined

                    return (
                      <td key={`${card.leagueName}-${cell.hour}-${cell.minuteSlot}`}>
                        <button
                          type="button"
                          className={`matrix-cell reference ${toggleState.showTeams && displayRecord ? 'is-teams' : ''} ${shouldShowOddSequence ? 'has-odd-sequence' : ''} ${cellState} ${isMaximaHighlight ? 'is-maxima-highlight' : ''} ${isNextRanking ? 'is-next-ranking' : ''} ${isNextRankingDual ? 'is-next-ranking-double' : ''} ${payingStateClass} ${columnSelectionClass} ${oddSelectionClass} ${isSelected ? 'selected' : ''}`}
                          aria-label={cellAssistiveLabel}
                          aria-pressed={isSelected}
                          onClick={() => onCellClick(cell, scoreDisplayTimeMode)}
                          style={selectionStyle}
                        >
                          <span className={`cell-main ${toggleState.showTeams && displayRecord ? 'is-teams' : ''} ${shouldShowCellOddDetails ? 'has-odd' : ''} ${shouldShowOddSequence ? 'has-odd-sequence' : ''} ${isCombinedTimeMode ? 'has-split-score' : ''}`}>
                            {displayRecord
                              ? toggleState.showTeams
                                ? (
                                  <span className={`cell-team-result-stack ${shouldShowCellOddDetails ? 'has-odd' : ''} ${shouldShowOddSequence ? 'has-odd-sequence has-fixed-score-slot' : ''} ${isCombinedTimeMode ? 'has-split-score' : ''}`} aria-label={`${displayRecord.homeTeam} x ${displayRecord.awayTeam}`}>
                                    {shouldShowOddSequence ? (
                                      <span
                                        className={`cell-fixed-score-slot ${!upcoming && isFinished && latest ? 'has-value' : 'is-empty'}`}
                                        aria-hidden={!(!upcoming && isFinished && latest)}
                                      >
                                        {!upcoming && isFinished && latest
                                          ? renderMatrixScoreValue(latest, scoreDisplayTimeMode)
                                          : <span className="cell-score-placeholder">00-00</span>}
                                      </span>
                                    ) : (
                                      !upcoming && isFinished && latest && (
                                        renderMatrixScoreValue(latest, scoreDisplayTimeMode)
                                      )
                                    )}
                                    <span
                                      className={`cell-team-stack ${cellState === 'is-result-black' ? 'is-light' : 'is-dark'} ${upcoming ? 'is-pending' : ''}`}
                                    >
                                      <span className="cell-team-name">{displayRecord.homeTeam}</span>
                                      <span className="cell-team-vs">x</span>
                                      <span className="cell-team-name">{displayRecord.awayTeam}</span>
                                    </span>
                                    {shouldShowCellOddDetails && cellOddContent}
                                  </span>
                                )
                                : shouldShowCellOddDetails
                                  ? (
                                    <span className={`cell-score-odd-stack ${shouldShowOddSequence ? 'has-odd-sequence' : ''} ${isCombinedTimeMode ? 'has-split-score' : ''} ${upcoming ? 'is-odd-only' : ''}`}>
                                      {!upcoming && (
                                        <span className="cell-primary-value">
                                          {isFinished && latest
                                            ? renderMatrixScoreValue(latest, scoreDisplayTimeMode)
                                            : <span className="cell-ball" aria-label="Jogo pendente" />}
                                        </span>
                                      )}
                                      {cellOddContent}
                                    </span>
                                  )
                                  : !upcoming && isFinished && latest
                                    ? renderMatrixScoreValue(latest, scoreDisplayTimeMode)
                                    : <span className="cell-ball" aria-label="Jogo pendente" />
                              : shouldShowCellOddDetails
                                ? (
                                  <span className={`cell-score-odd-stack ${shouldShowOddSequence ? 'has-odd-sequence' : ''}`}>
                                    <span className="cell-primary-value">
                                      {isProjectedUpcoming
                                        ? <span className="cell-ball" aria-label="Jogo pendente" />
                                        : '-'}
                                    </span>
                                    {cellOddContent}
                                  </span>
                                )
                                : isProjectedUpcoming
                                  ? <span className="cell-ball" aria-label="Jogo pendente" />
                                  : '-'}
                          </span>
                          {cellMatchLabel && (!toggleState.showTeams || shouldShowOddSequence) && (
                            <span className="matrix-cell-callout" aria-hidden="true">
                              {cellMatchLabel}
                            </span>
                          )}

                        </button>
                      </td>
                    )
                      })}
                      <td className={`matrix-summary ${getMetricTone(row.greenRate)}`}>
                        {row.total ? percentageFormatter.format(row.greenRate) : '--'}
                      </td>
                      <td className="matrix-summary">{row.greens}</td>
                      <td className="matrix-summary">{row.total ? row.goals : '--'}</td>
                    </tr>
                  )
                })()
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="analysis-footer-actions">
        <div className="analysis-footer-button-row">
          <button
            type="button"
            className={`analysis-footer-button ${activeFooterTab === 'detailCells' ? 'active' : ''}`}
            onClick={() => openFooterTab('detailCells')}
          >
            Modo Trader
          </button>
          <button
            type="button"
            className={`analysis-footer-button ${activeFooterTab === 'altReading' ? 'active' : ''}`}
            onClick={() => openFooterTab('altReading')}
          >
            Tendencia
          </button>
          <button
            type="button"
            className={`analysis-footer-button ${activeFooterTab === 'showMaxima' ? 'active' : ''}`}
            onClick={() => openFooterTab('showMaxima')}
          >
            Maxima
          </button>
          <button
            type="button"
            className={`analysis-footer-button ${activeFooterTab === 'showRanking' ? 'active' : ''}`}
            onClick={() => openFooterTab('showRanking')}
          >
            Ranking
          </button>
          <button
            type="button"
            className={`analysis-footer-button ${activeFooterTab === 'showNextGames' ? 'active' : ''}`}
            onClick={() => openFooterTab('showNextGames')}
          >
            Próximos Jogos
          </button>
          <button
            type="button"
            className={`analysis-footer-button ${activeFooterTab === 'showMartingale' ? 'active' : ''}`}
            onClick={() => openFooterTab('showMartingale')}
          >
            Calculadora Martingale
          </button>
        </div>

        {toggleState.detailCells && (
          <div className="analysis-footer-trader">
            <TraderPanel
              currentMarket={filters.market}
              oddBand={filters.oddBand}
              platform={filters.platform}
              records={card.traderRecords}
            />
          </div>
        )}

        {toggleState.altReading && (
          <div className="analysis-footer-tendency">
            <TrendPanel records={card.traderRecords} />
          </div>
        )}

        {toggleState.showMaxima && (
          <div className="analysis-footer-maxima">
            <MaximaPanel onHighlightChange={setHighlightedMaximaSlots} records={card.traderRecords} />
          </div>
        )}

        {toggleState.showRanking && (
          <div className="analysis-footer-ranking">
            <RankingPanel
              limit={nextRankingLimit}
              market={filters.market}
              onLimitChange={setNextRankingLimit}
              onScopeChange={setNextRankingScope}
              records={card.rankingRecords}
              scope={nextRankingScope}
            />
          </div>
        )}

        {toggleState.showNextGames && (
          <div className="analysis-footer-next-games">
            <NextGamesPanel
              card={card}
              historyPeriod={nextGamesPeriod}
              platform={filters.platform}
              onChangeHistoryPeriod={onChangeNextGamesPeriod}
            />
          </div>
        )}

        {toggleState.showMartingale && (
          <div className="analysis-footer-martingale">
            <MartingaleCalculatorPanel />
          </div>
        )}

      </div>
    </article>
  )
}

export function AnalysisPage({
  cards,
  dataSourceError,
  leagueOptions,
  platform,
  selectedLeague,
  onSelectLeague,
  onPrefetchLeague,
  onChangeCardFilters,
  onResetFilters,
  onChangeNextGamesPeriod,
  selectedCell,
  selectedCellMarkerMap,
  onCellClick,
  getNextGamesPeriod,
  getToggleState,
  toggleFlag,
}: AnalysisPageProps) {
  const quickLeagueOrder = useMemo(
    () => quickLeagueOrderByPlatform[platform] ?? [],
    [platform],
  )
  const quickLeagueNames = useMemo(
    () =>
      [...leagueOptions].sort((left, right) => {
        const leftLabel = getQuickLeagueLabel(left)
        const rightLabel = getQuickLeagueLabel(right)
        const leftOrder = quickLeagueOrder.indexOf(leftLabel)
        const rightOrder = quickLeagueOrder.indexOf(rightLabel)
        const safeLeftOrder = leftOrder === -1 ? Number.MAX_SAFE_INTEGER : leftOrder
        const safeRightOrder = rightOrder === -1 ? Number.MAX_SAFE_INTEGER : rightOrder

        if (safeLeftOrder !== safeRightOrder) {
          return safeLeftOrder - safeRightOrder
        }

        return leftLabel.localeCompare(rightLabel)
      }),
    [leagueOptions, quickLeagueOrder],
  )
  const resolvedSelectedLeague = quickLeagueNames.includes(selectedLeague)
    ? selectedLeague
    : quickLeagueNames[0] ?? selectedLeague
  const visibleCards = cards.filter((card) => card.leagueName === resolvedSelectedLeague)
  const handleQuickLeagueSelect = (leagueName: string) => {
    if (leagueName === resolvedSelectedLeague) return
    handleQuickLeaguePrefetch(leagueName)
    onSelectLeague(leagueName)
  }
  const handleQuickLeaguePrefetch = (leagueName: string) => {
    if (leagueName === resolvedSelectedLeague) return
    onPrefetchLeague?.(leagueName)
  }

  return (
    <section className="analysis-page">
      <div className="analysis-page-title">
        <h1>
          Futebol Virtual - <span>{getPlatformLabel(platform)}</span>
        </h1>
      </div>

      {dataSourceError && cards.length === 0 && (
        <div className="analysis-odds-warning" role="status">
          <span>Sem dados dessa liga agora.</span>
        </div>
      )}

      {quickLeagueNames.length > 1 && (
        <section className="analysis-quick-leagues" aria-label="Escolha rapida de ligas">
          <div className="analysis-quick-leagues-header">
            <span className="analysis-quick-leagues-eyebrow">Ligas</span>
            <strong>Selecione uma liga para carregar a matriz em foco</strong>
          </div>
          <div className="analysis-quick-leagues-grid">
            {quickLeagueNames.map((leagueName) => {
              const isActive = resolvedSelectedLeague === leagueName

              return (
                <button
                  key={`quick-league-${leagueName}`}
                  type="button"
                  className={`analysis-quick-league-button ${isActive ? 'is-active' : ''}`}
                  onPointerDown={() => handleQuickLeaguePrefetch(leagueName)}
                  onMouseEnter={() => handleQuickLeaguePrefetch(leagueName)}
                  onFocus={() => handleQuickLeaguePrefetch(leagueName)}
                  onTouchStart={() => handleQuickLeaguePrefetch(leagueName)}
                  onClick={() => handleQuickLeagueSelect(leagueName)}
                  aria-pressed={isActive}
                >
                  <span>{getQuickLeagueLabel(leagueName)}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <div className="analysis-card-list">
        {visibleCards.map((card) => (
          <div key={card.leagueName} className="analysis-card-anchor" data-league-name={card.leagueName}>
            <AnalysisCard
              card={card}
              filters={card.filters}
              nextGamesPeriod={getNextGamesPeriod(card.leagueName)}
              onChangeFilters={(next) => onChangeCardFilters(card.leagueName, next)}
              onResetFilters={onResetFilters}
              onChangeNextGamesPeriod={(next) => onChangeNextGamesPeriod(card.leagueName, next)}
              selectedCell={selectedCell}
              selectedCellMarkerMap={selectedCellMarkerMap}
              onCellClick={onCellClick}
              toggleFlag={(key) => toggleFlag(card.leagueName, key)}
              toggleState={getToggleState(card.leagueName)}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
