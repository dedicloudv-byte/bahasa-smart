import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { cors } from 'hono/cors'
import { GoogleGenAI } from "@google/genai"
import { proxyFetch } from '@dividenconquer/cloudflare-proxy-fetch'
import { connect } from "cloudflare:sockets";

type Bindings = {
  R2: R2Bucket
}

// Proxy/VPN Constants & Helpers
const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
const SALT_A1 = atob("Vk1lc3MgSGVhZGVyIEFFQUQgS2V5X0xlbmd0aA==");
const SALT_A2 = atob("Vk1lc3MgSGVhZGVyIEFFQUQgTm9uY2VfTGVuZ3Ro");
const SALT_A3 = atob("Vk1lc3MgSGVhZGVyIEFFQUQgS2V5");
const SALT_A4 = atob("Vk1lc3MgSGVhZGVyIEFFQUQgTm9uY2U=");
const SALT_B1 = atob("QUVBRCBSZXNwIEhlYWRlciBMZW4gS2V5");
const SALT_B2 = atob("QUVBRCBSZXNwIEhlYWRlciBMZW4gSVY=");
const SALT_B3 = atob("QUVBRCBSZXNwIEhlYWRlciBLZXk=");
const SALT_B4 = atob("QUVBRCBSZXNwIEhlYWRlciBJVg==");

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
        baseUrl: baseUrl,
        fetch: (url: any, init: any) => {
            if (baseUrl && !baseUrl.includes('googleapis.com')) {
                // If it looks like an IP:Port, use proxyFetch (Socket-based)
                if (/^https?:\/\/\d+\.\d+\.\d+\.\d+:\d+/.test(baseUrl)) {
                    return proxyFetch(url, { ...init, proxy: baseUrl });
                }
                // If it's a domain (Relay Worker), just use regular fetch
                // The SDK will already use baseUrl as the prefix
                return fetch(url, init);
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

// --- PROXY PROTOCOL PARSERS & HELPERS (from Nautica) ---

async function protocolSniffer(buffer: ArrayBuffer): Promise<string> {
    const u8 = new Uint8Array(buffer);
    if (u8.byteLength >= 62) {
        const horseDelimiter = new Uint8Array(buffer.slice(56, 60));
        if (horseDelimiter[0] === 0x0d && horseDelimiter[1] === 0x0a) {
            if (horseDelimiter[2] === 0x01 || horseDelimiter[2] === 0x03 || horseDelimiter[2] === 0x7f) {
                if (horseDelimiter[3] === 0x01 || horseDelimiter[3] === 0x03 || horseDelimiter[3] === 0x04) {
                    return "trojan";
                }
            }
        }
    }
    if (u8.byteLength >= 18) {
        const version = u8[0];
        if (version === 0) {
            const protocolUuid = new Uint8Array(buffer.slice(1, 17));
            if (arrayBufferToHex(protocolUuid).match(/^[0-9a-f]{8}[0-9a-f]{4}4[0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i)) {
                return "vless";
            }
        }
    }
    if (u8.byteLength >= 42) {
        const firstByte = u8[0];
        if (firstByte === 0x01 || firstByte === 0x03 || firstByte === 0x04) {
            return "ss";
        }
        return "vmess";
    }
    return "ss";
}

async function readStreamHeader(buffer: ArrayBuffer) {
    try {
        const uuidString = "00000000-0000-0000-0000-000000000000";
        const uuidBytes = new Uint8Array(uuidString.replace(/-/g, "").match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
        const authKey = await md5(uuidBytes, new TextEncoder().encode(atob("YzQ4NjE5ZmUtOGYwMi00OWUwLWI5ZTktZWRmNzYzZTE3ZTIx")));
        const authId = new Uint8Array(buffer.slice(0, 16));
        const encryptedLength = new Uint8Array(buffer.slice(16, 34));
        const nonce = new Uint8Array(buffer.slice(34, 42));
        const lengthKey = (await kdf(authKey, [SALT_A1, authId, nonce])).slice(0, 16);
        const lengthIv = (await kdf(authKey, [SALT_A2, authId, nonce])).slice(0, 12);
        const lengthBytes = await aesGcmDecrypt(lengthKey, lengthIv, encryptedLength, authId);
        const headerLength = (lengthBytes[0] << 8) | lengthBytes[1];
        const encryptedHeader = new Uint8Array(buffer.slice(42, 42 + headerLength + 16));
        const payloadKey = (await kdf(authKey, [SALT_A3, authId, nonce])).slice(0, 16);
        const payloadIv = (await kdf(authKey, [SALT_A4, authId, nonce])).slice(0, 12);
        const headerPayload = await aesGcmDecrypt(payloadKey, payloadIv, encryptedHeader, authId);
        const view = new DataView(headerPayload.buffer);
        let offset = 0;
        const version = view.getUint8(offset++);
        if (version !== 1) return { hasError: true, message: `Invalid version: ${version}` };
        const encIv = new Uint8Array(headerPayload.slice(offset, offset + 16)); offset += 16;
        const encKey = new Uint8Array(headerPayload.slice(offset, offset + 16)); offset += 16;
        const options = new Uint8Array(headerPayload.slice(offset, offset + 4)); offset += 4;
        const cmd = view.getUint8(offset++);
        const isUDP = cmd !== 0x01;
        const portRemote = view.getUint16(offset, false); offset += 2;
        const addressType = view.getUint8(offset++);
        let addressRemote = "";
        switch (addressType) {
            case 1: addressRemote = `${view.getUint8(offset)}.${view.getUint8(offset + 1)}.${view.getUint8(offset + 2)}.${view.getUint8(offset + 3)}`; offset += 4; break;
            case 2: case 3: const len = view.getUint8(offset++); addressRemote = new TextDecoder().decode(headerPayload.slice(offset, offset + len)); offset += len; break;
            case 4: const parts = []; for (let i = 0; i < 8; i++) parts.push(view.getUint16(offset + i * 2, false).toString(16)); addressRemote = parts.join(":"); offset += 16; break;
            default: return { hasError: true, message: `Invalid address type: ${addressType}` };
        }
        const rawDataIndex = 42 + headerLength + 16;
        return { hasError: false, addressRemote, addressType, portRemote, rawDataIndex, rawClientData: buffer.slice(rawDataIndex), version: new Uint8Array([options[0], 0]), isUDP, needsResponse: true, responseOptions: options, encKey, encIv };
    } catch (e: any) { return { hasError: true, message: "VMess header failed: " + e.message }; }
}

function readSsHeader(ssBuffer: ArrayBuffer) {
    const view = new DataView(ssBuffer);
    const addressType = view.getUint8(0);
    let addressLength = 0, addressValueIndex = 1, addressValue = "";
    switch (addressType) {
        case 1: addressLength = 4; addressValue = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join("."); break;
        case 3: addressLength = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + 1))[0]; addressValueIndex += 1; addressValue = new TextDecoder().decode(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)); break;
        case 4: addressLength = 16; const dv = new DataView(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)); const ipv6 = []; for (let i = 0; i < 8; i++) ipv6.push(dv.getUint16(i * 2).toString(16)); addressValue = ipv6.join(":"); break;
        default: return { hasError: true, message: `Invalid SS ATYP: ${addressType}` };
    }
    const portIndex = addressValueIndex + addressLength;
    const portRemote = new DataView(ssBuffer.slice(portIndex, portIndex + 2)).getUint16(0);
    return { hasError: false, addressRemote: addressValue, addressType, portRemote, rawDataIndex: portIndex + 2, rawClientData: ssBuffer.slice(portIndex + 2), version: null, isUDP: portRemote == 53 };
}

