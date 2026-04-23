import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const email = process.env.BBTIPS_EMAIL
const password = process.env.BBTIPS_PASSWORD
const headless = process.env.BBTIPS_HEADLESS !== 'false'
const channel = process.env.BBTIPS_CHANNEL || undefined
const userAgent = process.env.BBTIPS_USER_AGENT || undefined

const outputDir = path.join(process.cwd(), 'captures', 'bbtips-page-capture')

const interestingRequest = (url) =>
  /bbtips|api|socket|ws|ranking|horarios|fut|liga|jogo|match|future|proximo/i.test(url)

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

      const currentValue = await candidate.inputValue().catch(() => '')
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
  const needsLogin =
    page.url().includes('/login') ||
    (await page.locator('input[type="password"], input[formcontrolname="password"]').count()) > 0

  if (!needsLogin || !email || !password) {
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

async function main() {
  await mkdir(outputDir, { recursive: true })

  const browser = await chromium.launch({
    headless,
    channel,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext(
    userAgent
      ? {
          userAgent,
        }
      : undefined,
  )
  const page = await context.newPage()
  const entries = []

  page.on('request', (request) => {
    const url = request.url()
    if (!interestingRequest(url)) return
    entries.push({
      kind: 'request',
      method: request.method(),
      resourceType: request.resourceType(),
      url,
      headers: request.headers(),
    })
  })

  page.on('response', async (response) => {
    const url = response.url()
    if (!interestingRequest(url)) return

    const headers = await response.allHeaders().catch(() => ({}))
    const contentType = headers['content-type'] ?? ''
    let bodyPreview = ''

    if (/json|text|javascript/i.test(contentType)) {
      bodyPreview = (await response.text().catch(() => '')).slice(0, 1200)
    }

    entries.push({
      kind: 'response',
      status: response.status(),
      url,
      headers,
      bodyPreview,
    })
  })

  try {
    await page.goto('https://app.bbtips.com.br/futebol/horarios', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    const loginState = await maybeLogin(page)
    await page.waitForTimeout(8000)

    const pageInfo = {
      title: await page.title(),
      url: page.url(),
      loginState,
      bodyTextPreview: ((await page.locator('body').innerText().catch(() => '')) || '').slice(0, 6000),
      localStorage: await page.evaluate(() =>
        Object.fromEntries(Object.keys(window.localStorage).map((key) => [key, window.localStorage.getItem(key)])),
      ),
      sessionStorage: await page.evaluate(() =>
        Object.fromEntries(Object.keys(window.sessionStorage).map((key) => [key, window.sessionStorage.getItem(key)])),
      ),
      cookies: await context.cookies(),
    }

    await page.screenshot({ path: path.join(outputDir, 'page.png'), fullPage: true })
    await writeFile(path.join(outputDir, 'page.html'), await page.content(), 'utf8')
    await writeFile(path.join(outputDir, 'page-info.json'), JSON.stringify(pageInfo, null, 2), 'utf8')
    await writeFile(path.join(outputDir, 'network-log.json'), JSON.stringify(entries, null, 2), 'utf8')

    console.log(`Captura salva em ${outputDir}`)
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
