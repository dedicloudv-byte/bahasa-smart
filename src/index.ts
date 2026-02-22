import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  R2: R2Bucket
}

const app = new Hono<{ Bindings: Bindings }>()

// API Endpoints for Config
app.get('/api/config', async (c) => {
  try {
    const obj = await c.env.R2.get('config/gemini_key.txt')
    if (!obj) {
      return c.json({ key: null })
    }
    const key = await obj.text()
    return c.json({ key })
  } catch (e) {
    return c.json({ key: null, error: 'Failed to fetch key' })
  }
})

app.post('/api/config', async (c) => {
  const { key } = await c.req.json()
  if (!key) {
    return c.json({ error: 'Key is required' }, 400)
  }
  await c.env.R2.put('config/gemini_key.txt', key)
  return c.json({ success: true })
})

// Serving static files explicitly from the public directory
app.get('/', serveStatic({ path: './public/index.html' }))
app.get('/style.css', serveStatic({ path: './public/style.css' }))
app.get('/app.js', serveStatic({ path: './public/app.js' }))

export default app
