import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const rootDir = process.cwd()
const capturesDir = path.join(rootDir, 'captures')

const siteConfigs = {
  easycoanalytics: {
    id: 'easycoanalytics',
    name: 'Easy Analytics',
    loginUrl: 'https://app.easycoanalytics.com.br/',
    navTexts: ['Dashboard', 'Futebol Virtual', 'Criar Bots', 'Extras', 'Chamar Suporte'],
    afterLoginPaths: [
      '/dash/futebol-virtual/betano',
      '/dash/futebol-virtual/bet365',
      '/dash/criar-bots',
    ],
  },
  historicosbet: {
    id: 'historicosbet',
    name: 'Historicos Bet',
    loginUrl: 'https://historicosbet.com/login',
    navTexts: ['Historicos', 'Bots', 'Ranking', 'Alertas', 'Entrar'],
    afterLoginPaths: [],
  },
}

const sensitiveParamPattern = /token|auth|key|secret|password|pass|email|session|jwt|bearer/i
const apiPattern = /(\/api\/|graphql|socket|signalr|odds|fixture|virtual|market|history|historico|partida|jogo|league|liga|bot)/i
const mediaPattern = /\.(png|jpe?g|gif|svg|ico|woff2?|ttf|css|map)$/i
const loginButtonPattern = /entrar|login|sign in|acessar/i

function timestampSlug() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function sanitizeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    for (const [key] of parsed.searchParams.entries()) {
      if (sensitiveParamPattern.test(key)) {
        parsed.searchParams.set(key, '[redacted]')
      }
    }
    return parsed.toString()
  } catch {
    return rawUrl
  }
}

function endpointKey(method, rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    return `${method.toUpperCase()} ${parsed.origin}${parsed.pathname}`
  } catch {
    return `${method.toUpperCase()} ${rawUrl}`
  }
}

function looksLikeApi(entry) {
  const method = (entry.request?.method ?? '').toUpperCase()
  const url = entry.request?.url ?? ''
  const contentType =
    entry.response?.content?.mimeType ??
    entry.response?.headers?.find((header) => header.name.toLowerCase() === 'content-type')?.value ??
    ''

  if (!url || mediaPattern.test(url)) {
    return false
  }

  if (url.includes('/_next/static/') || url.endsWith('/sw.js')) {
    return false
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return true
  }

  return apiPattern.test(url) || /json|javascript|event-stream|protobuf/i.test(contentType)
}

function buildSummary(harJson) {
  const pages = harJson.log?.pages ?? []
  const entries = harJson.log?.entries ?? []
  const summaryMap = new Map()

  for (const entry of entries) {
    if (!looksLikeApi(entry)) {
      continue
    }

    const method = entry.request?.method ?? 'GET'
    const url = sanitizeUrl(entry.request?.url ?? '')
    const key = endpointKey(method, url)
    const headerMap = new Map(
      (entry.response?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]),
    )

    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        method,
        url,
        statusCodes: new Set(),
        mimeTypes: new Set(),
        hits: 0,
      })
    }

    const current = summaryMap.get(key)
    current.hits += 1
    current.statusCodes.add(entry.response?.status ?? 0)
    if (headerMap.get('content-type')) {
      current.mimeTypes.add(headerMap.get('content-type'))
    }
  }

  const endpoints = Array.from(summaryMap.values())
    .map((entry) => ({
      ...entry,
      statusCodes: Array.from(entry.statusCodes).sort((a, b) => a - b),
      mimeTypes: Array.from(entry.mimeTypes),
    }))
    .sort((left, right) => {
      if (left.url === right.url) {
        return left.method.localeCompare(right.method)
      }
      return left.url.localeCompare(right.url)
    })

  return {
    capturedAt: new Date().toISOString(),
    totalPages: pages.length,
    totalHarEntries: entries.length,
    apiEndpoints: endpoints.length,
    endpoints,
  }
}

