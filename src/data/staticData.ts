import type {
  AlertItem,
  Bot,
  Market,
  OddBand,
  OddDisplayOption,
  Period,
  Plan,
  Platform,
  ProfileSummary,
  RankingTab,
  TimeMode,
  ToggleKey,
} from '../types'

const baseTimestamp = new Date('2026-04-12T19:55:00').getTime()
const dayMs = 24 * 60 * 60 * 1000
const hourMs = 60 * 60 * 1000
const minuteMs = 60 * 1000

export const platformOptions: Platform[] = ['Betano', 'Bet365', 'Express 365']
export const virtualPlatformOptions: Platform[] = [...platformOptions, 'PlayPix']
export const timeModeOptions: TimeMode[] = ['FT', 'HT', 'FT + HT']

const exactScoreMarkets = Array.from({ length: 9 }, (_, totalGoals) =>
  Array.from({ length: totalGoals + 1 }, (_, home) => `${home}x${totalGoals - home}`),
).flat()

const totalGoalsMarkets = Array.from({ length: 7 }, (_, goals) => `${goals} gols FT`)

export const resultFtMarkets: Market[] = ['Casa vence', 'Empate', 'Fora vence', 'Resultado final']
export const resultHtMarkets: Market[] = ['Resultado HT', 'Casa vence HT', 'Empate HT', 'Fora vence HT']

export const marketGroups: Array<{ label: string; options: Market[] }> = [
  {
    label: 'Over',
    options: ['Over 0.5', 'Over 1.5', 'Over 2.5', 'Over 3.5', 'Over 4.5', 'Over 5.5'],
  },
  {
    label: 'Under',
    options: [
      'Under 0.5',
      'Under 1.5',
      'Under 2.5',
      'Under 3.5',
    ],
  },
  {
    label: 'Ambas',
    options: ['Ambas Marcam Sim', 'Ambas Marcam Não'],
  },
  {
    label: 'Resultado Correto',
    options: exactScoreMarkets,
  },
  {
    label: 'Resultado FT',
    options: resultFtMarkets,
  },
  {
    label: 'Resultado HT',
    options: resultHtMarkets,
  },
  {
    label: 'Gols FT',
    options: totalGoalsMarkets,
  },
  {
    label: 'Extras',
    options: ['Viradinha'],
  },
]

export const marketOptions: Market[] = marketGroups.flatMap((group) => group.options)
export const periodOptions: Period[] = [
  '6h',
  '12h',
  '24h',
  '36h',
  '48h',
  '72h',
  '96h',
  '120h',
]

export const oddGroups: Array<{ label: string; options: OddBand[] }> = [
  {
    label: '',
    options: ['Selecione as Odds', '1.20 - 1.59', '1.60 - 1.99', '2.00+'],
  },
]

export const oddBandOptions: OddBand[] = oddGroups.flatMap((group) => group.options)
const oddDisplayTotalGoalsOptions: Market[] = [
  '0 gols FT',
  '1 gol FT',
  '2 gols FT',
  '3 gols FT',
  '4 gols FT',
  '5 gols FT',
]

export const oddDisplayGroups: Array<{ label: string; options: OddDisplayOption[] }> = [
  {
    label: '',
    options: ['Selecione as Odds'],
  },
  {
    label: 'Over',
    options: ['Over 0.5', 'Over 1.5', 'Over 2.5', 'Over 3.5', 'Over 4.5', 'Over 5.5'],
  },
  {
    label: 'Under',
    options: ['Under 0.5', 'Under 1.5', 'Under 2.5', 'Under 3.5'],
  },
  {
    label: 'Ambas',
    options: ['Ambas Marcam Sim', 'Ambas Marcam Não'],
  },
  {
    label: 'Gols FT',
    options: oddDisplayTotalGoalsOptions,
  },
  {
    label: 'Extras',
    options: ['Viradinha'],
  },
]

export const oddDisplayLabelMap: Record<OddDisplayOption, string> = {
  'Selecione as Odds': 'Selecione as Odds',
  'Ambas Marcam Sim': 'Ambas Marcam Sim',
  'Ambas Marcam Não': 'Ambas Marcam Não',
  'Over 0.5': 'Over 0.5',
  'Over 1.5': 'Over 1.5',
  'Over 2.5': 'Over 2.5',
  'Over 3.5': 'Over 3.5',
  'Over 4.5': 'Over 4.5',
  'Over 5.5': 'Over 5.5',
  'Under 0.5': 'Under 0.5',
  'Under 1.5': 'Under 1.5',
  'Under 2.5': 'Under 2.5',
  'Under 3.5': 'Under 3.5',
  '0 gols FT': '0 gols FT',
  '1 gol FT': '1 gol FT',
  '2 gols FT': '2 gols FT',
  '3 gols FT': '3 gols FT',
  '4 gols FT': '4 gols FT',
  '5 gols FT': '5 gols FT',
  Viradinha: 'Viradinha',
}

/**
 * Todos os mercados do filtro "Odds" (exceto "Selecione"), para preencher OddsByMarket.
 * Inclui Total de Gols 0–5 FT (ge0–ge5), que antes ficavam de fora.
 */
export const bbtipsSupplementOddDisplayMarkets: Market[] = oddDisplayGroups
  .flatMap((group) => group.options)
  .filter((option): option is Market => option !== 'Selecione as Odds')

