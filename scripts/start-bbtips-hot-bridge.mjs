import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const localBaseUrl = process.env.TIGGER_LOCAL_URL || 'http://127.0.0.1:5173'
const cdpUrl = process.env.BBTIPS_HOT_BRIDGE_CDP_URL || ''
const profileDir = process.env.BBTIPS_HOT_BRIDGE_PROFILE_DIR ||
  path.join(process.cwd(), 'captures', 'bbtips-bridge-chrome-profile')
const pollMs = Math.max(750, Number(process.env.BBTIPS_HOT_BRIDGE_POLL_MS || 1000))
const period = process.env.BBTIPS_HOT_BRIDGE_PERIOD || 'Horas12'
const runOnce = process.env.BBTIPS_HOT_BRIDGE_ONCE === '1'

const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(existsSync)

const chromePath = process.env.CHROME_PATH || chromeCandidates[0]

const pages = {
  betano: 'https://app.bbtips.com.br/betano/futebol/horarios',
  futebolvirtual: 'https://app.bbtips.com.br/futebol/horarios',
  playpix: 'https://app.bbtips.com.br/playpix/futebol/horarios',
}

const targets = [
  ...[
    [2, 'Betano/classicos'],
    [3, 'Betano/copa'],
    [4, 'Betano/euro'],
    [5, 'Betano/america'],
    [6, 'Betano/british'],
    [7, 'Betano/espanhola'],
    [8, 'Betano/scudetto'],
    [9, 'Betano/italiano'],
    [11, 'Betano/estrelas'],
    [12, 'Betano/campeoes'],
  ].map(([liga, label]) => ({
    label,
    page: 'betano',
    matrixUrls: [
      `https://api.bbtips.com.br/api/betanoFutebolVirtual?liga=${liga}&Horas=${period}&dadosAlteracao=&filtros=`,
    ],
    updatedAtUrl: `https://api.bbtips.com.br/api/betanoFutebolVirtual/ultimaAtualizacao?liga=${liga}`,
  })),
  ...[
    [1, 'PlayPix/ita'],
    [2, 'PlayPix/eng'],
    [3, 'PlayPix/spa'],
    [4, 'PlayPix/bra'],
    [5, 'PlayPix/lat'],
  ].map(([liga, label]) => ({
    label,
    page: 'playpix',
    matrixUrls: [
      `https://api.bbtips.com.br/api/PlayPixFutebolVirtual?liga=${liga}&Horas=${period}&filtros=`,
    ],
    updatedAtUrl: `https://api.bbtips.com.br/api/PlayPixFutebolVirtual/ultimaAtualizacao?liga=${liga}`,
  })),
  ...[
    [2, 'Bet365/copa'],
    [1, 'Bet365/euro'],
    [4, 'Bet365/super'],
    [3, 'Bet365/premier'],
    [0, 'Express/express'],
  ].map(([liga, label]) => ({
    label,
    page: 'futebolvirtual',
    matrixUrls: [
      `https://api.bbtips.com.br/api/futebolvirtual?liga=${liga}&futuro=false&Horas=${period}&tipoOdd=&dadosAlteracao=&filtros=&confrontos=false&hrsConfrontos=240`,
      `https://api.bbtips.com.br/api/futebolvirtual?liga=${liga}&futuro=true&Horas=${period}&tipoOdd=&dadosAlteracao=&filtros=&confrontos=false&hrsConfrontos=240`,
    ],
    updatedAtUrl: `https://api.bbtips.com.br/api/futebolvirtual/ultimaAtualizacao?liga=${liga}`,
  })),
]

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const state = {
  errors: [],
  fetched: 0,
  ingested: 0,
  lastCycleAt: null,
  startedAt: new Date().toISOString(),
}

const rememberError = (message) => {
  state.errors.unshift(String(message).slice(0, 260))
  state.errors.splice(20)
}

const postLocal = async (pathName, payload) => {
  const response = await fetch(`${localBaseUrl}${pathName}`, {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`Tigger ${pathName} HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`)
  }
}

const refreshLocalStatus = async () => {
  const response = await fetch(`${localBaseUrl}/api/bbtips/status`)
  if (!response.ok) return
  const payload = await response.json()
  const latestSnapshots = Number(payload?.bridge?.latestSnapshots ?? 0)
  if (Number.isFinite(latestSnapshots) && latestSnapshots < targets.length) {
    updatedAtByTarget.clear()
    matrixSignatureByUrl.clear()
  }
}

const ping = async () => {
  await postLocal('/api/bbtips/bridge-ping', {
    href: 'playwright-hot-bridge',
    state: {
      errors: state.errors,
      matched: state.fetched,
      polled: state.fetched,
      sent: state.ingested,
      transport: 'playwright-xhr',
    },
    title: 'BBTips hot bridge',
    userAgent: 'playwright-hot-bridge',
  }).catch(() => undefined)
}

