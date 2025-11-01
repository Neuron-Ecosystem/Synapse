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

const $status = document.getElementById('connection-status');
const $chatWindow = document.getElementById('chat-window');
const $offerSdp = document.getElementById('offer-sdp');
const $remoteSdp = document.getElementById('remote-sdp');
const $messageInput = document.getElementById('message-input');

// --- Функции для чата ---

function appendMessage(message, type) {
    const msgElement = document.createElement('div');
    msgElement.classList.add('message', type);
    msgElement.textContent = message;
    $chatWindow.appendChild(msgElement);
    $chatWindow.scrollTop = $chatWindow.scrollHeight; // Прокрутка вниз
}

function sendMessage() {
    const message = $messageInput.value;
    if (message && dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(message);
        appendMessage('Я: ' + message, 'local');
        $messageInput.value = '';
    } else if (message) {
        appendMessage('Ошибка: Соединение еще не установлено.', 'remote');
    }
}

// --- Функции WebRTC ---

function initializePeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);
    $status.textContent = 'Инициализировано. Ожидание ICE-кандидатов...';
    
    // 1. Сбор ICE-кандидатов (информация о подключении)
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            // ICE-кандидаты отправляются вместе с Offer/Answer, поэтому нам не нужно отправлять их отдельно
            // Мы просто ждем, пока все соберутся
            console.log('Собрали ICE-кандидата:', event.candidate);
        } else {
            console.log('Сбор ICE-кандидатов завершен.');
            if (isInitiator) {
                // Если мы создали Offer, выводим его для ручной отправки
                $offerSdp.value = JSON.stringify(peerConnection.localDescription);
                $status.textContent = 'Offer готов. Скопируйте его.';
            } else if (peerConnection.localDescription.type === 'answer') {
                 // Если мы создали Answer, выводим его для ручной отправки
                 $offerSdp.value = JSON.stringify(peerConnection.localDescription);
                 $status.textContent = 'Answer готов. Скопируйте и отправьте его.';
            }
        }
    };

    // 2. Обработчик для удаленного канала данных (Data Channel)
    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel(dataChannel);
    };

    // 3. Обработчик смены состояния соединения
    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'connected') {
            $status.textContent = 'Соединение установлено!';
        } else {
             $status.textContent = 'Состояние соединения: ' + peerConnection.iceConnectionState;
        }
    };
}

function setupDataChannel(channel) {
    channel.onopen = () => {
        $status.textContent = 'Соединение P2P установлено! Можно общаться.';
        appendMessage('*** Соединение установлено ***', 'remote');
    };

    channel.onmessage = (event) => {
        appendMessage('Собеседник: ' + event.data, 'remote');
    };

    channel.onclose = () => {
        $status.textContent = 'Соединение закрыто.';
        appendMessage('*** Соединение потеряно ***', 'remote');
    };
}

// --- Обработчики кнопок ---

// Функция 1: Пользователь создает предложение (Offer)
async function createOffer() {
    isInitiator = true;
    initializePeerConnection();
    
    // Создаем канал данных, который будет использоваться для передачи сообщений
    dataChannel = peerConnection.createDataChannel('chat');
    setupDataChannel(dataChannel);

    // Создаем SDP-предложение
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // Offer будет выведен в onicecandidate, когда все ICE-кандидаты будут собраны
}

// Функция 2: Обработка Offer или Answer от собеседника
async function processSdp() {
    const sdpValue = $remoteSdp.value;
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
            // Если это Offer, мы должны создать Answer
            $status.textContent = 'Получено Offer. Создаем Answer...';
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            // Answer будет выведен в onicecandidate для ручной отправки
        }

        // Очищаем поле для удобства
        $remoteSdp.value = '';

    } catch (e) {
        alert('Ошибка при обработке SDP. Убедитесь, что JSON скопирован полностью. Ошибка: ' + e.message);
        console.error(e);
    }
}
