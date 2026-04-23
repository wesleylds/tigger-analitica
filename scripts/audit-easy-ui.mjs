import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const rootDir = process.cwd()
const capturesDir = path.join(rootDir, 'captures')
const loginUrl = 'https://app.easycoanalytics.com.br/'

const email = process.env.EASY_EMAIL
const password = process.env.EASY_PASSWORD

if (!email || !password) {
  throw new Error('Defina EASY_EMAIL e EASY_PASSWORD para executar a auditoria visual.')
}

function timestampSlug() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function normalizeText(value) {
  return value
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

      await candidate.evaluate(
        (node, nextValue) => {
          const element = node
          element.focus()
          element.value = nextValue
          element.dispatchEvent(new Event('input', { bubbles: true }))
          element.dispatchEvent(new Event('change', { bubbles: true }))
        },
        value,
      )

      const checkedValue = await candidate.inputValue().catch(() => '')
      if (checkedValue === value) {
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

async function clickFirstVisibleWithText(page, text) {
  const target = normalizeText(text)
  const candidates = page.locator('button, a, [role="button"]')
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
      await candidate.click({ force: true }).catch(() => {})
      return true
    }
  }

  return false
}

async function closeFloatingUi(page) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.mouse.click(20, 20).catch(() => {})
  await page.waitForTimeout(250)
}

async function findContainerByTexts(page, texts, minWidth = 120, minHeight = 40) {
  const handle = await page.evaluateHandle(
    ({ texts: rawTexts, minWidth: nextMinWidth, minHeight: nextMinHeight }) => {
      const normalize = (value) =>
        (value ?? '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim()

      const targets = rawTexts.map(normalize)
      const area = (element) => {
        const rect = element.getBoundingClientRect()
        return rect.width * rect.height
      }

      const isVisible = (element) => {
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity || 1) !== 0 &&
          rect.width >= nextMinWidth &&
          rect.height >= nextMinHeight
        )
      }

      const candidates = [...document.querySelectorAll('body *')]
        .filter((element) => isVisible(element))
        .filter((element) => {
          const text = normalize(element.innerText || element.textContent || '')
          return targets.every((target) => text.includes(target))
        })
        .sort((left, right) => area(left) - area(right))

      return candidates[0] ?? null
    },
    { texts, minWidth, minHeight },
  )

  const element = handle.asElement()
  if (!element) {
    throw new Error(`Nao encontrei container para: ${texts.join(', ')}`)
  }

  return element
}

async function captureElement(handle, targetPath) {
  await handle.scrollIntoViewIfNeeded().catch(() => {})
  await handle.screenshot({ path: targetPath })
}

