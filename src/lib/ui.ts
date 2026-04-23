import { bbtipsLeagueCatalog as leagueCatalog } from '../data/bbtipsCatalog'
import { marketOptions, rankingTabs } from '../data/staticData'
import { getPlatformLabel } from './platformLabel'
import type {
  Bot,
  BotDraft,
  FiltersState,
  HistoryView,
  Market,
  MatchRecord,
  MatrixCell,
  OddBand,
  Page,
  Period,
  RankingRow,
  TimeMode,
  ToggleKey,
} from '../types'

export const allLeaguesLabel = 'Todos'
export const botStorageKey = 'tigger-analytics-bots'
export const toggleStorageKey = 'tigger-analytics-toggles-v2'
export const toggleTouchedStorageKey = 'tigger-analytics-toggles-touched-v2'
export const leagueToggleStorageKey = 'tigger-analytics-league-toggles-v1'
export const defaultCellGreenColor = '#008235'
export const defaultCellRedColor = '#c10007'

export const pageLabels: Record<Page, string> = {
  capture: 'Captacao',
  login: 'Login',
  analysis: 'Analise',
  history: 'Historico',
  bots: 'Bots',
  ranking: 'Ranking',
  alerts: 'Alertas',
  account: 'Conta',
  plans: 'Planos',
  admin: 'Admin',
}

export const primaryPages: Page[] = ['analysis', 'history', 'bots', 'ranking', 'alerts']
export const supportPages: Page[] = ['account', 'plans', 'admin']
export const historyViews: HistoryView[] = ['Tabela', 'Timeline', 'Liga', 'Sequencia']
export const densityModes = ['Compacta', 'Confortavel'] as const
export { rankingTabs }

export const periodMsMap: Record<Period, number> = {
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '18h': 18 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '36h': 36 * 60 * 60 * 1000,
  '48h': 48 * 60 * 60 * 1000,
  '60h': 60 * 60 * 60 * 1000,
  '72h': 72 * 60 * 60 * 1000,
  '96h': 96 * 60 * 60 * 1000,
  '120h': 120 * 60 * 60 * 1000,
  '144h': 144 * 60 * 60 * 1000,
  '168h': 168 * 60 * 60 * 1000,
  '192h': 192 * 60 * 60 * 1000,
  '216h': 216 * 60 * 60 * 1000,
  '240h': 240 * 60 * 60 * 1000,
}
export const marketLabelMap: Record<string, string> = {
  'Ambas Marcam Sim': 'Ambas Marcam Sim',
  'Ambas Marcam Não': 'Ambas Marcam Não',
  'Resultado final': 'Resultado final',
  'Resultado HT': 'Resultado HT',
  'Casa vence': 'Casa vence',
  'Casa vence HT': 'Casa vence HT',
  Empate: 'Empate',
  'Empate HT': 'Empate HT',
  'Fora vence': 'Fora vence',
  'Fora vence HT': 'Fora vence HT',
}

export const periodLabelMap: Record<Period, string> = {
  '6h': '6 horas',
  '12h': '12 horas',
  '18h': '18 horas',
  '24h': '24 horas',
  '36h': '36 horas',
  '48h': '48 horas',
  '60h': '60 horas',
  '72h': '72 horas',
  '96h': '96 horas',
  '120h': '120 horas',
  '144h': '144 horas',
  '168h': '168 horas',
  '192h': '192 horas',
  '216h': '216 horas',
  '240h': '240 horas',
}
export const percentageFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 0,
})

export const numericFormatter = new Intl.NumberFormat('pt-BR')
export const stampFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
export const shortDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
})

export const createInitialToggles = (): Record<ToggleKey, boolean> => ({
  showTeams: false,
  showMaxima: false,
  showRanking: false,
  showVideo: false,
  nextRanking: false,
  showNextGames: false,
  showMartingale: false,
  payingHours: false,
  altReading: false,
  detailCells: false,
})

export const oddMatchesBand = (value: number | null | undefined, band: OddBand) => {
  if (band === 'Selecione as Odds') return true
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (band === '1.20 - 1.59') return value >= 1.2 && value <= 1.59
  if (band === '1.60 - 1.99') return value >= 1.6 && value <= 1.99
  if (band === '2.00+') return value >= 2
  return true
}

export const formatOddValue = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value.toFixed(2) : '--'

const exactScoreMarketPattern = /^\d+x\d+$/i
const threeWayOutcomeMarkets = new Set<Market>(['Casa vence', 'Empate', 'Fora vence'])

const parseScorePair = (score: string) => {
  const [home, away] = score.split(/[x-]/i).map(Number)

  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return null
  }

  return { away, home }
}

