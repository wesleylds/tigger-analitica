import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const rootDir = process.cwd()
const capturesDir = path.join(rootDir, 'captures')
const loginUrl = 'https://app.easycoanalytics.com.br/'
const targetUrl = 'https://app.easycoanalytics.com.br/dash/futebol-virtual/betano'

const email = process.env.EASY_EMAIL
const password = process.env.EASY_PASSWORD

if (!email || !password) {
  throw new Error('Defina EASY_EMAIL e EASY_PASSWORD para executar a auditoria da celula.')
}

function timestampSlug() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
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
      if (currentValue === value) return true
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

async function login(page) {
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(1200)

  await fillFirstVisible(page, [
    'input[type="email"]',
    'input[name="email"]',
    'input[placeholder*="mail" i]',
  ], email)

  await fillFirstVisible(page, [
    'input[type="password"]',
    'input[name="password"]',
    'input[placeholder*="senha" i]',
  ], password)

  await clickLogin(page)
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(2500)
}

const normalize = (value) =>
  (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

async function closeFloatingUi(page) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.mouse.click(24, 24).catch(() => {})
  await page.waitForTimeout(250)
}

async function clickFirstVisibleWithText(page, text) {
  const target = normalize(text)
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

    if (normalize(pieces).includes(target)) {
      await candidate.click({ force: true }).catch(() => {})
      return true
    }
  }

  return false
}

async function ensureBetanoPage(page) {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(1500)

  const hasMatrix = await page
    .locator('text=Hora')
    .first()
    .isVisible()
    .catch(() => false)

  if (hasMatrix) return

  await clickFirstVisibleWithText(page, 'Futebol Virtual')
  await page.waitForTimeout(600)
  await clickFirstVisibleWithText(page, 'Betano')
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2500)
}

async function run() {
  const runId = `easy-cell-click-${timestampSlug()}`
  const siteDir = path.join(capturesDir, runId)
  await mkdir(siteDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } })

  try {
    await login(page)
    await ensureBetanoPage(page)
    await closeFloatingUi(page)

    await page.screenshot({ path: path.join(siteDir, 'before-click.png'), fullPage: true })

    const result = await page.evaluate(() => {
      const normalizeInner = (value) =>
        (value ?? '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim()

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
        const text = normalizeInner(element.innerText || element.textContent || '')
        return text.includes('hora') && text.includes('minuto') && text.includes('greens') && text.includes('total')
      })

      if (!matrixRoot) return { error: 'matrix-root-not-found' }

      const buttons = [...matrixRoot.querySelectorAll('button')]
        .filter((button) => isVisible(button))
        .filter((button) => {
          const rect = button.getBoundingClientRect()
          return rect.width >= 24 && rect.height >= 24
        })

      const candidate =
        buttons.find((button) => /^(\d+-\d+|\d+x\d+)$/i.test((button.innerText || button.textContent || '').trim())) ??
        buttons.find((button) => (button.getAttribute('title') || '').includes(' x ')) ??
        buttons[0]

      if (!candidate) return { error: 'button-not-found' }

      const beforeStyle = window.getComputedStyle(candidate)
      const beforeRect = candidate.getBoundingClientRect()
      const before = {
        backgroundColor: beforeStyle.backgroundColor,
        borderColor: beforeStyle.borderColor,
        boxShadow: beforeStyle.boxShadow,
        className: candidate.className,
        text: (candidate.innerText || candidate.textContent || '').trim(),
        title: candidate.getAttribute('title') || '',
        top: beforeRect.top,
        left: beforeRect.left,
        width: beforeRect.width,
        height: beforeRect.height,
      }

      candidate.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      candidate.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      candidate.dispatchEvent(new MouseEvent('click', { bubbles: true }))

      const afterStyle = window.getComputedStyle(candidate)
      const after = {
        backgroundColor: afterStyle.backgroundColor,
        borderColor: afterStyle.borderColor,
        boxShadow: afterStyle.boxShadow,
        className: candidate.className,
      }

      const sidePanelCandidates = [...document.querySelectorAll('aside, [role="dialog"], .drawer, .sidebar, .panel')]
        .filter((node) => isVisible(node))
        .map((node) => ({
          className: node.className || '',
          text: normalizeInner(node.innerText || node.textContent || '').slice(0, 300),
        }))

      return {
        after,
        before,
        sidePanelCandidates,
      }
    })

    await page.waitForTimeout(1200)
    await page.screenshot({ path: path.join(siteDir, 'after-click.png'), fullPage: true })
    await writeFile(path.join(siteDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8')

    console.log(JSON.stringify({ ok: true, result, runId, siteDir }, null, 2))
  } finally {
    await browser.close()
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
