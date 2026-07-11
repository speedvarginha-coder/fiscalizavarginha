const gracefulFs = require('graceful-fs');
const realFs = require('fs');
gracefulFs.gracefulify(realFs);

const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const http = require('http'); // Importado para comunicação Master/Réplica
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PRIVATE_PORT = 59876;
const ELECTION_RETRY_MS = 5000;
let isMaster = false;
let electionTimeout = null;

// Função de proxy usando módulo http nativo
function proxyRequestToMaster(req, res, targetUrl) {
    const url = new URL(targetUrl);
    const options = {
        hostname: url.hostname,
        port: url.port,
        path: req.originalUrl,
        method: req.method,
        headers: { ...req.headers }
    };
    delete options.headers['host'];
    
    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
    });
    
    proxyReq.on('error', (err) => {
        console.error('Erro de proxy para o Master:', err.message);
        res.status(502).json({ error: 'Erro de comunicação interna entre instâncias.' });
    });
    
    if (req.body && Object.keys(req.body).length > 0) {
        const bodyStr = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyStr));
        proxyReq.write(bodyStr);
    } else {
        req.pipe(proxyReq, { end: true });
    }
}

// Middleware para proxy de requisições de Réplicas para o Master
app.use((req, res, next) => {
    if (!isMaster && req.socket.localPort !== PRIVATE_PORT) {
        return proxyRequestToMaster(req, res, `http://127.0.0.1:${PRIVATE_PORT}`);
    }
    next();
});

const PORT = 8080;
const HOST = process.env.HOST || '127.0.0.1';
const MIN_API_KEY_LENGTH = 48;
const API_KEY = (() => {
    let key = process.env.WHATSAPP_API_KEY?.trim();
    if (!key) {
        try {
            key = fs.readFileSync(path.join(__dirname, '.apikey'), 'utf8').trim();
        } catch (err) {
            // A mensagem deliberadamente não inclui caminhos ou valores sensíveis.
        }
    }

    if (!key || key.length < MIN_API_KEY_LENGTH) {
        console.error(`WHATSAPP_API_KEY ou .apikey deve conter uma chave nova com pelo menos ${MIN_API_KEY_LENGTH} caracteres.`);
        process.exit(1);
    }
    return key;
})();
const CSRF_TOKEN = crypto.randomBytes(32).toString('base64url');

let sock = null;
let qrCodeDataUrl = null;
let connectionStatus = 'Desconectado';
let groupsList = [];
let reconnectTimeout = null;
let isConnecting = false;

// Auth state directory
const AUTH_DIR = path.join(__dirname, 'auth_info');

async function cleanupSocket() {
    if (sock) {
        console.log('Limpando socket anterior e removendo listeners...');
        try {
            sock.ev.removeAllListeners('connection.update');
            sock.ev.removeAllListeners('creds.update');
            sock.end();
        } catch (e) {
            // ignorar
        }
        sock = null;
    }
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
}

function scheduleReconnect(delayMs) {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
    reconnectTimeout = setTimeout(() => {
        connectToWhatsApp();
    }, delayMs);
}

