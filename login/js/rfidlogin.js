const rfidForm = document.getElementById('rfidForm');
const rfidInput = document.getElementById('rfidInput');
const rfidIcon = document.getElementById('rfidIcon');
const statusMessage = document.getElementById('statusMessage');
const messageContent = document.getElementById('messageContent');
const submitBtn = document.getElementById('submitBtn');

let kioskSerialPort = null;
let kioskSerialReader = null;
let kioskKeepReading = true;
let kioskSerialConnected = false;
const KIOSK_BAUDS = [115200, 9600, 57600, 38400, 19200];
const KIOSK_USB_FILTERS = [
    { usbVendorId: 0x2341 },
    { usbVendorId: 0x2A03 },
    { usbVendorId: 0x1A86 },
    { usbVendorId: 0x10C4 },
    { usbVendorId: 0x0403 }
];

function kioskLineLooksValid(line) {
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

function kioskSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function kioskExtractRFID(rawLine) {
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

function setKioskUsbBtnState(connected) {
    const btn = document.getElementById('kioskUsbBtn');
    if (!btn) return;
    if (connected) {
        btn.classList.remove('btn-outline-dark');
        btn.classList.add('btn-success');
        btn.title = 'RFID Reader Connected — click to disconnect';
    } else {
        btn.classList.remove('btn-success');
        btn.classList.add('btn-outline-dark');
        btn.title = 'Connect USB RFID Reader';
    }
}

async function disconnectKioskUSB() {
    kioskKeepReading = false;
    if (kioskSerialReader) {
        try { await kioskSerialReader.cancel(); } catch (e) {}
        kioskSerialReader = null;
    }
    if (kioskSerialPort) {
        try { await kioskSerialPort.close(); } catch (e) {}
        kioskSerialPort = null;
    }
    kioskSerialConnected = false;
    setKioskUsbBtnState(false);
}

async function kioskOpenAtBaud(port, baud) {
    try {
        await port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
        try { if (port.setSignals) await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (_) {}
        return true;
    } catch (e) {
        console.warn(`[Kiosk USB] open() at ${baud} failed:`, e.message);
        return false;
    }
}

async function kioskProbeBaud(port, baud, probeMs) {
    console.log(`[Kiosk USB] Probing baud ${baud} for ${probeMs}ms...`);
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
                        if (kioskLineLooksValid(l)) {
                            console.log(`[Kiosk USB] Valid match at ${baud}:`, l.trim());
                            got = true;
                            clearTimeout(t);
                            try { reader.cancel(); } catch (_) {}
                            break;
                        }
                    }
                    if (got) break;
                }
            } catch (e) {
                if (e && e.name !== 'BreakError') console.debug(`[Kiosk USB] probe read at ${baud}:`, e?.message || e);
            } finally {
                try { reader.releaseLock(); } catch (_) {}
                reader = null;
            }
            if (got || timedOut) break;
        }
    } catch (outer) {
        console.debug(`[Kiosk USB] probe outer ${baud}:`, outer?.message || outer);
    } finally { clearTimeout(t); }
    return got;
}

async function kioskTryHandshake(port) {
    try {
        if (!port || !port.writable) return false;
        const w = port.writable.getWriter();
        try {
            const e = new TextEncoder();
            await w.write(e.encode('\r\nPING\r\n'));
            await kioskSleep(150);
            await w.write(e.encode('STATUS?\n'));
            return true;
        } finally { try { w.releaseLock(); } catch (_) {} }
    } catch (_) { return false; }
}

