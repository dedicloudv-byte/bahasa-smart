import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { cors } from 'hono/cors'
import { GoogleGenerativeAI } from "@google/generative-ai"

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

    // Read Proxy Config
    let baseUrl: string | undefined = undefined
    const proxyObj = await c.env.R2.get('config/proxy_config.json')
    if (proxyObj) {
      const proxyData = await proxyObj.json() as any
      if (proxyData.proxyUrl) {
        baseUrl = proxyData.proxyUrl
      }
    }

    const genAI = new GoogleGenerativeAI(apiKey)

    // Use gemini-1.5-flash which is stable and widely available
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: systemInstruction?.parts?.[0]?.text
    }, { baseUrl })

    const chat = model.startChat({
        history: contents.slice(0, -1).map((m: any) => ({
            role: m.role === 'model' ? 'model' : 'user',
            parts: m.parts
        })),
    });

    const lastMsg = contents[contents.length - 1].parts[0].text;
    const result = await chat.sendMessage(lastMsg);
    const response = await result.response;
    const text = response.text();

    return c.json({ text: text })
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

// Proxy Config Endpoints
app.get('/api/proxy-config', async (c) => {
  const obj = await c.env.R2.get('config/proxy_config.json')
  const data = obj ? await obj.json() : {}
  return c.json(data)
})

app.post('/api/proxy-test', async (c) => {
  const { proxyUrl } = await c.req.json<{ proxyUrl: string }>();
  try {
    const start = Date.now();
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 8000);

    // Append a simple health check path if not present, but for generic proxy we just HEAD the base
    const response = await fetch(proxyUrl, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(id);

    const latency = Date.now() - start;
    return c.json({
      success: true,
      status: response.status,
      latency: `${latency}ms`
    });
  } catch (err: any) {
    return c.json({
      success: false,
      error: err.name === 'AbortError' ? 'Connection Timeout (8s)' : (err.message || 'Connection failed')
    }, 500);
  }
});

app.post('/api/proxy-config', async (c) => {
  const data = await c.req.json()
  await c.env.R2.put('config/proxy_config.json', JSON.stringify(data))
  return c.json({ success: true })
})

// Serving static files
app.use('/*', serveStatic({ root: './' }))

export default app