async function connectToWhatsApp() {
    if (isConnecting) {
        console.log('Uma tentativa de conexão já está em andamento. Ignorando...');
        return;
    }
    isConnecting = true;

    await cleanupSocket();

    try {
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        
        // Busca a versão mais recente para evitar erro 405 Connection Failure
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`Conectando ao WhatsApp com a versão v${version.join('.')}, isLatest: ${isLatest}`);
        
        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            syncFullHistory: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                qrCodeDataUrl = await QRCode.toDataURL(qr);
                connectionStatus = 'Aguardando escaneamento do QR Code';
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const isLoggedOut = statusCode === DisconnectReason.loggedOut;
                console.log('Conexão fechada. Código de status:', statusCode, 'Erro:', lastDisconnect?.error);
                
                qrCodeDataUrl = null;
                connectionStatus = 'Desconectado';
                groupsList = [];

                // Remove listeners do socket antigo para que ele não dispare mais eventos
                if (sock) {
                    try {
                        sock.ev.removeAllListeners('connection.update');
                        sock.ev.removeAllListeners('creds.update');
                    } catch (e) {}
                    sock = null;
                }

                if (isLoggedOut || statusCode === DisconnectReason.badSession) {
                    console.log('Aparelho desconectado ou sessão corrompida. Limpando pasta de autenticação...');
                    try {
                        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                    } catch (err) {
                        console.error('Erro ao limpar pasta de autenticação:', err);
                    }
                    scheduleReconnect(1000);
                } else if (statusCode === DisconnectReason.connectionReplaced) {
                    console.log('Conexão substituída (conflito). Aguardando 15 segundos para evitar loops de conflito...');
                    scheduleReconnect(15000);
                } else {
                    console.log('Reconectando em 5 segundos...');
                    scheduleReconnect(5000);
                }
            } else if (connection === 'open') {
                console.log('Conexão estabelecida com sucesso!');
                qrCodeDataUrl = null;
                connectionStatus = 'Conectado';
                
                // Fetch groups
                try {
                    const getGroups = await sock.groupFetchAllParticipating();
                    groupsList = Object.values(getGroups).map(g => ({
                        id: g.id,
                        subject: g.subject
                    }));
                } catch (err) {
                    console.error('Erro ao buscar grupos:', err);
                }
            }
        });
    } catch (err) {
        console.error('Erro ao conectar ao WhatsApp:', err);
        scheduleReconnect(10000);
    } finally {
        isConnecting = false;
    }
}

// Start WhatsApp Connection
// (Iniciada de forma controlada através da eleição de Master na porta privada)

