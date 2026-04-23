(() => {
  const bridgeUrl = 'http://127.0.0.1:5173/api/bbtips/ingest'
  const bridgePingUrl = 'http://127.0.0.1:5173/api/bbtips/bridge-ping'
  const targetPattern = /(?:api\.bbtips\.com\.br\/api\/|\/api\/)(?:futebolvirtual|betanoFutebolVirtual|playpixFutebolVirtual)\b/i
  const state = {
    errors: [],
    installedAt: new Date().toISOString(),
    matched: 0,
    polled: 0,
    polling: false,
    sent: 0,
  }
  const period = 'Horas12'
  const pollTargets = [
    ...[
      [2, 'Betano/classicos'],
      [3, 'Betano/copa'],
      [4, 'Betano/euro'],
      [5, 'Betano/america'],
      [6, 'Betano/british'],
      [7, 'Betano/espanhola'],
      [8, 'Betano/scudetto'],
      [9, 'Betano/italiano'],
      [11, 'Betano/estrelas'],
      [12, 'Betano/campeoes'],
    ].map(([liga, label]) => ({
      label,
      urls: [
        `https://api.bbtips.com.br/api/betanoFutebolVirtual?liga=${liga}&Horas=${period}&dadosAlteracao=&filtros=`,
      ],
    })),
    ...[
      [1, 'PlayPix/ita'],
      [2, 'PlayPix/eng'],
      [3, 'PlayPix/spa'],
      [4, 'PlayPix/bra'],
      [5, 'PlayPix/lat'],
    ].map(([liga, label]) => ({
      label,
      urls: [
        `https://api.bbtips.com.br/api/playpixFutebolVirtual?liga=${liga}&Horas=${period}&dadosAlteracao=&filtros=`,
      ],
    })),
    ...[
      [2, 'Bet365/copa'],
      [1, 'Bet365/euro'],
      [4, 'Bet365/super'],
      [3, 'Bet365/premier'],
      [0, 'Express/express'],
    ].map(([liga, label]) => ({
      label,
      urls: [
        `https://api.bbtips.com.br/api/futebolvirtual?liga=${liga}&futuro=false&Horas=Horas24&tipoOdd=&dadosAlteracao=&filtros=&confrontos=false&hrsConfrontos=240`,
        `https://api.bbtips.com.br/api/futebolvirtual?liga=${liga}&futuro=true&Horas=Horas24&tipoOdd=&dadosAlteracao=&filtros=&confrontos=false&hrsConfrontos=240`,
      ],
    })),
  ]

  const normalizeUrl = (url) => {
    try {
      return new URL(String(url), window.location.origin).href
    } catch {
      return String(url ?? '')
    }
  }

  const rememberError = (error) => {
    state.errors.unshift(String(error instanceof Error ? error.message : error).slice(0, 220))
    state.errors.splice(8)
  }

  const pingTigger = () => {
    const body = JSON.stringify({
      href: window.location.href,
      state,
      title: document.title,
      userAgent: navigator.userAgent,
    })

    fetch(bridgePingUrl, {
      body,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      keepalive: true,
      method: 'POST',
      mode: 'cors',
    }).catch(() => undefined)
  }

  const sendToTigger = (url, text) => {
    const absoluteUrl = normalizeUrl(url)
    if (!targetPattern.test(absoluteUrl)) return
    state.matched += 1
    if (!text || !String(text).trim().startsWith('{')) return

    let payload = null
    try {
      payload = JSON.parse(text)
    } catch {
      return
    }
    if (!Array.isArray(payload?.Linhas) || payload.Linhas.length === 0) return

    state.sent += 1
    const body = JSON.stringify({ payload, url: absoluteUrl })

    fetch(bridgeUrl, {
      body,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      keepalive: true,
      method: 'POST',
      mode: 'cors',
    }).catch((error) => {
      rememberError(error)
      fetch(bridgeUrl, {
        body,
        keepalive: true,
        method: 'POST',
        mode: 'no-cors',
      }).catch(rememberError)
    })
  }

  const pollBbtipsApi = async () => {
    if (state.polling) return
    state.polling = true

    try {
      for (const target of pollTargets) {
        for (const url of target.urls) {
          try {
            const response = await fetch(url, {
              headers: {
                Accept: 'application/json, text/plain, */*',
                'Cache-Control': 'no-cache',
                Pragma: 'no-cache',
              },
            })
            const text = await response.text()
            state.polled += 1
            if (!response.ok) {
              rememberError(`${target.label}: HTTP ${response.status}`)
              continue
            }
            sendToTigger(url, text)
          } catch (error) {
            rememberError(`${target.label}: ${error instanceof Error ? error.message : error}`)
          }
          await new Promise((resolve) => setTimeout(resolve, 80))
        }
      }
    } finally {
      state.polling = false
    }
  }

  if (!window.__tiggerBbtipsBridgeFetchInstalled) {
    window.__tiggerBbtipsBridgeFetchInstalled = true
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const response = await originalFetch(...args)
      const url = normalizeUrl(args[0] instanceof Request ? args[0].url : args[0] ?? '')
      if (targetPattern.test(url)) {
        response.clone().text().then((text) => sendToTigger(url, text)).catch(() => undefined)
      }
      return response
    }
  }

  if (!window.__tiggerBbtipsBridgeXhrInstalled) {
    window.__tiggerBbtipsBridgeXhrInstalled = true
    const originalOpen = XMLHttpRequest.prototype.open
    const originalSend = XMLHttpRequest.prototype.send

    XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
      this.__tiggerBbtipsBridgeUrl = normalizeUrl(url)
      return originalOpen.call(this, method, url, ...rest)
    }

    XMLHttpRequest.prototype.send = function send(...args) {
      this.addEventListener('loadend', () => {
        const url = this.__tiggerBbtipsBridgeUrl
        if (!targetPattern.test(String(url))) return

        try {
          sendToTigger(url, this.responseText)
        } catch {
          // O bridge nunca pode quebrar a BBTips.
        }
      })

      return originalSend.call(this, ...args)
    }
  }

  window.__tiggerBbtipsBridgeState = state
  pollBbtipsApi()
  pingTigger()
  window.__tiggerBbtipsBridgePollTimer = window.setInterval(pollBbtipsApi, 3500)
  window.__tiggerBbtipsBridgePingTimer = window.setInterval(pingTigger, 5000)
  console.log('[Tigger] Bridge BBTips ativo com polling direto da aba BBTips. Estado:', state)
})()