async function kioskPickManualBaud(tried) {
    const msg =
        'Auto-detect could not match baud: ' + tried.join(', ') + '\n\n' +
        'Sketch uses Serial.begin(115200);\n' +
        'Pick baud matching your sketch:\n\n' +
        '  1) 115200  (your MFRC522 sketch uses this)\n' +
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

async function kioskEstablish(port) {
    let baud = null;
    let manual = false;

    const info = port.getInfo ? port.getInfo() : {};
    const vid = info.usbVendorId || 0;
    const isFTDI = vid === 0x0403;

    if (isFTDI) {
        console.log(`[Kiosk USB] VID=0x${vid.toString(16).toUpperCase()} (FTDI FT232R) — SKIP probe, lock 115200.`);
        const ok = await kioskOpenAtBaud(port, 115200);
        if (!ok) return { ok: false, reason: 'FTDI_OPEN_FAIL', baud: 115200 };
        baud = 115200;
        try { if (port.setSignals) await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (_) {}
        return { ok: true, baud, manual: false, fastBypass: true };
    }

    for (const rate of KIOSK_BAUDS) {
        const ok = await kioskOpenAtBaud(port, rate);
        if (!ok) { try { await port.close(); } catch (_) {} continue; }
        await kioskSleep(1800);
        kioskTryHandshake(port);
        const matched = await kioskProbeBaud(port, rate, 2500);
        if (matched) { baud = rate; console.log(`[Kiosk USB] Auto-detected baud: ${rate}`); break; }
        console.warn(`[Kiosk USB] No data at ${rate}`);
        try { await port.close(); } catch (_) {}
        await kioskSleep(200);
    }
    if (!baud) {
        const p = await kioskPickManualBaud(KIOSK_BAUDS);
        if (!p) return { ok: false, reason: 'NO_BAUD' };
        const ok = await kioskOpenAtBaud(port, p);
        if (!ok) return { ok: false, reason: 'MANUAL_FAIL', baud: p };
        await kioskSleep(2200);
        baud = p; manual = true;
    }
    try { if (port.setSignals) await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (_) {}
    return { ok: true, baud, manual };
}

function kioskFormatRawError(e) {
    if (!e) return '(no error object)';
    const parts = [];
    if (e.name) parts.push('Name: ' + e.name);
    if (e.message) parts.push('Message: ' + e.message);
    if (e.code) parts.push('Code: ' + e.code);
    if (parts.length === 0) parts.push(String(e));
    return parts.join('\n');
}

async function connectKioskUSB() {
    if (!("serial" in navigator)) {
        showAlert('Browser Error: Web Serial API is not supported. Use Brave, Chrome, or Edge (HTTPS or localhost required).', 'danger');
        return;
    }

    if (kioskSerialConnected) {
        await disconnectKioskUSB();
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
            console.warn('[Kiosk USB] requestPort(filters=[]) failed, retrying vendor filters:', retry1);
            port = await navigator.serial.requestPort({ filters: KIOSK_USB_FILTERS });
        }
    } catch (selErr) {
        console.error('[Kiosk USB] requestPort() raw:', selErr);
        const raw = kioskFormatRawError(selErr);
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

    await disconnectKioskUSB();
    kioskSerialPort = port;

    const info = port.getInfo ? port.getInfo() : null;
    if (info) console.log('[Kiosk USB] port info:', info);

    let est;
    try {
        est = await kioskEstablish(kioskSerialPort);
    } catch (estErr) {
        console.error('[Kiosk USB] kioskEstablish crashed:', estErr);
        showAlert(
            `USB Connect Failed (establish)\n\nPort was picked, but opening COM port failed.\n\nRaw error:\n${kioskFormatRawError(estErr)}\n\n` +
            'Most likely: Arduino IDE Serial Monitor still has COM3 open. Close it completely.',
            'danger'
        );
        try { await kioskSerialPort.close(); } catch (_) {}
        kioskSerialPort = null;
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
        try { await kioskSerialPort.close(); } catch (_) {}
        kioskSerialPort = null;
        return;
    }

    kioskSerialConnected = true;
    kioskKeepReading = true;
    setKioskUsbBtnState(true);
    const bypass = est.fastBypass ? ' (FTDI fast-connect)' : '';
    const hintBaud = est.manual ? ` (you picked ${est.baud})` : ` @ ${est.baud}`;
    showAlert(`RFID Reader ready${hintBaud}${bypass}. Scan a card now.`, 'success');

    port.addEventListener('disconnect', () => {
        kioskSerialConnected = false;
        setKioskUsbBtnState(false);
        showAlert('RFID reader was unplugged.', 'warning');
    });

    const decoder = new TextDecoder();
    let buffer = '';
    let lastRfid = '';
    let lastAt = 0;
    const DEDUP = 1200;

    try {
        while (kioskKeepReading && kioskSerialPort && kioskSerialPort.readable) {
            const reader = kioskSerialPort.readable.getReader();
            kioskSerialReader = reader;
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
                            console.log('[Kiosk USB] Handshake received ✅');
                            continue;
                        }
                        const rfid = kioskExtractRFID(rawLine);
                        if (!rfid) continue;
                        const now = Date.now();
                        if (rfid === lastRfid && (now - lastAt) < DEDUP) continue;
                        lastRfid = rfid;
                        lastAt = now;
                        console.log('[Kiosk USB] Scanned:', rfid, 'raw:', rawLine.trim());
                        rfidInput.value = rfid;
                        handleScan();
                    }
                }
            } catch (loopErr) {
                if (loopErr && loopErr.name === 'BreakError') {
                    console.log('[Kiosk USB] Reader loop cancelled.');
                    break;
                }
                console.error('[Kiosk USB] Read error:', loopErr);
                showAlert(
                    `USB Read Error\n\nSerial stream crashed mid-read.\n\nRaw error:\n${kioskFormatRawError(loopErr)}\n\n` +
                    'Likely: Arduino lost power or USB cable was jostled. Re-plug and retry.',
                    'warning'
                );
            } finally {
                try { reader.releaseLock(); } catch (e) {}
                if (kioskSerialReader === reader) kioskSerialReader = null;
            }
        }
    } catch (outerErr) {
        console.error('[Kiosk USB] Loop error:', outerErr);
    } finally {
        if (kioskSerialConnected) {
            kioskSerialConnected = false;
            setKioskUsbBtnState(false);
            try { await kioskSerialPort.close(); } catch (e) {}
        }
        kioskSerialPort = null;
    }
}