async function extractLines(handle) {
  const text = await handle.evaluate((node) => node.innerText || node.textContent || '')
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function extractMatrixMeta(page) {
  return page.evaluate(() => {
    const normalize = (value) =>
      (value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()

    const allElements = [...document.querySelectorAll('body *')]
    const matrixRoot = allElements.find((element) => {
      const text = normalize(element.innerText || element.textContent || '')
      return (
        text.includes('hora') &&
        text.includes('minuto') &&
        text.includes('greens') &&
        text.includes('total')
      )
    })

    if (!matrixRoot) {
      return null
    }

    const styledRows = [...matrixRoot.querySelectorAll('[style*="grid-template-columns"]')]
    const headerRow = styledRows.find((element) => normalize(element.innerText).includes('hora minuto'))
    const rowStyle = headerRow?.getAttribute('style') || styledRows[0]?.getAttribute('style') || ''
    const repeatMatch = rowStyle.match(/repeat\((\d+),/i)
    const minuteColumns = repeatMatch ? Number(repeatMatch[1]) : null
    const rowLabels = styledRows
      .map((element) => element.innerText.split('\n')[0]?.trim())
      .filter(Boolean)
      .filter((value) => /^\d{2}$/.test(value))

    return {
      rowStyle,
      minuteColumns,
      visibleHourRows: [...new Set(rowLabels)].slice(0, 12),
    }
  })
}

async function openAndCaptureMenu(page, siteDir, spec) {
  await closeFloatingUi(page)
  const clicked = await clickFirstVisibleWithText(page, spec.triggerText)
  if (!clicked) {
    throw new Error(`Nao consegui abrir o gatilho ${spec.triggerText}`)
  }

  await page.waitForTimeout(350)
  const menu = await findContainerByTexts(page, spec.menuTexts, 90, 70)
  const screenshotPath = path.join(siteDir, spec.fileName)
  await captureElement(menu, screenshotPath)
  const lines = await extractLines(menu)
  await closeFloatingUi(page)

  return {
    name: spec.name,
    fileName: spec.fileName,
    screenshotPath,
    lines,
  }
}

async function auditVirtualPage(page, siteDir, pageSlug) {
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(2500)

  const viewportPath = path.join(siteDir, `${pageSlug}-viewport.png`)
  const overviewPath = path.join(siteDir, `${pageSlug}-overview.png`)
  await page.screenshot({ path: viewportPath })
  await page.screenshot({ path: overviewPath, fullPage: true })

  const captureTargets = [
    {
      name: 'topbar',
      texts: ['Dashboard', 'Futebol Virtual', 'Criar Bots', 'Extras', 'Chamar Suporte'],
      minWidth: 900,
      minHeight: 40,
      fileName: `${pageSlug}-topbar.png`,
    },
    {
      name: 'filters',
      texts: ['Ligas', 'Tempo', 'Mercado', 'Odds', 'Ultimas Horas'],
      minWidth: 900,
      minHeight: 80,
      fileName: `${pageSlug}-filters.png`,
    },
    {
      name: 'header',
      texts: ['Ver Times', 'Ranking nos Proximos', 'Horas Pagantes'],
      minWidth: 900,
      minHeight: 120,
      fileName: `${pageSlug}-header.png`,
    },
    {
      name: 'matrix',
      texts: ['Hora', 'Minuto', 'Greens', 'Total'],
      minWidth: 900,
      minHeight: 220,
      fileName: `${pageSlug}-matrix.png`,
    },
    {
      name: 'footer',
      texts: ['Modo Trader', 'Tendencia', 'Maxima'],
      minWidth: 600,
      minHeight: 40,
      fileName: `${pageSlug}-footer-actions.png`,
    },
  ]

  const sections = []

  for (const target of captureTargets) {
    try {
      const handle = await findContainerByTexts(page, target.texts, target.minWidth, target.minHeight)
      const screenshotPath = path.join(siteDir, target.fileName)
      await captureElement(handle, screenshotPath)
      sections.push({
        name: target.name,
        fileName: target.fileName,
        screenshotPath,
        lines: await extractLines(handle),
      })
    } catch (error) {
      sections.push({
        name: target.name,
        fileName: target.fileName,
        screenshotPath: null,
        lines: [`erro: ${error instanceof Error ? error.message : String(error)}`],
      })
    }
  }

  const dropdowns = []

  const safeCaptureMenu = async (spec) => {
    try {
      dropdowns.push(await openAndCaptureMenu(page, siteDir, spec))
    } catch (error) {
      dropdowns.push({
        name: spec.name,
        fileName: spec.fileName,
        screenshotPath: null,
        lines: [`erro: ${error instanceof Error ? error.message : String(error)}`],
      })
    }
  }

  await safeCaptureMenu({
    name: 'topbar-futebol-virtual',
    triggerText: 'Futebol Virtual',
    menuTexts: ['Kiron', 'Betano', 'Bet365'],
    fileName: `${pageSlug}-menu-futebol-virtual.png`,
  })

  await safeCaptureMenu({
    name: 'topbar-extras',
    triggerText: 'Extras',
    menuTexts: ['Sugestoes', 'Indique e Ganhe 50%', 'Grupo da Plataforma'],
    fileName: `${pageSlug}-menu-extras.png`,
  })

  const filterMenus = [
    {
      name: 'ligas',
      triggerText: 'Todos',
      menuTexts: ['Todos', 'British Derbies', 'Liga Espanhola', 'Scudetto Italiano'],
      fileName: `${pageSlug}-menu-ligas.png`,
    },
    {
      name: 'tempo',
      triggerText: 'FT',
      menuTexts: ['FT', 'HT', 'FT + HT'],
      fileName: `${pageSlug}-menu-tempo.png`,
    },
    {
      name: 'mercado',
      triggerText: 'Ambas Marcam Sim',
      menuTexts: ['Resultado final', 'Resultado HT', 'Over 0.5'],
      fileName: `${pageSlug}-menu-mercado.png`,
    },
    {
      name: 'odds',
      triggerText: 'Selecione as Odds',
      menuTexts: ['Selecione as Odds', '1.20 - 1.59', '1.60 - 1.99', '2.00+'],
      fileName: `${pageSlug}-menu-odds.png`,
    },
    {
      name: 'ultimas-horas',
      triggerText: '12 horas',
      menuTexts: ['12 horas', '24 horas', '3 dias', '7 dias', '30 dias'],
      fileName: `${pageSlug}-menu-ultimas-horas.png`,
    },
  ]

  for (const spec of filterMenus) {
    await safeCaptureMenu(spec)
  }

  const matrixMeta = await extractMatrixMeta(page)

  return {
    pageSlug,
    viewportPath,
    overviewPath,
    sections,
    dropdowns,
    matrixMeta,
  }
}

async function run() {
  const runId = `easy-ui-audit-${timestampSlug()}`
  const siteDir = path.join(capturesDir, runId)
  await mkdir(siteDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
    deviceScaleFactor: 1,
  })

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
    await page.waitForTimeout(4000)

    const afterLoginPath = path.join(siteDir, '01-after-login.png')
    await page.screenshot({ path: afterLoginPath, fullPage: true })

    const audits = []
    const targets = [
      { slug: 'betano', url: 'https://app.easycoanalytics.com.br/dash/futebol-virtual/betano' },
      { slug: 'bet365', url: 'https://app.easycoanalytics.com.br/dash/futebol-virtual/bet365' },
    ]

    for (const target of targets) {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      audits.push(await auditVirtualPage(page, siteDir, target.slug))
    }

    const summary = {
      capturedAt: new Date().toISOString(),
      viewport: { width: 1366, height: 900 },
      loginUrl,
      pages: audits.map((audit) => ({
        pageSlug: audit.pageSlug,
        viewportPath: path.relative(rootDir, audit.viewportPath),
        overviewPath: path.relative(rootDir, audit.overviewPath),
        sections: audit.sections.map((section) => ({
          name: section.name,
          screenshotPath: section.screenshotPath ? path.relative(rootDir, section.screenshotPath) : null,
          lines: section.lines.slice(0, 20),
        })),
        dropdowns: audit.dropdowns.map((menu) => ({
          name: menu.name,
          screenshotPath: menu.screenshotPath ? path.relative(rootDir, menu.screenshotPath) : null,
          lines: menu.lines.slice(0, 30),
        })),
        matrixMeta: audit.matrixMeta,
      })),
    }

    const summaryPath = path.join(siteDir, 'summary.json')
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8')

    const reportLines = [
      '# Auditoria Visual Easy Analytics',
      '',
      `- Capturado em: ${summary.capturedAt}`,
      `- Viewport: ${summary.viewport.width}x${summary.viewport.height}`,
      `- Login: ${loginUrl}`,
      '',
      '## Estrutura principal encontrada',
      '',
      '- Topbar com: Dashboard, Futebol Virtual, Criar Bots, Extras, Chamar Suporte.',
      '- Barra de filtros com: Ligas, Tempo, Mercado, Odds, Últimas Horas.',
      '- Cabeçalho analítico com: nome da liga, barra percentual e linha de controles.',
      '- Matriz operacional com hora, minuto, percentual por coluna, greens e total.',
      '- Rodapé operacional com ações como Modo Trader, Tendência e Máxima.',
      '',
    ]

    for (const pageAudit of summary.pages) {
      reportLines.push(`## ${pageAudit.pageSlug.toUpperCase()}`)
      reportLines.push('')
      reportLines.push(`- Viewport: ${pageAudit.viewportPath}`)
      reportLines.push(`- Overview: ${pageAudit.overviewPath}`)
      reportLines.push(`- Colunas visíveis na matriz: ${pageAudit.matrixMeta?.minuteColumns ?? 'nao identificado'}`)
      reportLines.push(
        `- Horas visíveis na captura: ${(pageAudit.matrixMeta?.visibleHourRows ?? []).join(', ') || 'nao identificado'}`,
      )
      reportLines.push('')
      reportLines.push('### Seções capturadas')
      reportLines.push('')
      for (const section of pageAudit.sections) {
        reportLines.push(`- ${section.name}: ${section.screenshotPath}`)
      }
      reportLines.push('')
      reportLines.push('### Menus e filtros capturados')
      reportLines.push('')
      for (const menu of pageAudit.dropdowns) {
        reportLines.push(`- ${menu.name}: ${menu.screenshotPath}`)
      }
      reportLines.push('')
    }

    const reportPath = path.join(siteDir, 'report.md')
    await writeFile(reportPath, reportLines.join('\n'), 'utf8')

    console.log(
      JSON.stringify(
        {
          ok: true,
          runId,
          captureDir: siteDir,
          summaryPath,
          reportPath,
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
