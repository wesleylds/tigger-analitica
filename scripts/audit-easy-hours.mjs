import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const rootDir = process.cwd()
const capturesDir = path.join(rootDir, 'captures')
const loginUrl = 'https://app.easycoanalytics.com.br/'
const betanoUrl = 'https://app.easycoanalytics.com.br/dash/futebol-virtual/betano'

const email = process.env.EASY_EMAIL ?? process.env.SCRAPER_EMAIL
const password = process.env.EASY_PASSWORD ?? process.env.SCRAPER_PASSWORD
const includeScreenshots = process.env.EASY_AUDIT_SCREENSHOTS === '1'
const includeOddOptions = process.env.EASY_AUDIT_ODDS === '1'
const marketLimit = Number(process.env.EASY_AUDIT_MARKET_LIMIT ?? 0)

if (!email || !password) {
  throw new Error('Defina EASY_EMAIL/EASY_PASSWORD ou SCRAPER_EMAIL/SCRAPER_PASSWORD.')
}

function timestampSlug() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function slugify(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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

      if ((await candidate.inputValue().catch(() => '')) === value) {
        return true
      }
    }
  }

  return false
}

async function clickLogin(page) {
  const candidates = page.locator('button, input[type="submit"], [role="button"]')
  const count = await candidates.count()

  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index)
    if (!(await candidate.isVisible().catch(() => false))) continue

    const text =
      (await candidate.innerText().catch(() => '')) ||
      (await candidate.inputValue().catch(() => '')) ||
      (await candidate.textContent().catch(() => ''))

    if (/(entrar|login|sign in|acessar)/i.test(text)) {
      await candidate.click({ force: true }).catch(() => {})
      return true
    }
  }

  await page.keyboard.press('Enter').catch(() => {})
  return false
}

async function waitForDashboard(page) {
  await page.waitForURL(/\/dash\//, { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(3000)
}

async function closeFloatingUi(page) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.mouse.click(20, 20).catch(() => {})
  await page.waitForTimeout(250)
}

async function getFilterTriggers(page) {
  const buttons = page.locator('button')
  const raw = await buttons.evaluateAll((nodes) =>
    nodes
      .map((node, index) => {
        const rect = node.getBoundingClientRect()
        const style = window.getComputedStyle(node)
        return {
          index,
          text: (node.innerText || node.textContent || '').trim(),
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          display: style.display,
          visibility: style.visibility,
        }
      })
      .filter(
        (item) =>
          item.top > 150 &&
          item.top < 240 &&
          item.left > 10 &&
          item.width > 120 &&
          item.height > 20 &&
          item.display !== 'none' &&
          item.visibility !== 'hidden',
      )
      .sort((left, right) => left.left - right.left),
  )

  return raw
}

async function openFilter(page, order) {
  const triggers = await getFilterTriggers(page)
  const trigger = triggers[order]
  if (!trigger) {
    throw new Error(`Nao encontrei o filtro de ordem ${order}`)
  }

  await page.locator('button').nth(trigger.index).click({ force: true }).catch(() => {})
  await page.waitForTimeout(500)

  return trigger
}

async function collectOpenOptions(page) {
  const options = await page
    .locator('[role="option"]')
    .evaluateAll((nodes) => nodes.map((node) => (node.textContent || '').trim()).filter(Boolean))

  return [...new Set(options)]
}

async function selectOpenOption(page, label) {
  const target = normalizeText(label)
  const options = page.locator('[role="option"]')
  const count = await options.count()

  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index)
    if (!(await option.isVisible().catch(() => false))) continue

    const text = normalizeText(await option.textContent().catch(() => ''))
    if (text === target) {
      await option.click({ force: true }).catch(() => {})
      await page.waitForTimeout(800)
      return true
    }
  }

  return false
}

async function getFilterOptions(page, order) {
  await closeFloatingUi(page)
  await openFilter(page, order)
  const options = await collectOpenOptions(page)
  await closeFloatingUi(page)
  return options
}

async function selectFilterOption(page, order, label) {
  await closeFloatingUi(page)
  await openFilter(page, order)
  const selected = await selectOpenOption(page, label)
  if (!selected) {
    await closeFloatingUi(page)
    throw new Error(`Nao consegui selecionar "${label}" no filtro ${order}`)
  }
}

