import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const rootDir = process.cwd()
const capturesDir = path.join(rootDir, 'captures')
const loginUrl = 'https://app.easycoanalytics.com.br/'

const email = process.env.EASY_EMAIL ?? process.env.SCRAPER_EMAIL
const password = process.env.EASY_PASSWORD ?? process.env.SCRAPER_PASSWORD

if (!email || !password) {
  throw new Error('Defina EASY_EMAIL/EASY_PASSWORD ou SCRAPER_EMAIL/SCRAPER_PASSWORD.')
}

const pageTargets = [
  { slug: 'dashboard', url: 'https://app.easycoanalytics.com.br/' },
  { slug: 'betano', url: 'https://app.easycoanalytics.com.br/dash/futebol-virtual/betano' },
  { slug: 'bet365', url: 'https://app.easycoanalytics.com.br/dash/futebol-virtual/bet365' },
  { slug: 'kiron', url: 'https://app.easycoanalytics.com.br/dash/futebol-virtual/kiron' },
  { slug: 'kiron-bet365', url: 'https://app.easycoanalytics.com.br/dash/futebol-virtual/kiron-bet365' },
  { slug: 'criar-bots', url: 'https://app.easycoanalytics.com.br/dash/criar-bots' },
  {
    slug: 'cadastrar-telegram',
    url: 'https://app.easycoanalytics.com.br/dash/criar-bots/cadastrar-telegram',
  },
]

function timestampSlug() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function normalizeText(value) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
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

      const currentValue = await candidate.inputValue().catch(() => '')
      if (currentValue === value) {
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
      await candidate.click()
      return
    }
  }

  await page.keyboard.press('Enter').catch(() => {})
}

async function closeFloatingUi(page) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.mouse.click(20, 20).catch(() => {})
  await page.waitForTimeout(250)
}

async function findFirstVisibleAction(page, text) {
  const target = normalizeText(text)
  const candidates = page.locator('button, a, [role="button"], [data-slot="select-trigger"]')
  const count = await candidates.count()

  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index)
    if (!(await candidate.isVisible().catch(() => false))) continue

    const pieces = [
      await candidate.innerText().catch(() => ''),
      await candidate.textContent().catch(() => ''),
      await candidate.getAttribute('aria-label').catch(() => ''),
    ]
      .filter(Boolean)
      .join(' ')

    if (normalizeText(pieces).includes(target)) {
      return candidate
    }
  }

  return null
}

async function captureTriggerClip(page, triggerText, targetPath, width, height) {
  await closeFloatingUi(page)

  const trigger = await findFirstVisibleAction(page, triggerText)
  if (!trigger) {
    throw new Error(`Nao encontrei gatilho visivel para "${triggerText}"`)
  }

  await trigger.scrollIntoViewIfNeeded().catch(() => {})
  const box = await trigger.boundingBox()
  if (!box) {
    throw new Error(`Nao consegui medir gatilho "${triggerText}"`)
  }

  await trigger.click({ force: true }).catch(() => {})
  await page.waitForTimeout(400)

  const viewport = page.viewportSize() ?? { width: 1366, height: 900 }
  const clip = {
    x: Math.max(0, Math.floor(box.x - 20)),
    y: Math.max(0, Math.floor(box.y - 8)),
    width: Math.min(width, Math.floor(viewport.width - Math.max(0, box.x - 20))),
    height: height,
  }

  await page.screenshot({
    path: targetPath,
    clip,
  })

  await closeFloatingUi(page)
}

async function savePageShots(page, siteDir, slug) {
  const viewportPath = path.join(siteDir, `${slug}-viewport.png`)
  const overviewPath = path.join(siteDir, `${slug}-overview.png`)
  await page.screenshot({ path: viewportPath })
  await page.screenshot({ path: overviewPath, fullPage: true })
  return { viewportPath, overviewPath }
}

async function run() {
  const runId = `easy-ui-complete-${timestampSlug()}`
  const siteDir = path.join(capturesDir, runId)
  await mkdir(siteDir, { recursive: true })

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })

  const captures = []

  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.screenshot({ path: path.join(siteDir, '00-login.png'), fullPage: true })

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
    await page.waitForURL(/\/dash\//, { timeout: 60000 }).catch(() => {})
    await page.waitForTimeout(3500)
    await page.screenshot({ path: path.join(siteDir, '01-after-login.png'), fullPage: true })

    for (const target of pageTargets) {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(2000)

      const shots = await savePageShots(page, siteDir, target.slug)
      captures.push({
        slug: target.slug,
        viewportPath: path.relative(rootDir, shots.viewportPath),
        overviewPath: path.relative(rootDir, shots.overviewPath),
      })

      if (['betano', 'bet365', 'kiron', 'kiron-bet365'].includes(target.slug)) {
        const menus = [
          { text: 'Futebol Virtual', file: `${target.slug}-menu-futebol-virtual.png`, width: 260, height: 220 },
          { text: 'Extras', file: `${target.slug}-menu-extras.png`, width: 260, height: 200 },
          { text: 'Weslley', file: `${target.slug}-menu-user.png`, width: 260, height: 220 },
          { text: 'Todos', file: `${target.slug}-menu-ligas.png`, width: 320, height: 420 },
          { text: 'FT', file: `${target.slug}-menu-tempo.png`, width: 260, height: 210 },
          { text: 'Ambas Marcam Sim', file: `${target.slug}-menu-mercado.png`, width: 320, height: 360 },
          { text: 'Selecione as Odds', file: `${target.slug}-menu-odds.png`, width: 280, height: 230 },
          { text: '12 horas', file: `${target.slug}-menu-ultimas-horas.png`, width: 280, height: 250 },
        ]

        for (const menu of menus) {
          try {
            await captureTriggerClip(
              page,
              menu.text,
              path.join(siteDir, menu.file),
              menu.width,
              menu.height,
            )
          } catch {
            // segue; nem todo trigger vai existir em toda pagina
          }
        }
      }
    }

    const summary = {
      capturedAt: new Date().toISOString(),
      runId,
      captures,
    }

    await writeFile(path.join(siteDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')

    const reportLines = [
      '# Easy UI Complete Audit',
      '',
      `- Capturado em: ${summary.capturedAt}`,
      `- Pasta: ${siteDir}`,
      '',
      '## Pages',
      '',
      ...captures.flatMap((capture) => [
        `- ${capture.slug}: ${capture.viewportPath}`,
        `- ${capture.slug} overview: ${capture.overviewPath}`,
      ]),
    ]

    await writeFile(path.join(siteDir, 'report.md'), reportLines.join('\n'), 'utf8')

    console.log(
      JSON.stringify(
        {
          ok: true,
          runId,
          captureDir: siteDir,
          pages: captures,
        },
        null,
        2,
      ),
    )
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
