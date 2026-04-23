import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const email = process.env.BBTIPS_EMAIL?.trim()
const password = process.env.BBTIPS_PASSWORD ?? ''
const profileDir = process.env.BBTIPS_BRIDGE_PROFILE_DIR ||
  path.join(process.cwd(), 'captures', 'bbtips-bridge-chrome-profile')
const targetUrl = process.env.BBTIPS_LOGIN_URL ||
  'https://app.bbtips.com.br/betano/futebol/horarios'
const readyTimeoutMs = Number(process.env.BBTIPS_LOGIN_TIMEOUT_MS ?? 180_000)
const probeUrls = [
  'https://api.bbtips.com.br/api/betanoFutebolVirtual?liga=2&Horas=Horas12&dadosAlteracao=&filtros=',
  'https://api.bbtips.com.br/api/playpixFutebolVirtual?liga=2&Horas=Horas12&dadosAlteracao=&filtros=',
  'https://api.bbtips.com.br/api/futebolvirtual?liga=2&futuro=false&Horas=Horas24&tipoOdd=&dadosAlteracao=&filtros=&confrontos=false&hrsConfrontos=240',
]

if (!email || !password) {
  throw new Error('Defina BBTIPS_EMAIL e BBTIPS_PASSWORD para autenticar o perfil bridge.')
}

const fillFirstVisible = async (page, selectors, value) => {
  for (const selector of selectors) {
    const locator = page.locator(selector)
    const count = await locator.count().catch(() => 0)

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index)
      if (!(await candidate.isVisible().catch(() => false))) continue

      await candidate.click({ force: true }).catch(() => undefined)
      await candidate.fill('').catch(() => undefined)
      await candidate.pressSequentially(value, { delay: 20 }).catch(() => undefined)
      await candidate.evaluate((node, nextValue) => {
        const element = node
        element.focus()
        element.value = nextValue
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
      }, value).catch(() => undefined)

      const currentValue = await candidate.inputValue().catch(() => '')
      if (currentValue) return true
    }
  }

  return false
}

const clickFirstVisible = async (page, selectors) => {
  for (const selector of selectors) {
    const locator = page.locator(selector)
    const count = await locator.count().catch(() => 0)

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index)
      if (!(await candidate.isVisible().catch(() => false))) continue
      await candidate.click({ force: true }).catch(() => undefined)
      return true
    }
  }

  return false
}

const maybeLogin = async (page) => {
  const hasPasswordField = await page.locator('input[type="password"], input[formcontrolname="password"]').count()
    .then((count) => count > 0)
    .catch(() => false)
  const needsLogin = page.url().includes('/login') || hasPasswordField

  if (!needsLogin) return false

  const emailFilled = await fillFirstVisible(page, [
    'input[formcontrolname="username"]',
    'input[formcontrolname="userName"]',
    'input#email',
    'input[type="email"]',
    'input[name="username"]',
    'input[autocomplete="username"]',
    'input[type="text"]',
  ], email)
  const passwordFilled = await fillFirstVisible(page, [
    'input[formcontrolname="password"]',
    'input[type="password"]',
    'input[autocomplete="current-password"]',
  ], password)

  if (!emailFilled || !passwordFilled) return false

  const clicked = await clickFirstVisible(page, [
    'button[type="submit"]',
    'button:has-text("Entrar")',
    'button:has-text("Login")',
    'button:has-text("Acessar")',
  ])

  if (!clicked) {
    await page.keyboard.press('Enter').catch(() => undefined)
  }

  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => undefined)
  await page.waitForTimeout(4_000)
  return true
}

const probeApi = async (page) =>
  page.evaluate(async (urls) => {
    const results = []
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          credentials: 'include',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
          },
        })
        const text = await response.text()
        let json = null
        try {
          json = JSON.parse(text)
        } catch {}
        results.push({
          ok: response.ok && Array.isArray(json?.Linhas) && json.Linhas.length > 0,
          rows: Array.isArray(json?.Linhas) ? json.Linhas.length : 0,
          status: response.status,
          url,
        })
      } catch (error) {
        results.push({
          error: error instanceof Error ? error.message : String(error),
          ok: false,
          rows: 0,
          status: 0,
          url,
        })
      }
    }
    return results
  }, probeUrls)

const main = async () => {
  await mkdir(profileDir, { recursive: true })
  const context = await chromium.launchPersistentContext(profileDir, {
    args: ['--disable-blink-features=AutomationControlled'],
    channel: 'chrome',
    headless: false,
    viewport: { height: 900, width: 1366 },
  }).catch(() =>
    chromium.launchPersistentContext(profileDir, {
      args: ['--disable-blink-features=AutomationControlled'],
      headless: false,
      viewport: { height: 900, width: 1366 },
    }),
  )
  const page = context.pages()[0] ?? await context.newPage()

  try {
    await page.goto(targetUrl, { timeout: 60_000, waitUntil: 'domcontentloaded' }).catch(() => undefined)
    const startedAt = Date.now()
    let lastProbe = []

    while (Date.now() - startedAt < readyTimeoutMs) {
      await maybeLogin(page)
      await page.waitForTimeout(1500)
      lastProbe = await probeApi(page)

      if (lastProbe.some((result) => result.ok)) {
        console.log(JSON.stringify({
          ok: true,
          profileDir,
          probe: lastProbe,
          url: page.url(),
        }, null, 2))
        await context.close()
        return
      }
    }

    console.log(JSON.stringify({
      ok: false,
      profileDir,
      probe: lastProbe,
      url: page.url(),
    }, null, 2))
    throw new Error('Login BBTips nao liberou a API dentro do tempo.')
  } finally {
    await context.close().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