/** Bet365 / Express 365: menos requisições com filtros externos (evita fechar o navegador). Total de gols pode vir só do pipe. */
export const bbtipsSupplementOddDisplayMarketsLight: Market[] = [
  'Ambas Marcam Não',
  'Over 1.5',
  'Over 2.5',
  'Over 3.5',
  'Under 1.5',
  'Under 2.5',
  'Under 3.5',
  'Viradinha',
]

export const rankingTabs: RankingTab[] = [
  'Ligas',
  'Horarios',
  'Mercados',
  'Sequencias',
  'Cenarios',
]

export const quickToggleOptions: Array<{ key: ToggleKey; label: string }> = [
  { key: 'showTeams', label: 'Ver times' },
  { key: 'showMaxima', label: 'Maxima' },
  { key: 'showVideo', label: 'Ver video' },
  { key: 'nextRanking', label: 'Ranking nos proximos' },
  { key: 'showNextGames', label: 'Proximos jogos' },
  { key: 'showMartingale', label: 'Calculadora Martingale' },
  { key: 'payingHours', label: 'Horas pagantes' },
  { key: 'altReading', label: 'Leitura alternativa' },
  { key: 'detailCells', label: 'Detalhar celulas' },
]

export const initialBots: Bot[] = [
  {
    id: 'bot-01',
    name: 'BTTS Betano manha',
    description: 'Ambas marcam nas ligas mais vivas da Betano durante a manha.',
    platform: 'Betano',
    league: 'British Derbies',
    market: 'Ambas Marcam Sim',
    period: '24h',
    criteria: ['Odd 1.60 - 1.99', 'Faixa 09h-12h', 'Detalhar celulas'],
    status: 'Ativo',
    priority: 'Alta',
    createdAt: baseTimestamp - 8 * dayMs,
    updatedAt: baseTimestamp - 1 * dayMs,
  },
  {
    id: 'bot-02',
    name: 'Over 2.5 Bet365 tarde',
    description: 'Leitura de over nas janelas mais abertas da Bet365.',
    platform: 'Bet365',
    league: 'Copa do Mundo',
    market: 'Over 2.5',
    period: '12h',
    criteria: ['Odd 1.60 - 1.99', 'Leitura alternativa', 'Horas pagantes'],
    status: 'Ativo',
    priority: 'Media',
    createdAt: baseTimestamp - 6 * dayMs,
    updatedAt: baseTimestamp - 2 * dayMs,
  },
  {
    id: 'bot-03',
    name: 'Linha segura BT365',
    description: 'Procura sequencias mais comportadas em Copa do Mundo.',
    platform: 'Bet365',
    league: 'Euro Cup',
    market: 'Over 1.5',
    period: '24h',
    criteria: ['Faixa 15h-18h', 'Tabela compacta', 'Linha baixa'],
    status: 'Pausado',
    priority: 'Baixa',
    createdAt: baseTimestamp - 18 * dayMs,
    updatedAt: baseTimestamp - 4 * dayMs,
  },
]

export const initialAlerts: AlertItem[] = [
  {
    id: 'alert-01',
    name: 'BTTS acima de 68%',
    criterion: 'British Derbies | 11:10 | Ambas marcam',
    origin: 'Matriz',
    timestamp: baseTimestamp - 28 * minuteMs,
    status: 'Ativo',
    linkedBot: 'bot-01',
  },
  {
    id: 'alert-02',
    name: 'Over 2.5 aqueceu',
    criterion: 'Copa do Mundo | 16:35 | Over 2.5',
    origin: 'Bot',
    timestamp: baseTimestamp - 83 * minuteMs,
    status: 'Disparado',
    linkedBot: 'bot-02',
  },
  {
    id: 'alert-03',
    name: 'Sequencia segura',
    criterion: 'Euro Cup | 17:20 | Over 1.5',
    origin: 'Historico',
    timestamp: baseTimestamp - 5 * hourMs,
    status: 'Silenciado',
    linkedBot: 'bot-03',
  },
]

export const planCatalog: Plan[] = [
  {
    id: 'Free',
    price: 'R$ 0',
    botsLimit: 1,
    savedFilters: 3,
    historyDepth: '24 horas',
    rankingAccess: 'Top 10',
    alertsAccess: 'Basico',
  },
  {
    id: 'Pro',
    price: 'R$ 79',
    botsLimit: 6,
    savedFilters: 15,
    historyDepth: '7 dias',
    rankingAccess: 'Completo',
    alertsAccess: 'Telegram + painel',
    highlight: true,
  },
  {
    id: 'Premium',
    price: 'R$ 149',
    botsLimit: 20,
    savedFilters: 50,
    historyDepth: '30 dias',
    rankingAccess: 'Completo + cenarios',
    alertsAccess: 'Prioritario',
  },
]

export const profileSummary: ProfileSummary = {
  name: 'Weslley',
  email: 'wesley080198@gmail.com',
  currentPlan: 'Pro',
  favoritePlatform: 'Betano',
}

export const adminStats = [
  { label: 'Usuarios ativos', value: '5.214' },
  { label: 'Assinaturas Pro', value: '1.482' },
  { label: 'Alertas hoje', value: '18.904' },
  { label: 'Bots vivos', value: '2.731' },
]

export const adminLogs = [
  'Sincronizacao Betano em tempo real estabilizada.',
  'Feed websocket da Bet365 ativo nas ligas principais.',
  'Fila de alertas Telegram estabilizada apos pico das 18h.',
  'Nova coleta de historico real incorporada ao ambiente.',
]

export const productImages = {
  analysis: '/images/analysis-room.png',
  history: '/images/history-tunnel.png',
  control: '/images/control-grid.png',
}



