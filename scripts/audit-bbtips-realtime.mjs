import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const apiOrigin = 'https://api.bbtips.com.br'
const appOrigin = 'https://app.bbtips.com.br'
const outputRoot = path.join(process.cwd(), 'captures', 'bbtips-realtime-audit')
const storageStateCandidates = [
  path.join(process.cwd(), 'captures', 'bbtips-browser-state.json'),
  path.join(process.cwd(), 'captures', 'bbtips-storage-state.json'),
]

const durationMs = Number(process.env.BBTIPS_AUDIT_DURATION_MS ?? 15 * 60 * 1000)
const intervalMs = Number(process.env.BBTIPS_AUDIT_INTERVAL_MS ?? 1000)
const fullMatrixIntervalMs = Number(process.env.BBTIPS_AUDIT_FULL_INTERVAL_MS ?? 3500)
const manualReadyWaitMs = Number(process.env.BBTIPS_AUDIT_WAIT_FOR_LOGIN_MS ?? 0)
const localBaseUrl = process.env.TIGGER_LOCAL_URL ?? 'http://127.0.0.1:5173'
const headless = process.env.BBTIPS_AUDIT_HEADLESS === 'true'
const requestedPlatformNames = process.argv.slice(2).map((entry) => entry.toLowerCase())

const catalog = {
  Betano: {
    appUrl: `${appOrigin}/betano/futebol/horarios`,
    localRoute: '/api/bbtips/betano/live',
    endpoint: 'betanoFutebolVirtual',
    leagues: [
      { id: 1, key: 'brasileirao', name: 'Brasileirao' },
      { id: 2, key: 'classicos', name: 'Classicos da America' },
      { id: 3, key: 'copa', name: 'Copa' },
      { id: 4, key: 'euro', name: 'Euro' },
      { id: 5, key: 'america', name: 'Copa America' },
      { id: 6, key: 'british', name: 'British Derbies' },
      { id: 7, key: 'espanhola', name: 'Liga Espanhola' },
      { id: 8, key: 'scudetto', name: 'Scudetto Italiano' },
      { id: 9, key: 'italiano', name: 'Campeonato Italiano' },
      { id: 11, key: 'estrelas', name: 'Copa das Estrelas' },
      { id: 12, key: 'campeoes', name: 'Campeoes' },
    ],
  },
  PlayPix: {
    appUrl: `${appOrigin}/playpix/futebol/horarios`,
    localRoute: '/api/bbtips/playpix/live',
    endpoint: 'playpixFutebolVirtual',
    leagues: [
      { id: 1, key: 'ita', name: 'ITA' },
      { id: 2, key: 'eng', name: 'ENG' },
      { id: 3, key: 'spa', name: 'SPA' },
      { id: 4, key: 'bra', name: 'BRA' },
      { id: 5, key: 'lat', name: 'LAT' },
    ],
  },
  Bet365: {
    appUrl: `${appOrigin}/futebol/horarios`,
    localRoute: '/api/bbtips/bet365/live',
    endpoint: 'futebolvirtual',
    leagues: [
      { id: 2, key: 'copa', name: 'Copa do Mundo' },
      { id: 1, key: 'euro', name: 'Euro Cup' },
      { id: 4, key: 'super', name: 'Super Liga Sul-Americana' },
      { id: 3, key: 'premier', name: 'PremierShip' },
    ],
  },
  'Express 365': {
    appUrl: `${appOrigin}/futebol/horarios`,
    localRoute: '/api/bbtips/express/live',
    endpoint: 'futebolvirtual',
    leagues: [
      { id: 0, key: 'express', name: 'Express' },
    ],
  },
}

const timestampLabel = () => new Date().toISOString().replace(/[:.]/g, '-')

const selectedPlatforms = Object.entries(catalog)
  .filter(([platform]) =>
    requestedPlatformNames.length === 0 ||
    requestedPlatformNames.includes(platform.toLowerCase()) ||
    requestedPlatformNames.includes(platform.toLowerCase().replace(/\s+/g, '')),
  )

const toHorasParam = (period = '12h') => `Horas${String(period).replace(/h$/i, '')}`