async function fillFirstVisible(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector)
    const count = await locator.count()
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index)
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.click({ force: true }).catch(() => {})
        await candidate.fill('').catch(() => {})
        await candidate.pressSequentially(value, { delay: 35 }).catch(() => {})

        let currentValue = await candidate.inputValue().catch(() => '')
        if (currentValue !== value) {
          await candidate.evaluate(
            (node, nextValue) => {
              const element = node
              element.focus()
              element.value = nextValue
              element.dispatchEvent(new Event('input', { bubbles: true }))
              element.dispatchEvent(new Event('change', { bubbles: true }))
              element.blur()
            },
            value,
          )
          currentValue = await candidate.inputValue().catch(() => '')
        }

        if (currentValue === value) {
          return true
        }
      }
    }
  }

  return false
}

async function clickLogin(page) {
  const roleButtons = page.getByRole('button', { name: loginButtonPattern })
  if (await roleButtons.count()) {
    await roleButtons.first().click()
    return true
  }

  const textButtons = page.locator('button, [role="button"], input[type="submit"]')
  const count = await textButtons.count()
  for (let index = 0; index < count; index += 1) {
    const candidate = textButtons.nth(index)
    const text = (await candidate.innerText().catch(() => '')) || (await candidate.inputValue().catch(() => ''))
    if (loginButtonPattern.test(text) && (await candidate.isVisible().catch(() => false))) {
      await candidate.click()
      return true
    }
  }

  await page.keyboard.press('Enter').catch(() => {})
  return true
}

async function readCurrentValue(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector)
    const count = await locator.count()
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index)
      if (await candidate.isVisible().catch(() => false)) {
        const value = await candidate.inputValue().catch(() => '')
        if (value) {
          return value
        }
      }
    }
  }

  return false
}

async function exploreSite(page, config) {
  for (const label of config.navTexts) {
    const navTarget = page.getByRole('link', { name: new RegExp(label, 'i') }).first()
    if (await navTarget.isVisible().catch(() => false)) {
      await navTarget.click().catch(() => {})
      await page.waitForTimeout(2500)
      continue
    }

    const buttonTarget = page.getByRole('button', { name: new RegExp(label, 'i') }).first()
    if (await buttonTarget.isVisible().catch(() => false)) {
      await buttonTarget.click().catch(() => {})
      await page.waitForTimeout(2500)
    }
  }
}

async function savePageSnapshot(page, siteDir, routePath, index) {
  const snapshotSlug = routePath
    .replaceAll(/^\/+|\/+$/g, '')
    .replaceAll('/', '__')
    .replaceAll(/[?&=%]/g, '_')

  const htmlPath = path.join(siteDir, `page-${index + 1}-${snapshotSlug}.html`)
  const screenshotPath = path.join(siteDir, `page-${index + 1}-${snapshotSlug}.png`)

  await writeFile(htmlPath, await page.content(), 'utf8')
  await page.screenshot({ path: screenshotPath, fullPage: true })

  return { htmlPath, screenshotPath }
}

