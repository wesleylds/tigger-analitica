import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const rootDir = process.cwd()
const capturesDir = path.join(rootDir, 'captures')
const loginUrl = 'https://app.easycoanalytics.com.br/'
const targetUrl = 'https://app.easycoanalytics.com.br/dash/futebol-virtual/betano'

const email = process.env.EASY_EMAIL ?? process.env.SCRAPER_EMAIL
const password = process.env.EASY_PASSWORD ?? process.env.SCRAPER_PASSWORD

if (!email || !password) {
  throw new Error('Defina EASY_EMAIL/EASY_PASSWORD ou SCRAPER_EMAIL/SCRAPER_PASSWORD.')
}

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

function isStaticAsset(url) {
  if (!url) {
    return true
  }

  if (url.includes('/_next/static/')) {
    return true
  }

  return /\.(css|js|png|jpe?g|webp|svg|ico|woff2?|ttf|map)(\?|$)/i.test(url)
}

function looksVideoLike(url = '', contentType = '') {
  return /m3u8|mp4|mpd|dash|hls|stream|video|embed|player|media|playlist|manifest/i.test(
    `${url} ${contentType}`,
  )
}

async function launchBrowser() {
  try {
    return await chromium.launch({
      channel: 'chrome',
      headless: true,
    })
  } catch {
    return chromium.launch({ headless: true })
  }
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

async function closeFloatingUi(page) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.mouse.click(24, 24).catch(() => {})
  await page.waitForTimeout(250)
}

async function waitForAnalysisUi(page) {
  const checks = [
    page.getByText(/Ver V[ií]deo/i).first(),
    page.getByText(/Horas Pagantes/i).first(),
    page.getByText(/Ligas/i).first(),
  ]

  for (const locator of checks) {
    if (!(await locator.isVisible().catch(() => false))) {
      return false
    }
  }

  return true
}

async function findFirstVisibleAction(page, text) {
  const target = normalizeText(text)
  const candidates = page.locator('button, a, [role="button"], [data-slot="select-trigger"], [role="menuitem"]')
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

async function chooseVirtualProvider(page, providerName) {
  await closeFloatingUi(page)

  const trigger = await findFirstVisibleAction(page, 'Futebol Virtual')
  if (!trigger) {
    return false
  }

  await trigger.click({ force: true }).catch(() => {})
  await page.waitForTimeout(500)

  const clicked = await page.evaluate((providerText) => {
    const normalize = (value) =>
      (value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()

    const isVisible = (element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 20 &&
        rect.height > 16
      )
    }

    const area = (element) => {
      const rect = element.getBoundingClientRect()
      return rect.width * rect.height
    }

    const menu = [...document.querySelectorAll('body *')]
      .filter((element) => isVisible(element))
      .filter((element) => {
        const text = normalize(element.textContent || '')
        return text.includes('kiron') && text.includes('betano') && text.includes('bet365')
      })
      .sort((left, right) => area(left) - area(right))[0]

    if (!menu) {
      return false
    }

    const target = [...menu.querySelectorAll('*')]
      .filter((element) => isVisible(element))
      .find((element) => normalize(element.textContent || '') === normalize(providerText))

    if (!target) {
      return false
    }

    const clickable =
      target.closest('button, a, [role="menuitem"], [role="option"], [role="button"]') ?? target

    clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    clickable.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  }, providerName)

  await page.waitForTimeout(2500)
  return clicked
}

async function clickVideoToggle(page) {
  await closeFloatingUi(page)

  const directSwitch = page.locator(
    '[id^="switch-ver-video-"], button[role="switch"][id*="ver-video"], [role="switch"][id*="ver-video"]',
  )

  if (await directSwitch.first().isVisible().catch(() => false)) {
    await directSwitch.first().click({ force: true }).catch(() => {})
    await page.waitForTimeout(800)
    return true
  }

  const label = page.getByText(/Ver V[ií]deo/i).first()
  if (!(await label.isVisible().catch(() => false))) {
    return false
  }

  await label.scrollIntoViewIfNeeded().catch(() => {})
  const box = await label.boundingBox()
  if (!box) {
    return false
  }

  const clickPoints = [
    { x: box.x + box.width + 16, y: box.y + box.height / 2 },
    { x: box.x + box.width + 28, y: box.y + box.height / 2 },
    { x: box.x + box.width + 40, y: box.y + box.height / 2 },
  ]

  for (const point of clickPoints) {
    await page.mouse.click(point.x, point.y).catch(() => {})
    await page.waitForTimeout(800)

    const state = await page.evaluate(() => {
      const normalize = (value) =>
        (value ?? '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim()

      const root = [...document.querySelectorAll('body *')].find((element) =>
        normalize(element.textContent || '').includes('ver video'),
      )

      const switchNode =
        root?.closest('label, div, section')?.querySelector('button[role="switch"], [role="switch"], button') ?? null

      return {
        ariaChecked: switchNode?.getAttribute?.('aria-checked') ?? null,
        dataState: switchNode?.getAttribute?.('data-state') ?? null,
      }
    })

    if (state.ariaChecked === 'true' || state.dataState === 'checked') {
      return true
    }
  }

  return true
}

async function clickPotentialPlayer(page) {
  const candidateHandle = await page.evaluateHandle(() => {
    const elements = [...document.querySelectorAll('body *')]
    const visible = elements.filter((element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()

      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || 1) !== 0 &&
        rect.width >= 280 &&
        rect.height >= 150
      )
    })

    const ranked = visible
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const text = `${element.id} ${element.className} ${element.getAttribute('aria-label') || ''} ${
          element.textContent || ''
        }`
        const score =
          (/video|player|live|ao vivo|replay|play/i.test(text) ? 1000 : 0) + rect.width * rect.height

        return { element, score, top: rect.top }
      })
      .filter((entry) => entry.top > 180)
      .sort((left, right) => right.score - left.score)

    return ranked[0]?.element ?? null
  })

  const candidate = candidateHandle.asElement()
  if (!candidate) {
    return false
  }

  await candidate.scrollIntoViewIfNeeded().catch(() => {})
  const box = await candidate.boundingBox()
  if (!box) {
    return false
  }

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {})
  await page.waitForTimeout(1800)
  return true
}