export const resolveMarketTimeMode = (market: Market, timeMode: TimeMode): TimeMode => {
  if (market === 'Resultado HT') return 'HT'
  if (market === 'Resultado final' || exactScoreMarketPattern.test(market)) return 'FT'
  if (threeWayOutcomeMarkets.has(market)) return timeMode === 'HT' ? 'HT' : 'FT'
  return timeMode
}

export const getMarketResult = (record: MatchRecord, market: Market, timeMode: TimeMode) => {
  const resolvedTimeMode = resolveMarketTimeMode(market, timeMode)

  if (market === 'Resultado HT' || market === 'Resultado final' || threeWayOutcomeMarkets.has(market)) {
    const parsed = parseScorePair(resolvedTimeMode === 'HT' ? record.scoreHT : record.scoreFT)
    if (!parsed) return false

    if (market === 'Empate') return parsed.home === parsed.away
    if (market === 'Fora vence') return parsed.home < parsed.away
    return parsed.home > parsed.away
  }

  return Boolean(record.marketResults[market])
}

export const scoreForTime = (record: MatchRecord, timeMode: TimeMode) =>
  timeMode === 'HT'
    ? record.scoreHT
    : timeMode === 'FT + HT'
      ? `${record.scoreFT} | ${record.scoreHT}`
      : record.scoreFT

export const shortTeam = (team: string) => team.slice(0, 3).toUpperCase()

export const formatHour = (hour: number, minute = 0) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

export interface MatrixCellMarkerTone {
  id: string
  accent: string
  background: string
  foreground: string
  ring: string
  calloutBackground: string
  calloutForeground: string
}