const buildCurrentUrl = (platform, league, period = '12h') => {
  const info = catalog[platform]
  if (platform === 'Bet365' || platform === 'Express 365') {
    return `${apiOrigin}/api/${info.endpoint}?liga=${league.id}&futuro=false&Horas=${toHorasParam(period)}&tipoOdd=&dadosAlteracao=&filtros=&confrontos=false&hrsConfrontos=240`
  }

  return `${apiOrigin}/api/${info.endpoint}?liga=${league.id}&Horas=${toHorasParam(period)}&dadosAlteracao=&filtros=`
}

const buildFutureUrl = (platform, league, period = '12h') => {
  if (platform !== 'Bet365' && platform !== 'Express 365') return null
  const info = catalog[platform]
  return `${apiOrigin}/api/${info.endpoint}?liga=${league.id}&futuro=true&Horas=${toHorasParam(period)}&tipoOdd=&dadosAlteracao=&filtros=&confrontos=false&hrsConfrontos=240`
}

const buildUpdatedAtUrl = (platform, league) => {
  if (platform !== 'Betano' && platform !== 'PlayPix') return null
  return `${apiOrigin}/api/${catalog[platform].endpoint}/ultimaAtualizacao?liga=${league.id}`
}

const previewText = (value) => {
  try {
    return JSON.stringify(value).slice(0, 800)
  } catch {
    return String(value).slice(0, 800)
  }
}

const fetchJson = async (url, options = {}) => {
  const startedAt = Date.now()
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json, text/plain, */*',
        origin: appOrigin,
        referer: `${appOrigin}/`,
        'user-agent': 'Mozilla/5.0',
        ...(options.headers ?? {}),
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    })
    const text = await response.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}

    return {
      durationMs: Date.now() - startedAt,
      json,
      ok: response.ok,
      preview: text.slice(0, 800),
      status: response.status,
      url,
    }
  } catch (error) {
    return {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      status: 0,
      url,
    }
  }
}

const browserFetchJson = async (page, url) =>
  page.evaluate(async (targetUrl) => {
    const startedAt = Date.now()
    try {
      const response = await fetch(targetUrl, {
        credentials: 'include',
        headers: {
          accept: 'application/json, text/plain, */*',
        },
      })
      const text = await response.text()
      let json = null
      try {
        json = JSON.parse(text)
      } catch {}

      return {
        durationMs: Date.now() - startedAt,
        json,
        ok: response.ok,
        preview: text.slice(0, 800),
        status: response.status,
        url: targetUrl,
      }
    } catch (error) {
      return {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        ok: false,
        status: 0,
        url: targetUrl,
      }
    }
  }, url)

const readLocalPayload = async (platform, league) => {
  const info = catalog[platform]
  const url = new URL(info.localRoute, localBaseUrl)
  url.searchParams.set('period', '12h')
  url.searchParams.set('leagues', league.key)
  url.searchParams.set('cacheOnly', 'true')
  url.searchParams.set('allowStale', 'false')
  const result = await fetchJson(String(url), { timeoutMs: 2500 })
  const leaguePayload = result.json?.leagues?.find?.((entry) => entry.key === league.key) ?? null
  return {
    ...result,
    leaguePayload,
  }
}

const normalizeValue = (value) => String(value ?? '').trim()

const flattenCells = (payload) => {
  const cells = new Map()
  for (const line of payload?.Linhas ?? []) {
    const hour = normalizeValue(line?.Hora).padStart(2, '0')
    for (const column of line?.Colunas ?? []) {
      const minute = normalizeValue(column?.Minuto ?? column?.Horario ?? column?.Id).padStart(2, '0')
      if (!hour || !minute) continue
      const key = `${hour}:${minute}`
      cells.set(key, {
        key,
        result: normalizeValue(column?.Resultado_FT ?? column?.Resultado),
        teams: [
          normalizeValue(column?.SiglaA ?? column?.TimeA),
          normalizeValue(column?.SiglaB ?? column?.TimeB),
        ].filter(Boolean).join(' x '),
      })
    }
  }
  return cells
}

const summarizeMatrix = (payload) => {
  const lines = payload?.Linhas ?? []
  const minutes = (payload?.Minutos ?? []).map((minute) => Number(minute?.Numero)).filter(Number.isFinite)
  const cells = [...flattenCells(payload).values()]
  const resolvedCells = cells.filter((cell) => cell.result)

  return {
    cells: cells.length,
    dataAtualizacao: payload?.DataAtualizacao ?? null,
    firstHour: lines[0]?.Hora ?? null,
    lastHour: lines.at(-1)?.Hora ?? null,
    lastResolvedCell: resolvedCells.at(-1) ?? null,
    lineHours: lines.map((line) => line?.Hora ?? null),
    lines: lines.length,
    minuteSlots: minutes,
    resolvedCells: resolvedCells.length,
  }
}

