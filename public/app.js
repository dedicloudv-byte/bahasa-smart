// Constants
const API_CONFIG_URL = '/api/config';
const GEMINI_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
// Using the model from user snippet
const MODEL_NAME = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

// UI Elements
const setupContainer = document.getElementById('setup-container');
const mainInterface = document.getElementById('main-interface');
const loadingSpinner = document.getElementById('loading-spinner');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const micBtn = document.getElementById('mic-btn');
const micStatus = document.getElementById('mic-status');
const chatBox = document.getElementById('chat-box');
const visualizerBars = document.querySelectorAll('.v-bar');

// State - following the logic pattern from the user snippet
let apiKey = null;
let socket = null;
const responseQueue = [];
const audioQueue = [];
let audioContext = null;
let playbackContext = null;
let stream = null;
let processor = null;
let isRecording = false;
let isPlaying = false;
let currentSource = null;

// Initialize loops and checks
async function init() {
    try {
        const res = await fetch(API_CONFIG_URL);
        const data = await res.json();
        if (data.key) {
            apiKey = data.key;
            showMainInterface();
        } else {
            showSetup();
        }
    } catch (e) {
        console.error('Failed to load config', e);
        showSetup();
    }
}

function showSetup() {
    loadingSpinner.classList.add('hidden');
    setupContainer.classList.remove('hidden');
    mainInterface.classList.add('hidden');
}

function showMainInterface() {
    loadingSpinner.classList.add('hidden');
    setupContainer.classList.add('hidden');
    mainInterface.classList.remove('hidden');
    updateStatus('Ready', 'bg-green-500');
}

function updateStatus(text, colorClass) {
    statusText.innerText = text;
    statusDot.className = `w-2 h-2 rounded-full ${colorClass}`;
}

// Save Key
saveKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) return;

    saveKeyBtn.disabled = true;
    try {
        await fetch(API_CONFIG_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        apiKey = key;
        showMainInterface();
    } catch (e) {
        alert('Gagal menyimpan key');
    } finally {
        saveKeyBtn.disabled = false;
    }
});

// Loops inspired by user snippet
async function messageLoop() {
    while (true) {
        if (responseQueue.length > 0) {
            const message = responseQueue.shift();

            if (message.serverContent) {
                if (message.serverContent.interrupted) {
                    // Empty audio queue and stop playback on interruption
                    audioQueue.length = 0;
                    stopPlayback();
                }

                if (message.serverContent.modelTurn && message.serverContent.modelTurn.parts) {
                    for (const part of message.serverContent.modelTurn.parts) {
                        if (part.inlineData && part.inlineData.data) {
                            audioQueue.push(part.inlineData.data); // base64
                        }
                        if (part.text) {
                            appendMessage('AI', part.text);
                        }
                    }
                }
            }
        }
        await new Promise(r => setTimeout(r, 10)); // Yield
    }
}

async function playbackLoop() {
    while (true) {
        if (audioQueue.length > 0 && !isPlaying) {
            await playNextChunk();
        }
        await new Promise(r => setTimeout(r, 10)); // Yield
    }
}

function stopPlayback() {
    if (currentSource) {
        currentSource.stop();
        currentSource = null;
    }
    isPlaying = false;
}

async function playNextChunk() {
    if (audioQueue.length === 0) return;

    isPlaying = true;
    const base64Data = audioQueue.shift();
    const binaryData = atob(base64Data);
    const bytes = new Uint8Array(binaryData.length);
    for (let i = 0; i < binaryData.length; i++) {
        bytes[i] = binaryData.charCodeAt(i);
    }

    if (!playbackContext) {
        playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    }

    const audioBuffer = playbackContext.createBuffer(1, bytes.length / 2, 24000);
    const channelData = audioBuffer.getChannelData(0);
    const dataView = new DataView(bytes.buffer);

    for (let i = 0; i < bytes.length / 2; i++) {
        channelData[i] = dataView.getInt16(i * 2, true) / 32768;
    }

    const source = playbackContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(playbackContext.destination);
    currentSource = source;

    return new Promise((resolve) => {
        source.onended = () => {
            if (currentSource === source) currentSource = null;
            isPlaying = false;
            resolve();
        };
        source.start();
    });
}

// Session Start
async function startSession() {
    if (!apiKey) return;

    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    if (audioContext.state === 'suspended') await audioContext.resume();

    updateStatus('Menghubungkan...', 'bg-yellow-500');
    socket = new WebSocket(`${GEMINI_WS_URL}?key=${apiKey}`);

    socket.onopen = () => {
        updateStatus('Tersambung', 'bg-green-500');
        const setup = {
            setup: {
                model: MODEL_NAME,
                generationConfig: {
                    responseModalities: ["audio"]
                },
                systemInstruction: {
                    parts: [{ text: "Anda adalah 'BAHASA SMART', asisten AI elit yang membantu belajar bahasa. Merespon dengan cerdas, ramah, dan berikan bimbingan edukatif." }]
                }
            }
        };
        socket.send(JSON.stringify(setup));
    };

    socket.onmessage = (event) => {
        const response = JSON.parse(event.data);
        responseQueue.push(response);

        if (response.setupComplete) {
            startRecording();
        }
    };

    socket.onerror = (e) => {
        updateStatus('Error', 'bg-red-500');
        console.error('WS Error', e);
    };

    socket.onclose = () => {
        updateStatus('Terputus', 'bg-gray-500');
        stopRecording();
    };
}

// Microphone handling (Browser equivalent of 'mic' library)
async function startRecording() {
    if (isRecording) return;

    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioContext.createMediaStreamSource(stream);
        processor = audioContext.createScriptProcessor(4096, 1, 1);

        source.connect(processor);
        processor.connect(audioContext.destination);

        processor.onaudioprocess = (e) => {
            if (!isRecording || !socket || socket.readyState !== WebSocket.OPEN) return;

            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = floatTo16BitPCM(inputData);
            const base64Data = arrayBufferToBase64(pcmData);

            socket.send(JSON.stringify({
                realtimeInput: {
                    mediaChunks: [{
                        mimeType: "audio/pcm;rate=16000",
                        data: base64Data
                    }]
                }
            }));
            updateVisualizer(inputData);
        };

        isRecording = true;
        document.body.classList.add('recording');
        micStatus.innerText = 'Neural Voice Aktif';
    } catch (err) {
        console.error('Mic Error:', err);
        alert('Mohon izinkan akses mikrofon');
    }
}

function stopRecording() {
    isRecording = false;
    document.body.classList.remove('recording');
    micStatus.innerText = 'Siap untuk Mendengarkan';
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (processor) processor.disconnect();
}

// Helpers
function floatTo16BitPCM(input) {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < input.length; i++) {
        let s = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function appendMessage(sender, text) {
    const div = document.createElement('div');
    div.className = sender === 'AI' ? 'msg-ai animate-fade-in' : 'msg-user animate-fade-in';
    div.innerText = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function updateVisualizer(data) {
    for (let i = 0; i < visualizerBars.length; i++) {
        const val = Math.abs(data[Math.floor(i * data.length / visualizerBars.length)]) * 100;
        visualizerBars[i].style.height = `${Math.max(4, val * 3)}px`;
    }
}

// Event Listeners
micBtn.addEventListener('click', () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        startSession();
    } else {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }
});

// Start loops
messageLoop();
playbackLoop();
init();