async function ensurePaidHoursOn(page) {
  const toggle = page.locator('#switch-paid-hours').first()
  if (!(await toggle.isVisible().catch(() => false))) return false

  const checked = await toggle.getAttribute('aria-checked').catch(() => null)
  if (checked !== 'true') {
    await toggle.click({ force: true }).catch(() => {})
    await page.waitForTimeout(400)
  }

  return true
}

async function captureFirstCard(page, targetPath) {
  if (!includeScreenshots) {
    return false
  }

  const card = await page.locator('h2').first()
  await card.scrollIntoViewIfNeeded().catch(() => {})

  const article = page.locator('article').filter({ has: card }).first()
  if (await article.isVisible().catch(() => false)) {
    await article.screenshot({ path: targetPath })
    return true
  }

  await page.screenshot({ path: targetPath, fullPage: true })
  return false
}

async function extractVisibleCardState(page) {
  return page.evaluate(() => {
    const numeric = (value) => {
      const match = String(value ?? '').match(/-?\d+(\.\d+)?/)
      return match ? Number(match[0]) : null
    }

    const normalize = (value) =>
      String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()

    const parseRgb = (value) => {
      const match = String(value ?? '').match(/\d+/g)
      if (!match || match.length < 3) return null
      const [r, g, b] = match.slice(0, 3).map(Number)
      return { b, g, r }
    }

    const isBlueBackground = (value) => {
      const rgb = parseRgb(value)
      return Boolean(rgb && rgb.b > 150 && rgb.b > rgb.r + 25 && rgb.b > rgb.g + 25)
    }

    const isVisible = (node) => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || 1) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      )
    }

    const allElements = [...document.querySelectorAll('body *')]
    const matrixRoot = allElements.find((element) => {
      if (!isVisible(element)) return false
      const text = normalize(element.innerText || element.textContent || '')
      return (
        text.includes('hora') &&
        text.includes('minuto') &&
        text.includes('greens') &&
        text.includes('total')
      )
    })

    if (!matrixRoot) {
      return {
        blueCells: [],
        blueCount: 0,
        cardTitle: document.querySelector('h2')?.textContent?.trim() ?? null,
        minuteHeaders: [],
        rowHeaders: [],
      }
    }

    const buttons = [...matrixRoot.querySelectorAll('button')]
      .filter((node) => isVisible(node))
      .map((node) => {
        const rect = node.getBoundingClientRect()
        const style = window.getComputedStyle(node)
        return {
          background: style.backgroundColor,
          height: rect.height,
          left: rect.left,
          opacity: numeric(style.opacity) ?? 1,
          text: (node.innerText || node.textContent || '').trim(),
          title: node.getAttribute('title') || '',
          top: rect.top,
          width: rect.width,
        }
      })
      .filter((item) => item.width >= 24 && item.height >= 24)

    const firstCellLeft = Math.min(...buttons.map((item) => item.left))
    const firstCellTop = Math.min(...buttons.map((item) => item.top))

    const labels = [...matrixRoot.querySelectorAll('*')]
      .filter((node) => isVisible(node))
      .map((node) => {
        const text = (node.textContent || '').trim()
        const rect = node.getBoundingClientRect()
        return {
          left: rect.left,
          text,
          top: rect.top,
        }
      })
      .filter((item) => /^\d{2}$/.test(item.text))

    const minuteHeaders = labels
      .filter((item) => item.top < firstCellTop - 6 && item.left >= firstCellLeft - 8)
      .sort((left, right) => left.left - right.left)

    const rowHeaders = labels
      .filter((item) => item.left < firstCellLeft - 8 && item.top >= firstCellTop - 8)
      .sort((left, right) => left.top - right.top)

    const nearestBy = (items, axis, value) =>
      items.reduce(
        (best, item) => {
          const distance = Math.abs(item[axis] - value)
          if (!best || distance < best.distance) {
            return { distance, item }
          }
          return best
        },
        null,
      )?.item ?? null

    const blueCells = buttons
      .filter((item) => isBlueBackground(item.background))
      .map((item) => ({
        background: item.background,
        minute: nearestBy(minuteHeaders, 'left', item.left + item.width / 2)?.text ?? null,
        opacity: item.opacity,
        row: nearestBy(rowHeaders, 'top', item.top + item.height / 2)?.text ?? null,
        text: item.text,
        title: item.title,
      }))

    const cardTitle = document.querySelector('h2')?.textContent?.trim() ?? null

    return {
      cardTitle,
      blueCells: blueCells.slice(0, 24),
      blueCount: blueCells.length,
      minuteHeaders: minuteHeaders.map((item) => item.text),
      rowHeaders: rowHeaders.slice(0, 12).map((item) => item.text),
    }
  })
}