function readNekoHeader(buffer: ArrayBuffer) {
    const u8 = new Uint8Array(buffer);
    const version = u8[0];
    const optLength = u8[17];
    const cmd = u8[18 + optLength];
    const isUDP = cmd === 2;
    const portIndex = 18 + optLength + 1;
    const portRemote = new DataView(buffer.slice(portIndex, portIndex + 2)).getUint16(0);
    let addressIndex = portIndex + 2;
    const addressType = u8[addressIndex];
    let addressLength = 0, addressValueIndex = addressIndex + 1, addressValue = "";
    switch (addressType) {
        case 1: addressLength = 4; addressValue = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + addressLength)).join("."); break;
        case 2: addressLength = u8[addressValueIndex++]; addressValue = new TextDecoder().decode(buffer.slice(addressValueIndex, addressValueIndex + addressLength)); break;
        case 3: addressLength = 16; const dv = new DataView(buffer.slice(addressValueIndex, addressValueIndex + addressLength)); const ipv6 = []; for (let i = 0; i < 8; i++) ipv6.push(dv.getUint16(i * 2).toString(16)); addressValue = ipv6.join(":"); break;
        default: return { hasError: true, message: `Invalid VLESS ATYP: ${addressType}` };
    }
    return { hasError: false, addressRemote: addressValue, addressType, portRemote, rawDataIndex: addressValueIndex + addressLength, rawClientData: buffer.slice(addressValueIndex + addressLength), version: new Uint8Array([version, 0]), isUDP };
}