function safeEqual(candidate, expected) {
    const candidateBuffer = Buffer.from(candidate || '');
    const expectedBuffer = Buffer.from(expected);
    return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

function checkApiKey(req, res, next) {
    const authorization = req.headers.authorization || '';
    let candidate = req.headers.apikey;
    if (authorization.startsWith('Bearer ')) candidate = authorization.slice(7);
    if (authorization.startsWith('Basic ')) {
        try {
            candidate = Buffer.from(authorization.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':');
        } catch (err) {
            candidate = '';
        }
    }

    if (typeof candidate === 'string' && safeEqual(candidate, API_KEY)) {
        return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="WhatsApp Bridge", charset="UTF-8"');
    return res.status(401).json({ error: 'Não autorizado. Chave de API inválida.' });
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
}

// Endpoint compatible with Evolution API v1/v2: POST /message/sendText/:instance
app.post('/message/sendText/:instance', checkApiKey, async (req, res) => {
    const { instance } = req.params;
    const { number, textMessage } = req.body;
    const text = textMessage?.text;

    if (!sock || connectionStatus !== 'Conectado') {
        return res.status(503).json({ error: 'Serviço temporariamente indisponível. WhatsApp não conectado.' });
    }

    if (!number || !text) {
        return res.status(400).json({ error: 'Número de telefone e texto da mensagem são obrigatórios.' });
    }

    try {
        // Ensure destination JID has correct format
        let jid = number;
        if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us')) {
            if (jid.includes('-')) {
                jid = `${jid}@g.us`;
            } else {
                jid = `${jid}@s.whatsapp.net`;
            }
        }

        const response = await sock.sendMessage(jid, { text: text });
        return res.status(200).json({
            key: response.key,
            messageId: response.key.id,
            status: 'success'
        });
    } catch (err) {
        console.error('Erro ao enviar mensagem:', err);
        return res.status(500).json({ error: 'Falha ao enviar mensagem.' });
    }
});

// Serve Dashboard HTML
app.get('/', checkApiKey, (req, res) => {
    let groupsHtml = '';
    if (connectionStatus === 'Conectado') {
        if (groupsList.length === 0) {
            groupsHtml = '<p class="text-muted">Nenhum grupo encontrado ou ainda carregando...</p>';
        } else {
            groupsHtml = `
                <table class="table table-striped table-hover mt-3">
                    <thead>
                        <tr>
                            <th>Nome do Grupo</th>
                            <th>ID do Grupo (JID)</th>
                            <th>Ação</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${groupsList.map(g => `
                            <tr>
                                <td class="fw-bold">${escapeHtml(g.subject)}</td>
                                <td><code>${escapeHtml(g.id)}</code></td>
                                <td>
                                    <button class="btn btn-sm btn-outline-primary copy-group" data-group-id="${escapeHtml(g.id)}">
                                        Copiar ID
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    }

    const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Fiscaliza Varginha - Painel WhatsApp</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <style>
            body { background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
            .card { border-radius: 12px; border: none; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
            .status-badge { font-size: 1rem; padding: 0.5em 1em; border-radius: 20px; }
            .qr-container { max-width: 300px; margin: 0 auto; background: white; padding: 15px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            code { background-color: #f1f3f5; padding: 0.2em 0.4em; border-radius: 4px; font-family: monospace; }
        </style>
    </head>
    <body>
        <div class="container py-5">
            <div class="row justify-content-center">
                <div class="col-md-8">
                    <div class="card p-4 mb-4 text-center">
                        <h2 class="mb-3 text-primary fw-bold">Fiscaliza Varginha 🤖</h2>
                        <h4 class="mb-4 text-secondary">Painel de Integração do WhatsApp (Grátis & Local)</h4>
                        
                        <div class="mb-4">
                            Status da Conexão: 
                            <span class="badge status-badge ${connectionStatus === 'Conectado' ? 'bg-success' : (connectionStatus === 'Desconectado' ? 'bg-danger' : 'bg-warning text-dark')}">
                                ${escapeHtml(connectionStatus)}
                            </span>
                            <button class="btn btn-outline-danger btn-sm ms-3" onclick="resetConnection()">
                                🔄 Resetar Conexão
                            </button>
                        </div>

                        ${qrCodeDataUrl ? `
                            <div class="my-4">
                                <p class="lead">Abra o seu WhatsApp no celular, vá em <strong>Aparelhos Conectados</strong> e escaneie o código abaixo:</p>
                                <div class="qr-container my-3">
                                    <img src="${escapeHtml(qrCodeDataUrl)}" alt="QR Code" class="img-fluid">
                                </div>
                                <p class="text-muted small">O código é atualizado automaticamente se expirar.</p>
                            </div>
                        ` : ''}

                        ${connectionStatus === 'Conectado' ? `
                            <div class="alert alert-success my-3">
                                🚀 <strong>Conectado com sucesso!</strong> O robô está pronto para disparar mensagens.
                            </div>
                        ` : ''}

                        <hr class="my-4">
                        
                        <div class="text-start">
                            <h5 class="fw-bold">1. Configuração do Canal</h5>
                            <p>Após conectar, copie o ID do seu grupo abaixo e cole no campo <code>group_id</code> do seu arquivo <code>private/whatsapp_config.json</code>:</p>
                            
                            ${connectionStatus === 'Conectado' ? groupsHtml : `
                                <div class="alert alert-info">
                                    Conecte o seu WhatsApp acima para listar os seus grupos e copiar o identificador correto.
                                </div>
                            `}
                        </div>
                    </div>
                    
                    <div class="card p-4">
                        <h5 class="fw-bold text-secondary mb-3">Instruções de Execução</h5>
                        <p>Este painel roda localmente no seu computador. Para iniciar e parar o serviço, use o arquivo <code>iniciar-whatsapp.bat</code> na pasta raiz do projeto.</p>
                        <p class="text-muted small mb-0">Desenvolvido com carinho para o Fiscaliza Varginha (Custo Zero de API).</p>
                    </div>
                </div>
            </div>
        </div>

        <script>
            const csrfToken = ${JSON.stringify(CSRF_TOKEN)};
            function copyToClipboard(text) {
                navigator.clipboard.writeText(text).then(() => {
                    alert('ID do grupo copiado para a área de transferência: ' + text);
                }).catch(err => {
                    console.error('Erro ao copiar:', err);
                });
            }
            
            function resetConnection() {
                if (confirm('Tem certeza que deseja resetar a conexão? Isso limpará a sessão atual e gerará um novo QR Code.')) {
                    fetch('/reset-connection', {
                        method: 'POST',
                        headers: { 'X-CSRF-Token': csrfToken }
                    })
                        .then(res => res.json())
                        .then(data => {
                            alert(data.message);
                            window.location.reload();
                        })
                        .catch(err => {
                            console.error('Erro ao resetar:', err);
                            alert('Erro ao resetar conexão.');
                        });
                }
            }

            document.querySelectorAll('.copy-group').forEach(button => {
                button.addEventListener('click', () => copyToClipboard(button.dataset.groupId));
            });
            
            // Auto reload to update QR or status
            setTimeout(() => {
                window.location.reload();
            }, 5000);
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// Endpoint to reset the WhatsApp connection
app.post('/reset-connection', checkApiKey, async (req, res) => {
    if (!safeEqual(req.headers['x-csrf-token'], CSRF_TOKEN)) {
        return res.status(403).json({ error: 'Token CSRF inválido.' });
    }
    console.log('Solicitação de reset de conexão recebida.');
    
    await cleanupSocket();
    
    try {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        console.log('Pasta auth_info removida com sucesso.');
    } catch (err) {
        console.error('Erro ao remover pasta auth_info:', err);
    }

    connectionStatus = 'Desconectado';
    qrCodeDataUrl = null;
    groupsList = [];

    scheduleReconnect(1000);

    res.json({ success: true, message: 'Conexão resetada com sucesso. Aguarde o novo QR Code.' });
});

// Get groups API for debugging
app.get('/groups', checkApiKey, (req, res) => {
    res.json(groupsList);
});

// Start Passenger listener
const mainPort = process.env.PORT || PORT;
app.listen(mainPort, HOST, () => {
    console.log(`Servidor HTTP ativo em ${HOST}:${mainPort}`);
});

// Try to bind private Master port. Replicas keep retrying so one of them
// automatically takes over if the current Master is terminated.
const privateServer = http.createServer(app);

function scheduleMasterElection(delayMs = ELECTION_RETRY_MS) {
    if (isMaster || electionTimeout) return;

    electionTimeout = setTimeout(() => {
        electionTimeout = null;
        attemptMasterElection();
    }, delayMs);
}

function attemptMasterElection() {
    if (isMaster || privateServer.listening) return;

    try {
        privateServer.listen(PRIVATE_PORT, '127.0.0.1');
    } catch (err) {
        console.error('Erro ao tentar eleger o Master:', err);
        scheduleMasterElection();
    }
}

privateServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        // Outro worker já é Master: viramos réplica e encaminhamos a ele.
        console.log(`[Replica] Porta privada ${PRIVATE_PORT} ocupada. Rodando como RÉPLICA passiva.`);
        isMaster = false;
        scheduleMasterElection();
    } else {
        // Não é conflito de porta (ex.: host bloqueia bind em 127.0.0.1).
        // Fallback seguro: assume Master SEM porta privada e conecta direto.
        // Assim o pior caso degrada para "todos conectam" (comportamento
        // pré-eleição) em vez de deixar todo mundo como réplica órfã -> 502.
        console.warn(`[Fallback] Nao foi possivel abrir a porta privada (${err.code}). Assumindo Master direto, sem eleicao.`);
        isMaster = true;
        if (electionTimeout) { clearTimeout(electionTimeout); electionTimeout = null; }
        connectToWhatsApp();
    }
});

privateServer.on('listening', () => {
    console.log(`[Master] Porta privada ${PRIVATE_PORT} alocada. Rodando como MASTER ativa.`);
    isMaster = true;
    if (electionTimeout) {
        clearTimeout(electionTimeout);
        electionTimeout = null;
    }
    connectToWhatsApp();
});

attemptMasterElection();
