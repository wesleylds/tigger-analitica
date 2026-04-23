import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { chromium } from 'playwright'

const outputDir = path.join(process.cwd(), 'captures', 'bbtips-league-id-audit')
const storageStatePath = path.join(process.cwd(), 'captures', 'bbtips-browser-state.json')

const require = createRequire(import.meta.url)

const loadOverridesModule = async () => {
  const sourcePath = path.join(process.cwd(), 'src', 'data', 'bbtipsLeagueIdOverrides.ts')
  const source = await readFile(sourcePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  }).outputText

  const module = { exports: {} }
  const executor = new Function('module', 'exports', 'require', compiled)
  executor(module, module.exports, require)
  return module.exports
}

const normalizePlatformName = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')

const buildPlatformMap = (targetsByPlatform) =>
  Object.fromEntries(
    Object.keys(targetsByPlatform).map((platform) => [normalizePlatformName(platform), platform]),
  )

const timestampLabel = () =>
  new Date().toISOString().replace(/[:.]/g, '-')

async function clickFirstVisibleText(page, labels) {
  for (const label of labels) {
    const locator = page.getByText(label, { exact: true })
    const count = await locator.count().catch(() => 0)

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index)
      if (!(await candidate.isVisible().catch(() => false))) continue
      await candidate.click({ force: true }).catch(() => {})
      return label
    }
  }

  return null
}

const parseLeagueIdFromUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl)
    const rawLeagueId = url.searchParams.get('liga') ?? url.searchParams.get('Liga')
    const leagueId = Number(rawLeagueId)
    return Number.isFinite(leagueId) ? leagueId : null
  } catch {
    return null
  }
}

const pickResolvedGridHit = (hits, endpointPattern) => {
  const gridHits = hits.filter((hit) =>
    hit.url.includes(endpointPattern) &&
    !/\/ultimaAtualizacao/i.test(hit.url),
  )

  if (gridHits.length > 0) {
    return {
      ...gridHits.at(-1),
      kind: 'grid',
    }
  }

  const timestampHits = hits.filter((hit) => hit.url.includes(endpointPattern))
  return timestampHits.length > 0
    ? {
        ...timestampHits.at(-1),
        kind: /\/ultimaAtualizacao/i.test(timestampHits.at(-1).url) ? 'ultimaAtualizacao' : 'unknown',
      }
    : null
}

const main = async () => {
  await mkdir(outputDir, { recursive: true })

  const overridesModule = await loadOverridesModule()
  const targetsByPlatform = overridesModule.bbtipsLeagueIdAuditTargetsByPlatform ?? {}
  const overridesByPlatform = overridesModule.bbtipsLeagueIdOverridesByPlatform ?? {}
  const platformMap = buildPlatformMap(targetsByPlatform)

  const requestedPlatforms = process.argv.slice(2)
  const resolvedPlatforms = (
    requestedPlatforms.length > 0
      ? requestedPlatforms.map((platform) => platformMap[normalizePlatformName(platform)]).filter(Boolean)
      : Object.keys(targetsByPlatform)
  )

  if (resolvedPlatforms.length === 0) {
    throw new Error('Nenhuma plataforma auditavel foi selecionada.')
  }

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--start-minimized',
      '--window-position=-32000,-32000',
      '--window-size=320,240',
    ],
  }).catch(() =>
    chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--start-minimized',
        '--window-position=-32000,-32000',
        '--window-size=320,240',
      ],
    }),
  )

  const context = await browser.newContext(
    existsSync(storageStatePath)
      ? { storageState: storageStatePath }
      : undefined,
  )
  const page = await context.newPage()
  const report = {
    generatedAt: new Date().toISOString(),
    platforms: {},
  }

  try {
    for (const platform of resolvedPlatforms) {
      const target = targetsByPlatform[platform]
      if (!target) continue

      const platformHits = []
      const onResponse = async (response) => {
        const url = response.url()
        if (!url.includes(target.endpointPattern)) return

        let textPreview = ''
        try {
          textPreview = (await response.text()).slice(0, 1200)
        } catch {}

        platformHits.push({
          status: response.status(),
          textPreview,
          timestamp: Date.now(),
          url,
        })
      }

      page.on('response', onResponse)
      await page.goto(target.pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      await page.waitForTimeout(8_000)

      const tabs = []
      for (const tab of target.tabs) {
        platformHits.length = 0
        const clickedLabel = await clickFirstVisibleText(page, tab.labels)
        await page.waitForTimeout(10_000)

        const resolvedHit = pickResolvedGridHit(platformHits, target.endpointPattern)
        const discoveredId = resolvedHit ? parseLeagueIdFromUrl(resolvedHit.url) : null
        const configuredId = overridesByPlatform[platform]?.[tab.key]?.id ?? null

        tabs.push({
          clickedLabel,
          configuredId,
          discoveredId,
          discoveredFrom: resolvedHit?.kind ?? null,
          key: tab.key,
          matchesConfiguredId: configuredId === discoveredId,
          requestUrl: resolvedHit?.url ?? null,
          responsePreview: resolvedHit?.textPreview ?? null,
        })
      }

      const bodyPreview = await page.locator('body').innerText().catch(() => '')
      page.off('response', onResponse)

      report.platforms[platform] = {
        bodyPreview: String(bodyPreview).slice(0, 2000),
        pageUrl: target.pageUrl,
        tabs,
      }
    }

    const outputPath = path.join(outputDir, `${timestampLabel()}.json`)
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')

    console.log(`Relatorio salvo em ${outputPath}`)
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
