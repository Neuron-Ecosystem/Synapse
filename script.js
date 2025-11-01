// --- Конфигурация WebRTC (Расширенный список STUN-серверов) ---
const configuration = {
    iceServers: [
        // Основные STUN-серверы Google
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        // Дополнительные публичные STUN-серверы для надежности
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.nextcloud.com:443' },
        { urls: 'stun:stunserver.org:3478' }
    ]
};

let peerConnection;
let dataChannel;
let isInitiator = false;

// --- Конфигурация E2EE ---
let encryptionKey; 
const ENCRYPTION_ALGO = 'AES-GCM'; 
const KEY_LENGTH = 256; 
const IV_LENGTH = 12;

// --- Конфигурация Diffie-Hellman Key Exchange ---
let dhKeyPair; 
const DH_ALGO = 'ECDH';
// Мы используем кривую P-256 в generateDhKeyPair
// --- DOM-элементы ---
const $statusText = document.getElementById('conn-state');
const $chatWindow = document.getElementById('chat-window');
const $offerSdp = document.getElementById('offer-sdp');
const $remoteSdp = document.getElementById('remote-sdp');
const $messageInput = document.getElementById('message-input');


// --- Функции для E2EE (Diffie-Hellman) ---

/** Шаг 1: Генерирует локальную пару DH-ключей */
async function generateDhKeyPair() {
    dhKeyPair = await crypto.subtle.generateKey(
        {
            name: DH_ALGO,
            namedCurve: 'P-256',
        },
        true,
        ['deriveKey']
    );
    updateStatus('DH-ключи сгенерированы. Готов к обмену.', '#ffcc00');
}

/** Шаг 2: Создает общий секретный ключ (EncryptionKey) */
async function deriveEncryptionKey(remotePublicKey) {
    if (!dhKeyPair) {
        throw new Error("Local DH key pair not generated.");
    }
    
    // Импорт публичного ключа собеседника
    const remoteKey = await crypto.subtle.importKey(
        'jwk',
        remotePublicKey,
        { name: DH_ALGO, namedCurve: 'P-256' },
        false,
        [] 
    );

    // Выведение общего секретного ключа (shared secret)
    const sharedSecret = await crypto.subtle.deriveKey(
        {
            name: DH_ALGO,
            public: remoteKey,
        },
        dhKeyPair.privateKey,
        {
            name: ENCRYPTION_ALGO,
            length: KEY_LENGTH,
        },
        true,
        ['encrypt', 'decrypt']
    );
    
    encryptionKey = sharedSecret;
    updateStatus('E2EE АКТИВНО! Соединение установлено.', '#00ff7f');
}

/** Шифрование текста сообщения */
async function encryptMessage(text) {
    if (!encryptionKey) {
        return "[E2EE_ERROR: NO KEY]"; 
    }
    
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
    
    // Передаем как Base64 (текст)
    return btoa(String.fromCharCode.apply(null, combined));
}

/** Дешифрование полученного текста сообщения */
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

/** Копирует сгенерированный SDP/JSON в буфер обмена */
window.copySdp = function() {
    $offerSdp.select();
    $offerSdp.setSelectionRange(0, 99999); 
    try {
        navigator.clipboard.writeText($offerSdp.value)
            .then(() => {
                updateStatus('JSON скопирован в буфер обмена. Отправьте собеседнику!', '#00ff7f');
            })
            .catch(err => {
                // Fallback для старых/мобильных браузеров
                document.execCommand('copy');
                updateStatus('JSON скопирован (через fallback). Отправьте собеседнику!', '#00ff7f');
            });
    } catch (err) {
        // Финальный fallback
        document.execCommand('copy');
        updateStatus('JSON скопирован (через fallback). Отправьте собеседнику!', '#00ff7f');
    }
};

// --- Функции WebRTC ---

function setupDataChannel(channel) {
    channel.onopen = async () => {
        updateStatus('Соединение P2P установлено! (открыто)', '#00ff7f'); 
        appendMessage('*** Соединение установлено ***', 'system-message');
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
    
    // Только логирование ICE-кандидатов
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log("ICE Candidate collected: ", event.candidate);
        } else {
            console.log("ICE Candidate collection finished.");
        }
    };

    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel(dataChannel);
    };

    peerConnection.oniceconnectionstatechange = async () => {
        updateStatus('Состояние ICE: ' + peerConnection.iceConnectionState);
    };
}

// --- Обработчики кнопок ---

/** Создает Offer (Вызывается Пользователем А) */
window.createOffer = async function() {
    isInitiator = true;
    initializePeerConnection();
    
    // 1. Генерируем DH ключи
    await generateDhKeyPair();
    
    dataChannel = peerConnection.createDataChannel('chat');
    setupDataChannel(dataChannel);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer); 
    
    updateStatus('Создание Offer...');

    // Таймаут для сбора кандидатов и вывода SDP + DH Public Key
    setTimeout(async () => {
        if (peerConnection.localDescription) {
             const dhPublicKey = await crypto.subtle.exportKey('jwk', dhKeyPair.publicKey);
             
             const transferObject = {
                 sdp: peerConnection.localDescription,
                 dhKey: dhPublicKey,
             };

             $offerSdp.value = JSON.stringify(transferObject, null, 2); 
             updateStatus('Offer + DH Key готов. Скопируйте.');
        } else {
             updateStatus('Ошибка: Не удалось создать Offer. Повторите попытку.', 'red');
        }
    }, 1500); 
}

/** Обрабатывает Offer или Answer (Вызывается Пользователем А и Б) */
window.processSdp = async function() {
    const sdpValue = $remoteSdp.value.trim();
    if (!sdpValue) {
        alert('Пожалуйста, вставьте Offer/Answer JSON.');
        return;
    }
    
    try {
        const transferObject = JSON.parse(sdpValue);
        const remoteDescription = transferObject.sdp;
        const remoteDhKey = transferObject.dhKey;
        
        if (!peerConnection) {
            initializePeerConnection();
        }
        
        await peerConnection.setRemoteDescription(remoteDescription);

        if (remoteDescription.type === 'offer') {
            // Если это Offer, мы - Получатель
            updateStatus('Получено Offer. Создаем Answer и общий ключ...');
            
            // 1. Генерируем свои DH ключи
            await generateDhKeyPair();
            
            // 2. Вычисляем общий секретный ключ (E2EE)
            await deriveEncryptionKey(remoteDhKey);

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer); 
            
            // 3. Выводим Answer + НАШ публичный DH ключ
            setTimeout(async () => {
                 const dhPublicKey = await crypto.subtle.exportKey('jwk', dhKeyPair.publicKey);
                 const answerObject = {
                     sdp: peerConnection.localDescription,
                     dhKey: dhPublicKey,
                 };
                 $offerSdp.value = JSON.stringify(answerObject, null, 2);
                 updateStatus('Answer + DH Key готов. Скопируйте и отправьте.');
            }, 1500);
            
        } else if (remoteDescription.type === 'answer') {
            // Если это Answer, мы - Инициатор
            updateStatus('Получено Answer. Установка соединения...');

            // Вычисляем общий секретный ключ (E2EE)
            await deriveEncryptionKey(remoteDhKey);
        }
        
        $remoteSdp.value = ''; // Очищаем поле ввода!
        $offerSdp.select(); 
        
    } catch (e) {
        alert('Ошибка при обработке JSON/ключей. Убедитесь, что скопирован полный JSON-объект. Ошибка: ' + e.message);
        console.error('Ошибка SDP/DH:', e);
    }
}
