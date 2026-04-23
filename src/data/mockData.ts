import type {
  AlertItem,
  Bot,
  LeagueDefinition,
  Market,
  MatchRecord,
  OddBand,
  Period,
  Plan,
  Platform,
  ProfileSummary,
  RankingTab,
  TimeMode,
  ToggleKey,
} from '../types'
import { marketOptions as globalMarketOptions } from './staticData'

const baseTimestamp = new Date('2026-04-12T19:55:00').getTime()
const dayMs = 24 * 60 * 60 * 1000
const hourMs = 60 * 60 * 1000
const minuteMs = 60 * 1000

const seededValue = (seed: number) => {
  const raw = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return raw - Math.floor(raw)
}

const clampOdd = (value: number) =>
  Number(Math.min(3.8, Math.max(1.12, value)).toFixed(2))

export const platformOptions: Platform[] = ['Betano', 'Bet365']
export const timeModeOptions: TimeMode[] = ['FT', 'HT', 'FT + HT']
export const marketOptions: Market[] = globalMarketOptions
export const periodOptions: Period[] = [
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
export const oddBandOptions: OddBand[] = [
  'Selecione as Odds',
  '1.20 - 1.59',
  '1.60 - 1.99',
  '2.00+',
]
export const rankingTabs: RankingTab[] = [
  'Ligas',
  'Horarios',
  'Mercados',
  'Sequencias',
  'Cenarios',
]
export const hourSlots = Array.from({ length: 12 }, (_, index) => index + 8)
export const minuteSlots = Array.from({ length: 20 }, (_, index) => 1 + index * 3)

export const quickToggleOptions: Array<{ key: ToggleKey; label: string }> = [
  { key: 'showTeams', label: 'Ver times' },
  { key: 'showMaxima', label: 'Maxima' },
  { key: 'showVideo', label: 'Ver video' },
  { key: 'nextRanking', label: 'Ranking nos proximos' },
  { key: 'payingHours', label: 'Horas pagantes' },
  { key: 'altReading', label: 'Leitura alternativa' },
  { key: 'detailCells', label: 'Detalhar celulas' },
]

export const leagueCatalog: LeagueDefinition[] = [
  {
    name: 'British Derbies',
    region: 'BR',
    descriptor: 'rodadas compactas com jogo direto',
    image: '/images/brasil-turbo.png',
    accent: '#3bd671',
    teams: ['Atlas', 'Ferro', 'Ponte', 'Cruzeiro', 'Nacional', 'Lobos'],
  },
  {
    name: 'Liga Espanhola',
    region: 'UK',
    descriptor: 'mercado rapido e mais travado no HT',
    image: '/images/inglaterra-elite.png',
    accent: '#59c2ff',
    teams: ['Kings', 'Harbor', 'Union', 'Borough', 'Rovers', 'Crown'],
  },
  {
    name: 'Scudetto Italiano',
    region: 'ES',
    descriptor: 'placares curtos e retomada forte no fim',
    image: '/images/espanha-pro.png',
    accent: '#ffb648',
    teams: ['Torres', 'Rayo', 'Costa', 'Sevilla', 'Valle', 'Leon'],
  },
  {
    name: 'Campeonato Italiano',
    region: 'IT',
    descriptor: 'linhas de over com mais ruido',
    image: '/images/italia-flash.png',
    accent: '#ff6a78',
    teams: ['Roma', 'Verde', 'Turim', 'Milan', 'Laguna', 'Vesuvio'],
  },
  {
    name: 'Copa das Estrelas',
    region: 'GL',
    descriptor: 'ligas mistas com empate recorrente',
    image: '/images/mundo-cup.png',
    accent: '#ad8cff',
    teams: ['Orion', 'Mirage', 'Delta', 'Phoenix', 'Pulse', 'Storm'],
  },
  {
    name: 'Campeoes',
    region: 'DE',
    descriptor: 'pressao alta em janelas pagantes',
    image: '/images/alemanha-max.png',
    accent: '#57e0b3',
    teams: ['Rhine', 'Berlin', 'Volt', 'Essen', 'Kraft', 'Dynamo'],
  },
  {
    name: 'Classicos da America',
    region: 'AM',
    descriptor: 'faixas agressivas com placares abertos',
    image: '/images/analysis-room.png',
    accent: '#59c2ff',
    teams: ['Capital', 'Oeste', 'River', 'Boca', 'Norte', 'Sul'],
  },
  {
    name: 'Copa America',
    region: 'AM',
    descriptor: 'sequencias intensas com oscilacao de odd',
    image: '/images/control-grid.png',
    accent: '#ffb648',
    teams: ['Aurora', 'Pampa', 'Andes', 'Pacifico', 'Central', 'Serra'],
  },
  {
    name: 'Euro',
    region: 'EU',
    descriptor: 'janelas de equilibrio e retomada no FT',
    image: '/images/history-tunnel.png',
    accent: '#ad8cff',
    teams: ['Nord', 'Leste', 'Oeste', 'Sul', 'Centro', 'Atletico'],
  },
  {
    name: 'Brasileirao Betano',
    region: 'BR',
    descriptor: 'volume alto e leitura direta por mercado',
    image: '/images/brasil-turbo.png',
    accent: '#3bd671',
    teams: ['Barra', 'Vila', 'Real', 'Uniao', 'Campo', 'Avenida'],
  },
]

const tendencies = [
  'pressao casa',
  'janela de over',
  'linha curta',
  'ritmo frio',
  'retomada no segundo tempo',
  'empate resistente',
  'mercado inclinado',
]

const buildTags = (homeGoals: number, awayGoals: number, homeOdd: number) => {
  const tags = ['leitura rapida']
  const totalGoals = homeGoals + awayGoals
  if (totalGoals >= 4) tags.push('placar esticado')
  if (homeGoals === awayGoals) tags.push('empate frio')
  if (homeGoals > awayGoals && homeOdd <= 1.65) tags.push('favorito confirma')
  if (homeGoals < awayGoals) tags.push('virada visitante')
  if (homeGoals > 0 && awayGoals > 0) tags.push('btts quente')
  if (totalGoals <= 1) tags.push('linha baixa')
  return tags
}

const buildRecords = () => {
  const records: MatchRecord[] = []

  for (let dayOffset = 0; dayOffset < 30; dayOffset += 1) {
    for (let platformIndex = 0; platformIndex < platformOptions.length; platformIndex += 1) {
      const platform = platformOptions[platformIndex]

      for (let leagueIndex = 0; leagueIndex < leagueCatalog.length; leagueIndex += 1) {
        const league = leagueCatalog[leagueIndex]

        for (const hour of hourSlots) {
          for (let minuteIndex = 0; minuteIndex < minuteSlots.length; minuteIndex += 1) {
            const minuteSlot = minuteSlots[minuteIndex]
            const seed =
              dayOffset * 100000 +
              platformIndex * 10000 +
              leagueIndex * 1000 +
              hour * 100 +
              minuteSlot

            const homeIndex = Math.floor(seededValue(seed + 1) * league.teams.length)
            let awayIndex = Math.floor(seededValue(seed + 2) * league.teams.length)
            if (awayIndex === homeIndex) {
              awayIndex = (awayIndex + 2) % league.teams.length
            }

            const htHome = Math.floor(seededValue(seed + 3) * 3)
            const htAway = Math.floor(seededValue(seed + 4) * 3)
            const ftHome = Math.min(5, htHome + Math.floor(seededValue(seed + 5) * 3))
            const ftAway = Math.min(5, htAway + Math.floor(seededValue(seed + 6) * 3))
            const totalGoals = ftHome + ftAway
            const bothTeamsScore = ftHome > 0 && ftAway > 0
            const hasComeback =
              (htHome < htAway && ftHome > ftAway) || (htHome > htAway && ftHome < ftAway)

            const homeStrength = 0.46 + seededValue(seed + 7) * 0.28
            const awayStrength = 0.38 + seededValue(seed + 8) * 0.26
            const marketBias = seededValue(seed + 9)

            const homeOdd = clampOdd(1.28 + (1 - homeStrength) * 1.8 + (awayStrength > homeStrength ? 0.28 : 0))
            const drawOdd = clampOdd(2.45 + marketBias * 1.2)
            const awayOdd = clampOdd(1.34 + (1 - awayStrength) * 1.9 + (homeStrength > awayStrength ? 0.24 : 0))
            const over05Odd = clampOdd(1.14 + seededValue(seed + 10) * 0.32)
            const over15Odd = clampOdd(1.34 + seededValue(seed + 11) * 0.54)
            const over25Odd = clampOdd(1.68 + seededValue(seed + 12) * 0.86)
            const bttsOdd = clampOdd(1.42 + seededValue(seed + 13) * 0.76)
            const htHomeOdd = clampOdd(homeOdd - 0.08 + seededValue(seed + 14) * 0.22)
            const htDrawOdd = clampOdd(drawOdd - 0.14 + seededValue(seed + 15) * 0.18)
            const htAwayOdd = clampOdd(awayOdd - 0.08 + seededValue(seed + 16) * 0.22)

            const odds = Object.fromEntries(
              marketOptions.map((market) => [market, null]),
            ) as Record<Market, number | null>

            odds['Ambas Marcam Sim'] = bttsOdd
            odds['Ambas Marcam Não'] = clampOdd(bttsOdd + 0.18)
            odds['Over 0.5'] = over05Odd
            odds['Over 1.5'] = over15Odd
            odds['Over 2.5'] = over25Odd
            odds['Over 3.5'] = clampOdd(over25Odd + 0.34)
            odds['Over 4.5'] = clampOdd(over25Odd + 0.62)
            odds['Over 5.5'] = clampOdd(over25Odd + 0.94)
            odds['Under 0.5'] = clampOdd(6.4 + seededValue(seed + 30) * 1.1)
            odds['Under 1.5'] = clampOdd(2.2 + seededValue(seed + 31) * 0.9)
            odds['Under 2.5'] = clampOdd(1.72 + seededValue(seed + 32) * 0.7)
            odds['Under 3.5'] = clampOdd(1.42 + seededValue(seed + 33) * 0.46)
            odds['Under 4.5'] = clampOdd(1.24 + seededValue(seed + 34) * 0.3)
            odds['Under 5.5'] = clampOdd(1.14 + seededValue(seed + 35) * 0.18)
            odds['Resultado final'] = homeOdd
            odds['Resultado HT'] = htHomeOdd
            odds['Casa vence'] = homeOdd
            odds['Empate'] = drawOdd
            odds['Fora vence'] = awayOdd
            odds['Casa vence HT'] = htHomeOdd
            odds['Empate HT'] = htDrawOdd
            odds['Fora vence HT'] = htAwayOdd

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
            marketResults['Ambas Marcam Sim'] = bothTeamsScore
            marketResults['Ambas Marcam Não'] = !bothTeamsScore
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

            const winnerCode = marketResults['Casa vence']
              ? 'H'
              : marketResults['Fora vence']
                ? 'A'
                : 'D'
            const goalCode = totalGoals >= 3 ? '+G' : '-G'
            const bttsCode = bothTeamsScore ? 'BT' : 'NB'
            const sequencePattern = `${winnerCode} ${goalCode} ${bttsCode}`

            const timestamp =
              baseTimestamp -
              dayOffset * dayMs +
              hour * hourMs +
              minuteSlot * minuteMs +
              platformIndex * 3 * minuteMs +
              leagueIndex * 2 * minuteMs

            records.push({
              id: `${platform}-${league.name}-${dayOffset}-${hour}-${minuteSlot}`,
              platform,
              league: league.name,
              timestamp,
              hour,
              minuteSlot,
              round: 2000 + dayOffset * 144 + hour * 12 + minuteIndex + leagueIndex * 40,
              status: 'finalizado',
              homeTeam: league.teams[homeIndex],
              awayTeam: league.teams[awayIndex],
              scoreHT: `${htHome}-${htAway}`,
              scoreFT: `${ftHome}-${ftAway}`,
              odds,
              marketResults,
              sequencePattern,
              tendency: tendencies[Math.floor(seededValue(seed + 15) * tendencies.length)],
              tags: buildTags(ftHome, ftAway, homeOdd),
              videoAvailable: seededValue(seed + 16) > 0.22,
              leagueImage: league.image,
            })
          }
        }
      }
    }
  }

  return records.sort((left, right) => right.timestamp - left.timestamp)
}

export const matchRecords = buildRecords()

export const initialBots: Bot[] = [
  {
    id: 'bot-01',
    name: 'Janela casa 11h',
    description: 'Casa vence em linhas curtas nas ligas quentes da manha.',
    platform: 'Betano',
    league: 'Brasil Turbo',
    market: 'Casa vence',
    period: '24h',
    criteria: ['Odd 1.20 - 1.59', 'Faixa 11h-13h', 'Detalhar celulas'],
    status: 'Ativo',
    priority: 'Alta',
    createdAt: baseTimestamp - 8 * dayMs,
    updatedAt: baseTimestamp - 1 * dayMs,
  },
  {
    id: 'bot-02',
    name: 'Over agressivo tarde',
    description: 'Leitura de over quando o historico puxa acima de 63%.',
    platform: 'Bet365',
    league: 'Italia Flash',
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
    name: 'Empate resistente',
    description: 'Busca janelas com empate recorrente em Mundo Cup.',
    platform: 'Betano',
    league: 'Mundo Cup',
    market: 'Empate',
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
    name: 'Casa vence acima de 68%',
    criterion: 'Brasil Turbo | 11:10 | Casa vence',
    origin: 'Matriz',
    timestamp: baseTimestamp - 28 * minuteMs,
    status: 'Ativo',
    linkedBot: 'bot-01',
  },
  {
    id: 'alert-02',
    name: 'Over 2.5 aqueceu',
    criterion: 'Italia Flash | 16:35 | Over 2.5',
    origin: 'Bot',
    timestamp: baseTimestamp - 83 * minuteMs,
    status: 'Disparado',
    linkedBot: 'bot-02',
  },
  {
    id: 'alert-03',
    name: 'Empate em sequencia longa',
    criterion: 'Mundo Cup | 17:20 | Empate',
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
  'Sincronizacao Betano 19:40 concluida sem atraso.',
  'Reprocessamento de odds da Italia Flash executado em 14s.',
  'Fila de alertas Telegram estabilizada apos pico das 18h.',
  'Novo pacote de historico Bet365 carregado para 30 dias.',
]

export const productImages = {
  analysis: '/images/analysis-room.png',
  history: '/images/history-tunnel.png',
  control: '/images/control-grid.png',
}










