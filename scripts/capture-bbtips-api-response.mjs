import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const headless = process.env.BBTIPS_HEADLESS !== 'false'
const channel = process.env.BBTIPS_CHANNEL || undefined

const outputDir = path.join(process.cwd(), 'captures', 'bbtips-api-response')

async function main() {
  await mkdir(outputDir, { recursive: true })

  const browser = await chromium.launch({
    headless,
    channel,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.addInitScript(() => {
    const capturedApis = []
    const targetPattern = /api\.bbtips\.com\.br\/api\//i

    window.__capturedApis = capturedApis

    const originalFetch = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const response = await originalFetch(...args)
      const url = String(args[0] instanceof Request ? args[0].url : args[0] ?? '')

      if (targetPattern.test(url)) {
        const clone = response.clone()
        let text = ''
        try {
          text = await clone.text()
        } catch {}

        capturedApis.push({
          via: 'fetch',
          ok: response.ok,
          status: response.status,
          url,
          textPreview: text.slice(0, 5000),
        })
      }

      return response
    }

    const originalOpen = XMLHttpRequest.prototype.open
    const originalSend = XMLHttpRequest.prototype.send

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__captureMeta = { method, url: String(url ?? '') }
      return originalOpen.call(this, method, url, ...rest)
    }

    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('loadend', () => {
        const meta = this.__captureMeta
        if (!meta || !targetPattern.test(meta.url)) return

        let text = ''
        try {
          text = typeof this.responseText === 'string' ? this.responseText : ''
        } catch {}

        capturedApis.push({
          via: 'xhr',
          method: meta.method,
          ok: this.status >= 200 && this.status < 300,
          status: this.status,
          url: meta.url,
          textPreview: text.slice(0, 5000),
        })
      })

      return originalSend.call(this, ...args)
    }
  })

  try {
    await page.goto('https://app.bbtips.com.br/futebol/horarios', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await page.waitForTimeout(15000)

    const result = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      capturedApis: window.__capturedApis ?? [],
    }))

    await page.screenshot({ path: path.join(outputDir, 'page.png'), fullPage: true })
    await writeFile(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8')

    console.log(`Resultado salvo em ${outputDir}`)
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
