// --- Конфигурация WebRTC (Расширенный список серверов) ---
const configuration = {
    iceServers: [
        // Бесплатные STUN-серверы Google (основной)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // Дополнительные публичные STUN-серверы для надежности
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.nextcloud.com:443' },
        { urls: 'stun:stunserver.org:3478' }
    ]
};

let peerConnection;
let dataChannel;
let isInitiator = false;

// ... (Остальные переменные и функции E2EE остаются прежними) ...

let encryptionKey; 
const ENCRYPTION_ALGO = 'AES-GCM'; 
const KEY_LENGTH = 256; 
const IV_LENGTH = 12;

const $statusText = document.getElementById('conn-state');
const $chatWindow = document.getElementById('chat-window');
const $offerSdp = document.getElementById('offer-sdp');
const $remoteSdp = document.getElementById('remote-sdp');
const $messageInput = document.getElementById('message-input');

// --- Функции для E2EE (НЕ ИЗМЕНЕНЫ) ---

async function deriveEncryptionKey() {
    encryptionKey = await crypto.subtle.generateKey(
        { name: ENCRYPTION_ALGO, length: KEY_LENGTH },
        true, 
        ['encrypt', 'decrypt']
    );
    updateStatus('E2EE Активно: Ключ сгенерирован', '#00ff7f');
}

async function encryptMessage(text) {
    if (!encryptionKey) {
        return "[E2EE_ERROR: NO KEY]"; 
    }
    // ... (тело функции encryptMessage остается прежним) ...
    const encoded = new TextEncoder().encode(text);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH)); 
    
    const ciphertext = await crypto.subtle.encrypt(
        { name: ENCRYPTION_ALGO, iv: iv },
        encryptionKey,
        encoded
    );
    
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    
    return btoa(String.fromCharCode.apply(null, combined));
}

async function decryptMessage(base64Text) {
    if (!encryptionKey) return base64Text;
    
    try {
        if (base64Text.includes("[E2EE_ERROR: NO KEY]")) {
            throw new Error("Сообщение было отправлено без активного E2EE ключа.");
        }
        
        const combinedBuffer = new Uint8Array(atob(base64Text).split('').map(char => char.charCodeAt(0)));
        
        const iv = combinedBuffer.slice(0, IV_LENGTH);
        const ciphertext = combinedBuffer.slice(IV_LENGTH);
        
        const plaintext = await crypto.subtle.decrypt(
            { name: ENCRYPTION_ALGO, iv: iv },
            encryptionKey,
            ciphertext
        );
        
        return new TextDecoder().decode(plaintext);
    } catch (e) {
        console.error("Ошибка дешифрования:", e);
        return `[СООБЩЕНИЕ НЕ МОЖЕТ БЫТЬ ДЕШИФРОВАНО: ${e.message}]`;
    }
}

// --- Функции для чата и интерфейса (НЕ ИЗМЕНЕНЫ) ---

function appendMessage(text, type) {
    const msgElement = document.createElement('div');
    msgElement.classList.add('message', type);
    msgElement.textContent = text;
    $chatWindow.appendChild(msgElement);
    $chatWindow.scrollTop = $chatWindow.scrollHeight; 
}

window.sendMessage = async function() {
    const message = $messageInput.value.trim();
    if (message && dataChannel && dataChannel.readyState === 'open') {
        const encryptedMessage = await encryptMessage(message);
        dataChannel.send(encryptedMessage);
        
        appendMessage(message, 'local'); 
        $messageInput.value = '';
    } else if (message) {
        appendMessage('Система: Соединение P2P еще не открыто.', 'system-message');
    }
}

function updateStatus(text, color = '#66ccff') {
    $statusText.textContent = text;
    $statusText.style.color = color;
}

// --- Функции WebRTC (ИЗМЕНЕНИЯ) ---

