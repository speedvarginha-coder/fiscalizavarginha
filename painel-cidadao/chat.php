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
$configFile = __DIR__ . '/../../gemini_key.php'; // acima do public_html
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
$contexto = "Você é o assistente do painel Fiscaliza Varginha, uma ferramenta de transparência pública municipal.
Responda SEMPRE em português brasileiro, de forma clara, direta e acessível ao cidadão comum.
Tom: neutro, honesto, sem acusações. Dados são pistas, não provas de irregularidade.
Nunca invente dados. Se não souber, diga que o cidadão deve verificar na fonte oficial.
Respostas curtas (máx 3 parágrafos). Use bullet points quando ajudar.

════════════════════════════════
DADOS REAIS DE VARGINHA-MG (coletados automaticamente — competência mai/jun 2026)
════════════════════════════════

── PREFEITURA 2026 (jan–jun) ──
- Total pago a fornecedores externos: R\$ 147.396.775,85
- Contratos ativos: 887
- Contratos PNCP (compras federais): 50 contratos / R\$ 22.764.293,97

Top 10 fornecedores da Prefeitura em 2026:
1. Hospital Regional do Sul de Minas – R\$ 34.049.240,66 (saúde)
2. PAVICAN Pavimentação e Terraplenagem – R\$ 9.627.998,16 (obras/asfalto)
3. Viação Real Transporte Urbano – R\$ 7.939.204,75 (transporte coletivo)
4. Varian Medical Systems – R\$ 7.819.347,76 (equipamentos médicos)
5. Receita Federal – R\$ 5.432.273,38 (tributos federais)
6. Transporto Transportes Coletivos – R\$ 4.549.185,77 (transporte)
7. SEFE Sistema Educacional Família Escola – R\$ 3.766.863,16 (educação)
8. INSS – R\$ 3.406.069,03 (previdência social)
9. COPASA – R\$ 3.280.942,68 (saneamento)
10. Centro de Desenvolvimento Integrado – R\$ 3.070.000,00 (assistência social)

── REMUNERAÇÃO — AGENTES POLÍTICOS (maio/2026, folha pública Betha) ──
- Prefeito Leonardo Vinhas Ciacci: bruto R\$ 32.906,13 / líquido R\$ 23.946,74
- Vice-prefeito Antonio Silva: bruto R\$ 9.871,81 / líquido R\$ 7.401,58

── REMUNERAÇÃO — SERVIDORES PREFEITURA (maio/2026) ──
- Total de servidores na folha: 3.990
- Comissionados (sem concurso): 90 servidores
- Servidor mais bem pago: Luiz Gonçalves Reinoso Filho (Professor P-II) – R\$ 100.433,31
- 2º: Marlene Reis Inácio Amaro (Educador Infantil) – R\$ 72.562,07
- 3º: Erika Mariano (Professor P-II) – R\$ 69.240,39
- Maior comissionado: Evandro Marcelo dos Santos (Procurador Geral) – R\$ 23.239,97

── DIÁRIAS 2026 ──
Prefeitura:
- Total: R\$ 1.993.273,25 | 5.035 registros | 276 servidores viajaram
- Quem mais recebeu: Sebastião Cristiano Ferreira da Silva – R\$ 32.361,89 (58 diárias)
- 2º: Jaime Roberto Alves Macedo – R\$ 31.885,63 (25 diárias)
- 3º: Tadeu Aparecido de Godoi Junior – R\$ 30.257,98 (64 diárias)

Câmara Municipal:
- Total: R\$ 136.145,00 | 230 registros | 30 servidores/vereadores
- Quem mais recebeu: Luis Claudio Fernandes Alves – R\$ 4.260,00 (6,5 diárias)
- 2º: Hélio Lino Junior – R\$ 3.960,00 (5,5 diárias)

── CÂMARA MUNICIPAL 2026 ──
- 17 vereadores ativos
- Total gasto: R\$ 5.925.535,01
- Contratos: 36
- Salário bruto de cada vereador: R\$ 10.384,06/mês
- Top fornecedor câmara: Versão BR Comunicação e Marketing – R\$ 1.393.222,92 (publicidade)
- 2º: Verocheque Refeições – R\$ 1.062.359,18 (alimentação)
- 3º: Betha Sistemas – R\$ 491.715,90 (tecnologia)

── PRESENÇA DOS VEREADORES (2025/2026) ──
Presença 100%: Dr. Lucas, Joãozinho Enfermeiro, Cássio Chiodi, Thulyo Paiva, Davi Martins
Menor presença: Rogério Bueno (94,2%), Dudu Ottoni (94,2%), Bruno Leandro Coletor (95,3%)

── EMENDAS IMPOSITIVAS (2025, base SAPL) ──
- 357 emendas registradas | Total: R\$ 17.841.369,18
- Maior emendador (valor): Cássio Chiodi – R\$ 1.182.800 em 15 emendas
- 2º: Miguel da Saúde – R\$ 1.160.832 em 14 emendas
- 3º: Thulyo Paiva – R\$ 1.112.832 em 9 emendas
- Mais prolífico (qtd): Alexandre Prado – 40 emendas / R\$ 1.082.832

── MATÉRIAS NA CÂMARA (2025, base SAPL) ──
- 1.584 matérias no total
- Leis aprovadas: 25 | Em tramitação: 666 | Arquivadas: 882
- Temas mais citados: saúde (135 menções), praça (86), cultura (63), educação (41), segurança (36)

── LAI — LEI DE ACESSO À INFORMAÇÃO ──
- Prazo de resposta: 20 dias úteis
- Canal: e-SIC da Prefeitura de Varginha
- O painel tem 21 modelos prontos de pedido LAI em cobrar.html
- Temas disponíveis: contratos, diárias, obras, salários, licitações e mais

── MONITORAMENTO FEDERAL ──
- CNPJ da Prefeitura de Varginha: 18.240.380/0001-38
- CNPJ-IBGE: 3170701
- Status sanções CEIS/CNEP: nenhuma registrada para fornecedores ativos (verificado jun/2026)";

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

$model = 'gemini-2.5-flash';
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
