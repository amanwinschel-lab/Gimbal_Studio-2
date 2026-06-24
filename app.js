/* ==========================================
   GIMBAL STUDIO 2 - FRONTEND CONTROLLER (DUAL MODE)
   ========================================== */

// BLE Configuration Constants
const BLE_SERVICE_UUID = '0000fee9-0000-1000-8000-00805f9b34fb'; // Quintic Corp Service
const BLE_WRITE_UUID = 'd44bc439-abfd-45a2-b575-925416129600';

// Command Hex Matrix (for Standalone Web Bluetooth Mode)
const COMMANDS_HEX = {
    "STOP": "243c040018181000d577",
    
    "PAN_RIGHT": [
        "243c0800181218010210d00fa283",
        "243c080018121b010210d00f424d",
        "243c080018121e010210d00f430e",
        "243c0800181221010210d00fcce4",
        "243c0800181224010210d00fcda7",
        "243c0800181227010210d00f2d69",
        "243c080018122a010210d00f6e27",
        "243c080018122d010210d00f2fef",
        "243c0800181230010210d00fe8bb"
    ],

    "PAN_LEFT": [
        "243c080018125401021000009906",
        "243c0800181257010210000079c8",
        "243c080018125a01021000003a86",
        "243c080018125d01021000007b4e",
        "243c08001812600102100000b42f",
        "243c0800181263010210000054e1",
        "243c0800181266010210000055a2",
        "243c080018126901021000005667",
        "243c080018126c01021000005724"
    ],

    "TILT_UP": [
        "243c0800181256010110d40e282e",
        "243c0800181259010110d40e2beb",
        "243c080018125c010110d40e2aa8",
        "243c080018125f010110d40eca66",
        "243c0800181262010110d40e0507",
        "243c0800181265010110d40e44cf",
        "243c0800181268010110d40e0781",
        "243c080018126b010110d40ee74f",
        "243c080018126e010110d40ee60c"
    ],

    "TILT_DOWN": [
        "243c08001812040101102c017bbe",
        "243c08001812070101102c019b70",
        "243c080018120a0101102c01d83e",
        "243c080018120d0101102c0199f6",
        "243c08001812100101102c015ea2",
        "243c08001812130101102c01be6c",
        "243c08001812160101102c01bf2f",
        "243c08001812190101102c01bcea",
        "243c080018121c0101102c01bda9"
    ]
};

// State Variables
let ws = null;
let currentProfile = [];
let isConnected = false;
let isRecording = false;
let controlMode = 'server'; // 'server' or 'bluetooth'
let pressedKeys = new Set();
let activeDirection = null;

// Direct Bluetooth State
let bleDevice = null;
let bleServer = null;
let bleCharacteristic = null;
let bleStreamInterval = null;

// Direct Bluetooth Recording State
let recordStartTime = 0;
let stepStartTime = 0;

// Key configuration mapping
const KEY_MAP = {
    'w': 'TILT_UP',
    'arrowup': 'TILT_UP',
    's': 'TILT_DOWN',
    'arrowdown': 'TILT_DOWN',
    'a': 'PAN_LEFT',
    'arrowleft': 'PAN_LEFT',
    'd': 'PAN_RIGHT',
    'arrowright': 'PAN_RIGHT'
};

// UI Elements
const logBox = document.getElementById('log-box');
const badge = document.getElementById('connection-badge');
const badgeText = document.getElementById('badge-text');
const modeSelect = document.getElementById('mode-select');

// Connection panels
const serverSection = document.getElementById('server-connection-section');
const bluetoothSection = document.getElementById('bluetooth-connection-section');

// Server mode elements
const macInput = document.getElementById('mac-input');
const scanBtn = document.getElementById('scan-btn');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');

// Bluetooth mode elements
const bleConnectBtn = document.getElementById('ble-connect-btn');
const bleDisconnectBtn = document.getElementById('ble-disconnect-btn');

// Shared elements
const recordBtn = document.getElementById('record-btn');
const stepCount = document.getElementById('step-count');
const timelineSteps = document.getElementById('timeline-steps');
const profileNameInput = document.getElementById('profile-name-input');
const saveProfileBtn = document.getElementById('save-profile-btn');
const profileSelect = document.getElementById('profile-select');
const loadProfileBtn = document.getElementById('load-profile-btn');
const deleteProfileBtn = document.getElementById('delete-profile-btn');
const playBtn = document.getElementById('play-btn');
const previewContainer = document.getElementById('preview-steps-container');

