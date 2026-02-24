// Constants
const API_STATUS_URL = '/api/config-status';
const API_SAVE_URL = '/api/config';
const CHAT_API_URL = '/api/chat';

// UI Elements
const setupContainer = document.getElementById('setup-container');
const mainInterface = document.getElementById('main-interface');
const loadingSpinner = document.getElementById('loading-spinner');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const currentIpDisplay = document.getElementById('current-ip');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const testProxyBtn = document.getElementById('test-proxy-btn');
const settingsBtn = document.getElementById('settings-btn');
const cancelSetupBtn = document.getElementById('cancel-setup-btn');
const proxySettingsSection = document.getElementById('proxy-settings');
const nodeList = document.getElementById('node-list');
const nodeEditor = document.getElementById('node-editor');
const addNodeBtn = document.getElementById('add-node-btn');
const vlessImportInput = document.getElementById('vless-import-input');
const saveNodeBtn = document.getElementById('save-node-btn');
const cancelNodeBtn = document.getElementById('cancel-node-btn');
const clientIntegrationSection = document.getElementById('client-integration');
const clientEndpointUrl = document.getElementById('client-endpoint-url');
const clientApiKeyInput = document.getElementById('client-api-key');
const rotateClientKeyBtn = document.getElementById('rotate-client-key-btn');
const vpnConfigSection = document.getElementById('vpn-config-section');
const vlessConfigUrl = document.getElementById('vless-config-url');
const vpnOverlay = document.getElementById('vpn-overlay');
const connectVpnBtn = document.getElementById('connect-vpn-btn');
const inputArea = document.getElementById('input-area');
const selectedNodeDisplay = document.getElementById('selected-node-display');
const chatBox = document.getElementById('chat-box');
const debugLogs = document.getElementById('debug-logs');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const voiceBtn = document.getElementById('voice-btn');
const ttsToggleBtn = document.getElementById('tts-toggle-btn');
const ttsIcon = document.getElementById('tts-icon');

// State
let ttsEnabled = true;
let currentEgressIp = 'Unknown';
let chatHistory = [];
let relayNodes = [];
let activeNodeId = 'default';
const SYSTEM_INSTRUCTION = "Anda adalah BAHASA SMART, asisten edukasi belajar bahasa yang interaktif dan premium. " +
    "Tugas Anda adalah membantu pengguna belajar bahasa apa pun melalui percakapan teks. " +
    "ATURAN FORMATING: " +
    "1. Gunakan Markdown yang rapi. " +
    "2. Setiap istilah penting, kosakata baru, atau koreksi HARUS ditulis TEBAL (Contoh: **Bonjour**). " +
    "3. Gunakan Emoji/Logo di setiap judul atau bagian penting (Contoh: 📘 Kosakata Baru, ✅ Koreksi). " +
    "4. Gunakan list atau bullet points untuk penjelasan agar terlihat rapi dan mewah. " +
    "5. Selalu gunakan gaya bahasa yang ramah dan profesional.";

// Initialize
async function checkIP() {
    try {
        const res = await fetch('/api/check-ip');
        const data = await res.json();
        const oldIp = currentEgressIp;
        currentEgressIp = data.ip;
        if (currentIpDisplay) currentIpDisplay.innerText = currentEgressIp;

        if (oldIp !== 'Unknown' && oldIp !== currentEgressIp) {
            logDebug(`[System] IP Change Detected: ${oldIp} -> ${currentEgressIp}`);
            showToast(`IP Berubah: ${currentEgressIp}`, 'info');
        } else {
            logDebug(`[System] Current Egress IP: ${currentEgressIp}`);
        }
    } catch (e) {
        logDebug('[Error] Gagal mengecek IP');
    }
}

