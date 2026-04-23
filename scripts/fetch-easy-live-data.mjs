import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { io } from 'socket.io-client'

const rootDir = process.cwd()
const capturesDir = path.join(rootDir, 'captures')
const socketUrl = 'wss://api.easycoanalytics.com.br'

const leagueCatalog = {
  BETANO: [
    { title: 'British Derbies', sub: 'british-derbies', champParam: 'british-derbies' },
    { title: 'Liga Espanhola', sub: 'liga-espanhola', champParam: 'liga-espanhola' },
    { title: 'Scudetto Italiano', sub: 'scudetto-italiano', champParam: 'scudetto-italiano' },
    { title: 'Campeonato Italiano', sub: 'campeonato-italiano', champParam: 'campeonato-italiano' },
    { title: 'Copa Das Estrelas', sub: 'copa-das-estrelas', champParam: 'copa-das-estrelas' },
    { title: 'Campeões', sub: 'campeões', champParam: 'campeões' },
    { title: 'Clássicos da América', sub: 'clássicos-da-américa', champParam: 'clássicos-da-américa' },
    { title: 'Copa America', sub: 'copa-america', champParam: 'copa-america' },
    { title: 'Euro', sub: 'euro', champParam: 'euro' },
    { title: 'Copa', sub: 'copa', champParam: 'copa' },
  ],
  BET365: [
    { title: 'Copa do Mundo', sub: 'copa_do_mundo', champParam: 'copa do mundo' },
    { title: 'Euro Cup', sub: 'euro cup', champParam: 'euro cup' },
    { title: 'PremierShip', sub: 'premiership', champParam: 'premiership' },
    { title: 'Super Liga Sul-Americana', sub: 'super_liga_sul-americana', champParam: 'super liga sul-americana' },
  ],
}

function timestampSlug() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function normalizeMatch(match) {
  const parseScoreboard = (scoreboard) => ({
    home: Number(scoreboard?.home ?? 0),
    away: Number(scoreboard?.away ?? 0),
  })

  return {
    subId: match.subId ?? null,
    date: match.date ?? null,
    status: match.status ?? null,
    teamA: match.teamA ?? null,
    teamB: match.teamB ?? null,
    scoreboardFT: parseScoreboard(match.scoreboardFT),
    scoreboardHT: parseScoreboard(match.scoreboardHT),
    odds: match.odds ?? null,
  }
}

function isFinished(match) {
  const status = String(match?.status ?? '').toLowerCase()
  return status === 'finalizado' || status.includes('final')
}

async function captureLeague(provider, league, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = io(socketUrl, {
      transports: ['websocket'],
      reconnection: false,
      timeout: timeoutMs,
    })

    const cleanup = () => {
      socket.off('connect')
      socket.off('connect_error')
      socket.off('update')
      socket.off('disconnect')
      socket.disconnect()
    }

    const timer = setTimeout(() => {
      cleanup()
      resolve({
        provider,
        leagueTitle: league.title,
        sub: league.sub,
        champParam: league.champParam,
        capturedAt: new Date().toISOString(),
        matches: [],
        error: `timeout after ${timeoutMs}ms`,
      })
    }, timeoutMs)

    socket.on('connect_error', (error) => {
      clearTimeout(timer)
      cleanup()
      reject(error)
    })

    socket.on('connect', () => {
      socket.emit('subscribe', { provider, sub: league.sub })
    })

    socket.on('update', (payload) => {
      const rawMatches = Array.isArray(payload) ? payload : [payload]
      const matches = rawMatches.filter(isFinished).map(normalizeMatch)

      if (matches.length === 0) {
        return
      }

      clearTimeout(timer)
      socket.emit('unsubscribe', { provider, sub: league.sub })
      cleanup()
      resolve({
        provider,
        leagueTitle: league.title,
        sub: league.sub,
        champParam: league.champParam,
        capturedAt: new Date().toISOString(),
        matches,
        error: null,
      })
    })
  })
}

async function main() {
  const timeoutMs = Number(process.env.EASY_CAPTURE_TIMEOUT_MS ?? 12000)
  const providers = process.argv.slice(2)
  const selectedProviders = providers.length > 0 ? providers : ['BETANO', 'BET365']
  const invalidProvider = selectedProviders.find((provider) => !(provider in leagueCatalog))

  if (invalidProvider) {
    throw new Error(`Provider desconhecido: ${invalidProvider}`)
  }

  const captureRunDir = path.join(capturesDir, `easy-live-${timestampSlug()}`)
  await mkdir(captureRunDir, { recursive: true })

  const results = []

  for (const provider of selectedProviders) {
    for (const league of leagueCatalog[provider]) {
      try {
        const result = await captureLeague(provider, league, timeoutMs)
        results.push(result)
        console.log(`${provider} / ${league.title}: ${result.matches.length} partidas`)
      } catch (error) {
        results.push({
          provider,
          leagueTitle: league.title,
          sub: league.sub,
          champParam: league.champParam,
          capturedAt: new Date().toISOString(),
          matches: [],
          error: error instanceof Error ? error.message : String(error),
        })
        console.log(`${provider} / ${league.title}: erro`)
      }
    }
  }

  const summary = {
    capturedAt: new Date().toISOString(),
    socketUrl,
    providers: selectedProviders,
    leagues: results.length,
    successfulLeagues: results.filter((result) => !result.error && result.matches.length > 0).length,
    totalMatches: results.reduce((accumulator, result) => accumulator + result.matches.length, 0),
    results,
  }

  const summaryPath = path.join(captureRunDir, 'easy-live-summary.json')
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8')

  const reportPath = path.join(captureRunDir, 'report.md')
  const lines = [
    '# Easy Live Capture',
    '',
    `- Capturado em: ${summary.capturedAt}`,
    `- Socket: ${socketUrl}`,
    `- Providers: ${summary.providers.join(', ')}`,
    `- Ligas com resposta: ${summary.successfulLeagues}/${summary.leagues}`,
    `- Total de partidas: ${summary.totalMatches}`,
    '',
    '## Ligas',
    '',
    ...results.map((result) => {
      const status = result.error ? `erro: ${result.error}` : `${result.matches.length} partidas`
      return `- ${result.provider} / ${result.leagueTitle} (\`${result.sub}\`): ${status}`
    }),
    '',
    `- JSON: ${path.relative(rootDir, summaryPath)}`,
  ]

  await writeFile(reportPath, lines.join('\n'), 'utf8')
  console.log(`Relatorio salvo em ${reportPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

