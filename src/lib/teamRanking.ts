import type { Market, MatchRecord, MatrixCell } from '../types'

export type RankingScope = 'home' | 'away' | 'all'
export type RankingLimit = 3 | 5 | 10 | 'all'

export interface TeamRankingRow {
  draws: number
  firstSeenOrder: number
  games: number
  goalsAgainst: number
  goalsFor: number
  hitRate: number
  hits: number
  id: string
  label: string
  losses: number
  points: number
  wins: number
}

export const rankingScopeOptions: Array<{ label: string; value: RankingScope }> = [
  { label: 'Casa', value: 'home' },
  { label: 'Fora', value: 'away' },
  { label: 'Casa/Fora', value: 'all' },
]

export const rankingLimitOptions: Array<{ label: string; value: RankingLimit }> = [
  { label: 'Top 5', value: 5 },
  { label: 'Top 3', value: 3 },
  { label: 'Top 10', value: 10 },
  { label: 'Todos', value: 'all' },
]

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

const normalizeStatusValue = (value: string) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const parseScorePair = (score: string) => {
  const [homeRaw, awayRaw] = String(score ?? '').trim().split(/[x-]/i)
  const home = Number(homeRaw)
  const away = Number(awayRaw)

  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return null
  }

  return { away, home }
}

const isFinishedRankingRecord = (record: MatchRecord) => {
  if (!parseScorePair(record.scoreFT)) return false

  const normalizedStatus = normalizeStatusValue(record.status)

  return !pendingStatusTokens.some((token) => normalizedStatus.includes(token))
}

export const parseRankingLimit = (value: string): RankingLimit => {
  if (value === 'all') return 'all'

  const numericValue = Number(value)

  return numericValue === 3 || numericValue === 10 ? numericValue : 5
}

export const getRankingLimitLabel = (limit: RankingLimit) =>
  limit === 'all' ? 'Todos' : `Top ${limit}`

export const getRankingLimitPhrase = (limit: RankingLimit) =>
  limit === 'all' ? 'ranking completo' : `top ${limit}`

export const getRankingScopeLabel = (scope: RankingScope) =>
  rankingScopeOptions.find((option) => option.value === scope)?.label ?? 'Casa/Fora'

export const getMarketHitLabel = (market: Market) => {
  const normalizedMarket = market
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  if (normalizedMarket.includes('ambas') && normalizedMarket.includes('sim')) return 'Sim'
  if (normalizedMarket.includes('ambas') && normalizedMarket.includes('nao')) return 'Nao'
  if (normalizedMarket.includes('over')) return 'Over'
  if (normalizedMarket.includes('under')) return 'Under'
  if (normalizedMarket.includes('casa')) return 'Casa'
  if (normalizedMarket.includes('visitante')) return 'Visitante'

  return 'Qtd'
}

export function buildTeamRankingRows(
  records: MatchRecord[],
  market: Market,
  scope: RankingScope = 'all',
  limit: RankingLimit = 5,
) {
  const buckets = new Map<string, TeamRankingRow>()
  let firstSeenOrder = 0

  const registerTeam = (
    teamName: string,
    goalsFor: number,
    goalsAgainst: number,
    isMarketHit: boolean,
  ) => {
    const current =
      buckets.get(teamName) ??
      {
        draws: 0,
        firstSeenOrder: firstSeenOrder++,
        games: 0,
        goalsAgainst: 0,
        goalsFor: 0,
        hitRate: 0,
        hits: 0,
        id: teamName,
        label: teamName,
        losses: 0,
        points: 0,
        wins: 0,
      }

    current.games += 1
    current.goalsFor += goalsFor
    current.goalsAgainst += goalsAgainst
    current.hits += isMarketHit ? 1 : 0

    if (goalsFor > goalsAgainst) {
      current.wins += 1
      current.points += 3
    } else if (goalsFor === goalsAgainst) {
      current.draws += 1
      current.points += 1
    } else {
      current.losses += 1
    }

    current.hitRate = current.games ? current.hits / current.games : 0
    buckets.set(teamName, current)
  }

  records.forEach((record) => {
    if (!isFinishedRankingRecord(record)) return

    const parsedScore = parseScorePair(record.scoreFT)
    if (!parsedScore) return

    const isMarketHit = Boolean(record.marketResults[market])

    if (scope === 'home' || scope === 'all') {
      registerTeam(record.homeTeam, parsedScore.home, parsedScore.away, isMarketHit)
    }

    if (scope === 'away' || scope === 'all') {
      registerTeam(record.awayTeam, parsedScore.away, parsedScore.home, isMarketHit)
    }
  })

  const sortedRows = [...buckets.values()].sort((left, right) => {
    if (right.hitRate !== left.hitRate) return right.hitRate - left.hitRate
    if (right.hits !== left.hits) return right.hits - left.hits
    if (right.points !== left.points) return right.points - left.points
    if (right.games !== left.games) return right.games - left.games
    if (right.goalsFor - right.goalsAgainst !== left.goalsFor - left.goalsAgainst) {
      return right.goalsFor - right.goalsAgainst - (left.goalsFor - left.goalsAgainst)
    }
    return left.firstSeenOrder - right.firstSeenOrder
  })

  return limit === 'all' ? sortedRows : sortedRows.slice(0, limit)
}

export function buildNextRankingHighlights(
  finishedRecords: MatchRecord[],
  rows: Array<{ cells: MatrixCell[] }>,
  market: Market,
  scope: RankingScope,
  limit: RankingLimit,
  upcomingRecords: MatchRecord[] = [],
) {
  const homeTeams = new Set(
    buildTeamRankingRows(finishedRecords, market, scope === 'away' ? 'away' : scope, limit).map((row) => row.label),
  )
  const awayTeams =
    scope === 'all'
      ? homeTeams
      : new Set(buildTeamRankingRows(finishedRecords, market, scope, limit).map((row) => row.label))

  const nextRankingMatchIds: string[] = []
  const nextRankingDualMatchIds: string[] = []
  const pendingRowRecords = rows
    .flatMap((row) => row.cells)
    .map((cell) => {
      const pendingLatest =
        cell.latest && !isFinishedRankingRecord(cell.latest as MatchRecord)
          ? cell.latest as MatchRecord
          : undefined

      return cell.upcoming ?? pendingLatest
    })
    .filter((record): record is MatchRecord => Boolean(record && !isFinishedRankingRecord(record)))
  const pendingRecords = new Map<string, MatchRecord>()

  ;[...upcomingRecords, ...pendingRowRecords]
    .filter((record) => !isFinishedRankingRecord(record))
    .sort((left, right) => left.timestamp - right.timestamp)
    .forEach((record) => {
      if (!pendingRecords.has(record.id)) {
        pendingRecords.set(record.id, record)
      }
    })

  pendingRecords.forEach((record) => {
      const homeIsRanked = scope === 'away' ? false : homeTeams.has(record.homeTeam)
      const awayIsRanked = scope === 'home' ? false : awayTeams.has(record.awayTeam)
      const rankedTeamsInMatch = Number(homeIsRanked) + Number(awayIsRanked)

      if (rankedTeamsInMatch >= 1) {
        nextRankingMatchIds.push(record.id)
      }

      if (scope === 'all' && rankedTeamsInMatch >= 2) {
        nextRankingDualMatchIds.push(record.id)
      }
    })

  return {
    nextRankingDualMatchIds,
    nextRankingMatchIds,
  }
}
