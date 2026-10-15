// Fun Facts about Gym/Bodybuilding
const funFacts = [
    "The first gyms were actually schools of philosophy in ancient Greece! Philosophers like Plato trained their minds AND bodies.",
    "Your muscles don't grow during your workout—they grow while you rest and recover!",
    "Lifting weights can boost your metabolism for up to 38 hours post-workout (EPOC effect)!",
    "Arnold Schwarzenegger won the Mr. Olympia title 7 times!",
    "The human body has over 600 muscles, which make up about 40% of your total body weight!",
    "The 'pump' you feel after a workout is due to increased blood flow and fluid buildup in your muscles!",
    "Deadlifts work over 200 muscles at once—they're the ultimate full-body exercise!",
    "Muscle tissue burns about 3 times more calories at rest than fat tissue!",
    "The first commercial gym in the US was opened in 1840 by a German immigrant named Charles Atlas!",
    "Squats are often called the 'king of all exercises' because they work your quads, glutes, hamstrings, core, and even your upper body!"
];

// Live Clock Implementation
function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const clockElement = document.getElementById('clock');
    if (clockElement) {
        clockElement.textContent = `${hours}:${minutes}:${seconds}`;
    }
}
setInterval(updateClock, 1000);

// Show Alert Function
function showAlert(msg, type) {
    const statusMessage = document.getElementById('statusMessage');
    const messageContent = document.getElementById('messageContent');
    if (!statusMessage || !messageContent) {
        return;
    }
    
    statusMessage.className = `alert alert-${type} alert-dismissible fade show`;
    statusMessage.style.display = 'block';
    messageContent.textContent = msg;
    setTimeout(() => { statusMessage.style.display = 'none'; }, 5000);
}