// Direction buttons mapping
const btnMap = {
    'TILT_UP': document.getElementById('btn-tilt-up'),
    'TILT_DOWN': document.getElementById('btn-tilt-down'),
    'PAN_LEFT': document.getElementById('btn-pan-left'),
    'PAN_RIGHT': document.getElementById('btn-pan-right')
};

const directionIcons = {
    'TILT_UP': 'fa-solid fa-arrow-up',
    'TILT_DOWN': 'fa-solid fa-arrow-down',
    'PAN_LEFT': 'fa-solid fa-arrow-left',
    'PAN_RIGHT': 'fa-solid fa-arrow-right'
};

// ==========================================
// SYSTEM LOGGING
// ==========================================
function log(msg, type = 'system') {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `[${time}] ${msg}`;
    logBox.appendChild(entry);
    logBox.scrollTop = logBox.scrollHeight;
}

// Helper: Hex string to Uint8Array
function hexToBytes(hex) {
    let bytes = [];
    for (let c = 0; c < hex.length; c += 2) {
        bytes.push(parseInt(hex.substr(c, 2), 16));
    }
    return new Uint8Array(bytes);
}

// ==========================================
// INITIALIZATION
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
    log('Initializing Gimbal Studio 2 workspace...');
    
    // Check if FastAPI backend is online, else fallback to Web Bluetooth
    try {
        const res = await fetch('/api/status');
        if (res.ok) {
            log('Python server online. Defaulting to Server control mode.', 'success');
            setControlMode('server');
            fetchStatus();
            initWebSocket();
        } else {
            throw new Error();
        }
    } catch (err) {
        log('Python server offline. Autodetected Standalone Web Bluetooth Mode.', 'info');
        setControlMode('bluetooth');
        // Hide server option from mode select since server is unavailable
        modeSelect.querySelector('option[value="server"]').disabled = true;
    }
    
    loadProfileList();
    setupEventHandlers();
    setupKeyboardListeners();
    setupMouseTouchListeners();
});

function setControlMode(mode) {
    controlMode = mode;
    modeSelect.value = mode;
    
    if (mode === 'server') {
        serverSection.style.display = 'block';
        bluetoothSection.style.display = 'none';
        disconnectBluetooth();
    } else {
        serverSection.style.display = 'none';
        bluetoothSection.style.display = 'block';
        if (ws) {
            ws.close();
            ws = null;
        }
        // Emulate disconnect state on start
        updateUIState({ connected: false, recording_active: false });
    }
    log(`Control Mode switched to: ${mode === 'server' ? 'Server Connection' : 'Web Bluetooth (Field)'}`);
    loadProfileList();
}

// ==========================================
// WEBSOCKET (SERVER MODE TELEMETRY)
// ==========================================
function initWebSocket() {
    if (controlMode !== 'server') return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        updateUIState(data);
    };
    
    ws.onclose = () => {
        if (controlMode === 'server') {
            log('WebSocket link lost. Reconnecting...', 'error');
            setTimeout(initWebSocket, 3000);
        }
    };
}

// ==========================================
// DIRECT WEB BLUETOOTH (MOBILE/FIELD)
// ==========================================
async function connectBluetooth() {
    if (!navigator.bluetooth) {
        log('Web Bluetooth is NOT supported by your browser/device. (Use Chrome on Android/HTTPS)', 'error');
        alert('Web Bluetooth requires a secure context (HTTPS) and a compatible browser like Google Chrome.');
        return;
    }
    
    log('Scanning for Crane M3 via local Bluetooth controller...', 'info');
    badge.className = 'badge badge-scanning';
    badgeText.textContent = 'Scanning...';
    
    try {
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: 'Crane M3' }, { namePrefix: 'Crane-M3' }],
            optionalServices: [BLE_SERVICE_UUID]
        });
        
        log(`Acquired device: ${bleDevice.name}. Securely pairing...`, 'info');
        
        bleServer = await bleDevice.gatt.connect();
        log('GATT Server connected. Loading services...', 'info');
        
        const service = await bleServer.getPrimaryService(BLE_SERVICE_UUID);
        bleCharacteristic = await service.getCharacteristic(BLE_WRITE_UUID);
        
        log('Handshake successful! Crane M3 is online.', 'success');
        updateUIState({ connected: true, recording_active: false });
        
        // Listen for sudden disconnects
        bleDevice.addEventListener('gattserverdisconnected', onBluetoothDisconnected);
        
    } catch (err) {
        log(`Web Bluetooth pairing failed: ${err.message}`, 'error');
        updateUIState({ connected: false, recording_active: false });
    }
}

