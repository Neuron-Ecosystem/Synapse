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

// Получение DOM-элементов
const $statusText = document.getElementById('conn-state');
const $chatWindow = document.getElementById('chat-window');
const $offerSdp = document.getElementById('offer-sdp');
const $remoteSdp = document.getElementById('remote-sdp');
const $messageInput = document.getElementById('message-input');

// --- Функции для чата и интерфейса ---

/** Добавляет сообщение в окно чата */
function appendMessage(text, type) {
    const msgElement = document.createElement('div');
    msgElement.classList.add('message', type);
    msgElement.textContent = text;
    $chatWindow.appendChild(msgElement);
    $chatWindow.scrollTop = $chatWindow.scrollHeight; // Прокрутка вниз
}

/** Отправляет сообщение через P2P-канал */
function sendMessage() {
    const message = $messageInput.value.trim();
    if (message && dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(message);
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

/** Устанавливает обработчики для канала данных (открытие/сообщение/закрытие) */
function setupDataChannel(channel) {
    channel.onopen = () => {
        updateStatus('Соединение P2P установлено! (открыто)', '#00ff7f'); // Зеленый
        appendMessage('*** Соединение P2P установлено ***', 'system-message');
    };

    channel.onmessage = (event) => {
        appendMessage(event.data, 'remote');
    };

    channel.onclose = () => {
        updateStatus('Соединение закрыто. Перезагрузите страницу.', '#ff4d4d'); // Красный
        appendMessage('*** Соединение потеряно ***', 'system-message');
    };
}

/** Инициализирует объект RTCPeerConnection */
function initializePeerConnection() {
    // Если соединение уже есть, закрываем его для перезапуска
    if (peerConnection) peerConnection.close();
    
    peerConnection = new RTCPeerConnection(configuration);
    updateStatus('Инициализировано. Сбор ICE-кандидатов...');
    
    // Сбор ICE-кандидатов (информация о подключении)
    peerConnection.onicecandidate = (event) => {
        if (!event.candidate) {
            // Сбор кандидатов завершен. Выводим Offer/Answer.
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
    peerConnection.oniceconnectionstatechange = () => {
        updateStatus('Состояние ICE: ' + peerConnection.iceConnectionState);
    };
}

// --- Обработчики кнопок ---

/** Создает Offer (Вызывается Пользователем А) */
window.createOffer = async function() {
    isInitiator = true;
    initializePeerConnection();
    
    // Создаем канал данных, который будет использоваться для передачи сообщений
    dataChannel = peerConnection.createDataChannel('chat');
    setupDataChannel(dataChannel);

    // Создаем и устанавливаем SDP-предложение
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // SDP Offer будет выведен в onicecandidate
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
            // Если это Offer, мы должны инициализировать соединение
            initializePeerConnection();
        }

        await peerConnection.setRemoteDescription(remoteDescription);
        
        if (remoteDescription.type === 'offer') {
            // Если это Offer, мы - Получатель и должны создать Answer
            updateStatus('Получено Offer. Создаем Answer...');
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            // Answer будет выведен в onicecandidate для ручной отправки
        } else if (remoteDescription.type === 'answer') {
            // Если это Answer, мы - Инициатор и соединение должно установиться
            updateStatus('Получено Answer. Установка соединения...');
        }
        
        $remoteSdp.value = ''; // Очищаем поле
        $offerSdp.select(); // Выделяем наш SDP для удобства копирования
        
    } catch (e) {
        alert('Ошибка при обработке SDP. Проверьте JSON.');
        console.error('Ошибка SDP:', e);
    }
}