const compareMatrices = (referencePayload, localPayload) => {
  const referenceCells = flattenCells(referencePayload)
  const localCells = flattenCells(localPayload)
  const keys = new Set([...referenceCells.keys(), ...localCells.keys()])
  const differences = []
  let missing = 0
  let extra = 0
  let different = 0

  for (const key of [...keys].sort()) {
    const referenceCell = referenceCells.get(key)
    const localCell = localCells.get(key)

    if (!referenceCell) {
      extra += 1
      if (differences.length < 100) differences.push({ key, local: localCell, type: 'extra' })
      continue
    }

    if (!localCell) {
      missing += 1
      if (differences.length < 100) differences.push({ key, reference: referenceCell, type: 'missing' })
      continue
    }

    if (referenceCell.result !== localCell.result || referenceCell.teams !== localCell.teams) {
      different += 1
      if (differences.length < 100) {
        differences.push({ key, local: localCell, reference: referenceCell, type: 'different' })
      }
    }
  }

  return {
    counts: {
      different,
      extra,
      missing,
      reference: referenceCells.size,
      tigger: localCells.size,
      totalDifferences: different + extra + missing,
    },
    differences,
  }
}

const createTargetState = (platform, league) => ({
  currentUrl: buildCurrentUrl(platform, league),
  directProbe: null,
  futureUrl: buildFutureUrl(platform, league),
  lastFullFetchAt: 0,
  lastLocalCheckAt: 0,
  lastMatrix: null,
  lastTimestamp: null,
  league,
  local: null,
  localComparison: null,
  platform,
  samples: [],
  timestampChanges: [],
  updatedAtUrl: buildUpdatedAtUrl(platform, league),
})

const sampleTarget = async (page, state) => {
  const now = Date.now()
  let timestampResult = null
  let shouldFetchFull = now - state.lastFullFetchAt >= fullMatrixIntervalMs

  if (state.updatedAtUrl) {
    timestampResult = await browserFetchJson(page, state.updatedAtUrl)
    const nextTimestamp = normalizeValue(timestampResult.json ?? timestampResult.preview)
    if (nextTimestamp && nextTimestamp !== state.lastTimestamp) {
      state.timestampChanges.push({
        at: new Date().toISOString(),
        from: state.lastTimestamp,
        to: nextTimestamp,
      })
      state.lastTimestamp = nextTimestamp
      shouldFetchFull = true
    }
  }

  let matrixResult = null
  if (shouldFetchFull) {
    state.lastFullFetchAt = now
    matrixResult = await browserFetchJson(page, state.currentUrl)
    if (matrixResult.ok && matrixResult.json?.Linhas) {
      state.lastMatrix = matrixResult.json
    }
  }

  if (now - state.lastLocalCheckAt >= 3000) {
    state.lastLocalCheckAt = now
    state.local = await readLocalPayload(state.platform, state.league)
    state.localComparison = compareMatrices(
      state.lastMatrix,
      state.local?.leaguePayload?.current,
    )
  }

  state.samples.push({
    at: new Date().toISOString(),
    localStatus: state.local?.status ?? null,
    localUpdatedAt: state.local?.json?.updatedAt ?? null,
    matrixError: matrixResult?.error ?? null,
    matrixDurationMs: matrixResult?.durationMs ?? null,
    matrixStatus: matrixResult?.status ?? null,
    matrixSummary: matrixResult?.json ? summarizeMatrix(matrixResult.json) : null,
    timestampError: timestampResult?.error ?? null,
    timestampDurationMs: timestampResult?.durationMs ?? null,
    timestampStatus: timestampResult?.status ?? null,
    timestampValue: timestampResult?.json ?? timestampResult?.preview ?? null,
  })

  state.samples.splice(120)
}