function disconnectBluetooth() {
    if (bleDevice && bleDevice.gatt.connected) {
        log('Terminating direct Bluetooth link...', 'info');
        bleDevice.gatt.disconnect();
    }
    onBluetoothDisconnected();
}

function onBluetoothDisconnected() {
    if (bleStreamInterval) {
        clearInterval(bleStreamInterval);
        bleStreamInterval = null;
    }
    bleDevice = null;
    bleServer = null;
    bleCharacteristic = null;
    log('Direct Bluetooth link released.', 'system');
    updateUIState({ connected: false, recording_active: false });
}

// Packet streaming logic for direct bluetooth mode
let packetIndex = 0;
async function sendBluetoothStream(direction) {
    if (!bleCharacteristic) return;
    
    const hexPackets = COMMANDS_HEX[direction];
    
    // Stop any existing stream
    if (bleStreamInterval) clearInterval(bleStreamInterval);
    
    packetIndex = 0;
    
    // Write packet immediately
    writePacket(hexPackets[0]);
    
    // Stream at 20Hz (every 50ms)
    bleStreamInterval = setInterval(() => {
        packetIndex++;
        const nextPacket = hexPackets[packetIndex % hexPackets.length];
        writePacket(nextPacket);
    }, 50);
}

async function writePacket(hexStr) {
    if (!bleCharacteristic) return;
    try {
        const bytes = hexToBytes(hexStr);
        await bleCharacteristic.writeValueWithoutResponse(bytes);
    } catch (err) {
        // Suppress noisy write failures
    }
}

async function stopBluetoothStream() {
    if (bleStreamInterval) {
        clearInterval(bleStreamInterval);
        bleStreamInterval = null;
    }
    // Write stop packet
    await writePacket(COMMANDS_HEX.STOP);
}

// ==========================================
// API REST OPERATIONS (SERVER OR LOCAL STORAGE)
// ==========================================
async function fetchStatus() {
    if (controlMode !== 'server') return;
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        macInput.value = data.mac_address;
        updateUIState(data);
    } catch (err) {
        log(`Failed to fetch status: ${err.message}`, 'error');
    }
}

async function loadProfileList() {
    profileSelect.innerHTML = '<option value="">-- Load profile --</option>';
    
    if (controlMode === 'server') {
        try {
            const res = await fetch('/api/profiles');
            const data = await res.json();
            data.profiles.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                profileSelect.appendChild(opt);
            });
        } catch (err) {
            log(`Failed to fetch profiles: ${err.message}`, 'error');
        }
    } else {
        // Direct LocalStorage Database
        const profiles = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('gimbal_profile_')) {
                profiles.push(key.replace('gimbal_profile_', ''));
            }
        }
        profiles.sort().forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            profileSelect.appendChild(opt);
        });
    }
}

// ==========================================
// UI RENDERERS
// ==========================================
function updateUIState(state) {
    isConnected = state.connected;
    isRecording = state.recording_active;
    
    // Connection Badging
    if (isConnected) {
        badge.className = 'badge badge-connected';
        badgeText.textContent = 'Connected';
        
        // Mode connection states
        connectBtn.disabled = true;
        disconnectBtn.disabled = false;
        macInput.disabled = true;
        scanBtn.disabled = true;
        
        bleConnectBtn.disabled = true;
        bleDisconnectBtn.disabled = false;
        
        recordBtn.disabled = false;
    } else {
        badge.className = 'badge badge-disconnected';
        badgeText.textContent = 'Disconnected';
        
        connectBtn.disabled = false;
        disconnectBtn.disabled = true;
        macInput.disabled = false;
        scanBtn.disabled = false;
        
        bleConnectBtn.disabled = false;
        bleDisconnectBtn.disabled = true;
        
        recordBtn.disabled = true;
        if (isRecording) {
            if (controlMode === 'server') stopRecording();
            else stopBluetoothRecording();
        }
    }
    
    // Recording state style
    if (isRecording) {
        recordBtn.className = 'btn btn-record recording';
        recordBtn.innerHTML = '<i class="fa-solid fa-square"></i> Stop Recording';
        saveProfileBtn.disabled = true;
    } else {
        recordBtn.className = 'btn btn-record';
        recordBtn.innerHTML = '<i class="fa-solid fa-circle"></i> Start Recording';
        saveProfileBtn.disabled = currentProfile.length === 0;
    }
    
    // Update active visual keys
    Object.values(btnMap).forEach(btn => btn.classList.remove('active'));
    if (state.current_direction && btnMap[state.current_direction]) {
        btnMap[state.current_direction].classList.add('active');
    }
}