async function pollLoginHardware() {
    try {
        const res = await fetch('api.php?action=get_last_scan');
        const data = await res.json();
        
        if (data.status === 'success' && data.rfid) {
            const rfid = data.rfid;
            
            // 1. Fill the input field
            const rfidInput = document.getElementById('rfidInput');
            if (rfidInput) {
                rfidInput.value = rfid;
                rfidInput.classList.add('is-valid');
            }

            // 2. Direct API call for RFID login (automatic submission)
            try {
                const formData = new FormData();
                formData.append('rfid', rfid);
                
                const response = await fetch('api.php?action=rfid_login', {
                    method: 'POST',
                    body: formData
                });
                const result = await response.json();
                
                if (result.status === 'success') {
                    // Consume the scan so it's not processed again
                    await fetch('api.php?action=consume_last_scan');

                    const successMsg = result.message + (result.action === 'checkout' ? '' : ' Redirecting...');
                    const alertType = result.action === 'checkin' ? 'success' : 'warning';
                    
                    const statusMessage = document.getElementById('statusMessage');
                    const messageContent = document.getElementById('messageContent');
                    
                    if (statusMessage && messageContent) {
                        messageContent.textContent = successMsg;
                        statusMessage.className = `alert alert-${alertType} mt-4 text-center animate__animated animate__fadeIn`;
                        statusMessage.classList.remove('d-none');
                    }
                    
                    if (result.redirect) {
                        setTimeout(() => window.location.href = `${result.redirect}`, 1500);
                    }
                } else {
                    if (rfidInput) rfidInput.classList.add('is-invalid');
                    // Still consume the scan if it failed (e.g. invalid RFID) so it doesn't loop
                    await fetch('api.php?action=consume_last_scan');
                }
            } catch (apiError) {
                console.error(apiError);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

// USB Serial Implementation for Login
let loginSerialPort = null;
let loginSerialReader = null;
let loginKeepReading = true;
let loginSerialConnected = false;
const LOGIN_RFID_BAUDS = [115200, 9600, 57600, 38400, 19200];
const LOGIN_USB_FILTERS = [
    { usbVendorId: 0x2341 },
    { usbVendorId: 0x2A03 },
    { usbVendorId: 0x1A86 },
    { usbVendorId: 0x10C4 },
    { usbVendorId: 0x0403 }
];

function loginLineLooksValid(line) {
    if (!line) return false;
    const s = String(line).trim();
    if (!s) return false;
    if (/^USB[_ -]?READY\b/i.test(s)) return true;
    if (/^RFID[_ -]?OK\b/i.test(s)) return true;
    if (/^READER[_ -]?OK\b/i.test(s)) return true;
    if (/^MFRC522/i.test(s)) return true;
    if (/^TAG\s*[:=|]/i.test(s)) return true;
    if (/^UID\s*[:=|]/i.test(s)) return true;
    if (/^CARD(?:\s*ID)?\s*[:=|]/i.test(s)) return true;
    if (/^SCAN\s*[:=|]/i.test(s)) return true;
    const justHex = s.replace(/[^A-Fa-f0-9]/g, '');
    if (justHex.length >= 6 && justHex.length <= 16) return true;
    return false;
}

function loginSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loginExtractRFID(rawLine) {
    if (!rawLine) return null;
    const line = String(rawLine).trim();
    if (!line) return null;

    const patterns = [
        /^TAG\s*[:=|]\s*([A-Fa-f0-9]+)\b/i,
        /^UID\s*[:=|]\s*([A-Fa-f0-9]+)\b/i,
        /^CARD(?:\s*ID)?\s*[:=|]\s*([A-Fa-f0-9]+)\b/i,
        /^RFID\s*[:=|]\s*([A-Fa-f0-9]+)\b/i,
        /^SCAN\s*[:=|]\s*([A-Fa-f0-9]+)\b/i,
        /^\s*0x([A-Fa-f0-9]{6,16})\b/,
        /\b([A-Fa-f0-9]{8,16})\b/
    ];
    for (const re of patterns) {
        const m = line.match(re);
        if (m) return m[1].toUpperCase();
    }
    const justHex = line.replace(/[^A-Fa-f0-9]/g, '');
    if (justHex.length >= 6 && justHex.length <= 16) return justHex.toUpperCase();
    return null;
}

function setLoginUsbBtnState(connected) {
    const btn = document.getElementById('loginUsbConnectBtn');
    if (!btn) return;
    if (connected) {
        btn.classList.remove('btn-dark');
        btn.classList.add('btn-success');
        btn.title = 'RFID Reader Connected — click to disconnect';
    } else {
        btn.classList.remove('btn-success');
        btn.classList.add('btn-dark');
        btn.title = 'Connect USB RFID Reader';
    }
}

async function disconnectLoginUSB() {
    loginKeepReading = false;
    if (loginSerialReader) {
        try { await loginSerialReader.cancel(); } catch (e) {}
        loginSerialReader = null;
    }
    if (loginSerialPort) {
        try { await loginSerialPort.close(); } catch (e) {}
        loginSerialPort = null;
    }
    loginSerialConnected = false;
    setLoginUsbBtnState(false);
}

async function loginOpenAtBaud(port, baud) {
    try {
        await port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
        try { if (port.setSignals) await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (_) {}
        return true;
    } catch (e) {
        console.warn(`[Login USB] open() at ${baud} failed:`, e.message);
        return false;
    }
}

async function loginProbeBaud(port, baud, probeMs) {
    console.log(`[Login USB] Probing baud ${baud} for ${probeMs}ms...`);
    const decoder = new TextDecoder();
    let buffer = '';
    let reader = null;
    let got = false;
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; if (reader) { try { reader.cancel(); } catch (_) {} } }, probeMs);
    try {
        while (!timedOut && port.readable) {
            reader = port.readable.getReader();
            try {
                while (!timedOut) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    const text = decoder.decode(value || new Uint8Array(), { stream: true });
                    if (text) buffer += text;
                    if (buffer.length > 4096) buffer = buffer.slice(-2048);
                    const lines = buffer.split(/\r?\n/);
                    buffer = lines.pop() || '';
                    for (const l of lines) {
                        if (loginLineLooksValid(l)) {
                            console.log(`[Login USB] Valid match at ${baud}:`, l.trim());
                            got = true;
                            clearTimeout(t);
                            try { reader.cancel(); } catch (_) {}
                            break;
                        }
                    }
                    if (got) break;
                }
            } catch (e) {
                if (e && e.name !== 'BreakError') console.debug(`[Login USB] probe read at ${baud}:`, e?.message || e);
            } finally {
                try { reader.releaseLock(); } catch (_) {}
                reader = null;
            }
            if (got || timedOut) break;
        }
    } catch (outer) {
        console.debug(`[Login USB] probe outer ${baud}:`, outer?.message || outer);
    } finally { clearTimeout(t); }
    return got;
}

async function loginTryHandshake(port) {
    try {
        if (!port || !port.writable) return false;
        const w = port.writable.getWriter();
        try {
            const e = new TextEncoder();
            await w.write(e.encode('\r\nPING\r\n'));
            await loginSleep(150);
            await w.write(e.encode('STATUS?\n'));
            return true;
        } finally { try { w.releaseLock(); } catch (_) {} }
    } catch (_) { return false; }
}

async function loginPickManualBaud(tried) {
    const msg =
        'Auto-detect could not match baud: ' + tried.join(', ') + '\n\n' +
        'Your sketch sets: Serial.begin(115200);\n' +
        'Pick baud matching your Arduino sketch:\n\n' +
        '  1) 115200  (MFRC522 default)\n' +
        '  2) 9600\n' +
        '  3) 57600\n' +
        '  4) 38400\n' +
        '  5) 19200\n' +
        '  0) Cancel\n\n' +
        'TIP: Close Arduino Serial Monitor first.';
    const c = prompt(msg, '1');
    if (c === null) return null;
    switch (c.trim()) {
        case '1': return 115200;
        case '2': return 9600;
        case '3': return 57600;
        case '4': return 38400;
        case '5': return 19200;
        default: return parseInt(c.trim(), 10) || null;
    }
}

async function loginEstablish(port) {
    let baud = null;
    let manual = false;

    const info = port.getInfo ? port.getInfo() : {};
    const vid = info.usbVendorId || 0;
    const isFTDI = vid === 0x0403;

    if (isFTDI) {
        console.log(`[Login USB] VID=0x${vid.toString(16).toUpperCase()} (FTDI FT232R) — SKIP probe, lock 115200.`);
        const ok = await loginOpenAtBaud(port, 115200);
        if (!ok) return { ok: false, reason: 'FTDI_OPEN_FAIL', baud: 115200 };
        baud = 115200;
        try { if (port.setSignals) await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (_) {}
        return { ok: true, baud, manual: false, fastBypass: true };
    }

    for (const rate of LOGIN_RFID_BAUDS) {
        const ok = await loginOpenAtBaud(port, rate);
        if (!ok) { try { await port.close(); } catch (_) {} continue; }
        await loginSleep(1800);
        loginTryHandshake(port);
        const matched = await loginProbeBaud(port, rate, 2500);
        if (matched) { baud = rate; console.log(`[Login USB] Auto-detected baud: ${rate}`); break; }
        console.warn(`[Login USB] No data at ${rate}`);
        try { await port.close(); } catch (_) {}
        await loginSleep(200);
    }
    if (!baud) {
        const p = await loginPickManualBaud(LOGIN_RFID_BAUDS);
        if (!p) return { ok: false, reason: 'NO_BAUD' };
        const ok = await loginOpenAtBaud(port, p);
        if (!ok) return { ok: false, reason: 'MANUAL_FAIL', baud: p };
        await loginSleep(2200);
        baud = p; manual = true;
    }
    try { if (port.setSignals) await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (_) {}
    return { ok: true, baud, manual };
}

function loginFormatRawError(e) {
    if (!e) return '(no error object)';
    const parts = [];
    if (e.name) parts.push('Name: ' + e.name);
    if (e.message) parts.push('Message: ' + e.message);
    if (e.code) parts.push('Code: ' + e.code);
    if (parts.length === 0) parts.push(String(e));
    return parts.join('\n');
}

function submitRfidForLogin(rfid) {
    const rfidInput = document.getElementById('rfidInput');
    if (!rfidInput) return;
    rfidInput.value = rfid;
    rfidInput.classList.remove('is-invalid');
    rfidInput.classList.add('is-valid');
    const form = document.getElementById('rfidForm');
    if (form) form.dispatchEvent(new Event('submit', { cancelable: true }));
}

async function connectLoginUSB() {
    if (!("serial" in navigator)) {
        showAlert('Browser Error: Web Serial API is not supported. Use Brave, Chrome, or Edge (HTTPS or localhost required).', 'danger');
        return;
    }

    if (loginSerialConnected) {
        await disconnectLoginUSB();
        showAlert('RFID reader disconnected.', 'info');
        return;
    }

    let port = null;
    try {
        const preMsg =
            '➡️  HOW TO USE THIS POPUP:\n\n' +
            '1) Find "FT232R USB UART (COM3)" in the list\n' +
            '2) CLICK THAT ROW ONCE so it has a BLUE HIGHLIGHT\n' +
            '3) Now the gray "Connect" button at the bottom turns BLUE — click it.\n\n' +
            'If the Connect button stays GRAY, you forgot Step 2 (click the row first).\n\n' +
            'Also: Close Arduino IDE Serial Monitor FIRST (it locks COM3).';
        alert(preMsg);

        try {
            port = await navigator.serial.requestPort({ filters: [] });
        } catch (retry1) {
            console.warn('[Login USB] requestPort(filters=[]) failed, retrying vendor filters:', retry1);
            port = await navigator.serial.requestPort({ filters: LOGIN_USB_FILTERS });
        }
    } catch (selErr) {
        console.error('[Login USB] requestPort() raw:', selErr);
        const raw = loginFormatRawError(selErr);
        let hint = '';
        if (selErr && selErr.name === 'NotFoundError') {
            hint =
                '\n\n✅ FIX: Click the FT232R ROW first so it turns BLUE, then Connect enables.\n' +
                'Also:\n' +
                '• Arduino IDE Serial Monitor MUST be closed (it locks COM3)\n' +
                '• Brave Shield (🦁 icon in URL bar) → "Device Recognition" set to Allow\n' +
                '• If "FT232R USB UART (COM3) - Paired" appears → click it ONCE → then click Connect.';
        } else if (selErr && selErr.name === 'SecurityError') {
            hint =
                '\n\n✅ FIX: Click the 🦁 Brave Shield (top-right) → Lower shield for localhost,\n' +
                'or go to brave://settings/content/serialDevices and add localhost as allowed.';
        } else if (selErr && selErr.name === 'NetworkError') {
            hint =
                '\n\n✅ FIX: NetworkError = COM3 is already opened by another program.\n' +
                'Close Arduino IDE Serial Monitor NOW → click the X on that window.\n' +
                'Then unplug USB → wait 2s → replug → retry.';
        } else {
            hint =
                '\n\nTroubleshooting:\n' +
                '1) Close Arduino IDE Serial Monitor / Putty / TeraTerm (they lock COM3)\n' +
                '2) Click the device ROW first (Connect is gray until row is highlighted)\n' +
                '3) Click Brave 🦁 shield → Allow device recognition\n' +
                '4) Unplug USB → 2s → replug';
        }
        showAlert(
            `USB Connect Failed (requestPort)\n\nBrowser rejected the connection.\n\nRaw error:\n${raw}${hint}`,
            'danger'
        );
        return;
    }
    if (!port) return;

    await disconnectLoginUSB();
    loginSerialPort = port;

    const info = port.getInfo ? port.getInfo() : null;
    if (info) console.log('[Login USB] port info:', info);

    let est;
    try {
        est = await loginEstablish(loginSerialPort);
    } catch (estErr) {
        console.error('[Login USB] loginEstablish crashed:', estErr);
        showAlert(
            `USB Connect Failed (establish)\n\nPort was picked, but opening COM port failed.\n\nRaw error:\n${loginFormatRawError(estErr)}\n\n` +
            'Most likely: Arduino IDE Serial Monitor still has COM3 open. Close it completely.',
            'danger'
        );
        try { await loginSerialPort.close(); } catch (_) {}
        loginSerialPort = null;
        return;
    }

    if (!est.ok) {
        if (est.reason === 'FTDI_OPEN_FAIL') {
            showAlert(
                `FTDI FT232R Port Locked\n\nCould not open FT232R (COM3) at ${est.baud} baud.\n\n` +
                'Cause: Another program EXCLUSIVELY locked COM3.\n\n' +
                'FIX (do in order):\n' +
                '1) Close Arduino IDE Serial Monitor window (click X)\n' +
                '2) If you use Putty/TeraTerm with COM3 → close them\n' +
                '3) Unplug USB cable from computer → wait 2s → replug\n' +
                '4) Click USB button again and try once more.',
                'danger'
            );
        } else if (est.reason === 'MANUAL_FAIL') {
            showAlert(
                `Port Open Failed\n\nCould not open port at manual baud ${est.baud}.\n\n` +
                'Raw cause: Serial Monitor / Putty has COM3 locked → Close it first.',
                'danger'
            );
        } else {
            showAlert(
                'Baud Detection Timed Out\n\nBrowser opened the port OK, but received ZERO valid characters from the Arduino.\n\n' +
                'Since you have FT232R (external adapter):\n' +
                '  1) Make sure RX (Arduino pin 0) ← TX (FT232R)\n' +
                '     and TX (Arduino pin 1) ← RX (FT232R)\n' +
                '     (TX/RX must be CROSSED, not same-named!)\n' +
                '  2) GND wire between Arduino GND ↔ FT232R GND (REQUIRED)\n' +
                '  3) Arduino is POWERED ON (separate USB or 9V barrel)\n' +
                '  4) Hold a card on the reader during connect — forces TAG: output',
                'danger'
            );
        }
        try { await loginSerialPort.close(); } catch (_) {}
        loginSerialPort = null;
        return;
    }

    loginSerialConnected = true;
    loginKeepReading = true;
    setLoginUsbBtnState(true);
    const bypass = est.fastBypass ? ' (FTDI fast-connect)' : '';
    const hintBaud = est.manual ? ` (you picked ${est.baud})` : ` @ ${est.baud}`;
    showAlert(`RFID Reader ready${hintBaud}${bypass}. Scan a card to sign in.`, 'success');

    port.addEventListener('disconnect', () => {
        loginSerialConnected = false;
        setLoginUsbBtnState(false);
        showAlert('RFID reader was unplugged.', 'warning');
    });

    const decoder = new TextDecoder();
    let buffer = '';
    let lastRfid = '';
    let lastAt = 0;
    const DEDUP = 1200;

    try {
        while (loginKeepReading && loginSerialPort && loginSerialPort.readable) {
            const reader = loginSerialPort.readable.getReader();
            loginSerialReader = reader;
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value || new Uint8Array(), { stream: true });
                    const rawLines = buffer.split(/\r?\n/);
                    buffer = rawLines.pop() || '';
                    for (const rawLine of rawLines) {
                        const t = rawLine.trim();
                        if (!t) continue;
                        if (/^USB[_ -]?READY\b/i.test(t)) {
                            console.log('[Login USB] Handshake received ✅');
                            continue;
                        }
                        const rfid = loginExtractRFID(rawLine);
                        if (!rfid) continue;
                        const now = Date.now();
                        if (rfid === lastRfid && (now - lastAt) < DEDUP) continue;
                        lastRfid = rfid;
                        lastAt = now;
                        console.log('[Login USB] Scanned:', rfid, 'raw:', rawLine.trim());
                        submitRfidForLogin(rfid);
                    }
                }
            } catch (loopErr) {
                if (loopErr && loopErr.name === 'BreakError') {
                    console.log('[Login USB] Reader loop cancelled.');
                    break;
                }
                console.error('[Login USB] Read error:', loopErr);
                showAlert(
                    `USB Read Error\n\nSerial stream crashed mid-read.\n\nRaw error:\n${loginFormatRawError(loopErr)}\n\n` +
                    'Likely: Arduino lost power or USB cable was jostled. Re-plug and retry.',
                    'warning'
                );
            } finally {
                try { reader.releaseLock(); } catch (e) {}
                if (loginSerialReader === reader) loginSerialReader = null;
            }
        }
    } catch (outerErr) {
        console.error('[Login USB] Loop error:', outerErr);
    } finally {
        if (loginSerialConnected) {
            loginSerialConnected = false;
            setLoginUsbBtnState(false);
            try { await loginSerialPort.close(); } catch (e) {}
        }
        loginSerialPort = null;
    }
}

async function autoConnectLoginUSB() {
    if (!("serial" in navigator)) return;
    try {
        const ports = await navigator.serial.getPorts();
        if (!ports || ports.length === 0) return;
        console.log('[Login USB] Auto-connecting to previously authorized port.');
        const port = ports[0];
        await disconnectLoginUSB();
        loginSerialPort = port;

        const est = await loginEstablish(loginSerialPort);
        if (!est.ok) {
            console.warn('[Login USB] Auto-connect: baud detect failed.');
            try { await loginSerialPort.close(); } catch (_) {}
            loginSerialPort = null;
            return;
        }

        loginSerialConnected = true;
        loginKeepReading = true;
        setLoginUsbBtnState(true);
        showAlert('RFID reader auto-connected.', 'success');

        port.addEventListener('disconnect', () => {
            loginSerialConnected = false;
            setLoginUsbBtnState(false);
        });

        const decoder = new TextDecoder();
        let buffer = '';
        let lastRfid = '';
        let lastAt = 0;
        const DEDUP = 1200;
        while (loginKeepReading && loginSerialPort && loginSerialPort.readable) {
            const reader = loginSerialPort.readable.getReader();
            loginSerialReader = reader;
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value || new Uint8Array(), { stream: true });
                    const rawLines = buffer.split(/\r?\n/);
                    buffer = rawLines.pop() || '';
                    for (const rawLine of rawLines) {
                        const t = rawLine.trim();
                        if (!t) continue;
                        if (/^USB[_ -]?READY\b/i.test(t)) continue;
                        const rfid = loginExtractRFID(rawLine);
                        if (!rfid) continue;
                        const now = Date.now();
                        if (rfid === lastRfid && (now - lastAt) < DEDUP) continue;
                        lastRfid = rfid;
                        lastAt = now;
                        console.log('[Login USB Auto] Scanned:', rfid);
                        submitRfidForLogin(rfid);
                    }
                }
            } finally {
                try { reader.releaseLock(); } catch (e) {}
            }
        }
    } catch (e) {
        console.warn('[Login USB] Auto-connect skipped:', e?.message || e);
    }
}