const buildMarkdownSummary = (report) => {
  const lines = [
    '# BBTips realtime audit',
    '',
    `Generated: ${report.generatedAt}`,
    `Duration: ${report.durationMs}ms`,
    '',
    '| Platform | League | Direct | Changes | BBTips cells | Tigger cells | Diffs | Last timestamp |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
  ]

  for (const target of report.targets) {
    const sample = target.samples.at(-1) ?? {}
    const counts = target.localComparison?.counts ?? {}
    lines.push([
      target.platform,
      target.league.key,
      target.directProbe?.status ?? 'n/a',
      target.timestampChanges.length,
      sample.matrixSummary?.cells ?? target.matrixSummary?.cells ?? 0,
      counts.tigger ?? 0,
      counts.totalDifferences ?? 'n/a',
      target.lastTimestamp ?? target.matrixSummary?.dataAtualizacao ?? '',
    ].join(' | '))
  }

  return `${lines.join('\n')}\n`
}

const main = async () => {
  if (selectedPlatforms.length === 0) {
    throw new Error('Nenhuma plataforma selecionada para auditoria.')
  }

  const outputDir = path.join(outputRoot, timestampLabel())
  await mkdir(outputDir, { recursive: true })

  const storageStatePath = storageStateCandidates.find((candidate) => existsSync(candidate))
  const browser = await chromium.launch({
    args: ['--disable-blink-features=AutomationControlled'],
    channel: 'chrome',
    headless,
  }).catch(() => chromium.launch({
    args: ['--disable-blink-features=AutomationControlled'],
    headless,
  }))
  const context = await browser.newContext(storageStatePath ? { storageState: storageStatePath } : undefined)

  const targets = selectedPlatforms.flatMap(([platform, info]) =>
    info.leagues.map((league) => createTargetState(platform, league)),
  )

  for (const state of targets) {
    state.directProbe = await fetchJson(state.currentUrl)
  }

  const pagesByPlatform = new Map()
  const pageDiagnosticsByPlatform = new Map()
  for (const [platform, info] of selectedPlatforms) {
    const page = await context.newPage()
    await page.goto(info.appUrl, { timeout: 60_000, waitUntil: 'domcontentloaded' }).catch(() => undefined)
    await page.waitForTimeout(3000)
    if (manualReadyWaitMs > 0) {
      console.log(`Aguardando ${manualReadyWaitMs}ms para sessao/manual em ${platform}...`)
      await page.waitForTimeout(manualReadyWaitMs)
      await context.storageState({ path: path.join(process.cwd(), 'captures', 'bbtips-browser-state.json') })
    }
    pageDiagnosticsByPlatform.set(platform, {
      bodyPreview: await page.locator('body').innerText().then((text) => text.slice(0, 1200)).catch(() => ''),
      title: await page.title().catch(() => ''),
      url: page.url(),
    })
    pagesByPlatform.set(platform, page)
  }

  const startedAt = Date.now()
  try {
    while (Date.now() - startedAt < durationMs) {
      for (const state of targets) {
        const page = pagesByPlatform.get(state.platform)
        await sampleTarget(page, state)
        await page.waitForTimeout(150)
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }

  const report = {
    durationMs: Date.now() - startedAt,
    generatedAt: new Date().toISOString(),
    localBaseUrl,
    pageDiagnostics: Object.fromEntries(pageDiagnosticsByPlatform.entries()),
    targets: targets.map((state) => ({
      currentUrl: state.currentUrl,
      directProbe: {
        durationMs: state.directProbe?.durationMs,
        ok: state.directProbe?.ok,
        preview: state.directProbe?.preview ?? previewText(state.directProbe?.json),
        status: state.directProbe?.status,
      },
      futureUrl: state.futureUrl,
      lastTimestamp: state.lastTimestamp,
      league: state.league,
      localComparison: state.localComparison,
      matrixSummary: summarizeMatrix(state.lastMatrix),
      platform: state.platform,
      samples: state.samples,
      timestampChanges: state.timestampChanges,
      updatedAtUrl: state.updatedAtUrl,
    })),
  }

  const reportPath = path.join(outputDir, 'report.json')
  const summaryPath = path.join(outputDir, 'summary.md')
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
  await writeFile(summaryPath, buildMarkdownSummary(report), 'utf8')

  console.log(`Relatorio JSON: ${reportPath}`)
  console.log(`Resumo: ${summaryPath}`)
  console.log(buildMarkdownSummary(report))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