function renderTimeline(profile) {
    timelineSteps.innerHTML = '';
    stepCount.textContent = `${profile.length} steps`;
    
    if (profile.length === 0) {
        timelineSteps.innerHTML = '<div class="timeline-empty-state">No steps recorded yet. Start recording and move the gimbal.</div>';
        return;
    }
    
    profile.forEach((step) => {
        const item = document.createElement('div');
        item.className = `timeline-item ${step.direction.toLowerCase().replace('_', '-')}`;
        const dirClass = directionIcons[step.direction] || 'fa-solid fa-compass';
        item.innerHTML = `
            <div class="item-direction">
                <i class="${dirClass}"></i>
                <span>${step.direction}</span>
            </div>
            <div class="item-duration">${step.duration}s</div>
        `;
        timelineSteps.appendChild(item);
    });
    timelineSteps.scrollTop = timelineSteps.scrollHeight;
}

function renderPreview(profile) {
    previewContainer.innerHTML = '';
    
    if (profile.length === 0) {
        previewContainer.innerHTML = '<div class="preview-empty-state">No sequence loaded. Select a saved profile or record a new one.</div>';
        playBtn.disabled = true;
        return;
    }
    
    playBtn.disabled = false;
    
    profile.forEach((step, idx) => {
        const card = document.createElement('div');
        card.className = 'preview-step-card';
        const dirClass = directionIcons[step.direction] || 'fa-solid fa-compass';
        card.innerHTML = `
            <div class="preview-step-dir">
                <i class="${dirClass}"></i>
                <span>#${idx+1}</span>
            </div>
            <div style="font-size:0.75rem; font-weight:600;">${step.direction}</div>
            <div class="preview-step-dur">${step.duration}s</div>
        `;
        previewContainer.appendChild(card);
    });
}

// ==========================================
// INTERACTIVE COMMAND ACTIONS (DUAL)
// ==========================================
function sendGimbalStart(direction) {
    if (!isConnected) return;
    
    if (activeDirection !== direction) {
        activeDirection = direction;
        
        if (controlMode === 'server') {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'START', direction: direction }));
            }
        } else {
            // Direct Bluetooth Start
            sendBluetoothStream(direction);
            
            // Record state tracking
            if (isRecording) {
                // Save previous step if any
                saveDirectStep();
                stepStartTime = Date.now();
            }
        }
        
        // UI lighting
        Object.values(btnMap).forEach(btn => btn.classList.remove('active'));
        if (btnMap[direction]) btnMap[direction].classList.add('active');
    }
}

function sendGimbalStop() {
    if (!isConnected) return;
    
    if (controlMode === 'server') {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'STOP' }));
        }
    } else {
        // Direct Bluetooth Stop
        stopBluetoothStream();
        
        // Record state tracking
        if (isRecording) {
            saveDirectStep();
        }
    }
    
    activeDirection = null;
    Object.values(btnMap).forEach(btn => btn.classList.remove('active'));
}

// Server-side recordings
async function startRecording() {
    try {
        const res = await fetch('/api/recording/start', { method: 'POST' });
        const data = await res.json();
        if (data.status === 'recording_started') {
            log('Motion capture engine: RECORDING ACTIVE', 'info');
            currentProfile = [];
            renderTimeline(currentProfile);
            renderPreview(currentProfile);
            fetchStatus();
        }
    } catch (err) {
        log(`Failed to start recording: ${err.message}`, 'error');
    }
}

async function stopRecording() {
    try {
        const res = await fetch('/api/recording/stop', { method: 'POST' });
        const data = await res.json();
        if (data.status === 'recording_stopped') {
            log(`Recording saved. Captured ${data.profile.length} steps.`, 'success');
            currentProfile = data.profile;
            renderTimeline(currentProfile);
            renderPreview(currentProfile);
            fetchStatus();
        }
    } catch (err) {
        log(`Failed to stop recording: ${err.message}`, 'error');
    }
}