async function init() {
    await checkIP();
    try {
        const res = await fetch(API_STATUS_URL);
        const data = await res.json();
        if (data.configured) {
            showMainInterface();
            await loadSettings();
            // Update selected node display
            const node = relayNodes.find(n => n.id === activeNodeId);
            if (node && selectedNodeDisplay) selectedNodeDisplay.innerText = node.name;
        } else {
            showSetup();
        }
    } catch (e) {
        console.error('Failed to load config', e);
        showSetup();
    }
}

async function loadSettings() {
    try {
        const res = await fetch('/api/client-config');
        const data = await res.json();
        clientEndpointUrl.value = data.endpoint;
        clientApiKeyInput.value = data.clientKey || 'Belum di-generate';

        // Generate VPN Config
        const hostname = window.location.hostname || 'your-worker.workers.dev';
        const uuid = '00000000-0000-0000-0000-000000000000';
        vlessConfigUrl.value = `vless://${uuid}@${hostname}:443?encryption=none&security=tls&type=ws&host=${hostname}&path=%2F#BAHASA-SMART-VPN`;

        // Initial Nodes
        const defaultNode = { id: 'default', name: '⚡ Direct (Standard IP)', url: 'https://generativelanguage.googleapis.com' };

        // Load Proxy Config from R2
        const proxyRes = await fetch('/api/proxy-config');
        const proxyData = await proxyRes.json();

        if (proxyData.nodes && proxyData.nodes.length > 0) {
            relayNodes = proxyData.nodes;
            // Ensure default node is always present
            if (!relayNodes.find(n => n.id === 'default')) {
                relayNodes.unshift(defaultNode);
            }
        } else {
            relayNodes = [defaultNode];
        }

        if (proxyData.activeNodeId) {
            activeNodeId = proxyData.activeNodeId;
        }
        renderNodeList();
    } catch (e) {
        logDebug('[Error] Gagal memuat pengaturan');
    }
}

async function saveProxyConfig() {
    const activeNode = relayNodes.find(n => n.id === activeNodeId);
    try {
        await fetch('/api/proxy-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                activeNodeId: activeNodeId,
                activeNodeUrl: activeNode ? (activeNode.url || `http://${activeNode.address}:${activeNode.port}`) : 'https://generativelanguage.googleapis.com',
                nodes: relayNodes
            })
        });
        logDebug('[System] Proxy configuration saved to R2');
    } catch (e) {
        logDebug('[Error] Gagal menyimpan konfigurasi proxy');
        showToast('Gagal menyimpan perubahan ke cloud', 'error');
    }
}

function parseVlessUri(uri) {
    try {
        const url = new URL(uri);
        const uuid = url.username;
        const address = url.hostname;
        const port = parseInt(url.port);
        const params = Object.fromEntries(url.searchParams.entries());
        const name = decodeURIComponent(url.hash.replace('#', ''));

        return {
            uuid,
            address,
            port,
            path: params.path || '/',
            host: params.host || address,
            security: params.security || 'none',
            type: params.type || 'ws', // Default to ws for workers
            name: name || address
        };
    } catch (e) {
        return null;
    }
}

