const postText = async (url, body) => {
  const response = await fetch(url, {
    body,
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`POST ${url} HTTP ${response.status}`)
  }
  return { ok: true }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  ;(async () => {
    if (message?.type === 'fetchText') {
      const response = await fetch(message.url, {
        cache: 'no-store',
        credentials: 'include',
        headers: message.headers || {},
        mode: 'cors',
      })
      const text = await response.text()
      sendResponse({ httpOk: response.ok, ok: true, status: response.status, text })
      return
    }

    if (message?.type === 'postText') {
      await postText(message.url, message.body)
      sendResponse({ ok: true })
      return
    }

    sendResponse({ ok: false, error: 'unknown-message' })
  })().catch((error) => {
    sendResponse({ ok: false, error: String(error instanceof Error ? error.message : error) })
  })

  return true
})
