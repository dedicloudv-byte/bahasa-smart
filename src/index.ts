import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { cors } from 'hono/cors'
import { GoogleGenAI } from "@google/genai"

type Bindings = {
  R2: R2Bucket
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for External API
app.use('/api/v1/*', cors())

// API Endpoints for Config
app.get('/api/config-status', async (c) => {
  try {
    const obj = await c.env.R2.get('config/gemini_key.txt')
    return c.json({ configured: !!obj })
  } catch (e) {
    return c.json({ configured: false })
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

// Helper for Chat Logic
async function handleChat(c: any, contents: any, systemInstruction: any) {
  try {
    const obj = await c.env.R2.get('config/gemini_key.txt')
    if (!obj) {
      return c.json({ error: 'API Key not found in R2. Please configure it first.' }, 400)
    }
    const apiKey = await obj.text()

    const genAI = new GoogleGenAI({ apiKey })
    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: contents,
      config: {
        systemInstruction: systemInstruction
      }
    })

    return c.json({ text: response.text })
  } catch (e: any) {
    console.error('Gemini API Error:', e)
    return c.json({ error: e.message || 'Failed to generate content' }, 500)
  }
}

app.post('/api/chat', async (c) => {
  const { contents, systemInstruction } = await c.req.json()
  return handleChat(c, contents, systemInstruction)
})

// External Public API Endpoint
app.post('/api/v1/chat', async (c) => {
  const clientKeyHeader = c.req.header('X-Client-Key')
  const { contents, systemInstruction } = await c.req.json()

  // Validate Client Key
  const storedClientKeyObj = await c.env.R2.get('config/client_key.txt')
  if (!storedClientKeyObj || (await storedClientKeyObj.text()) !== clientKeyHeader) {
    return c.json({ error: 'Invalid or missing Client Key' }, 401)
  }

  return handleChat(c, contents, systemInstruction)
})

// Client Config Endpoints
app.get('/api/client-config', async (c) => {
  const obj = await c.env.R2.get('config/client_key.txt')
  const clientKey = obj ? await obj.text() : null

  return c.json({
    endpoint: `${new URL(c.req.url).origin}/api/v1/chat`,
    clientKey: clientKey
  })
})

app.post('/api/client-config/rotate', async (c) => {
  const newKey = crypto.randomUUID()
  await c.env.R2.put('config/client_key.txt', newKey)
  return c.json({ clientKey: newKey })
})

// Serving static files
app.use('/*', serveStatic({ root: './' }))

export default app