async function autoConnectKioskUSB() {
    if (!("serial" in navigator)) return;
    try {
        const ports = await navigator.serial.getPorts();
        if (!ports || ports.length === 0) return;
        console.log('[Kiosk USB] Auto-connecting to previously authorized port.');
        const port = ports[0];
        await disconnectKioskUSB();
        kioskSerialPort = port;

        const est = await kioskEstablish(kioskSerialPort);
        if (!est.ok) {
            console.warn('[Kiosk USB] Auto-connect: baud detect failed.');
            try { await kioskSerialPort.close(); } catch (_) {}
            kioskSerialPort = null;
            return;
        }

        kioskSerialConnected = true;
        kioskKeepReading = true;
        setKioskUsbBtnState(true);
        showAlert('RFID reader auto-connected.', 'success');

        port.addEventListener('disconnect', () => {
            kioskSerialConnected = false;
            setKioskUsbBtnState(false);
        });

        const decoder = new TextDecoder();
        let buffer = '';
        let lastRfid = '';
        let lastAt = 0;
        const DEDUP = 1200;
        while (kioskKeepReading && kioskSerialPort && kioskSerialPort.readable) {
            const reader = kioskSerialPort.readable.getReader();
            kioskSerialReader = reader;
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
                        const rfid = kioskExtractRFID(rawLine);
                        if (!rfid) continue;
                        const now = Date.now();
                        if (rfid === lastRfid && (now - lastAt) < DEDUP) continue;
                        lastRfid = rfid;
                        lastAt = now;
                        console.log('[Kiosk USB Auto] Scanned:', rfid);
                        rfidInput.value = rfid;
                        handleScan();
                    }
                }
            } finally {
                try { reader.releaseLock(); } catch (e) {}
            }
        }
    } catch (e) {
        console.warn('[Kiosk USB] Auto-connect skipped:', e?.message || e);
    }
}

function showAlert(msg, type) {
    statusMessage.className = `alert alert-${type} alert-dismissible fade show`;
    statusMessage.style.display = 'block';
    messageContent.textContent = msg;
    
    setTimeout(() => {
        statusMessage.style.display = 'none';
    }, 5000);
}

