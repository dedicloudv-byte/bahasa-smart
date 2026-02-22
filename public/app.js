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
const chatBox = document.getElementById('chat-box');
const debugLogs = document.getElementById('debug-logs');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');

// State
let apiKey = null;
let chatHistory = [];
const SYSTEM_INSTRUCTION = "Anda adalah BAHASA SMART, asisten edukasi belajar bahasa yang interaktif dan premium. " +
    "Tugas Anda adalah membantu pengguna belajar bahasa apa pun (Inggris, Jepang, Arab, dll) melalui percakapan teks. " +
    "Selalu gunakan gaya bahasa yang ramah, profesional, dan sangat mendukung. " +
    "Secara proaktif berikan koreksi jika ada kesalahan tata bahasa atau pemilihan kata dalam pesan pengguna. " +
    "Berikan penjelasan singkat tentang koreksi tersebut. Gunakan Markdown jika perlu untuk memperjelas format.";

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

function showSetup(isUpdate = false) {
    loadingSpinner.classList.add('hidden');
    setupContainer.classList.remove('hidden');
    mainInterface.classList.add('hidden');

    if (isUpdate) {
        cancelSetupBtn.classList.remove('hidden');
        document.querySelector('#setup-container h2').innerText = 'Perbarui API Key';
        saveKeyBtn.innerText = 'Simpan Perubahan';
    } else {
        cancelSetupBtn.classList.add('hidden');
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

// Save Key
saveKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) return;

    saveKeyBtn.disabled = true;
    try {
        const response = await fetch(API_SAVE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        if (!response.ok) throw new Error('Failed to save');
        apiKeyInput.value = '';
        showMainInterface();
        logDebug('[System] API Key updated successfully');
    } catch (e) {
        alert('Gagal menyimpan key');
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

// Chat Logic
function appendMessage(sender, text) {
    let div = document.createElement('div');
    if (sender === 'AI') {
        div.className = 'msg-ai animate-fade-in';
    } else if (sender === 'System') {
        div.className = 'text-center text-[10px] text-gray-500 my-2 animate-fade-in italic';
    } else {
        div.className = 'msg-user animate-fade-in';
    }
    div.innerText = text;
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
