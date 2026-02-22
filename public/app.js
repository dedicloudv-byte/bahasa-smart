// Constants
const API_CONFIG_URL = '/api/config';
const GEMINI_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const MODEL_NAME = 'models/gemini-2.0-flash-exp';

// UI Elements
const setupContainer = document.getElementById('setup-container');
const mainInterface = document.getElementById('main-interface');
const loadingSpinner = document.getElementById('loading-spinner');
const statusBadge = document.getElementById('status-badge');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const micBtn = document.getElementById('mic-btn');
const micStatus = document.getElementById('mic-status');
const chatBox = document.getElementById('chat-box');
const visualizerContainer = document.getElementById('visualizer-container');

// State
let apiKey = null;
let socket = null;
let audioContext = null;
let playbackContext = null;
let stream = null;
let processor = null;
let isRecording = false;
let audioQueue = [];
let isPlaying = false;

// Initialize
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
    statusBadge.innerText = 'Ready';
    statusBadge.classList.replace('bg-gray-500', 'bg-green-500');
}

// Save Key
saveKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) return alert('Please enter API key');

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
        alert('Failed to save key');
    } finally {
        saveKeyBtn.disabled = false;
    }
});

// Audio & WebSocket Logic
async function startSession() {
    if (!apiKey) return;

    // Initialize AudioContexts on user gesture
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    if (!playbackContext) playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });

    if (audioContext.state === 'suspended') await audioContext.resume();
    if (playbackContext.state === 'suspended') await playbackContext.resume();

    statusBadge.innerText = 'Connecting...';
    socket = new WebSocket(`${GEMINI_WS_URL}?key=${apiKey}`);

    socket.onopen = () => {
        statusBadge.innerText = 'Connected';
        // Send Setup Message
        const setup = {
            setup: {
                model: MODEL_NAME,
                generationConfig: {
                    responseModalities: ["audio"]
                },
                systemInstruction: {
                    parts: [{ text: "Anda adalah 'BAHASA SMART', tutor bahasa ahli. Bantu pengguna belajar bahasa apa pun melalui percakapan real-time. Berbicaralah dalam bahasa yang dipelajari pengguna, tetapi berikan penjelasan dalam bahasa Indonesia jika diperlukan. Jadilah ramah dan edukatif." }]
                }
            }
        };
        socket.send(JSON.stringify(setup));
    };

    socket.onmessage = async (event) => {
        const response = JSON.parse(event.data);

        if (response.setupComplete) {
            console.log('Setup complete');
            startRecording();
        }

        if (response.serverContent) {
            const content = response.serverContent;
            if (content.modelTurn && content.modelTurn.parts) {
                for (const part of content.modelTurn.parts) {
                    if (part.inlineData) {
                        // Received audio data
                        const audioData = part.inlineData.data;
                        audioQueue.push(audioData);
                        playNextInQueue();
                    }
                    if (part.text) {
                        appendMessage('AI', part.text);
                    }
                }
            }
            if (content.interrupted) {
                stopPlayback();
            }
        }
    };

    socket.onerror = (e) => {
        console.error('WebSocket Error', e);
        statusBadge.innerText = 'Error';
        statusBadge.classList.replace('bg-green-500', 'bg-red-500');
    };

    socket.onclose = () => {
        statusBadge.innerText = 'Disconnected';
        statusBadge.classList.replace('bg-green-500', 'bg-gray-500');
        stopRecording();
    };
}

async function startRecording() {
    if (isRecording) return;

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

        const message = {
            realtimeInput: {
                mediaChunks: [
                    {
                        mimeType: "audio/pcm;rate=16000",
                        data: base64Data
                    }
                ]
            }
        };
        socket.send(JSON.stringify(message));
        updateVisualizer(inputData);
    };

    isRecording = true;
    document.body.classList.add('recording');
    micStatus.innerText = 'Mendengarkan...';
}

function stopRecording() {
    isRecording = false;
    document.body.classList.remove('recording');
    micStatus.innerText = 'Klik tombol untuk mulai bicara';
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (processor) {
        processor.disconnect();
    }
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
    div.className = sender === 'AI' ? 'bg-blue-50 p-3 rounded-lg self-start max-w-[80%]' : 'bg-gray-100 p-3 rounded-lg self-end max-w-[80%]';
    div.innerText = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function updateVisualizer(data) {
    const bars = visualizerContainer.children;
    for (let i = 0; i < bars.length; i++) {
        const val = Math.abs(data[Math.floor(i * data.length / bars.length)]) * 100;
        bars[i].style.height = `${Math.max(8, val * 2)}px`;
    }
}

// Playback Logic
let currentSource = null;

function stopPlayback() {
    if (currentSource) {
        currentSource.stop();
        currentSource = null;
    }
    audioQueue = [];
    isPlaying = false;
}

async function playNextInQueue() {
    if (isPlaying || audioQueue.length === 0) return;

    isPlaying = true;
    const base64Data = audioQueue.shift();
    const binaryData = atob(base64Data);
    const len = binaryData.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryData.charCodeAt(i);
    }

    const audioBuffer = playbackContext.createBuffer(1, len / 2, 24000);
    const channelData = audioBuffer.getChannelData(0);
    const dataView = new DataView(bytes.buffer);

    for (let i = 0; i < len / 2; i++) {
        channelData[i] = dataView.getInt16(i * 2, true) / 32768;
    }

    const source = playbackContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(playbackContext.destination);
    currentSource = source;
    source.onended = () => {
        if (currentSource === source) currentSource = null;
        isPlaying = false;
        playNextInQueue();
    };
    source.start();
}

// Mic Button Click
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

// Start Init
init();