async function runForSite(config, email, password) {
  const runId = `${config.id}-${timestampSlug()}`
  const siteDir = path.join(capturesDir, runId)
  const harPath = path.join(siteDir, `${config.id}.har`)
  const screenshotBeforePath = path.join(siteDir, 'login-page.png')
  const screenshotAfterPath = path.join(siteDir, 'after-login.png')
  const summaryPath = path.join(siteDir, 'api-summary.json')
  const reportPath = path.join(siteDir, 'report.md')
  const storageStatePath = path.join(siteDir, 'storage-state.json')
  const snapshots = []

  await mkdir(siteDir, { recursive: true })

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  })

  const context = await browser.newContext({
    recordHar: {
      path: harPath,
      content: 'embed',
      mode: 'full',
    },
  })

  const page = await context.newPage()

  try {
    await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.screenshot({ path: screenshotBeforePath, fullPage: true })

    const emailFilled = await fillFirstVisible(
      page,
      [
        'input[placeholder*="mail" i]',
        'input[type="email"]',
        'input[name*="email" i]',
        'input[placeholder*="email" i]',
        'input[autocomplete="username"]',
        'input[name*="usuario" i]',
      ],
      email,
    )

    const passwordFilled = await fillFirstVisible(
      page,
      [
        'input[type="password"]',
        'input[name*="senha" i]',
        'input[name*="password" i]',
        'input[autocomplete="current-password"]',
      ],
      password,
    )

    if (!emailFilled || !passwordFilled) {
      throw new Error(`Nao consegui localizar os campos de login em ${config.loginUrl}`)
    }

    const typedEmailValue = await readCurrentValue(page, [
      'input[placeholder*="mail" i]',
      'input[type="email"]',
      'input[name*="email" i]',
      'input[placeholder*="email" i]',
      'input[autocomplete="username"]',
      'input[name*="usuario" i]',
    ])

    if (!typedEmailValue || !typedEmailValue.includes('@')) {
      throw new Error(`O campo de email nao manteve um valor valido em ${config.loginUrl}`)
    }

    const loginClicked = await clickLogin(page)

    if (!loginClicked) {
      throw new Error(`Nao consegui localizar o botao de login em ${config.loginUrl}`)
    }

    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(8000)

    await exploreSite(page, config)
    await page.waitForTimeout(5000)

    for (const [index, routePath] of (config.afterLoginPaths ?? []).entries()) {
      const targetUrl = new URL(routePath, config.loginUrl).toString()
      await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
      await page.waitForTimeout(4000)
      snapshots.push(await savePageSnapshot(page, siteDir, routePath, index))
    }

    await page.screenshot({ path: screenshotAfterPath, fullPage: true })
    await context.storageState({ path: storageStatePath })
  } finally {
    await context.close()
    await browser.close()
  }

  const harJson = JSON.parse(await readFile(harPath, 'utf8'))
  const summary = buildSummary(harJson)

  await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8')

  const reportLines = [
    `# ${config.name}`,
    '',
    `- Capturado em: ${summary.capturedAt}`,
    `- Total de entradas HAR: ${summary.totalHarEntries}`,
    `- Endpoints candidatos a API: ${summary.apiEndpoints}`,
    '',
    '## Endpoints',
    '',
    ...summary.endpoints.map(
      (endpoint) =>
        `- \`${endpoint.method}\` ${endpoint.url} | status: ${endpoint.statusCodes.join(', ')} | hits: ${endpoint.hits}`,
    ),
    '',
    '## Snapshots',
    '',
    ...(snapshots.length > 0
      ? snapshots.flatMap((snapshot) => [
          `- HTML: ${path.relative(rootDir, snapshot.htmlPath)}`,
          `- Screenshot: ${path.relative(rootDir, snapshot.screenshotPath)}`,
        ])
      : ['- Nenhum snapshot adicional gerado.']),
    '',
    '## Arquivos gerados',
    '',
    `- HAR: ${path.relative(rootDir, harPath)}`,
    `- Resumo JSON: ${path.relative(rootDir, summaryPath)}`,
    `- Storage state: ${path.relative(rootDir, storageStatePath)}`,
    `- Screenshot login: ${path.relative(rootDir, screenshotBeforePath)}`,
    `- Screenshot pos-login: ${path.relative(rootDir, screenshotAfterPath)}`,
  ]

  await writeFile(reportPath, reportLines.join('\n'), 'utf8')

  return {
    config,
    siteDir,
    summary,
    reportPath,
  }
}

async function main() {
  const email = process.env.SCRAPER_EMAIL
  const password = process.env.SCRAPER_PASSWORD
  const requestedSites = process.argv.slice(2)

  if (!email || !password) {
    throw new Error('Defina SCRAPER_EMAIL e SCRAPER_PASSWORD antes de rodar o capturador.')
  }

  const selectedConfigs =
    requestedSites.length > 0
      ? requestedSites.map((siteId) => {
          const config = siteConfigs[siteId]
          if (!config) {
            throw new Error(`Site desconhecido: ${siteId}`)
          }
          return config
        })
      : Object.values(siteConfigs)

  await mkdir(capturesDir, { recursive: true })

  for (const config of selectedConfigs) {
    const result = await runForSite(config, email, password)
    console.log(`${config.name}: ${result.summary.apiEndpoints} endpoints candidatos em ${result.reportPath}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
