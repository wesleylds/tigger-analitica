import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const headless = false
const email = process.env.BBTIPS_EMAIL?.trim()
const password = process.env.BBTIPS_PASSWORD ?? ''
const browserStatePath = path.join(process.cwd(), 'captures', 'bbtips-browser-state.json')
const storageStatePath = path.join(process.cwd(), 'captures', 'bbtips-storage-state.json')
const outputDir = path.join(process.cwd(), 'captures', 'bbtips-session-refresh')
const targetUrl = 'https://app.bbtips.com.br/futebol/horarios'
const apiProbeUrl =
  'https://api.bbtips.com.br/api/futebolvirtual?liga=2&futuro=false&Horas=Horas12&tipoOdd=&dadosAlteracao=&filtros=&confrontos=false&hrsConfrontos=240'
const readyTimeoutMs = 5 * 60 * 1000
const readyPollMs = 1000

const storageStateCandidates = [browserStatePath, storageStatePath]

const readStorageStateFile = (candidatePath) => {
  try {
    return JSON.parse(readFileSync(candidatePath, 'utf8'))
  } catch {
    return null
  }
}

const getBbtipsOrigin = (state) =>
  state?.origins?.find((entry) => entry.origin === 'https://app.bbtips.com.br') ?? null

async function fillFirstVisible(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector)
    const count = await locator.count()

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index)
      if (!(await candidate.isVisible().catch(() => false))) continue

      await candidate.click({ force: true }).catch(() => {})
      await candidate.fill('').catch(() => {})
      await candidate.pressSequentially(value, { delay: 30 }).catch(() => {})

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
        ).catch(() => {})
        currentValue = await candidate.inputValue().catch(() => '')
      }

      if (currentValue) return true
    }
  }

  return false
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector)
    const count = await locator.count()

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index)
      if (!(await candidate.isVisible().catch(() => false))) continue
      await candidate.click({ force: true }).catch(() => {})
      return true
    }
  }

  return false
}

async function submitFirstVisibleForm(page) {
  const forms = page.locator('form')
  const count = await forms.count()

  for (let index = 0; index < count; index += 1) {
    const form = forms.nth(index)
    if (!(await form.isVisible().catch(() => false))) continue

    await form.evaluate((node) => {
      const formElement = node
      if (typeof formElement.requestSubmit === 'function') {
        formElement.requestSubmit()
        return
      }

      formElement.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    }).catch(() => {})
    return true
  }

  return false
}

async function maybeLogin(page) {
  if (!email || !password) return { attempted: false, succeeded: false }

  const needsLogin =
    page.url().includes('/login') ||
    (await page.locator('input[type="password"], input[formcontrolname="password"]').count()) > 0

  if (!needsLogin) {
    return { attempted: false, succeeded: false }
  }

  const emailFilled = await fillFirstVisible(
    page,
    [
      'input[formcontrolname="username"]',
      'input[formcontrolname="userName"]',
      'input#email',
      'input[type="email"]',
      'input[name="username"]',
      'input[autocomplete="username"]',
    ],
    email,
  )
  const passwordFilled = await fillFirstVisible(
    page,
    [
      'input[formcontrolname="password"]',
      'input[type="password"]',
      'input[autocomplete="current-password"]',
    ],
    password,
  )

  if (!emailFilled || !passwordFilled) {
    return { attempted: true, succeeded: false }
  }

  let clicked = await clickFirstVisible(page, [
    'button[type="submit"]',
    'button:has-text("Entrar")',
    'button:has-text("Login")',
  ])

  if (!clicked) {
    clicked = await submitFirstVisibleForm(page)
  }

  if (!clicked) {
    return { attempted: true, succeeded: false }
  }

  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(5000)
  await page.waitForURL((url) => !url.pathname.includes('/login'), {
    timeout: 15000,
  }).catch(() => {})

  return {
    attempted: true,
    succeeded:
      !page.url().includes('/login') &&
      (await page.locator('input[type="password"], input[formcontrolname="password"]').count()) === 0,
  }
}

const challengePattern = /just a moment|um momento|verificacao de seguranca|verificação de segurança|cloudflare/i