async function handleScan(e) {
    if(e) e.preventDefault();
    const rfid = rfidInput.value.trim();
    if(!rfid) return;

    rfidIcon.classList.add('scanning');
    submitBtn.disabled = true;

    try {
        const formData = new FormData();
        formData.append('rfid', rfid);

        const response = await fetch('../api.php?action=rfid_login', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();

        if (result.status === 'success') {
            const type = result.action === 'checkin' ? 'success' : 'warning';
            showAlert(result.message, type);
            
            if (result.action === 'checkin' && result.redirect) {
                const newTab = window.open('../' + result.redirect, '_blank');
                if (!newTab || newTab.closed || typeof newTab.closed == 'undefined') {
                    messageContent.innerHTML = `${result.message} <br> <a href="../${result.redirect}" target="_blank" class="alert-link">Open Dashboard</a>`;
                }
            }
        } else {
            showAlert(result.message, 'danger');
        }
    } catch (error) {
        showAlert('Communication error with server.', 'danger');
    } finally {
        rfidInput.value = '';
        rfidIcon.classList.remove('scanning');
        submitBtn.disabled = false;
        rfidInput.focus();
    }
}

rfidForm.addEventListener('submit', handleScan);
rfidInput.addEventListener('change', () => {
    if(rfidInput.value.length > 0) handleScan();
});

let rfidScanTimer = null;
function scheduleHandleScan() {
    clearTimeout(rfidScanTimer);
    rfidScanTimer = setTimeout(() => {
        const value = rfidInput.value.trim();
        if (value) handleScan();
    }, 250);
}
rfidInput.addEventListener('input', scheduleHandleScan);

// Hardware bridge: Poll for recent hardware scans
let lastHandledTime = 0;
async function pollHardware() {
    try {
        const res = await fetch('../api.php?action=get_last_scan');
        const data = await res.json();
        
        console.log('[RFID Kiosk Poll] Response:', data);
        
        if (data.status === 'success' && data.rfid && data.time > lastHandledTime) {
            console.log('[RFID Kiosk Poll] New scan detected:', data.rfid);
            lastHandledTime = data.time;
            
            // Direct API call to process RFID login
            try {
                console.log('[RFID Kiosk Poll] Sending RFID login');
                rfidIcon.classList.add('scanning');
                
                const formData = new FormData();
                formData.append('rfid', data.rfid);
                
                const response = await fetch('../api.php?action=rfid_login', {
                    method: 'POST',
                    body: formData
                });
                const result = await response.json();
                console.log('[RFID Kiosk Poll] API Response:', result);
                
                if (result.status === 'success') {
                    const type = result.action === 'checkin' ? 'success' : 'warning';
                    showAlert(result.message, type);
                    
                    if (result.action === 'checkin' && result.redirect) {
                        setTimeout(() => {
                            const newTab = window.open('../' + result.redirect, '_blank');
                            if (!newTab || newTab.closed || typeof newTab.closed == 'undefined') {
                                messageContent.innerHTML = `${result.message} <br> <a href="../${result.redirect}" target="_blank" class="alert-link">Open Dashboard</a>`;
                            }
                        }, 500);
                    }
                } else {
                    showAlert(result.message, 'danger');
                }
            } catch (apiError) {
                console.error('[RFID Kiosk Poll] API Error:', apiError);
                showAlert('Communication error with server.', 'danger');
            } finally {
                rfidIcon.classList.remove('scanning');
            }
        }
    } catch (e) {
        console.error('[RFID Kiosk Poll] Fetch Error:', e);
    }
}

setInterval(pollHardware, 2000); // Check every 2 seconds

document.addEventListener('DOMContentLoaded', () => {
    const kioskUsbBtn = document.getElementById('kioskUsbBtn');
    if (kioskUsbBtn) kioskUsbBtn.addEventListener('click', connectKioskUSB);
    autoConnectKioskUSB();
});

document.addEventListener('click', () => rfidInput.focus());