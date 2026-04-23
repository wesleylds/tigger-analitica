import { chromium } from 'playwright'

const run = async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } })

  await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(8000)

  const firstVideo = page.locator('.analysis-video-player').first()
  await firstVideo.waitFor({ state: 'visible', timeout: 20000 })

  await page.screenshot({
    path: 'captures/local-video-check.png',
    fullPage: false,
  })

  const data = await firstVideo.evaluate((node) => {
    const video = node
    return {
      currentSrc: video.currentSrc,
      paused: video.paused,
      readyState: video.readyState,
      networkState: video.networkState,
      muted: video.muted,
      duration: Number.isFinite(video.duration) ? video.duration : null,
    }
  })

  console.log(JSON.stringify(data, null, 2))
  await browser.close()
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