const resolveStorageStatePath = () =>
  storageStateCandidates
    .filter((candidatePath) => existsSync(candidatePath))
    .map((candidatePath) => {
      const state = readStorageStateFile(candidatePath)
      if (!state) return null

      const bbtipsOrigin = getBbtipsOrigin(state)
      const hasAccessToken = Boolean(
        bbtipsOrigin?.localStorage?.some((entry) => entry.name === 'access_token' && entry.value),
      )
      const hasCurrentUser = Boolean(
        bbtipsOrigin?.localStorage?.some((entry) => entry.name === 'currentUser' && entry.value),
      )
      const hasBbtipsCookie = (state.cookies ?? []).some((cookie) =>
        /(^|\.)(bbtips\.com\.br|api\.bbtips\.com\.br)$/i.test(String(cookie.domain ?? '').replace(/^\./, '')) ||
        /^cf_/i.test(String(cookie.name ?? '')),
      )

      return {
        path: candidatePath,
        score: Number(hasAccessToken) * 4 + Number(hasCurrentUser) * 2 + Number(hasBbtipsCookie),
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)[0]?.path ?? null

const readPageSnapshot = async (page) => {
  const pageSnapshot = await page.evaluate(() => {
    const browserGlobal = globalThis
    const localStorageKeys = Array.from(
      { length: browserGlobal.localStorage?.length ?? 0 },
      (_, index) => browserGlobal.localStorage?.key(index) ?? '',
    ).filter(Boolean)

    return {
      bodyPreview: browserGlobal.document?.body?.innerText?.slice(0, 1200) ?? '',
      hasAccessToken: localStorageKeys.includes('access_token'),
      hasCurrentUser: localStorageKeys.includes('currentUser'),
      href: browserGlobal.location?.href ?? '',
      localStorageKeys,
      title: browserGlobal.document?.title ?? '',
      hasPasswordField: Boolean(
        browserGlobal.document?.querySelector?.('input[type="password"], input[formcontrolname="password"]'),
      ),
    }
  }).catch(() => ({
    bodyPreview: '',
    hasAccessToken: false,
    hasCurrentUser: false,
    hasPasswordField: false,
    href: page.url(),
    localStorageKeys: [],
    title: '',
  }))

  const bbtipsCookieNames = await page.context().cookies()
    .then((cookies) =>
      cookies
        .filter((cookie) =>
          /(^|\.)(bbtips\.com\.br|api\.bbtips\.com\.br)$/i.test(String(cookie.domain ?? '').replace(/^\./, '')) ||
          /^cf_/i.test(String(cookie.name ?? '')),
        )
        .map((cookie) => cookie.name),
    )
    .catch(() => [])

  return {
    ...pageSnapshot,
    bbtipsCookieCount: bbtipsCookieNames.length,
    bbtipsCookieNames,
  }
}

const isReadySnapshot = (snapshot) =>
  !snapshot.hasPasswordField &&
  !challengePattern.test(`${snapshot.title}\n${snapshot.bodyPreview}\n${snapshot.href}`) &&
  snapshot.href.includes('app.bbtips.com.br') &&
  (snapshot.hasAccessToken || snapshot.hasCurrentUser)

const probeApiFromPage = async (page) =>
  page.evaluate(async (url) => {
    const resolveToken = () => {
      const directToken = globalThis.localStorage?.getItem('access_token')?.trim()
      if (directToken) return directToken

      const currentUserRaw = globalThis.localStorage?.getItem('currentUser')
      if (!currentUserRaw) return ''

      try {
        return JSON.parse(currentUserRaw)?.token?.trim() || ''
      } catch {
        return ''
      }
    }

    const token = resolveToken()
    try {
      const response = await globalThis.fetch(url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
      })
      const text = await response.text()
      let parsed = null

      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }

      return {
        ok: response.ok && Boolean(parsed?.Linhas?.length),
        rowCount: Array.isArray(parsed?.Linhas) ? parsed.Linhas.length : 0,
        status: response.status,
        textPreview: text.slice(0, 300),
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
        rowCount: 0,
        status: 0,
        textPreview: '',
      }
    }
  }, apiProbeUrl).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
    ok: false,
    rowCount: 0,
    status: 0,
    textPreview: '',
  }))

const main = async () => {
  await mkdir(outputDir, { recursive: true })

  const browser = await chromium.launch({
    headless,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  }).catch(() =>
    chromium.launch({
      headless,
      args: ['--disable-blink-features=AutomationControlled'],
    }),
  )

  const storageState = resolveStorageStatePath()
  const context = await browser.newContext(
    storageState
      ? { storageState }
      : undefined,
  )
  const page = await context.newPage()

  try {
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    }).catch(() => undefined)
    await maybeLogin(page)

    console.log('BB Tips aberta. Passe pela verificacao/login se aparecer.')
    console.log('Quando a pagina entrar no app, a sessao sera salva automaticamente.')

    const startedAt = Date.now()
    let readySnapshot = await readPageSnapshot(page)
    let apiProbe = await probeApiFromPage(page)

    while (
      (!isReadySnapshot(readySnapshot) || !apiProbe.ok) &&
      Date.now() - startedAt < readyTimeoutMs
    ) {
      if (readySnapshot.hasPasswordField || page.url().includes('/login')) {
        await maybeLogin(page)
      }
      await page.waitForTimeout(readyPollMs)
      readySnapshot = await readPageSnapshot(page)
      apiProbe = isReadySnapshot(readySnapshot)
        ? await probeApiFromPage(page)
        : {
            ok: false,
            rowCount: 0,
            status: 0,
            textPreview: '',
          }
    }

    if (!isReadySnapshot(readySnapshot) || !apiProbe.ok) {
      throw new Error('A sessao do BB Tips nao ficou pronta dentro do tempo limite.')
    }

    await context.storageState({ path: browserStatePath })
    await writeFile(
      path.join(outputDir, 'last-refresh.json'),
      JSON.stringify({
        readyAt: new Date().toISOString(),
        apiProbe,
        snapshot: readySnapshot,
        storageStatePath: browserStatePath,
      }, null, 2),
      'utf8',
    )

    console.log(`Sessao atualizada em ${browserStatePath}`)
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
