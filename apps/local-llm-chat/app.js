const messagesContainer = document.getElementById('messages');
const inputForm = document.getElementById('input-form');
const inputText = document.getElementById('input-text');
const sendBtn = document.getElementById('send-btn');
const modelSelect = document.getElementById('model-select');
const serverUrlInput = document.getElementById('server-url');
const clearBtn = document.getElementById('clear-btn');
const statusDiv = document.getElementById('status');

const STORAGE_KEY = 'llm-chat-history';

let isWaiting = false;

function initChat() {
    loadChatHistory();
    updateStatus('準備完了');
    inputText.focus();
}

function saveChatHistory() {
    const messages = [];
    document.querySelectorAll('.message').forEach(msg => {
        const isUser = msg.classList.contains('user');
        const content = msg.querySelector('.message-content')?.textContent || '';
        messages.push({ role: isUser ? 'user' : 'assistant', content });
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
}

function loadChatHistory() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const messages = JSON.parse(saved);
            messages.forEach(msg => {
                displayMessage(msg.content, msg.role === 'user');
            });
        } catch (e) {
            console.error('Failed to load chat history:', e);
        }
    }
}

function displayMessage(text, isUser) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', isUser ? 'user' : 'bot');

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    contentDiv.textContent = text;

    msgDiv.appendChild(contentDiv);
    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function displayLoading() {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', 'bot');
    msgDiv.id = 'loading-indicator';

    const loadingDiv = document.createElement('div');
    loadingDiv.classList.add('loading');
    loadingDiv.innerHTML = '<span></span><span></span><span></span>';

    msgDiv.appendChild(loadingDiv);
    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function removeLoading() {
    const loading = document.getElementById('loading-indicator');
    if (loading) {
        loading.remove();
    }
}

function getServerUrl() {
    let url = serverUrlInput.value.trim();
    if (!url) {
        url = 'http://localhost:11434';
        serverUrlInput.value = url;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'http://' + url;
    }
    return url.replace(/\/$/, '');
}

async function callOllamaAPI(message, model) {
    const serverUrl = getServerUrl();
    const url = `${serverUrl}/api/generate`;

    try {
        updateStatus(`接続中: ${serverUrl}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model,
                prompt: message,
                stream: true,
            }),
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        updateStatus('応答中...');
        displayLoading();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        const msgDiv = document.getElementById('loading-indicator');

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim());

            for (const line of lines) {
                try {
                    const json = JSON.parse(line);
                    if (json.response) {
                        fullResponse += json.response;

                        if (!msgDiv.querySelector('.message-content')) {
                            msgDiv.innerHTML = '';
                            msgDiv.removeAttribute('id');
                            const contentDiv = document.createElement('div');
                            contentDiv.classList.add('message-content');
                            msgDiv.appendChild(contentDiv);
                        }

                        const contentDiv = msgDiv.querySelector('.message-content');
                        contentDiv.textContent = fullResponse;
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    }

                    if (json.done) {
                        updateStatus('準備完了');
                        saveChatHistory();
                    }
                } catch (e) {
                    console.error('Failed to parse JSON:', e);
                }
            }
        }

        if (!fullResponse) {
            removeLoading();
            updateStatus('エラー: 応答がありません');
        }

    } catch (error) {
        console.error('API Error:', error);
        removeLoading();
        displayMessage(`エラー: ${error.message}`, false);
        updateStatus(`エラー: ${error.message}`);
    }
}

async function sendMessage() {
    const message = inputText.value.trim();
    if (!message || isWaiting) return;

    isWaiting = true;
    sendBtn.disabled = true;

    displayMessage(message, true);
    inputText.value = '';

    const model = modelSelect.value;

    try {
        await callOllamaAPI(message, model);
    } finally {
        isWaiting = false;
        sendBtn.disabled = false;
        inputText.focus();
    }
}

function clearChat() {
    if (confirm('チャット履歴を削除してもよろしいですか？')) {
        messagesContainer.innerHTML = '';
        localStorage.removeItem(STORAGE_KEY);
        updateStatus('チャットをクリアしました');
    }
}

function updateStatus(message) {
    statusDiv.textContent = message;
}

inputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
});

clearBtn.addEventListener('click', clearChat);

inputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        sendMessage();
    }
});

document.addEventListener('DOMContentLoaded', initChat);