const openPages = async () => {
  mkdirSync(profileDir, { recursive: true })

  if (cdpUrl) {
    const browser = await chromium.connectOverCDP(cdpUrl)
    const context = browser.contexts()[0] || await browser.newContext()
    return { browser, context, ownsBrowser: false }
  }

  if (!chromePath) {
    throw new Error('Chrome nao encontrado. Defina CHROME_PATH apontando para chrome.exe.')
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    executablePath: chromePath,
    headless: process.env.BBTIPS_HOT_BRIDGE_HEADLESS === '1',
    viewport: { height: 900, width: 1440 },
  })
  return { browser: context.browser(), context, ownsBrowser: true }
}

const ensurePage = async (context, key, url) => {
  let page = context.pages().find((candidate) => candidate.url().startsWith(url))
  if (!page) {
    page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded' })
  }
  await page.waitForLoadState('domcontentloaded').catch(() => undefined)
  return page
}

const xhrText = async (page, url) => page.evaluate(async (requestUrl) => {
  const token = localStorage.getItem('access_token') || (() => {
    try {
      return JSON.parse(localStorage.getItem('currentUser') || '{}')?.token || ''
    } catch {
      return ''
    }
  })()

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', requestUrl)
    xhr.setRequestHeader('Accept', 'application/json, text/plain, */*')
    xhr.setRequestHeader('Cache-Control', 'no-cache')
    xhr.setRequestHeader('Pragma', 'no-cache')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: xhr.responseText })
    xhr.onerror = () => resolve({ ok: false, status: xhr.status || 0, text: 'XHR error' })
    xhr.ontimeout = () => resolve({ ok: false, status: xhr.status || 0, text: 'XHR timeout' })
    xhr.timeout = 12000
    xhr.send()
  })
}, url)

const isMatrixPayload = (text) => {
  if (!text || !String(text).trim().startsWith('{')) return false
  try {
    const payload = JSON.parse(text)
    return Array.isArray(payload?.Linhas) && payload.Linhas.length > 0
  } catch {
    return false
  }
}

const updatedAtByTarget = new Map()
const matrixSignatureByUrl = new Map()

const matrixSignature = (text) => {
  try {
    const payload = JSON.parse(text)
    return [
      payload.DataAtualizacao ?? '',
      payload.Linhas?.[0]?.Hora ?? '',
      payload.Linhas?.[0]?.Colunas?.length ?? 0,
      payload.Linhas?.[0]?.Colunas?.[0]?.Resultado ?? payload.Linhas?.[0]?.Colunas?.[0]?.Resultado_FT ?? '',
    ].join('|')
  } catch {
    return text.slice(0, 120)
  }
}

const runCycle = async (openPageByKey) => {
  state.lastCycleAt = new Date().toISOString()

  for (const target of targets) {
    const page = openPageByKey[target.page]
    let shouldFetch = !updatedAtByTarget.has(target.label)

    if (target.updatedAtUrl) {
      const response = await xhrText(page, target.updatedAtUrl)
      if (response.ok) {
        shouldFetch = shouldFetch || updatedAtByTarget.get(target.label) !== response.text
        updatedAtByTarget.set(target.label, response.text)
      } else {
        shouldFetch = true
        rememberError(`${target.label}/ultimaAtualizacao HTTP ${response.status}: ${response.text.slice(0, 120)}`)
      }
    }

    if (!shouldFetch) continue

    for (const url of target.matrixUrls) {
      const response = await xhrText(page, url)
      if (!response.ok) {
        rememberError(`${target.label} HTTP ${response.status}: ${response.text.slice(0, 120)}`)
        continue
      }
      state.fetched += 1
      if (!isMatrixPayload(response.text)) {
        rememberError(`${target.label}: resposta sem Linhas`)
        continue
      }

      const signature = matrixSignature(response.text)
      if (matrixSignatureByUrl.get(url) === signature) continue
      matrixSignatureByUrl.set(url, signature)

      await postLocal('/api/bbtips/ingest', {
        payload: JSON.parse(response.text),
        source: 'playwright-hot-bridge',
        url,
      })
      state.ingested += 1
      await delay(30)
    }
  }
}

const main = async () => {
  const { browser, context, ownsBrowser } = await openPages()
  const openPageByKey = {}
  for (const [key, url] of Object.entries(pages)) {
    openPageByKey[key] = await ensurePage(context, key, url)
  }

  console.log(`BBTips hot bridge ativo: ${targets.length} ligas, polling ${pollMs}ms.`)
  await ping()

  while (true) {
    try {
      await refreshLocalStatus().catch(() => undefined)
      await runCycle(openPageByKey)
      await ping()
    } catch (error) {
      rememberError(error instanceof Error ? error.message : error)
      await ping()
    }

    if (runOnce) break
    await delay(pollMs)
  }

  if (ownsBrowser) await context.close()
  else await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
