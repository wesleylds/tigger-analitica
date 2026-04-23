import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const email = process.env.BBTIPS_EMAIL
const password = process.env.BBTIPS_PASSWORD
const headless = process.env.BBTIPS_HEADLESS !== 'false'
const channel = process.env.BBTIPS_CHANNEL || undefined
const outputDir = path.join(process.cwd(), 'captures', 'bbtips-betano-discovery')
const targetUrl = process.env.BBTIPS_TARGET_URL || 'https://app.bbtips.com.br/betano/futebol/horarios'
const warmupUrl = 'https://app.bbtips.com.br/futebol/horarios'
const storageStatePath = path.join(process.cwd(), 'captures', 'bbtips-storage-state.json')

const leagueSteps = [
  { key: 'brasileirao', labels: ['Brasileirao', 'Brasileirão'] },
  { key: 'classicos', labels: ['Classicos', 'Clássicos', 'America'] },
  { key: 'copa', labels: ['Copa'] },
  { key: 'euro', labels: ['Euro'] },
  { key: 'british', labels: ['British'] },
  { key: 'espanhola', labels: ['Espanhola'] },
  { key: 'scudetto', labels: ['Scudetto'] },
  { key: 'italiano', labels: ['Italiano'] },
  { key: 'estrelas', labels: ['Estrelas'] },
  { key: 'campeoes', labels: ['Campeoes', 'Campeões'] },
  { key: 'split', labels: ['Split'] },
]

async function activateBetanoPlatform(page) {
  const dropdownToggleSelectors = [
    'a.nav-link.dropdown-toggle:has-text("Betano")',
    'a:has-text("Betano")',
    'button:has-text("Betano")',
  ]
  const exactBetanoHrefSelectors = [
    'a[href="/betano/futebol/horarios"]',
    'a[href="https://app.bbtips.com.br/betano/futebol/horarios"]',
    '[routerlink="/betano/futebol/horarios"]',
  ]

  for (const selector of dropdownToggleSelectors) {
    const locator = page.locator(selector)
    const count = await locator.count().catch(() => 0)

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index)
      if (!(await candidate.isVisible().catch(() => false))) continue

      await candidate.click({ force: true }).catch(() => {})
      await page.waitForTimeout(800)
    }
  }

  for (const selector of exactBetanoHrefSelectors) {
    const locator = page.locator(selector)
    const count = await locator.count().catch(() => 0)

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index)
      const href = await candidate.getAttribute('href').catch(() => null)
      const routerLink = await candidate.getAttribute('routerlink').catch(() => null)

      if (!(await candidate.isVisible().catch(() => false))) continue
      if (
        href !== '/betano/futebol/horarios' &&
        href !== 'https://app.bbtips.com.br/betano/futebol/horarios' &&
        routerLink !== '/betano/futebol/horarios'
      ) {
        continue
      }

      await Promise.allSettled([
        page.waitForURL(/\/betano\/futebol\/horarios/i, { timeout: 30_000 }),
        candidate.click({ force: true }),
      ])
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
      await page.waitForTimeout(5_000)

      if (/\/betano\/futebol\/horarios/i.test(page.url())) {
        return true
      }
    }
  }

  await page.evaluate(() => {
    const target = [...document.querySelectorAll('a')]
      .find((node) => node.getAttribute('href') === '/betano/futebol/horarios')

    target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(5_000)

  return /\/betano\/futebol\/horarios/i.test(page.url())
}

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

      const finalValue = await candidate.inputValue().catch(() => '')
      if (finalValue) return true
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

async function maybeLogin(page) {
  const needsLogin =
    page.url().includes('/login') ||
    (await page.locator('input[type="password"], input[formcontrolname="password"]').count()) > 0

  if (!needsLogin) {
    return { attempted: false, succeeded: true }
  }

  if (!email || !password) {
    throw new Error('Defina BBTIPS_EMAIL e BBTIPS_PASSWORD para descobrir a Betano na BBTips.')
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

  const clicked = await clickFirstVisible(page, [
    'button[type="submit"]',
    'button:has-text("Entrar")',
    'button:has-text("Login")',
  ])

  if (!clicked) {
    return { attempted: true, succeeded: false }
  }

  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {})
  await page.waitForTimeout(5_000)

  return {
    attempted: true,
    succeeded:
      !page.url().includes('/login') &&
      (await page.locator('input[type="password"], input[formcontrolname="password"]').count()) === 0,
  }
}

async function clickLeagueStep(page, step) {
  for (const label of step.labels) {
    const locator = page.getByText(label, { exact: true })
    const count = await locator.count().catch(() => 0)

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index)
      if (!(await candidate.isVisible().catch(() => false))) continue

      await candidate.click({ force: true }).catch(() => {})
      await page.waitForTimeout(3_500)
      return { clickedLabel: label, found: true }
    }
  }

  return { clickedLabel: null, found: false }
}

