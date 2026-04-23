export type Page =
  | 'capture'
  | 'login'
  | 'analysis'
  | 'history'
  | 'bots'
  | 'ranking'
  | 'alerts'
  | 'account'
  | 'plans'
  | 'admin'

export type Platform = 'Betano' | 'Bet365' | 'Express 365' | 'PlayPix'
export type NotificationChannel = 'WhatsApp' | 'Telegram'
export type TimeMode = 'FT' | 'HT' | 'FT + HT'
/** Janela "Ultimas horas" (max. 240h para nao pesar a UI). */
export type Period =
  | '6h'
  | '12h'
  | '18h'
  | '24h'
  | '36h'
  | '48h'
  | '60h'
  | '72h'
  | '96h'
  | '120h'
  | '144h'
  | '168h'
  | '192h'
  | '216h'
  | '240h'

export type Market = string

export type OddBand = string
export type OddDisplayOption = 'Selecione as Odds' | Market

export type ToggleKey =
  | 'showTeams'
  | 'showMaxima'
  | 'showRanking'
  | 'showVideo'
  | 'nextRanking'
  | 'showNextGames'
  | 'showMartingale'
  | 'payingHours'
  | 'altReading'
  | 'detailCells'

export type HistoryView = 'Tabela' | 'Timeline' | 'Liga' | 'Sequencia'
export type DensityMode = 'Compacta' | 'Confortavel'
export type RankingTab = 'Ligas' | 'Horarios' | 'Mercados' | 'Sequencias' | 'Cenarios'
export type BotStatus = 'Ativo' | 'Pausado'
export type AlertStatus = 'Ativo' | 'Disparado' | 'Silenciado'
export type Priority = 'Alta' | 'Media' | 'Baixa'

export interface LeagueDefinition {
  name: string
  region: string
  descriptor: string
  image: string
  accent: string
  teams: string[]
}

export interface MatchRecord {
  id: string
  platform: Platform
  league: string
  leagueSub?: string
  timestamp: number
  hour: number
  minuteSlot: number
  round: number
  status: string
  homeTeam: string
  awayTeam: string
  scoreHT: string
  scoreFT: string
  odds: Record<Market, number | null>
  marketResults: Record<Market, boolean>
  sequencePattern: string
  tendency: string
  tags: string[]
  videoAvailable: boolean
  streamUrl?: string
  leagueImage: string
}

export interface MatrixCell {
  hour: number
  minuteSlot: number
  greens: number
  goals: number
  total: number
  greenRate: number
  isProjectedUpcoming?: boolean
  averageOdd?: number | null
  odds?: Record<Market, number | null>
  latest?: MatchRecord
  upcoming?: MatchRecord
}

export interface Bot {
  id: string
  name: string
  description: string
  platform: Platform
  league: string
  market: Market
  period: Period
  criteria: string[]
  status: BotStatus
  priority: Priority
  createdAt: number
  updatedAt: number
}

export interface AlertItem {
  id: string
  name: string
  criterion: string
  origin: string
  timestamp: number
  status: AlertStatus
  linkedBot?: string
}

export interface Plan {
  id: 'Free' | 'Pro' | 'Premium'
  price: string
  botsLimit: number
  savedFilters: number
  historyDepth: string
  rankingAccess: string
  alertsAccess: string
  highlight?: boolean
}

export interface ProfileSummary {
  name: string
  email: string
  currentPlan: Plan['id']
  favoritePlatform: Platform
}

export interface RankingRow {
  id: string
  label: string
  secondary: string
  rate: number
  greens: number
  total: number
  image: string
}

export interface FiltersState {
  platform: Platform
  league: string
  timeMode: TimeMode
  market: Market
  oddBand: OddBand
  oddsView: OddDisplayOption
  oddSequence: Market[]
  period: Period
  greenColor: string
  redColor: string
}

export interface BotDraft {
  name: string
  description: string
  platform: Platform
  league: string
  market: Market
  period: Period
  criteria: string
  status: BotStatus
  priority: Priority
}
