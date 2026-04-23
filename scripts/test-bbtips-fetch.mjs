import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const email = process.env.BBTIPS_EMAIL
const password = process.env.BBTIPS_PASSWORD
const headless = process.env.BBTIPS_HEADLESS !== 'false'
const channel = process.env.BBTIPS_CHANNEL || undefined
const userAgent = process.env.BBTIPS_USER_AGENT || undefined

if (!email || !password) {
  throw new Error('Defina BBTIPS_EMAIL e BBTIPS_PASSWORD antes de rodar o script.')
}

const outputDir = path.join(process.cwd(), 'captures', 'bbtips-fetch-check')

const endpointSpecs = [
  {
    key: 'gridCurrent',
    url: 'https://api.bbtips.com.br/api/futebolvirtual?liga=2&futuro=false&Horas=Horas12&tipoOdd=&dadosAlteracao=&filtros=&confrontos=false&hrsConfrontos=240',
  },
  {
    key: 'gridFuture',
    url: 'https://api.bbtips.com.br/api/futebolvirtual?liga=2&futuro=true&Horas=Horas12&tipoOdd=&dadosAlteracao=&filtros=&confrontos=false&hrsConfrontos=240',
  },
  {
    key: 'ranking',
    url: 'https://api.bbtips.com.br/api/futService/obterRanking?campeonato=Premier',
  },
]

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

      let finalValue = await candidate.inputValue().catch(() => '')
      if (finalValue !== value) {
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
        finalValue = await candidate.inputValue().catch(() => '')
      }
      if (finalValue) {
        return true
      }
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

async function fetchFromPage(page, endpoints) {
  return page.evaluate(async (items) => {
    const results = {}

    for (const item of items) {
      try {
        const response = await fetch(item.url, {
          credentials: 'include',
          headers: {
            accept: 'application/json, text/plain, */*',
          },
        })

        const contentType = response.headers.get('content-type') ?? ''
        const text = await response.text()
        let parsed = null

        if (/json/i.test(contentType)) {
          try {
            parsed = JSON.parse(text)
          } catch {
            parsed = null
          }
        }

        results[item.key] = {
          ok: response.ok,
          status: response.status,
          url: response.url,
          contentType,
          textPreview: text.slice(0, 1200),
          parsed,
        }
      } catch (error) {
        results[item.key] = {
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    return {
      href: window.location.href,
      origin: window.location.origin,
      results,
      localStorage: Object.fromEntries(
        Object.keys(window.localStorage).map((key) => [key, window.localStorage.getItem(key)]),
      ),
    }
  }, endpoints)
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

  try {
    await page.goto('https://app.bbtips.com.br/futebol/horarios', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })

    const needsLogin =
      page.url().includes('/login') ||
      (await page.locator('input[type="password"], input[formcontrolname="password"]').count()) > 0

    if (needsLogin) {
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
        console.warn('Nao consegui preencher o login da BB Tips. Seguindo mesmo assim para testar o fetch pelo navegador.')
      } else {
        const clicked = await clickFirstVisible(
          page,
          [
            'button[type="submit"]',
            'button:has-text("Entrar")',
            'button:has-text("Login")',
          ],
        )

        if (!clicked) {
          clicked = await submitFirstVisibleForm(page)
        }

        if (!clicked) {
          console.warn('Nao consegui acionar o submit do login da BB Tips. Seguindo mesmo assim para testar o fetch pelo navegador.')
        } else {
          await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {})
          await page.waitForTimeout(5000)
        }
      }
    }

    const sameOriginFetch = await fetchFromPage(page, endpointSpecs)
    await writeFile(
      path.join(outputDir, 'bbtips-origin-fetch.json'),
      JSON.stringify(sameOriginFetch, null, 2),
      'utf8',
    )

    let localhostFetch = null
    try {
      await page.goto('http://127.0.0.1:5173/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      })
      await page.waitForTimeout(2000)
      localhostFetch = await fetchFromPage(page, endpointSpecs)
    } catch (error) {
      localhostFetch = {
        error: error instanceof Error ? error.message : String(error),
      }
    }

    await writeFile(
      path.join(outputDir, 'localhost-fetch.json'),
      JSON.stringify(localhostFetch, null, 2),
      'utf8',
    )

    const cookies = await context.cookies()
    await writeFile(
      path.join(outputDir, 'cookies.json'),
      JSON.stringify(cookies, null, 2),
      'utf8',
    )

    console.log(`Arquivos salvos em ${outputDir}`)
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
