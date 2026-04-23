import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const headless = process.env.BBTIPS_HEADLESS !== 'false'
const channel = process.env.BBTIPS_CHANNEL || undefined

const outputDir = path.join(process.cwd(), 'captures', 'bbtips-context-request')

const targets = [
  {
    key: 'gridCurrent',
    url: 'https://api.bbtips.com.br/api/futebolvirtual?liga=2&futuro=false&Horas=Horas12&tipoOdd=&dadosAlteracao=&filtros=&confrontos=false&hrsConfrontos=240',
  },
  {
    key: 'gridFuture',
    url: 'https://api.bbtips.com.br/api/futebolvirtual?liga=2&futuro=true&Horas=Horas12&tipoOdd=&dadosAlteracao=&filtros=&confrontos=false&hrsConfrontos=240',
  },
]

function extractChallengePath(html) {
  if (!html) return null
  const match = html.match(/cUPMDTk:"([^"]+)"/)
  return match?.[1] ?? null
}

async function requestWithChallengeWarmup(context, target) {
  const makeRequest = () =>
    context.request.get(target.url, {
      headers: {
        Referer: 'https://app.bbtips.com.br/',
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    })

  const initialResponse = await makeRequest()
  const initialText = await initialResponse.text()

  if (initialResponse.ok()) {
    return {
      ok: true,
      status: initialResponse.status(),
      headers: await initialResponse.headers(),
      textPreview: initialText.slice(0, 5000),
      challengeWarmupUsed: false,
    }
  }

  const challengePath = extractChallengePath(initialText)
  if (!challengePath) {
    return {
      ok: false,
      status: initialResponse.status(),
      headers: await initialResponse.headers(),
      textPreview: initialText.slice(0, 5000),
      challengeWarmupUsed: false,
    }
  }

  const challengePage = await context.newPage()
  try {
    await challengePage.goto(new URL(challengePath, target.url).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await challengePage.waitForTimeout(12000)
  } finally {
    await challengePage.close().catch(() => {})
  }

  const retriedResponse = await makeRequest()
  const retriedText = await retriedResponse.text()

  return {
    ok: retriedResponse.ok(),
    status: retriedResponse.status(),
    headers: await retriedResponse.headers(),
    textPreview: retriedText.slice(0, 5000),
    challengeWarmupUsed: true,
  }
}

async function main() {
  await mkdir(outputDir, { recursive: true })

  const browser = await chromium.launch({
    headless,
    channel,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto('https://app.bbtips.com.br/futebol/horarios', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await page.waitForTimeout(5000)

    const results = {}
    for (const target of targets) {
      try {
        results[target.key] = await requestWithChallengeWarmup(context, target)
      } catch (error) {
        results[target.key] = {
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    const payload = {
      title: await page.title(),
      url: page.url(),
      cookies: await context.cookies(),
      results,
    }

    await writeFile(path.join(outputDir, 'result.json'), JSON.stringify(payload, null, 2), 'utf8')
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
