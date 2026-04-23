import { chromium } from 'playwright'
import path from 'node:path'
import process from 'node:process'
import { existsSync } from 'node:fs'

const storageStatePath = path.join(process.cwd(), 'captures', 'bbtips-storage-state.json')

const tabNames = ['Express', 'Copa', 'Euro', 'Super', 'Premier', 'Split']

const run = async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  })
  const context = await browser.newContext(
    existsSync(storageStatePath) ? { storageState: storageStatePath } : undefined,
  )
  const page = await context.newPage()

  const requestLog = []
  page.on('request', (request) => {
    const url = request.url()
    if (!url.includes('/api/futebolvirtual/old')) return
    const match = url.match(/[?&]liga=(\d+)/)
    requestLog.push({ liga: match?.[1] ?? '?', url })
  })

  await page.goto('https://app.bbtips.com.br/futebol/horarios', {
    timeout: 60_000,
    waitUntil: 'domcontentloaded',
  })
  await page.waitForTimeout(4_000)

  for (const tabName of tabNames) {
    const before = requestLog.length
    await page.locator(`text=${tabName}`).first().click({ force: true }).catch(() => undefined)
    await page.waitForTimeout(2_500)
    const fresh = requestLog.slice(before)
    const last = fresh[fresh.length - 1]

    console.log(
      JSON.stringify({
        requests: fresh.length,
        tab: tabName,
        liga: last?.liga ?? null,
        url: last?.url ?? null,
      }),
    )
  }

  await context.close()
  await browser.close()
}

await run()