let loginRFIDTimer = null;
function scheduleLoginRFIDSubmit() {
    clearTimeout(loginRFIDTimer);
    loginRFIDTimer = setTimeout(() => {
        const rfidInput = document.getElementById('rfidInput');
        if (rfidInput && rfidInput.value.trim()) {
            document.getElementById('rfidForm').dispatchEvent(new Event('submit', { cancelable: true }));
        }
    }, 250);
}

document.addEventListener('DOMContentLoaded', function() {
    // Initialize elements after DOM is ready
    const staffTab = document.getElementById('staffTab');
    const memberTab = document.getElementById('memberTab');
    const staffLoginForm = document.getElementById('staffLoginForm');
    const memberLoginForm = document.getElementById('memberLoginForm');
    updateClock(); // Initial clock update

    // Tab Switching Logic
    if (staffTab) {
        staffTab.addEventListener('click', (e) => {
            e.preventDefault();
            staffTab.classList.add('active');
            memberTab.classList.remove('active');
            staffLoginForm.style.display = 'block';
            memberLoginForm.style.display = 'none';
        });
    }

    if (memberTab) {
        memberTab.addEventListener('click', (e) => {
            e.preventDefault();
            memberTab.classList.add('active');
            staffTab.classList.remove('active');
            staffLoginForm.style.display = 'none';
            memberLoginForm.style.display = 'block';
            setTimeout(() => {
                document.getElementById('rfidInput').focus();
            }, 100);
        });
    }

    // Staff Login
    const staffForm = document.getElementById('staffForm');
    if (staffForm) {
        staffForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            try {
                const response = await fetch('api.php?action=login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const result = await response.json();
                if (result.status === 'success') {
                    window.location.href = result.redirect;
                } else {
                    showAlert(result.message, 'danger');
                }
            } catch (error) {
                showAlert('Server error.', 'danger');
            }
        });
    }

    // RFID Login
    const rfidForm = document.getElementById('rfidForm');
    if (rfidForm) {
        rfidForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const rfid = document.getElementById('rfidInput').value;

            try {
                const formData = new FormData();
                formData.append('rfid', rfid);
                const response = await fetch('api.php?action=rfid_login', {
                    method: 'POST',
                    body: formData
                });
                const result = await response.json();
                if (result.status === 'success') {
                    showAlert(result.message, result.action === 'checkin' ? 'success' : 'warning');
                    if (result.action === 'checkin' && result.redirect) {
                        setTimeout(() => {
                            window.location.href = result.redirect;
                        }, 1200);
                    }
                } else {
                    showAlert(result.message, 'danger');
                }
            } catch (error) {
                showAlert('Server error.', 'danger');
            }
            document.getElementById('rfidInput').value = '';
            document.getElementById('rfidInput').focus();
        });
    }

    // RFID Input Listener
    const loginRFIDInput = document.getElementById('rfidInput');
    if (loginRFIDInput) {
        loginRFIDInput.addEventListener('input', scheduleLoginRFIDSubmit);
    }

    // Fun Fact Button
    const bodyBuildImg = document.getElementById('bodyBuildImg');
    if (bodyBuildImg) {
        bodyBuildImg.addEventListener('click', function() {
            const randomIndex = Math.floor(Math.random() * funFacts.length);
            document.getElementById('funFactContent').innerText = funFacts[randomIndex];
            new bootstrap.Modal(document.getElementById('funFactModal')).show();
        });
    }

    // USB Connect Button
    const usbBtn = document.getElementById('loginUsbConnectBtn');
    if (usbBtn) usbBtn.addEventListener('click', connectLoginUSB);

    autoConnectLoginUSB();

    // Forgot Password Functionality
    const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
    
    if (forgotPasswordBtn) {
        forgotPasswordBtn.addEventListener('click', function(e) {
            e.preventDefault();
            const modalEl = document.getElementById('forgotPasswordModal');
            const modal = new bootstrap.Modal(modalEl);
            document.getElementById('forgotPasswordForm').reset();
            modal.show();
        });
    }

    const forgotPasswordForm = document.getElementById('forgotPasswordForm');
        if (forgotPasswordForm) {
            forgotPasswordForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                const usernameOrEmail = document.getElementById('resetUsername').value;
                try {
                    const response = await fetch('api.php?action=forgot_password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: usernameOrEmail })
                    });
                    const data = await response.json();
                    if (data.status === 'success') {
                        showAlert(data.message, 'success');
                        const forgotModal = bootstrap.Modal.getInstance(document.getElementById('forgotPasswordModal'));
                        if (forgotModal) forgotModal.hide();
                        document.getElementById('secResetUser').textContent = data.name + ' — ' + usernameOrEmail;
                        document.getElementById('secResetUserId').value = data.user_id;
                        const qLabel = document.getElementById('secResetQuestionLabel');
                        if (qLabel && data.question) {
                            qLabel.textContent = data.question;
                        }
                        const answerInput = document.getElementById('secResetAnswer');
                        if (answerInput) answerInput.value = '';
                        document.getElementById('secNewPass').value = '';
                        document.getElementById('secNewPassConfirm').value = '';
                        new bootstrap.Modal(document.getElementById('verifyPasswordModal')).show();
                    } else {
                        showAlert(data.message, 'danger');
                    }
                } catch (err) {
                    console.error('Forgot password error:', err);
                    showAlert('Server error: ' + (err && err.message ? err.message : 'unknown'), 'danger');
                }
            });
        }

        const verifyPasswordForm = document.getElementById('verifyPasswordForm');
        if (verifyPasswordForm) {
            verifyPasswordForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                const userId = document.getElementById('secResetUserId').value;
                const answer = document.getElementById('secResetAnswer').value;
                const newPass = document.getElementById('secNewPass').value;
                const newPassConfirm = document.getElementById('secNewPassConfirm').value;
                try {
                    const response = await fetch('api.php?action=reset_password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            user_id: userId,
                            answer: answer,
                            new_password: newPass,
                            confirm_password: newPassConfirm
                        })
                    });
                    const data = await response.json();
                    if (data.status === 'success') {
                        showAlert(data.message, 'success');
                        const verifyModal = bootstrap.Modal.getInstance(document.getElementById('verifyPasswordModal'));
                        if (verifyModal) verifyModal.hide();
                    } else {
                        showAlert(data.message, 'danger');
                    }
                } catch (err) {
                    console.error('Reset password error:', err);
                    showAlert('Server error: ' + (err && err.message ? err.message : 'unknown'), 'danger');
                }
            });
        }

    // Start hardware poll after DOM is ready
    setInterval(pollLoginHardware, 2000);
});