// Direct Bluetooth client-side recordings
function startBluetoothRecording() {
    log('Direct Bluetooth capture engine: RECORDING ACTIVE', 'info');
    currentProfile = [];
    renderTimeline(currentProfile);
    renderPreview(currentProfile);
    
    isRecording = true;
    updateUIState({ connected: true, recording_active: true });
}

function stopBluetoothRecording() {
    saveDirectStep();
    isRecording = false;
    log(`Recording saved locally. Captured ${currentProfile.length} steps.`, 'success');
    renderTimeline(currentProfile);
    renderPreview(currentProfile);
    updateUIState({ connected: true, recording_active: false });
}

function saveDirectStep() {
    if (isRecording && activeDirection && stepStartTime > 0) {
        const duration = (Date.now() - stepStartTime) / 1000;
        if (duration > 0.08) {
            currentProfile.push({
                direction: activeDirection,
                duration: parseFloat(duration.toFixed(2))
            });
            renderTimeline(currentProfile);
        }
        stepStartTime = 0;
    }
}

async function playBluetoothProfile() {
    if (currentProfile.length === 0) return;
    log('Beginning direct profile playback on Gimbal...', 'info');
    
    for (const step of currentProfile) {
        log(`Playing step: ${step.direction} for ${step.duration}s`);
        
        // Start movement
        await sendBluetoothStream(step.direction);
        
        // Wait for duration
        await new Promise(resolve => setTimeout(resolve, step.duration * 1000));
        
        // Stop movement
        await stopBluetoothStream();
        
        // Brief rest step gap
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    log('Direct playback completed.', 'success');
}

// ==========================================
// EVENT HANDLERS SETUP
// ==========================================
function setupEventHandlers() {
    // Mode switcher listener
    modeSelect.addEventListener('change', (e) => {
        setControlMode(e.target.value);
    });

    // BLE Connect / Disconnect Buttons
    bleConnectBtn.addEventListener('click', connectBluetooth);
    bleDisconnectBtn.addEventListener('click', disconnectBluetooth);

    // Scan (Server)
    scanBtn.addEventListener('click', async () => {
        log('Scanning BLE spectrum for Crane M3...', 'info');
        badge.className = 'badge badge-scanning';
        badgeText.textContent = 'Scanning...';
        scanBtn.disabled = true;
        try {
            const res = await fetch('/api/scan', { method: 'POST' });
            const data = await res.json();
            if (data.status === 'success') {
                log(`Found Gimbal at MAC: ${data.mac_address}!`, 'success');
                macInput.value = data.mac_address;
            } else {
                log('Scan finished: Device not found.', 'error');
            }
        } catch (err) {
            log(`Scan error: ${err.message}`, 'error');
        } finally {
            fetchStatus();
        }
    });

    // Connect (Server)
    connectBtn.addEventListener('click', async () => {
        const mac = macInput.value.trim();
        log(`Linking connection interface: [${mac}]...`, 'info');
        try {
            const res = await fetch('/api/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mac_address: mac })
            });
            const data = await res.json();
            if (res.ok) {
                log('Telemetry link locked! Crane M3 is online.', 'success');
            } else {
                log(`Connection failure: ${data.detail}`, 'error');
            }
        } catch (err) {
            log(`Connection error: ${err.message}`, 'error');
        } finally {
            fetchStatus();
        }
    });

    // Disconnect (Server)
    disconnectBtn.addEventListener('click', async () => {
        log('Releasing telemetry link...', 'info');
        try {
            await fetch('/api/disconnect', { method: 'POST' });
            log('Disconnected successfully.', 'system');
        } catch (err) {
            log(`Error disconnecting: ${err.message}`, 'error');
        } finally {
            fetchStatus();
        }
    });

    // Record Toggle
    recordBtn.addEventListener('click', () => {
        if (isRecording) {
            if (controlMode === 'server') stopRecording();
            else stopBluetoothRecording();
        } else {
            if (controlMode === 'server') startRecording();
            else startBluetoothRecording();
        }
    });

    // Save Profile
    saveProfileBtn.addEventListener('click', async () => {
        let name = profileNameInput.value.trim();
        if (!name) return;
        name = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        
        if (controlMode === 'server') {
            log(`Writing workspace profile to server: ${name}...`, 'info');
            try {
                const res = await fetch(`/api/profiles/${name}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ profile: currentProfile })
                });
                if (res.ok) {
                    log(`Profile "${name}" saved to server library!`, 'success');
                    profileNameInput.value = '';
                    loadProfileList();
                }
            } catch (err) {
                log(`Failed to save: ${err.message}`, 'error');
            }
        } else {
            // Save to localStorage
            log(`Writing profile to phone local memory: ${name}...`, 'info');
            localStorage.setItem(`gimbal_profile_${name}`, JSON.stringify(currentProfile));
            log(`Profile "${name}" saved to local storage!`, 'success');
            profileNameInput.value = '';
            loadProfileList();
        }
    });

    // Load Profile
    loadProfileBtn.addEventListener('click', async () => {
        const name = profileSelect.value;
        if (!name) return;
        
        log(`Retrieving profile sequence: ${name}...`, 'info');
        if (controlMode === 'server') {
            try {
                const res = await fetch(`/api/profiles/${name}`);
                const data = await res.json();
                if (res.ok) {
                    currentProfile = data.profile;
                    renderTimeline(currentProfile);
                    renderPreview(currentProfile);
                    log(`Loaded from server: ${name} (${currentProfile.length} steps)`, 'success');
                }
            } catch (err) {
                log(`Failed to load: ${err.message}`, 'error');
            }
        } else {
            // Load from LocalStorage
            const stored = localStorage.getItem(`gimbal_profile_${name}`);
            if (stored) {
                currentProfile = JSON.parse(stored);
                renderTimeline(currentProfile);
                renderPreview(currentProfile);
                log(`Loaded from phone memory: ${name} (${currentProfile.length} steps)`, 'success');
            }
        }
    });

    // Delete Profile
    deleteProfileBtn.addEventListener('click', async () => {
        const name = profileSelect.value;
        if (!name) return;
        
        if (!confirm(`Are you sure you want to delete profile "${name}"?`)) return;
        
        if (controlMode === 'server') {
            try {
                const res = await fetch(`/api/profiles/${name}`, { method: 'DELETE' });
                if (res.ok) {
                    log(`Deleted profile: ${name}`, 'system');
                    profileSelect.value = '';
                    loadProfileList();
                }
            } catch (err) {
                log(`Failed to delete: ${err.message}`, 'error');
            }
        } else {
            // Delete from LocalStorage
            localStorage.removeItem(`gimbal_profile_${name}`);
            log(`Deleted local profile: ${name}`, 'system');
            profileSelect.value = '';
            loadProfileList();
        }
    });

    // Playback Run
    playBtn.addEventListener('click', () => {
        if (controlMode === 'server') {
            fetch('/api/playback', { method: 'POST' });
            log('Starting sequence playback (Server mode)...', 'info');
        } else {
            playBluetoothProfile();
        }
    });
}

// ==========================================
// KEYBOARD TELEMETRY DRIVER
// ==========================================
function setupKeyboardListeners() {
    window.addEventListener('keydown', (e) => {
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') {
            return;
        }
        
        const key = e.key.toLowerCase();
        if (KEY_MAP[key]) {
            e.preventDefault();
            const direction = KEY_MAP[key];
            if (!pressedKeys.has(direction)) {
                pressedKeys.add(direction);
                sendGimbalStart(direction);
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') {
            return;
        }

        const key = e.key.toLowerCase();
        if (KEY_MAP[key]) {
            const direction = KEY_MAP[key];
            pressedKeys.delete(direction);
            
            if (pressedKeys.size === 0) {
                sendGimbalStop();
            } else {
                const nextDir = Array.from(pressedKeys)[pressedKeys.size - 1];
                sendGimbalStart(nextDir);
            }
        }
    });
}

// ==========================================
// VIRTUAL MOUSE & TOUCH JOYSTICK TRIGGERS
// ==========================================
function setupMouseTouchListeners() {
    Object.entries(btnMap).forEach(([dir, btn]) => {
        if (!btn) return;
        
        const triggerStart = (e) => {
            e.preventDefault();
            sendGimbalStart(dir);
        };
        
        const triggerEnd = (e) => {
            e.preventDefault();
            sendGimbalStop();
        };

        btn.addEventListener('mousedown', triggerStart);
        btn.addEventListener('mouseup', triggerEnd);
        btn.addEventListener('mouseleave', triggerEnd);
        
        btn.addEventListener('touchstart', triggerStart);
        btn.addEventListener('touchend', triggerEnd);
        btn.addEventListener('touchcancel', triggerEnd);
    });
}
