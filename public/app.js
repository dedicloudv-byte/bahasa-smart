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
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const settingsBtn = document.getElementById('settings-btn');
const cancelSetupBtn = document.getElementById('cancel-setup-btn');
const proxySettingsSection = document.getElementById('proxy-settings');
const proxyUrlInput = document.getElementById('proxy-url-input');
const clientIntegrationSection = document.getElementById('client-integration');
const clientEndpointUrl = document.getElementById('client-endpoint-url');
const clientApiKeyInput = document.getElementById('client-api-key');
const rotateClientKeyBtn = document.getElementById('rotate-client-key-btn');
const chatBox = document.getElementById('chat-box');
const debugLogs = document.getElementById('debug-logs');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const voiceBtn = document.getElementById('voice-btn');
const ttsToggleBtn = document.getElementById('tts-toggle-btn');
const ttsIcon = document.getElementById('tts-icon');

// State
let apiKey = null;
let ttsEnabled = true;
let chatHistory = [];
const SYSTEM_INSTRUCTION = "Anda adalah BAHASA SMART, asisten edukasi belajar bahasa yang interaktif dan premium. " +
    "Tugas Anda adalah membantu pengguna belajar bahasa apa pun melalui percakapan teks. " +
    "ATURAN FORMATING: " +
    "1. Gunakan Markdown yang rapi. " +
    "2. Setiap istilah penting, kosakata baru, atau koreksi HARUS ditulis TEBAL (Contoh: **Bonjour**). " +
    "3. Gunakan Emoji/Logo di setiap judul atau bagian penting (Contoh: 📘 Kosakata Baru, ✅ Koreksi). " +
    "4. Gunakan list atau bullet points untuk penjelasan agar terlihat rapi dan mewah. " +
    "5. Selalu gunakan gaya bahasa yang ramah dan profesional.";

// Initialize
async function init() {
    try {
        const res = await fetch(API_STATUS_URL);
        const data = await res.json();
        if (data.configured) {
            showMainInterface();
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

        // Load Proxy
        const proxyRes = await fetch('/api/proxy-config');
        const proxyData = await proxyRes.json();
        proxyUrlInput.value = proxyData.proxyUrl || '';
    } catch (e) {
        logDebug('[Error] Gagal memuat pengaturan');
    }
}

function showSetup(isUpdate = false) {
    loadingSpinner.classList.add('hidden');
    setupContainer.classList.remove('hidden');
    mainInterface.classList.add('hidden');

    if (isUpdate) {
        cancelSetupBtn.classList.remove('hidden');
        clientIntegrationSection.classList.remove('hidden');
        proxySettingsSection.classList.remove('hidden');
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

function logDebug(msg) {
    const time = new Date().toLocaleTimeString();
    debugLogs.innerText += `\n[${time}] ${msg}`;
    debugLogs.scrollTop = debugLogs.scrollHeight;
}

// Save Settings
saveKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    const proxyUrl = proxyUrlInput.value.trim();

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
            body: JSON.stringify({ proxyUrl })
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

window.setProxyPreset = (url) => {
    proxyUrlInput.value = url;
    logDebug(`[System] Proxy preset set to ${url}`);
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
