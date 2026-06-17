<?php
/**
 * Fiscaliza Varginha — chat.php
 * Proxy seguro para Gemini. A chave NUNCA chega ao navegador.
 */

// Rate limit simples via sessão PHP
session_start();
$JANELA = 15 * 60; // 15 minutos
$MAX    = 10;      // máx 10 perguntas por janela

$agora = time();
if (!isset($_SESSION['rl_inicio']) || ($agora - $_SESSION['rl_inicio']) > $JANELA) {
    $_SESSION['rl_inicio'] = $agora;
    $_SESSION['rl_count']  = 0;
}
$_SESSION['rl_count']++;
if ($_SESSION['rl_count'] > $MAX) {
    http_response_code(429);
    header('Content-Type: application/json');
    echo json_encode(['erro' => 'Muitas perguntas em pouco tempo. Aguarde alguns minutos.']);
    exit;
}

// CORS — ajuste para seu domínio se necessário
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['erro' => 'Método não permitido']);
    exit;
}

// Chave da API — coloque no arquivo abaixo (fora do public_html, se possível)
// Ou defina direto aqui: $apiKey = 'AIza...';
$configFile = __DIR__ . '/../gemini_key.php';
if (file_exists($configFile)) {
    require $configFile; // define $apiKey
} else {
    $apiKey = getenv('GEMINI_API_KEY');
}
if (empty($apiKey)) {
    http_response_code(500);
    echo json_encode(['erro' => 'Chave não configurada']);
    exit;
}

// Ler pergunta
$body    = json_decode(file_get_contents('php://input'), true);
$pergunta = trim(substr($body['pergunta'] ?? '', 0, 500));
if (!$pergunta) {
    http_response_code(400);
    echo json_encode(['erro' => 'Pergunta vazia']);
    exit;
}

// Contexto fixo
$contexto = "Você é o assistente do painel Fiscaliza Varginha, uma ferramenta de transparência pública.
Responda SEMPRE em português brasileiro, de forma clara, direta e acessível ao cidadão comum.
Tom: neutro, honesto, sem acusações. Dados são pistas, não provas.
Nunca invente dados. Se não souber, diga que o cidadão deve verificar na fonte oficial.
Mantenha respostas curtas (máx 3 parágrafos). Use bullet points quando ajudar.

DADOS REAIS DE VARGINHA-MG (coletados automaticamente):

PREFEITURA 2026 (jan–jun):
- Total pago a fornecedores externos: R\$ 145.752.084,15
- Contratos ativos: 888
- Obras públicas: 130

Top 5 fornecedores da Prefeitura em 2026:
1. Hospital Regional do Sul de Minas – R\$ 34.049.240,66 (saúde)
2. PAVICAN Pavimentação e Terraplenagem – R\$ 9.627.998,16 (asfalto/obras)
3. Viação Real Transporte Urbano – R\$ 7.939.204,75 (transporte)
4. Varian Medical Systems – R\$ 7.819.347,76 (equipamentos médicos)
5. Unimed – R\$ 5.432.273,38 (saúde)

CÂMARA MUNICIPAL 2026:
- 17 vereadores ativos
- Total gasto: R\$ 5.925.535,01

EMENDAS IMPOSITIVAS (2025, base SAPL):
- 357 emendas registradas
- Total: R\$ 17.841.369,18

LAI — Lei de Acesso à Informação:
- Prazo de resposta: 20 dias úteis
- Canal: e-SIC da Prefeitura de Varginha
- O painel tem 21 modelos prontos de pedido em cobrar.html";

// Chamar Gemini
$payload = json_encode([
    'contents' => [[
        'parts' => [['text' => $contexto . "\n\nPergunta do cidadão: " . $pergunta]]
    ]],
    'generationConfig' => [
        'maxOutputTokens' => 400,
        'temperature'     => 0.3,
    ],
    'safetySettings' => [
        ['category' => 'HARM_CATEGORY_HARASSMENT',        'threshold' => 'BLOCK_MEDIUM_AND_ABOVE'],
        ['category' => 'HARM_CATEGORY_HATE_SPEECH',       'threshold' => 'BLOCK_MEDIUM_AND_ABOVE'],
        ['category' => 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'threshold' => 'BLOCK_MEDIUM_AND_ABOVE'],
        ['category' => 'HARM_CATEGORY_DANGEROUS_CONTENT', 'threshold' => 'BLOCK_MEDIUM_AND_ABOVE'],
    ],
]);

$model = 'gemini-2.0-flash';
$url   = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent?key={$apiKey}";

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_TIMEOUT        => 15,
]);
$resp   = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if (!$resp) {
    http_response_code(500);
    echo json_encode(['erro' => 'Erro de conexão com a IA']);
    exit;
}

$json  = json_decode($resp, true);
$texto = $json['candidates'][0]['content']['parts'][0]['text'] ?? '';
if (!$texto) {
    http_response_code(500);
    echo json_encode(['erro' => 'Sem resposta da IA. Tente novamente.']);
    exit;
}

echo json_encode(['resposta' => $texto]);
