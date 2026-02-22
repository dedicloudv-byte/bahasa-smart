import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { GoogleGenAI } from "@google/genai"

type Bindings = {
  R2: R2Bucket
}

const app = new Hono<{ Bindings: Bindings }>()

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

app.post('/api/chat', async (c) => {
  const { contents, systemInstruction } = await c.req.json()

  try {
    const obj = await c.env.R2.get('config/gemini_key.txt')
    if (!obj) {
      return c.json({ error: 'API Key not found in R2. Please configure it first.' }, 400)
    }
    const apiKey = await obj.text()

    const genAI = new GoogleGenAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
      systemInstruction: systemInstruction
    })

    const result = await model.generateContent({ contents })
    const response = result.response
    const text = response.text()

    return c.json({ text: text })
  } catch (e: any) {
    console.error('Gemini API Error:', e)
    return c.json({ error: e.message || 'Failed to generate content' }, 500)
  }
})

// Serving static files
app.use('/*', serveStatic({ root: './' }))

export default app