const normalizeMatrixCellStatus = (value: string) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const matrixCellPendingTokens = [
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

const isFinishedMatrixCellRecord = (record: MatchRecord | undefined) =>
  Boolean(
    record &&
      normalizeMatrixCellStatus(record.status).length > 0 &&
      !matrixCellPendingTokens.some((token) => normalizeMatrixCellStatus(record.status).includes(token)),
  )

const createMatrixCellMarkerTone = (
  id: string,
  accent: string,
  background: string,
  foreground: string,
  ring: string,
  calloutBackground: string,
  calloutForeground: string,
): MatrixCellMarkerTone => ({
  accent,
  background,
  calloutBackground,
  calloutForeground,
  foreground,
  id,
  ring,
})

const matrixCellMarkerTones: MatrixCellMarkerTone[] = [
  createMatrixCellMarkerTone('yellow', '#f5d74f', '#f5d74f', '#10151c', '#f5d74f', '#ffffff', '#1b2028'),
  createMatrixCellMarkerTone('blue', '#2454ff', '#2454ff', '#ffffff', '#2454ff', '#ffffff', '#1b2028'),
  createMatrixCellMarkerTone('magenta', '#e044c6', '#e044c6', '#ffffff', '#e044c6', '#ffffff', '#1b2028'),
  createMatrixCellMarkerTone('white', '#f3f3f0', '#f3f3f0', '#11151b', '#f3f3f0', '#ffffff', '#1b2028'),
  createMatrixCellMarkerTone('cyan', '#56d8ee', '#56d8ee', '#06151b', '#56d8ee', '#ffffff', '#1b2028'),
  createMatrixCellMarkerTone('brown', '#8b4b1d', '#8b4b1d', '#ffffff', '#8b4b1d', '#ffffff', '#1b2028'),
  createMatrixCellMarkerTone('purple', '#7b35d8', '#7b35d8', '#ffffff', '#7b35d8', '#ffffff', '#1b2028'),
  createMatrixCellMarkerTone('mint', '#35d68f', '#35d68f', '#061b12', '#35d68f', '#ffffff', '#1b2028'),
  createMatrixCellMarkerTone('coral', '#f05b4f', '#f05b4f', '#ffffff', '#f05b4f', '#ffffff', '#1b2028'),
  createMatrixCellMarkerTone('slate', '#7d8da2', '#7d8da2', '#0b121b', '#7d8da2', '#ffffff', '#1b2028'),
  createMatrixCellMarkerTone('orange', '#ff9f1a', '#ff9f1a', '#10151c', '#ff9f1a', '#ffffff', '#1b2028'),
  createMatrixCellMarkerTone('lime', '#b7ec3c', '#b7ec3c', '#101b05', '#b7ec3c', '#ffffff', '#1b2028'),
  createMatrixCellMarkerTone('rose', '#ff6e96', '#ff6e96', '#2c0610', '#ff6e96', '#ffffff', '#1b2028'),
  createMatrixCellMarkerTone('indigo', '#4f58c8', '#4f58c8', '#ffffff', '#4f58c8', '#ffffff', '#1b2028'),
  createMatrixCellMarkerTone('teal', '#008f99', '#008f99', '#ffffff', '#008f99', '#ffffff', '#1b2028'),
  createMatrixCellMarkerTone('gold', '#c69b00', '#c69b00', '#10151c', '#c69b00', '#ffffff', '#1b2028'),
]

const buildGeneratedMatrixCellMarkerTone = (index: number): MatrixCellMarkerTone => {
  const hueSequence = [52, 230, 310, 185, 270, 25, 145, 350, 210, 95, 15, 250, 165, 330, 75, 285]
  const cycle = Math.floor(index / hueSequence.length)
  const hue = (hueSequence[index % hueSequence.length] + cycle * 17) % 360
  const accentLightness = cycle % 2 === 0 ? 52 : 44
  const backgroundLightness = cycle % 2 === 0 ? 54 : 46
  const calloutLightness = Math.min(backgroundLightness + 8, 92)
  const useDarkForeground = backgroundLightness > 50 && hue >= 35 && hue <= 190

  return createMatrixCellMarkerTone(
    `generated-${index}`,
    `hsl(${hue}, 88%, ${accentLightness}%)`,
    `hsl(${hue}, 88%, ${backgroundLightness}%)`,
    useDarkForeground ? '#10151c' : '#ffffff',
    `hsl(${hue}, 88%, ${accentLightness}%)`,
    `hsl(${hue}, 96%, ${calloutLightness}%)`,
    '#1b2028',
  )
}

export const resolveMatrixCellMarkerTone = (toneId: string) => {
  const fixedTone = matrixCellMarkerTones.find((tone) => tone.id === toneId)
  if (fixedTone) return fixedTone

  const generatedIndex = /^generated-(\d+)$/.exec(toneId)?.[1]
  return generatedIndex ? buildGeneratedMatrixCellMarkerTone(Number(generatedIndex)) : undefined
}

export const getMatrixCellKey = (cell: MatrixCell) => {
  const primaryRecord = cell.upcoming ?? cell.latest
  return [
    primaryRecord?.league ?? 'sem-liga',
    cell.hour,
    cell.minuteSlot,
    primaryRecord?.id ?? 'sem-jogo',
  ].join('::')
}

export const getMatrixCellMarkerGroupKey = (cell: MatrixCell, timeMode: TimeMode) => {
  const latest = cell.latest

  if (latest && isFinishedMatrixCellRecord(latest)) {
    return `result::${timeMode}::${scoreForTime(latest, timeMode)}`
  }

  const primaryRecord = cell.upcoming ?? latest
  if (primaryRecord) {
    return `match::${primaryRecord.league}::${primaryRecord.id}`
  }

  return `slot::${cell.hour}::${cell.minuteSlot}`
}

export const pickNextMatrixCellMarkerTone = (usedToneIds: string[]) =>
  matrixCellMarkerTones.find((tone) => !usedToneIds.includes(tone.id)) ??
  buildGeneratedMatrixCellMarkerTone(usedToneIds.length)

export const createDraftFromBot = (bot: Bot): BotDraft => ({
  name: bot.name,
  description: bot.description,
  platform: bot.platform,
  league: bot.league,
  market: bot.market,
  period: bot.period,
  criteria: bot.criteria.join(', '),
  status: bot.status,
  priority: bot.priority,
})

export const createDraftFromFilters = (filters: FiltersState): BotDraft => ({
  name: `${getPlatformLabel(filters.platform)} ${filters.league} ${filters.market}`,
  description: 'Bot criado a partir da leitura atual.',
  platform: filters.platform,
  league: filters.league,
  market: filters.market,
  period: filters.period,
  criteria: ['Filtro atual', filters.oddBand, filters.timeMode].join(', '),
  status: 'Ativo',
  priority: 'Media',
})

export const buildCriteriaList = (draft: BotDraft) =>
  draft.criteria
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

export const groupBy = <T,>(items: T[], keyBuilder: (item: T) => string) => {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyBuilder(item)
    const bucket = map.get(key)
    if (bucket) {
      bucket.push(item)
    } else {
      map.set(key, [item])
    }
  }
  return map
}

export const resolveLeagueMeta = (leagueName: string) =>
  leagueCatalog.find((league) => league.name === leagueName)

export const buildMarketRankingRows = (records: MatchRecord[]): RankingRow[] =>
  marketOptions
    .map((market) => {
      const greens = records.filter((record) => record.marketResults[market]).length
      return {
        id: `market-${market}`,
        label: market,
        secondary: `${records[0]?.platform ?? 'Painel'} | ${records.length} leituras`,
        rate: records.length ? greens / records.length : 0,
        greens,
        total: records.length,
        image: '/images/history-tunnel.png',
      }
    })
    .sort((left, right) => {
      if (right.rate !== left.rate) return right.rate - left.rate
      return right.total - left.total
    })