function renderNodeList() {
    nodeList.innerHTML = '';
    relayNodes.forEach(node => {
        const isActive = node.id === activeNodeId;
        const div = document.createElement('div');
        div.className = `flex justify-between items-center p-3 rounded-xl border transition-all cursor-pointer ${isActive ? 'bg-premium-600/10 border-premium-600/30' : 'bg-black/20 border-white/5 hover:border-white/10'}`;
        div.onclick = () => selectNode(node.id);

        const subText = node.address ? `${node.address}:${node.port}` : node.url;

        div.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-2 h-2 rounded-full ${isActive ? 'bg-premium-600 animate-pulse' : 'bg-gray-700'}"></div>
                <div>
                    <p class="text-[11px] font-bold ${isActive ? 'text-white' : 'text-gray-400'}">${node.name}</p>
                    <p class="text-[9px] text-gray-600 font-mono truncate max-w-[150px]">${subText}</p>
                </div>
            </div>
            ${node.id !== 'default' ? `<button onclick="deleteNode(event, '${node.id}')" class="text-gray-600 hover:text-red-500 p-1"><i class="fas fa-times-circle text-[10px]"></i></button>` : ''}
        `;
        nodeList.appendChild(div);
    });
}

function selectNode(id) {
    activeNodeId = id;
    renderNodeList();
    saveProxyConfig(); // Persist selection
    const node = relayNodes.find(n => n.id === id);
    if (node && selectedNodeDisplay) {
        selectedNodeDisplay.innerText = node.name;
    }
    logDebug(`[System] Switched to relay node: ${id}`);

    // If we switch node, we might want to re-connect
    if (!vpnOverlay.classList.contains('hidden')) {
        // Overlay is visible, keep it that way
    } else {
        // Already connected, maybe show a warning that node changed
        showToast('Node dirubah. Klik Test Jalur di Pengaturan jika AI tidak merespon.', 'info');
    }
}

window.deleteNode = (e, id) => {
    e.stopPropagation();
    if (activeNodeId === id) activeNodeId = 'default';
    relayNodes = relayNodes.filter(n => n.id !== id);
    renderNodeList();
    saveProxyConfig(); // Auto-save to R2
};

function showSetup(isUpdate = false) {
    loadingSpinner.classList.add('hidden');
    setupContainer.classList.remove('hidden');
    mainInterface.classList.add('hidden');

    if (isUpdate) {
        cancelSetupBtn.classList.remove('hidden');
        clientIntegrationSection.classList.remove('hidden');
        proxySettingsSection.classList.remove('hidden');
        vpnConfigSection.classList.remove('hidden');
        document.querySelector('#setup-container h2').innerText = 'Perbarui Pengaturan';
        saveKeyBtn.innerText = 'Simpan Perubahan';
        loadSettings();
    } else {
        cancelSetupBtn.classList.add('hidden');
        clientIntegrationSection.classList.add('hidden');
        proxySettingsSection.classList.add('hidden');
        document.querySelector('#setup-container h2').innerText = 'Konfigurasi AI';
        saveKeyBtn.innerText = 'Aktifkan Sekarang';
    }
}

function showMainInterface() {
    loadingSpinner.classList.add('hidden');
    setupContainer.classList.add('hidden');
    mainInterface.classList.remove('hidden');
    updateStatus('AI Aktif', 'bg-green-500');
}

function updateStatus(text, colorClass) {
    statusText.innerText = text;
    statusDot.className = `w-2 h-2 rounded-full ${colorClass}`;
    logDebug(`[Status] ${text}`);
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const colorClass = type === 'success' ? 'border-green-500/30 bg-green-500/10 text-green-400' :
                      type === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-400' :
                      'border-premium-600/30 bg-premium-600/10 text-premium-400';

    toast.className = `px-6 py-4 rounded-2xl border backdrop-blur-md shadow-2xl flex items-center gap-3 animate-slide-up pointer-events-auto ${colorClass}`;
    toast.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
        <span class="text-xs font-bold tracking-wide uppercase">${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.5s ease';
        setTimeout(() => toast.remove(), 500);
    }, 4000);
}

function logDebug(msg) {
    const time = new Date().toLocaleTimeString();
    debugLogs.innerText += `\n[${time}] ${msg}`;
    debugLogs.scrollTop = debugLogs.scrollHeight;
}

// Node Editor
addNodeBtn.addEventListener('click', () => {
    nodeEditor.classList.toggle('hidden');
});

cancelNodeBtn.addEventListener('click', () => {
    nodeEditor.classList.add('hidden');
});

saveNodeBtn.addEventListener('click', () => {
    const uri = vlessImportInput.value.trim();

    if (!uri) {
        showToast('Tolong tempel link VLESS', 'error');
        return;
    }

    const parsed = parseVlessUri(uri);
    if (!parsed) {
        showToast('Format VLESS tidak valid', 'error');
        return;
    }

    const newNode = {
        id: 'vless-' + Date.now(),
        ...parsed,
        vlessUri: uri // Keep original for backend
    };

    relayNodes.push(newNode);
    vlessImportInput.value = '';
    nodeEditor.classList.add('hidden');
    renderNodeList();
    saveProxyConfig(); // Auto-save to R2
    showToast('Akun VLESS berhasil di-import', 'success');
});

// Save Settings
saveKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    const activeNode = relayNodes.find(n => n.id === activeNodeId);

    // Only require key on initial setup
    const isUpdate = !cancelSetupBtn.classList.contains('hidden');
    if (!key && !isUpdate) {
        alert('API Key diperlukan untuk aktivasi pertama kali.');
        return;
    }

    saveKeyBtn.disabled = true;
    try {
        // Save Key if provided
        if (key) {
            await fetch(API_SAVE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key })
            });
        }

        // Save Proxy
        await fetch('/api/proxy-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                activeNodeId: activeNodeId,
                activeNodeUrl: activeNode ? activeNode.url : 'https://generativelanguage.googleapis.com',
                nodes: relayNodes
            })
        });

        apiKeyInput.value = '';
        showMainInterface();
        logDebug('[System] Settings updated successfully');
    } catch (e) {
        alert('Gagal menyimpan pengaturan');
    } finally {
        saveKeyBtn.disabled = false;
    }
});

settingsBtn.addEventListener('click', () => {
    showSetup(true);
});

testProxyBtn.addEventListener('click', async () => {
    const activeNode = relayNodes.find(n => n.id === activeNodeId);
    const proxyUrl = activeNode ? activeNode.url : '';

    if (!proxyUrl) {
        showToast('Node tidak ditemukan', 'error');
        return;
    }

    testProxyBtn.disabled = true;
    testProxyBtn.innerHTML = '<i class="fas fa-circle-notch animate-spin text-[8px]"></i> MENGHUBUNGKAN...';

    try {
        const res = await fetch('/api/proxy-test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proxyUrl })
        });
        const data = await res.json();

        if (data.success) {
            const loc = data.location;
            const coloMap = { 'SIN': 'Singapore', 'HKG': 'Hong Kong', 'NRT': 'Tokyo', 'SJC': 'San Jose', 'LAX': 'Los Angeles', 'CGK': 'Jakarta' };
            const city = coloMap[loc.colo] || loc.colo;
            const locMsg = loc.colo !== 'N/A' ? ` [${city}, ${loc.country}]` : '';
            showToast(`Koneksi Berhasil! Latency: ${data.latency}${locMsg}`, 'success');
            logDebug(`[Proxy] Connected via ${proxyUrl}. Latency: ${data.latency}. DC: ${loc.colo}. IP: ${loc.ip}`);
        } else {
            let errMsg = data.error;
            if (errMsg.includes('consider using fetch instead')) {
                errMsg = 'Cloudflare melarang port 80/443 untuk tunnel socket.';
            }
            showToast(`Gagal: ${errMsg}`, 'error');
        }
    } catch (e) {
        showToast('Kesalahan Jaringan / Timeout', 'error');
    } finally {
        testProxyBtn.disabled = false;
        testProxyBtn.innerHTML = '<i class="fas fa-satellite-dish animate-pulse"></i> TEST JALUR KONEKSI';
    }
});

cancelSetupBtn.addEventListener('click', () => {
    showMainInterface();
});

rotateClientKeyBtn.addEventListener('click', async () => {
    if (!confirm('Apakah Anda yakin ingin mengganti Client Key? Client lama Anda akan segera kehilangan akses.')) return;
    try {
        const res = await fetch('/api/client-config/rotate', { method: 'POST' });
        const data = await res.json();
        clientApiKeyInput.value = data.clientKey;
        logDebug('[System] Client API Key rotated');
    } catch (e) {
        alert('Gagal memproses rotasi key');
    }
});

// Helper for Copy & Presets
window.copyToClipboard = (id) => {
    const el = document.getElementById(id);
    el.select();
    document.execCommand('copy');
    logDebug(`[System] Copied ${id} to clipboard`);
};

// TTS and Voice Logic
function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[*#_`]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'id-ID';
    window.speechSynthesis.speak(utterance);
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'id-ID';

    recognition.onstart = () => {
        voiceBtn.classList.add('text-red-500', 'animate-pulse');
        logDebug('[System] Listening...');
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        textInput.value = transcript;
        logDebug(`[Voice] Result: ${transcript}`);
        sendTextMessage();
    };

    recognition.onerror = (e) => {
        voiceBtn.classList.remove('text-red-500', 'animate-pulse');
        logDebug(`[Error] Voice recognition failed: ${e.error}`);
    };

    recognition.onend = () => {
        voiceBtn.classList.remove('text-red-500', 'animate-pulse');
    };

    voiceBtn.addEventListener('click', () => {
        try { recognition.start(); } catch (e) { logDebug(`[System] Mic already active`); }
    });
} else {
    voiceBtn.style.display = 'none';
}

ttsToggleBtn.addEventListener('click', () => {
    ttsEnabled = !ttsEnabled;
    ttsIcon.className = ttsEnabled ? 'fas fa-volume-up' : 'fas fa-volume-mute';
    ttsToggleBtn.className = `w-9 h-9 flex items-center justify-center rounded-xl border transition-all ${ttsEnabled ? 'border-white/10 bg-white/5 text-gray-400' : 'border-red-500/20 bg-red-500/10 text-red-500'}`;
    logDebug(`[System] Auto-read ${ttsEnabled ? 'enabled' : 'disabled'}`);
    if (!ttsEnabled) window.speechSynthesis.cancel();
});

// Chat Logic
function appendMessage(sender, text) {
    let div = document.createElement('div');
    if (sender === 'AI') {
        div.className = 'msg-ai animate-fade-in prose prose-invert max-w-none relative group';
        div.innerHTML = marked.parse(text);

        // Speaker Icon for replay
        const speaker = document.createElement('button');
        speaker.className = 'absolute -right-8 top-0 opacity-0 group-hover:opacity-100 transition-opacity p-2 text-gray-500 hover:text-premium-600';
        speaker.innerHTML = '<i class="fas fa-volume-up text-xs"></i>';
        speaker.onclick = () => speak(text);
        div.appendChild(speaker);

        if (ttsEnabled) speak(text);
    } else if (sender === 'System') {
        div.className = 'text-center text-[10px] text-gray-500 my-2 animate-fade-in italic';
        div.innerText = text;
    } else {
        div.className = 'msg-user animate-fade-in';
        div.innerText = text;
    }
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    return div;
}

function showTypingIndicator() {
    const div = document.createElement('div');
    div.id = 'typing-indicator';
    div.className = 'typing-indicator animate-fade-in ml-2 mb-4';
    div.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function removeTypingIndicator() {
    const div = document.getElementById('typing-indicator');
    if (div) div.remove();
}

async function sendTextMessage() {
    const text = textInput.value.trim();
    if (!text) return;

    if (!vpnOverlay.classList.contains('hidden')) {
        showToast('Hubungkan VPN terlebih dahulu!', 'error');
        return;
    }

    appendMessage('User', text);
    textInput.value = '';
    textInput.disabled = true;
    sendBtn.disabled = true;

    showTypingIndicator();

    chatHistory.push({ role: "user", parts: [{ text: text }] });

    try {
        const response = await fetch(CHAT_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: chatHistory,
                systemInstruction: {
                    parts: [{ text: SYSTEM_INSTRUCTION }]
                }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Gagal menghubungi AI');
        }

        removeTypingIndicator();
        const fullText = data.text;

        // Finalize message
        appendMessage('AI', fullText);
        chatHistory.push({ role: "model", parts: [{ text: fullText }] });
        logDebug(`[AI Response] Received ${fullText.length} chars`);

    } catch (e) {
        logDebug(`[Error] ${e.message}`);
        appendMessage('System', `Error: ${e.message}`);
        removeTypingIndicator();
    } finally {
        textInput.disabled = false;
        sendBtn.disabled = false;
        textInput.focus();
    }
}

// VPN Connection Logic
async function connectVPN() {
    const activeNode = relayNodes.find(n => n.id === activeNodeId);

    if (!activeNode) {
        showToast('Node tidak ditemukan', 'error');
        return;
    }

    const isVless = activeNode.id.startsWith('vless-');
    const proxyUrl = isVless ? activeNode.address : activeNode.url;

    connectVpnBtn.disabled = true;
    connectVpnBtn.innerHTML = '<i class="fas fa-circle-notch animate-spin"></i> MENGHUBUNGKAN...';
    logDebug(`[VPN] Attempting connection to ${activeNode.name}...`);

    try {
        const res = await fetch('/api/proxy-test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                proxyUrl: isVless ? `http://${activeNode.address}:${activeNode.port}` : proxyUrl,
                isVless: isVless
            })
        });
        const data = await res.json();

        if (data.success) {
            const loc = data.location;
            const coloMap = { 'SIN': 'Singapore', 'HKG': 'Hong Kong', 'NRT': 'Tokyo', 'SJC': 'San Jose', 'LAX': 'Los Angeles', 'CGK': 'Jakarta' };
            const city = coloMap[loc.colo] || loc.colo;
            const locMsg = loc.colo !== 'N/A' ? ` [${city}, ${loc.country}]` : '';

            showToast(`VPN Terhubung! ${locMsg}`, 'success');
            logDebug(`[VPN] Connected. Egress IP: ${loc.ip}`);

            // Unlock UI
            vpnOverlay.classList.add('hidden');
            inputArea.classList.remove('opacity-50', 'pointer-events-none');
            updateStatus('VPN Terhubung', 'bg-green-500');

            // Log the IP change explicitly
            const oldIp = currentEgressIp;
            currentEgressIp = loc.ip;
            if (currentIpDisplay) currentIpDisplay.innerText = currentEgressIp;
            logDebug(`[VPN] IP Changed: ${oldIp} -> ${currentEgressIp}`);

            appendMessage('System', `Terhubung ke jalur VPN ${activeNode.name}${locMsg}. IP Anda sekarang: ${currentEgressIp}`);
        } else {
            let errMsg = data.error;
            if (errMsg.includes('consider using fetch instead')) {
                errMsg = 'Cloudflare melarang port 80/443 untuk tunnel socket. Silahkan gunakan port lain atau ganti node.';
            }
            showToast(`Gagal: ${errMsg}`, 'error');
            logDebug(`[VPN] Connection failed: ${data.error}`);
        }
    } catch (e) {
        showToast('Kesalahan Jaringan / Timeout', 'error');
        logDebug(`[VPN] Network error during connection`);
    } finally {
        connectVpnBtn.disabled = false;
        connectVpnBtn.innerHTML = '<i class="fas fa-plug"></i> HUBUNGKAN VLESS VPN';
    }
}

connectVpnBtn.addEventListener('click', connectVPN);

// Event Listeners
sendBtn.addEventListener('click', sendTextMessage);
textInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendTextMessage();
});

clearChatBtn.addEventListener('click', () => {
    chatBox.innerHTML = `
        <div class="msg-ai animate-fade-in">
            Obrolan dibersihkan. Apa yang ingin Anda pelajari sekarang?
        </div>
    `;
    chatHistory = [];
    logDebug('[System] Chat history cleared');
});

// Start
init();
