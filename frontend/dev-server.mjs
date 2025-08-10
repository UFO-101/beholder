#!/usr/bin/env node
import http from 'http'
import { promises as fs } from 'fs'
import path from 'path'
import url from 'url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

const args = new Map(process.argv.slice(2).map((a) => {
  const [k, v] = a.split('=')
  return [k.replace(/^--/, ''), v ?? true]
}))

const port = Number(args.get('port') || process.env.PORT || 8080)
const root = path.resolve(__dirname)

const mime = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
}))

function safeJoin(base, target) {
  const targetPath = path.resolve(base, target)
  if (!targetPath.startsWith(base)) return null
  return targetPath
}

async function sendFile(res, filePath) {
  try {
    const data = await fs.readFile(filePath)
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, {
      'Content-Type': mime.get(ext) || 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    res.end(data)
  } catch (e) {
    if (e.code === 'ENOENT') {
      res.writeHead(404)
      res.end('Not Found')
    } else {
      res.writeHead(500)
      res.end('Server Error')
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url)
    let pathname = decodeURIComponent(parsed.pathname || '/')
    if (pathname === '/') pathname = '/index.html'
    const candidate = safeJoin(root, pathname)
    if (!candidate) {
      res.writeHead(400)
      res.end('Bad Request')
      return
    }
    await sendFile(res, candidate)
  } catch (err) {
    res.writeHead(500)
    res.end('Server Error')
  }
})

server.listen(port, () => {
  console.log(`[frontend] serving ${root} on http://localhost:${port}`)
})

