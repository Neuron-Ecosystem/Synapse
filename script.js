// --- Конфигурация WebRTC ---
// Используем публичные STUN-серверы для обнаружения IP-адресов
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

let peerConnection;
let dataChannel;
let isInitiator = false;

// --- Конфигурация E2EE ---
let encryptionKey; 
const ENCRYPTION_ALGO = 'AES-GCM'; 
const KEY_LENGTH = 256; 
const IV_LENGTH = 12; // Вектор инициализации (Initialization Vector)

// --- DOM-элементы ---
const $statusText = document.getElementById('conn-state');
const $chatWindow = document.getElementById('chat-window');
const $offerSdp = document.getElementById('offer-sdp');
const $remoteSdp = document.getElementById('remote-sdp');
const $messageInput = document.getElementById('message-input');

// --- Функции для E2EE ---

/** Генерация ключа шифрования (простой вариант для демо) */
async function deriveEncryptionKey() {
    encryptionKey = await crypto.subtle.generateKey(
        { name: ENCRYPTION_ALGO, length: KEY_LENGTH },
        true, // key exportable
        ['encrypt', 'decrypt']
    );
    
    updateStatus('E2EE Активно: Ключ сгенерирован', '#00ff7f');
}

/** Шифрование текста сообщения */
async function encryptMessage(text) {
    if (!encryptionKey) {
        // Если ключа нет, отправляем предупреждение вместо текста
        return "[E2EE_ERROR: NO KEY]"; 
    }
    
    const encoded = new TextEncoder().encode(text);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH)); 
    
    const ciphertext = await crypto.subtle.encrypt(
        { name: ENCRYPTION_ALGO, iv: iv },
        encryptionKey,
        encoded
    );
    
    // Объединяем IV и зашифрованный текст
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    
    // Передаем зашифрованные данные как Base64 (текст)
    return btoa(String.fromCharCode.apply(null, combined));
}

/** Дешифрование полученного текста сообщения */
async function decryptMessage(base64Text) {
    if (!encryptionKey) return base64Text;
    
    try {
        // Преобразование Base64 обратно в ArrayBuffer
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
        return "[СООБЩЕНИЕ НЕ МОЖЕТ БЫТЬ ДЕШИФРОВАНО]";
    }
}


// --- Функции для чата и интерфейса ---

/** Добавляет сообщение в окно чата */
function appendMessage(text, type) {
    const msgElement = document.createElement('div');
    msgElement.classList.add('message', type);
    msgElement.textContent = text;
    $chatWindow.appendChild(msgElement);
    $chatWindow.scrollTop = $chatWindow.scrollHeight; 
}

/** Отправляет сообщение через P2P-канал */
window.sendMessage = async function() {
    const message = $messageInput.value.trim();
    if (message && dataChannel && dataChannel.readyState === 'open') {
        
        // ШИФРОВАНИЕ исходящего сообщения
        const encryptedMessage = await encryptMessage(message);
        dataChannel.send(encryptedMessage);
        
        appendMessage(message, 'local'); 
        $messageInput.value = '';
    } else if (message) {
        appendMessage('Система: Соединение P2P еще не открыто.', 'system-message');
    }
}

/** Обновляет статус соединения на экране */
function updateStatus(text, color = '#66ccff') {
    $statusText.textContent = text;
    $statusText.style.color = color;
}

// --- Функции WebRTC ---

/** Устанавливает обработчики для канала данных */
function setupDataChannel(channel) {
    channel.onopen = () => {
        updateStatus('Соединение P2P установлено! (открыто)', '#00ff7f'); 
        appendMessage('*** Соединение установлено ***', 'system-message');
    };

    channel.onmessage = async (event) => {
        // ДЕШИФРОВАНИЕ входящего сообщения
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
    
    // Сбор ICE-кандидатов
    peerConnection.onicecandidate = (event) => {
        if (!event.candidate) {
            // Сбор завершен. Выводим Offer/Answer.
            const sdp = JSON.stringify(peerConnection.localDescription);
            $offerSdp.value = sdp;
            updateStatus(isInitiator ? 'Offer готов. Скопируйте.' : 'Answer готов. Скопируйте.');
        }
    };

    // Обработчик получения удаленного канала данных (для Получателя)
    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel(dataChannel);
    };

    // Обновление состояния соединения
    peerConnection.oniceconnectionstatechange = async () => {
        if (peerConnection.iceConnectionState === 'connected') {
            updateStatus('Соединение установлено!');
            // Генерация ключа после установления соединения
            if (!encryptionKey) {
                await deriveEncryptionKey();
            }
        } else {
             updateStatus('Состояние ICE: ' + peerConnection.iceConnectionState);
        }
    };
}

// --- Обработчики кнопок ---

/** Создает Offer (Вызывается Пользователем А) */
window.createOffer = async function() {
    isInitiator = true;
    initializePeerConnection();
    
    dataChannel = peerConnection.createDataChannel('chat');
    setupDataChannel(dataChannel);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    updateStatus('Создание Offer...');
}

/** Обрабатывает Offer или Answer (Вызывается Пользователем А и Б) */
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

        await peerConnection.setRemoteDescription(remoteDescription);

        if (remoteDescription.type === 'offer') {
            // Если это Offer, мы - Получатель и должны создать Answer
            updateStatus('Получено Offer. Создаем Answer...');
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
        } else if (remoteDescription.type === 'answer') {
            updateStatus('Получено Answer. Установка соединения...');
        }
        
        $remoteSdp.value = ''; 
        $offerSdp.select(); 
        
    } catch (e) {
        alert('Ошибка при обработке SDP. Проверьте JSON.');
        console.error('Ошибка SDP:', e);
    }
}