function readHorseHeader(buffer: ArrayBuffer) {
    const dataBuffer = buffer.slice(58);
    const view = new DataView(dataBuffer);
    const cmd = view.getUint8(0);
    const isUDP = cmd == 3;
    let addressType = view.getUint8(1);
    let addressLength = 0, addressValueIndex = 2, addressValue = "";
    switch (addressType) {
        case 1: addressLength = 4; addressValue = new Uint8Array(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join("."); break;
        case 3: addressLength = new Uint8Array(dataBuffer.slice(addressValueIndex, addressValueIndex + 1))[0]; addressValueIndex += 1; addressValue = new TextDecoder().decode(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)); break;
        case 4: addressLength = 16; const dv = new DataView(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)); const ipv6 = []; for (let i = 0; i < 8; i++) ipv6.push(dv.getUint16(i * 2).toString(16)); addressValue = ipv6.join(":"); break;
        default: return { hasError: true, message: `Invalid Trojan ATYP: ${addressType}` };
    }
    const portIndex = addressValueIndex + addressLength;
    const portRemote = new DataView(dataBuffer.slice(portIndex, portIndex + 2)).getUint16(0);
    return { hasError: false, addressRemote: addressValue, addressType, portRemote, rawDataIndex: portIndex + 4, rawClientData: dataBuffer.slice(portIndex + 4), version: null, isUDP };
}

// --- CRYPTO HELPERS ---

async function md5(...inputs: Uint8Array[]): Promise<Uint8Array> {
    const totalLen = inputs.reduce((acc, i) => acc + i.length, 0);
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const i of inputs) { combined.set(i, offset); offset += i.length; }
    return new Uint8Array(await crypto.subtle.digest("MD5", combined));
}

async function sha256(input: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

async function kdf(key: Uint8Array, path: (string | Uint8Array)[]): Promise<Uint8Array> {
    const hmacSha256 = async (key: Uint8Array, data: Uint8Array) => {
        const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
    };
    const recursiveHash = async (keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> => {
        const ipad = new Uint8Array(64).fill(0x36);
        const opad = new Uint8Array(64).fill(0x5c);
        for (let i = 0; i < Math.min(64, keyBytes.length); i++) { ipad[i] ^= keyBytes[i]; opad[i] ^= keyBytes[i]; }
        const inner = new Uint8Array(ipad.length + data.length); inner.set(ipad); inner.set(data, ipad.length);
        const innerRes = await sha256(inner);
        const outer = new Uint8Array(opad.length + innerRes.length); outer.set(opad); outer.set(innerRes, opad.length);
        return await sha256(outer);
    };
    let currentKey = new TextEncoder().encode("VMess AEAD KDF");
    for (const salt of path) {
        const saltBytes = typeof salt === "string" ? new TextEncoder().encode(salt) : salt;
        currentKey = await recursiveHash(saltBytes, currentKey);
    }
    return await recursiveHash(key, currentKey);
}

async function aesGcmDecrypt(key: Uint8Array, nonce: Uint8Array, data: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
    const k = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["decrypt"]);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, k, data));
}

async function aesGcmEncrypt(key: Uint8Array, nonce: Uint8Array, data: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
    const k = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt"]);
    return new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, k, data));
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
    return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// --- WEBSOCKET & SOCKET HANDLERS ---

