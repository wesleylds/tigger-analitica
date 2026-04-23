import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { createServer } from 'node:http'

const port = Number(process.env.PORT ?? 4173)
const root = join(process.cwd(), 'dist')

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const sendFile = (response, filePath) => {
  const ext = extname(filePath).toLowerCase()
  const type = contentTypes[ext] ?? 'application/octet-stream'
  response.writeHead(200, { 'Content-Type': type })
  createReadStream(filePath).pipe(response)
}

const server = createServer((request, response) => {
  const urlPath = request.url?.split('?')[0] ?? '/'
  const safePath = normalize(urlPath).replace(/^([.][.][/\\])+/, '')
  const requestedPath = safePath === '/' ? '/index.html' : safePath
  const filePath = join(root, requestedPath)

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    sendFile(response, filePath)
    return
  }

  const fallback = join(root, 'index.html')
  if (existsSync(fallback)) {
    sendFile(response, fallback)
    return
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end('dist not found')
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Static server running at http://127.0.0.1:${port}`)
})