async function collectDomSnapshot(page) {
  return page.evaluate(() => {
    const mediaNodes = [...document.querySelectorAll('video, iframe, embed, object, source, canvas')].map(
      (element) => {
        const rect = element.getBoundingClientRect()
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || null,
          className: element.className || null,
          src:
            element.getAttribute('src') ||
            element.getAttribute('data-src') ||
            element.getAttribute('poster') ||
            null,
          width: rect.width,
          height: rect.height,
          ariaLabel: element.getAttribute('aria-label') || null,
        }
      },
    )

    const playerLikeNodes = [...document.querySelectorAll('body *')]
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width < 240 || rect.height < 120) {
          return false
        }

        const fingerprint = `${element.id} ${element.className} ${element.getAttribute('aria-label') || ''} ${
          element.textContent || ''
        }`

        return /video|player|stream|live|ao vivo|replay|play/i.test(fingerprint)
      })
      .slice(0, 12)
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || null,
          className: element.className || null,
          text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
          width: rect.width,
          height: rect.height,
        }
      })

    const performanceEntries = performance
      .getEntriesByType('resource')
      .map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        duration: entry.duration,
      }))
      .filter((entry) => /m3u8|mp4|mpd|dash|hls|stream|video|embed|player|media|manifest/i.test(entry.name))
      .slice(0, 50)

    return {
      url: window.location.href,
      title: document.title,
      mediaNodes,
      playerLikeNodes,
      performanceEntries,
    }
  })
}