async function main() {
  await mkdir(outputDir, { recursive: true })

  const browser = await chromium.launch({
    headless,
    channel,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext(
    existsSync(storageStatePath)
      ? { storageState: storageStatePath }
      : undefined,
  )
  const page = await context.newPage()
  const networkEntries = []

  page.on('request', (request) => {
    const url = request.url()
    if (!/api\.bbtips\.com\.br\/api\//i.test(url)) return
    networkEntries.push({
      kind: 'request',
      method: request.method(),
      postData: request.postData(),
      resourceType: request.resourceType(),
      timestamp: Date.now(),
      url,
    })
  })

  page.on('response', async (response) => {
    const url = response.url()
    if (!/api\.bbtips\.com\.br\/api\//i.test(url)) return

    let textPreview = ''
    try {
      textPreview = (await response.text()).slice(0, 4000)
    } catch {}

    networkEntries.push({
      kind: 'response',
      status: response.status(),
      timestamp: Date.now(),
      textPreview,
      url,
    })
  })

  try {
    await page.goto(warmupUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    await page.waitForTimeout(5_000)

    const loginState = await maybeLogin(page)
    await page.waitForTimeout(8_000)

    const platformActivated = await activateBetanoPlatform(page)
    if (!platformActivated) {
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      await page.waitForTimeout(8_000)
    }

    const clickedSteps = []
    for (const step of leagueSteps) {
      const result = await clickLeagueStep(page, step)
      clickedSteps.push({
        key: step.key,
        ...result,
        url: page.url(),
      })
    }

    const bodyTextPreview = ((await page.locator('body').innerText().catch(() => '')) || '').slice(0, 12000)
    const navTargets = await page.evaluate(() =>
      [...document.querySelectorAll('a, button')]
        .map((node) => {
          const element = node
          const text = (element.textContent || '').replace(/\s+/g, ' ').trim()
          const href = element instanceof HTMLAnchorElement ? element.href : null
          const routerLink = element.getAttribute('routerlink')
          return { href, routerLink, tag: element.tagName.toLowerCase(), text }
        })
        .filter((entry) => entry.text || entry.href || entry.routerLink)
        .slice(0, 200),
    )
    const detectedLeagueRequests = networkEntries
      .filter((entry) => /futebolvirtual|futService/i.test(entry.url))
      .map((entry) => entry.url)

    const payload = {
      bodyTextPreview,
      clickedSteps,
      detectedLeagueRequests: [...new Set(detectedLeagueRequests)],
      loginState,
      networkEntries,
      navTargets,
      platformActivated,
      title: await page.title(),
      url: page.url(),
    }

    await page.screenshot({ path: path.join(outputDir, 'page.png'), fullPage: true })
    await writeFile(path.join(outputDir, 'page.html'), await page.content(), 'utf8')
    await writeFile(path.join(outputDir, 'result.json'), JSON.stringify(payload, null, 2), 'utf8')

    console.log(`Resultado salvo em ${outputDir}`)
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