async function websocketHandler(request: Request) {
    const webSocketPair = new WebSocketPair();
    const [client, webSocket] = Object.values(webSocketPair);

    webSocket.accept();

    let addressLog = "";
    let portLog = "";
    const log = (info: string, event?: any) => {
        console.log(`[${addressLog}:${portLog}] ${info}`, event || "");
    };

    const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
    const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

    let remoteSocketWrapper = { value: null as any };
    let isDNS = false;

    readableWebSocketStream.pipeTo(new WritableStream({
        async write(chunk, controller) {
            if (isDNS) {
                // Simplified DNS for now
                return;
            }
            if (remoteSocketWrapper.value) {
                const writer = remoteSocketWrapper.value.writable.getWriter();
                await writer.write(chunk);
                writer.releaseLock();
                return;
            }

            const protocol = await protocolSniffer(chunk);
            let header: any;
            if (protocol === "trojan") header = readHorseHeader(chunk);
            else if (protocol === "vmess") header = await readStreamHeader(chunk);
            else if (protocol === "vless") header = readNekoHeader(chunk);
            else if (protocol === "ss") header = readSsHeader(chunk);
            else throw new Error("Unknown Protocol");

            addressLog = header.addressRemote;
            portLog = `${header.portRemote} -> ${header.isUDP ? "UDP" : "TCP"}`;

            if (header.hasError) throw new Error(header.message);

            let responseHeader = header.version;
            // VMess AEAD response header logic would go here if needed

            if (header.isUDP) {
                // UDP logic would go here
                return;
            }

            await handleTCPOutBound(remoteSocketWrapper, header.addressRemote, header.portRemote, header.rawClientData, webSocket, responseHeader, log);
        },
        close() { log("Stream closed"); },
        abort(reason) { log("Stream aborted", reason); }
    })).catch((err) => log("Pipe error", err));

    return new Response(null, { status: 101, webSocket: client });
}

async function handleTCPOutBound(remoteSocket: any, address: string, port: number, rawData: ArrayBuffer, webSocket: WebSocket, responseHeader: Uint8Array | null, log: Function) {
    async function connectAndWrite(addr: string, p: number) {
        const socket = connect({ hostname: addr, port: p });
        remoteSocket.value = socket;
        log(`Connected to ${addr}:${p}`);
        const writer = socket.writable.getWriter();
        await writer.write(rawData);
        writer.releaseLock();
        return socket;
    }

    const tcpSocket = await connectAndWrite(address, port);
    remoteSocketToWS(tcpSocket, webSocket, responseHeader, log);
}

function makeReadableWebSocketStream(webSocket: WebSocket, earlyDataHeader: string, log: Function) {
    let cancelled = false;
    return new ReadableStream({
        start(controller) {
            webSocket.addEventListener("message", (e) => {
                if (!cancelled) controller.enqueue(e.data);
            });
            webSocket.addEventListener("close", () => {
                safeCloseWebSocket(webSocket);
                if (!cancelled) controller.close();
            });
            webSocket.addEventListener("error", (err) => controller.error(err));

            const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
            if (error) controller.error(error);
            else if (earlyData) controller.enqueue(earlyData);
        },
        cancel() { cancelled = true; safeCloseWebSocket(webSocket); }
    });
}

async function remoteSocketToWS(remoteSocket: any, webSocket: WebSocket, responseHeader: Uint8Array | null, log: Function) {
    let header = responseHeader;
    await remoteSocket.readable.pipeTo(new WritableStream({
        async write(chunk, controller) {
            if (webSocket.readyState !== WS_READY_STATE_OPEN) controller.error("WS Closed");
            if (header) {
                webSocket.send(await new Blob([header, chunk]).arrayBuffer());
                header = null;
            } else {
                webSocket.send(chunk);
            }
        },
    })).catch((err) => {
        log("Remote to WS error", err);
        safeCloseWebSocket(webSocket);
    });
}

function safeCloseWebSocket(socket: WebSocket) {
    try {
        if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) socket.close();
    } catch (e) {}
}

function base64ToArrayBuffer(base64: string) {
    if (!base64) return { error: null };
    try {
        const binary = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
        return { earlyData: Uint8Array.from(binary, c => c.charCodeAt(0)).buffer, error: null };
    } catch (e) { return { error: e }; }
}

export default {
    fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
        console.log(`[Fetch] Path: ${new URL(request.url).pathname}, Upgrade: ${request.headers.get("Upgrade")}`);
        if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
            console.log("[Fetch] WebSocket Upgrade detected");
            return websocketHandler(request);
        }
        return app.fetch(request, env, ctx);
    }
}
