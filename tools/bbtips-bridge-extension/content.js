(() => {
  if (globalThis.__tiggerBbtipsExtensionInjected) return
  globalThis.__tiggerBbtipsExtensionInjected = true

  const bridgeUrl = 'http://127.0.0.1:5173/api/bbtips/ingest'
  const bridgePingUrl = 'http://127.0.0.1:5173/api/bbtips/bridge-ping'
  const period = 'Horas12'
  const targetPattern = /(?:api\.bbtips\.com\.br\/api\/|\/api\/)(?:futebolvirtual|betanoFutebolVirtual|playpixFutebolVirtual)\b/i
  const signatureByUrl = new Map()
  const directState = {
    contentScriptAt: new Date().toISOString(),
    directErrors: [],
    directMatched: 0,
    directPolled: 0,
    directPolling: false,
    directSent: 0,
    injected: false,
  }

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
      matrixUrls: [
        `https://api.bbtips.com.br/api/betanoFutebolVirtual?liga=${liga}&Horas=${period}&dadosAlteracao=&filtros=`,
      ],
      updatedAtUrl: `https://api.bbtips.com.br/api/betanoFutebolVirtual/ultimaAtualizacao?liga=${liga}`,
    })),
    ...[
      [1, 'PlayPix/ita'],
      [2, 'PlayPix/eng'],
      [3, 'PlayPix/spa'],
      [4, 'PlayPix/bra'],
      [5, 'PlayPix/lat'],
    ].map(([liga, label]) => ({
      label,
      matrixUrls: [
        `https://api.bbtips.com.br/api/playpixFutebolVirtual?liga=${liga}&Horas=${period}&dadosAlteracao=&filtros=`,
      ],
      updatedAtUrl: `https://api.bbtips.com.br/api/playpixFutebolVirtual/ultimaAtualizacao?liga=${liga}`,
    })),
    ...[
      [2, 'Bet365/copa'],
      [1, 'Bet365/euro'],
      [4, 'Bet365/super'],
      [3, 'Bet365/premier'],
      [0, 'Express/express'],
    ].map(([liga, label]) => ({
      label,
      matrixUrls: [
        `https://api.bbtips.com.br/api/futebolvirtual?liga=${liga}&futuro=false&Horas=Horas24&tipoOdd=&dadosAlteracao=&filtros=&confrontos=false&hrsConfrontos=240`,
        `https://api.bbtips.com.br/api/futebolvirtual?liga=${liga}&futuro=true&Horas=Horas24&tipoOdd=&dadosAlteracao=&filtros=&confrontos=false&hrsConfrontos=240`,
      ],
      updatedAtUrl: null,
    })),
  ]

  const rememberError = (error) => {
    directState.directErrors.unshift(String(error instanceof Error ? error.message : error).slice(0, 240))
    directState.directErrors.splice(12)
  }

  const extensionRequest = (message) =>
    new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const runtimeError = chrome.runtime.lastError
          if (runtimeError) {
            reject(new Error(runtimeError.message))
            return
          }
          if (!response?.ok) {
            reject(new Error(response?.error || 'extension-request-failed'))
            return
          }
          resolve(response)
        })
      } catch (error) {
        reject(error)
      }
    })

  const normalizeUrl = (url) => {
    try {
      return new URL(String(url), window.location.href).href
    } catch {
      return String(url ?? '')
    }
  }

  const findAuthToken = () => {
    const candidates = []
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)
        const value = key ? localStorage.getItem(key) : null
        if (!value) continue
        if (/bearer|token|jwt|access/i.test(key) && /^[\w.-]{20,}$/.test(value.replace(/^Bearer\s+/i, ''))) {
          candidates.push(value.replace(/^Bearer\s+/i, ''))
        }
        if (/^\s*[{[]/.test(value)) {
          try {
            const parsed = JSON.parse(value)
            const stack = [parsed]
            while (stack.length) {
              const current = stack.pop()
              if (!current || typeof current !== 'object') continue
              for (const [childKey, childValue] of Object.entries(current)) {
                if (typeof childValue === 'string' && /token|jwt|access/i.test(childKey) && /^[\w.-]{20,}$/.test(childValue.replace(/^Bearer\s+/i, ''))) {
                  candidates.push(childValue.replace(/^Bearer\s+/i, ''))
                } else if (childValue && typeof childValue === 'object') {
                  stack.push(childValue)
                }
              }
            }
          } catch {
            // Ignora entradas que nao sao JSON valido.
          }
        }
      }
    } catch (error) {
      rememberError(`localStorage: ${error instanceof Error ? error.message : error}`)
    }
    return candidates[0] ?? ''
  }

  const buildHeaders = () => {
    const token = findAuthToken()
    return {
      Accept: 'application/json, text/plain, */*',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }

  const pingTigger = () => {
    const body = JSON.stringify({
      href: window.location.href,
      state: directState,
      title: document.title,
      userAgent: navigator.userAgent,
    })

    extensionRequest({ body, type: 'postText', url: bridgePingUrl }).catch(() => undefined)
  }

  const sendToTigger = (url, text) => {
    const absoluteUrl = normalizeUrl(url)
    if (!targetPattern.test(absoluteUrl)) return
    directState.directMatched += 1
    if (!text || !String(text).trim().startsWith('{')) return

    let payload = null
    try {
      payload = JSON.parse(text)
    } catch {
      return
    }
    if (!Array.isArray(payload?.Linhas) || payload.Linhas.length === 0) return

    const signature = [
      payload.DataAtualizacao ?? '',
      payload.Linhas?.[0]?.Hora ?? '',
      payload.Linhas?.[0]?.Colunas?.length ?? 0,
      payload.Linhas?.[0]?.Colunas?.[0]?.Resultado ?? payload.Linhas?.[0]?.Colunas?.[0]?.Resultado_FT ?? '',
    ].join('|')
    if (signatureByUrl.get(absoluteUrl) === signature) return
    signatureByUrl.set(absoluteUrl, signature)

    directState.directSent += 1
    extensionRequest({
      body: JSON.stringify({ payload, url: absoluteUrl }),
      type: 'postText',
      url: bridgeUrl,
    }).catch(rememberError)
  }

  const fetchText = async (url) => {
    const response = await extensionRequest({
      headers: buildHeaders(),
      type: 'fetchText',
      url,
    })
    const text = response.text || ''
    if (!response.httpOk) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 80)}`)
    }
    return text
  }

  const pollBbtipsApi = async () => {
    if (directState.directPolling) return
    directState.directPolling = true
    try {
      for (const target of pollTargets) {
        let shouldFetchMatrix = !target.updatedAtUrl
        if (target.updatedAtUrl) {
          try {
            const updatedAtText = await fetchText(target.updatedAtUrl)
            shouldFetchMatrix = signatureByUrl.get(target.updatedAtUrl) !== updatedAtText
            signatureByUrl.set(target.updatedAtUrl, updatedAtText)
          } catch (error) {
            shouldFetchMatrix = true
            rememberError(`${target.label}/ultimaAtualizacao: ${error instanceof Error ? error.message : error}`)
          }
        }

        if (!shouldFetchMatrix) continue

        for (const url of target.matrixUrls) {
          try {
            const text = await fetchText(url)
            directState.directPolled += 1
            sendToTigger(url, text)
          } catch (error) {
            rememberError(`${target.label}: ${error instanceof Error ? error.message : error}`)
          }
          await new Promise((resolve) => setTimeout(resolve, 40))
        }
      }
    } finally {
      directState.directPolling = false
      pingTigger()
    }
  }

  try {
    const script = document.createElement('script')
    script.src = chrome.runtime.getURL('inject.js')
    script.async = false
    script.onload = () => {
      directState.injected = true
      script.remove()
      pingTigger()
    }
    script.onerror = () => {
      rememberError('inject.js nao carregou')
      pingTigger()
    }
    ;(document.documentElement || document.head || document).appendChild(script)
  } catch (error) {
    rememberError(error)
  }

  pollBbtipsApi()
  pingTigger()
  setInterval(pollBbtipsApi, 1000)
  setInterval(pingTigger, 5000)
})()