async function writeRunSummary(siteDir, summary) {
  const summaryPath = path.join(siteDir, 'summary.json')
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8')

  const reportLines = [
    '# Easy Horas Pagantes Audit',
    '',
    `- Capturado em: ${summary.capturedAt}`,
    `- Pasta: ${siteDir}`,
    '',
    '## Mercados',
    '',
    ...summary.marketOptions.map((market) => `- ${market}`),
    '',
    '## Estados capturados',
    '',
    ...summary.matrixAudit.flatMap((entry) => [
      `### ${entry.market}`,
      `- Card: ${entry.state.cardTitle ?? '--'}`,
      `- Blue cells: ${entry.state.blueCount}`,
      `- Minutes: ${(entry.state.minuteHeaders ?? []).join(', ') || '--'}`,
      `- Rows: ${(entry.state.rowHeaders ?? []).join(', ') || '--'}`,
      ...entry.state.blueCells.slice(0, 12).map(
        (cell) =>
          `  - ${cell.row ?? '--'}:${cell.minute ?? '--'} | ${cell.text || 'pendente'} | ${cell.title || '--'}`,
      ),
      '',
    ]),
  ]

  await writeFile(path.join(siteDir, 'report.md'), reportLines.join('\n'), 'utf8')
}

async function run() {
  const runId = `easy-hours-audit-${timestampSlug()}`
  const siteDir = path.join(capturesDir, runId)
  await mkdir(siteDir, { recursive: true })

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })

  try {
    await page.route('**/*', (route) => {
      const type = route.request().resourceType()
      if (type === 'image' || type === 'media' || type === 'font') {
        route.abort().catch(() => {})
        return
      }

      route.continue().catch(() => {})
    })

    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })

    const emailFilled = await fillFirstVisible(
      page,
      ['input[type="email"]', 'input[name="email"]', 'input[placeholder*="mail" i]'],
      email,
    )
    const passwordFilled = await fillFirstVisible(
      page,
      ['input[type="password"]', 'input[name="password"]', 'input[placeholder*="senha" i]'],
      password,
    )

    if (!emailFilled || !passwordFilled) {
      throw new Error('Nao consegui preencher os campos de login.')
    }

    await clickLogin(page)
    await waitForDashboard(page)
    await page.goto(betanoUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(2500)

    await ensurePaidHoursOn(page)

    const marketOptions = await getFilterOptions(page, 2)
    const limitedMarketOptions =
      marketLimit > 0 ? marketOptions.slice(0, marketLimit) : marketOptions
    const initialOddOptions = includeOddOptions ? await getFilterOptions(page, 3) : []
    const summary = {
      capturedAt: new Date().toISOString(),
      runId,
      marketOptions: limitedMarketOptions,
      initialOddOptions,
      matrixAudit: [],
    }

    for (const market of limitedMarketOptions) {
      await selectFilterOption(page, 2, market)
      await ensurePaidHoursOn(page)

      const oddOptions = includeOddOptions ? await getFilterOptions(page, 3) : []
      const safeFile = slugify(market) || 'market'
      const screenshotPath = path.join(siteDir, `${safeFile}.png`)
      await captureFirstCard(page, screenshotPath)

      summary.matrixAudit.push({
        market,
        oddOptions,
        screenshot: includeScreenshots ? path.relative(rootDir, screenshotPath) : null,
        state: await extractVisibleCardState(page),
      })

      summary.capturedAt = new Date().toISOString()
      await writeRunSummary(siteDir, summary)
    }
    const summaryPath = path.join(siteDir, 'summary.json')

    console.log(JSON.stringify({ ok: true, runId, siteDir, summaryPath }, null, 2))
  } finally {
    await browser.close()
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
