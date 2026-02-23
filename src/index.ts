import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { cors } from 'hono/cors'
import { GoogleGenAI } from "@google/genai"
import { proxyFetch } from '@dividenconquer/cloudflare-proxy-fetch'

type Bindings = {
  R2: R2Bucket
}

const app = new Hono<{ Bindings: Bindings }>()

const PRX_BANK_URL = "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/proxyList.txt";

async function getProxyBank() {
  const res = await fetch(PRX_BANK_URL);
  if (!res.ok) return [];
  const text = await res.text();
  return text.split('\n')
    .filter(line => line.trim())
    .map(line => {
      const [ip, port, country, org] = line.split(',');
      return { ip, port: parseInt(port), country, org };
    });
}

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
      // New format: { activeNodeUrl: '...', nodes: [...] }
      if (proxyData.activeNodeUrl) {
        baseUrl = proxyData.activeNodeUrl
      } else if (proxyData.proxyUrl) {
        // Fallback for old format
        baseUrl = proxyData.proxyUrl
      }
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        baseUrl: baseUrl, // Dynamically set from R2
        fetch: (url: any, init: any) => {
            if (baseUrl && !baseUrl.includes('googleapis.com')) {
                // If using a relay node, we might want to route through it.
                // But if baseUrl IS the proxy gateway, we just fetch it.
                // If the user meant using the IPs from proxyList.txt as EGRESS PROXIES:
                // Then we should use proxyFetch with those IPs.

                // Let's assume if baseUrl is just an IP:Port or a non-google URL,
                // we treat it as a proxy.
                return proxyFetch(url, { ...init, proxy: baseUrl });
            }
            return fetch(url, init);
        }
      }
    })

    // Using the requested new model and SDK syntax
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: contents,
      config: {
        systemInstruction: systemInstruction
      }
    })

    // In @google/genai, the response text is accessed via the .text getter
    return c.json({ text: response.text })
  } catch (e: any) {
    console.error('Gemini API Error:', e)
    // If it's an API error, it might have more details
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
app.get('/api/proxy-bank', async (c) => {
    try {
        const proxies = await getProxyBank();
        return c.json(proxies);
    } catch (e) {
        return c.json({ error: 'Failed to fetch proxy bank' }, 500);
    }
});

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
    const id = setTimeout(() => controller.abort(), 12000);

    let locationData = { city: 'N/A', country: 'N/A', ip: 'N/A', colo: 'N/A' };

    // Try to fetch trace through the proxy using proxyFetch
    try {
        const traceRes = await proxyFetch('https://www.cloudflare.com/cdn-cgi/trace', {
            proxy: proxyUrl,
            signal: controller.signal
        });
        if (traceRes.ok) {
            const text = await traceRes.text();
            const lines = text.split('\n');
            const data: any = {};
            lines.forEach(line => {
                const [k, v] = line.split('=');
                if (k && v) data[k] = v;
            });
            locationData.ip = data.ip || 'N/A';
            locationData.colo = data.colo || 'N/A';
            locationData.country = data.loc || 'N/A';
        }
    } catch (e: any) {
        console.error('Trace via proxy failed:', e.message);
    }

    // Also check if the proxy can reach Gemini
    const geminiRes = await proxyFetch('https://generativelanguage.googleapis.com', {
        proxy: proxyUrl,
        signal: controller.signal
    });

    clearTimeout(id);

    const latency = Date.now() - start;
    return c.json({
      success: true,
      status: geminiRes.status,
      latency: `${latency}ms`,
      location: locationData
    });
  } catch (err: any) {
    return c.json({
      success: false,
      error: err.name === 'AbortError' ? 'Connection Timeout (12s)' : (err.message || 'Proxy Connection failed')
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