function setupDataChannel(channel) {
    channel.onopen = async () => {
        updateStatus('Соединение P2P установлено! (открыто)', '#00ff7f'); 
        appendMessage('*** Соединение установлено ***', 'system-message');
        
        // Генерация ключа после установления соединения
        if (!encryptionKey) {
            await deriveEncryptionKey();
        }
    };

    channel.onmessage = async (event) => {
        const decryptedMessage = await decryptMessage(event.data);
        appendMessage(decryptedMessage, 'remote');
    };

    channel.onclose = () => {
        updateStatus('Соединение закрыто. Перезагрузите страницу.', '#ff4d4d'); 
        appendMessage('*** Соединение потеряно ***', 'system-message');
    };
}

/** Инициализирует объект RTCPeerConnection */
function initializePeerConnection() {
    if (peerConnection) peerConnection.close();
    
    peerConnection = new RTCPeerConnection(configuration);
    updateStatus('Инициализировано. Сбор ICE-кандидатов...');
    
    // МЫ НЕ ИСПОЛЬЗУЕМ onicecandidate ДЛЯ ВЫВОДА SDP, 
    // чтобы избежать проблем на мобильных. Просто логируем его.
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log("ICE Candidate collected: ", event.candidate);
        } else {
            console.log("ICE Candidate collection finished.");
        }
    };

    // Обработчик получения удаленного канала данных (для Получателя)
    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel(dataChannel);
    };

    // Обновление состояния соединения
    peerConnection.oniceconnectionstatechange = async () => {
        updateStatus('Состояние ICE: ' + peerConnection.iceConnectionState);
    };
}

// --- Обработчики кнопок ---

window.createOffer = async function() {
    isInitiator = true;
    initializePeerConnection();
    
    dataChannel = peerConnection.createDataChannel('chat');
    setupDataChannel(dataChannel);

    const offer = await peerConnection.createOffer();
    // setLocalDescription обязательно вызывается ДО того, как Offer будет отправлен!
    await peerConnection.setLocalDescription(offer); 
    
    updateStatus('Создание Offer...');

    // ИСПРАВЛЕНИЕ: Ждем 1.5 сек для сбора ICE-кандидатов, затем выводим SDP
    setTimeout(() => {
        if (peerConnection.localDescription) {
             const sdp = JSON.stringify(peerConnection.localDescription);
             $offerSdp.value = sdp;
             updateStatus('Offer готов. Скопируйте.');
        } else {
             updateStatus('Ошибка: Не удалось создать Offer. Повторите попытку.', 'red');
        }
    }, 1500); 
}

window.processSdp = async function() {
    const sdpValue = $remoteSdp.value.trim();
    if (!sdpValue) {
        alert('Пожалуйста, вставьте SDP (Offer или Answer) в поле.');
        return;
    }
    
    try {
        const remoteDescription = JSON.parse(sdpValue);
        
        if (!peerConnection) {
            initializePeerConnection();
        }

        // Установка удаленного описания
        await peerConnection.setRemoteDescription(remoteDescription);

        if (remoteDescription.type === 'offer') {
            // Если это Offer, мы - Получатель и должны создать Answer
            updateStatus('Получено Offer. Создаем Answer...');
            
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer); // setLocalDescription для Answer

            // ИСПРАВЛЕНИЕ: Ждем 1.5 сек, затем выводим Answer
            setTimeout(() => {
                 const sdp = JSON.stringify(peerConnection.localDescription);
                 $offerSdp.value = sdp;
                 updateStatus('Answer готов. Скопируйте и отправьте.');
            }, 1500);
            
        } else if (remoteDescription.type === 'answer') {
            updateStatus('Получено Answer. Установка соединения...');
        }
        
        $remoteSdp.value = ''; 
        $offerSdp.select(); 
        
    } catch (e) {
        alert('Ошибка при обработке SDP. Проверьте JSON. Ошибка: ' + e.message);
        console.error('Ошибка SDP:', e);
    }
}