async function run() {
  const runId = `easy-video-${timestampSlug()}`
  const captureDir = path.join(capturesDir, runId)
  const harPath = path.join(captureDir, 'easy-video.har')
  const summaryPath = path.join(captureDir, 'video-summary.json')
  const reportPath = path.join(captureDir, 'report.md')
  const htmlPath = path.join(captureDir, 'after-toggle.html')

  await mkdir(captureDir, { recursive: true })

  const browser = await launchBrowser()
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    recordHar: {
      path: harPath,
      content: 'embed',
      mode: 'full',
    },
  })

  const requests = []
  const consoleMessages = []
  let captureRequests = false
  let page = await context.newPage()

  const attachPageObservers = (targetPage) => {
    targetPage.on('console', (message) => {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
      })
    })

    targetPage.on('requestfinished', async (request) => {
      if (!captureRequests) {
        return
      }

      const response = await request.response().catch(() => null)
      const url = request.url()
      const contentType = response?.headers()?.['content-type'] ?? ''

      if (isStaticAsset(url) && !looksVideoLike(url, contentType)) {
        return
      }

      requests.push({
        method: request.method(),
        url,
        status: response?.status() ?? null,
        resourceType: request.resourceType(),
        contentType,
        videoLike: looksVideoLike(url, contentType),
      })
    })
  }

  attachPageObservers(page)

  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.screenshot({ path: path.join(captureDir, '00-login.png'), fullPage: true })

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

    const analysisPage = await context.newPage()
    attachPageObservers(analysisPage)
    page = analysisPage

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(2500)
    await closeFloatingUi(page)

    let analysisReady = await waitForAnalysisUi(page)
    if (!analysisReady) {
      await page.goto('https://app.easycoanalytics.com.br/dash', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      }).catch(() => {})
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(2000)
      await chooseVirtualProvider(page, 'Betano')
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(2500)
      await closeFloatingUi(page)
      analysisReady = await waitForAnalysisUi(page)
    }

    if (!analysisReady) {
      throw new Error(`A tela de analise nao abriu corretamente. URL atual: ${page.url()}`)
    }

    await page.screenshot({ path: path.join(captureDir, '01-before-toggle.png'), fullPage: true })

    captureRequests = true
    const toggleClicked = await clickVideoToggle(page)
    await page.waitForTimeout(4500)
    const playerClicked = await clickPotentialPlayer(page)
    await page.waitForTimeout(3500)
    captureRequests = false

    await page.screenshot({ path: path.join(captureDir, '02-after-toggle.png'), fullPage: true })
    await writeFile(htmlPath, await page.content(), 'utf8')

    const domSnapshot = await collectDomSnapshot(page)
    const frameUrls = page.frames().map((frame) => frame.url())
    const filteredRequests = requests.filter((entry, index, array) => {
      const firstIndex = array.findIndex(
        (candidate) => candidate.url === entry.url && candidate.method === entry.method && candidate.status === entry.status,
      )
      return firstIndex === index
    })

    const summary = {
      capturedAt: new Date().toISOString(),
      runId,
      targetUrl,
      toggleClicked,
      playerClicked,
      frameUrls,
      videoLikeRequests: filteredRequests.filter((entry) => entry.videoLike),
      requests: filteredRequests,
      domSnapshot,
      consoleMessages,
      artifacts: {
        captureDir,
        harPath,
        htmlPath,
      },
    }

    await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8')

    const reportLines = [
      '# Easy Video Capture',
      '',
      `- Capturado em: ${summary.capturedAt}`,
      `- URL: ${targetUrl}`,
      `- Toggle clicado: ${toggleClicked}`,
      `- Player clicado: ${playerClicked}`,
      '',
      '## Frames',
      '',
      ...(frameUrls.length ? frameUrls.map((url) => `- ${url}`) : ['- nenhum frame adicional detectado']),
      '',
      '## Requests com cara de video/player',
      '',
      ...(summary.videoLikeRequests.length
        ? summary.videoLikeRequests.map(
            (entry) => `- [${entry.status ?? '??'}] ${entry.method} ${entry.resourceType} ${entry.url}`,
          )
        : ['- nenhum request de video/player detectado']),
      '',
      '## DOM media nodes',
      '',
      ...(domSnapshot.mediaNodes.length
        ? domSnapshot.mediaNodes.map(
            (entry) =>
              `- <${entry.tag}> ${entry.src ?? '(sem src)'} ${Math.round(entry.width)}x${Math.round(entry.height)}`,
          )
        : ['- nenhum video/iframe/embed/object/source/canvas detectado']),
      '',
      '## Player-like nodes',
      '',
      ...(domSnapshot.playerLikeNodes.length
        ? domSnapshot.playerLikeNodes.map(
            (entry) =>
              `- <${entry.tag}> ${Math.round(entry.width)}x${Math.round(entry.height)} ${entry.text.slice(0, 160)}`,
          )
        : ['- nenhum container com cara de player detectado']),
      '',
      `- JSON: ${path.relative(rootDir, summaryPath)}`,
      `- HAR: ${path.relative(rootDir, harPath)}`,
      `- HTML: ${path.relative(rootDir, htmlPath)}`,
    ]

    await writeFile(reportPath, reportLines.join('\n'), 'utf8')

    console.log(
      JSON.stringify(
        {
          ok: true,
          runId,
          captureDir,
          summaryPath,
          reportPath,
          videoLikeRequests: summary.videoLikeRequests.length,
          mediaNodes: domSnapshot.mediaNodes.length,
          frames: frameUrls.length,
        },
        null,
        2,
      ),
    )
  } finally {
    await page.close().catch(() => {})
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
