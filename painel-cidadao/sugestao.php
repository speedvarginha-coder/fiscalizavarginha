<?php
// Recebe sugestões e as encaminha ao endereço do projeto, sem gravar o conteúdo.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function responder($codigo, $mensagem) {
    http_response_code($codigo);
    echo json_encode(['ok' => $codigo === 200, 'mensagem' => $mensagem], JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') responder(405, 'Método não permitido.');
$origem = $_SERVER['HTTP_ORIGIN'] ?? '';
if (!in_array($origem, ['https://fiscalizavarginha.com.br', 'https://www.fiscalizavarginha.com.br'], true)) {
    responder(403, 'Origem não autorizada.');
}
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) responder(415, 'Formato inválido.');
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192) responder(413, 'Mensagem muito longa.');
$entrada = file_get_contents('php://input', false, null, 0, 8193);
if ($entrada === false || strlen($entrada) > 8192) responder(413, 'Mensagem muito longa.');
$dados = json_decode($entrada, true);
if (!is_array($dados)) responder(400, 'Dados inválidos.');

$campos = [];
foreach (['assunto' => 100, 'mensagem' => 4000, 'nome' => 400, 'email' => 160, 'cidade' => 400, 'site' => 400] as $campo => $limite) {
    if (isset($dados[$campo]) && !is_string($dados[$campo])) responder(400, 'Dados inválidos.');
    $valor = trim($dados[$campo] ?? '');
    if (strlen($valor) > $limite) responder(400, 'Campo muito longo.');
    $campos[$campo] = $valor;
}
if ($campos['site'] !== '') responder(400, 'Não foi possível enviar a sugestão.');
if (!in_array($campos['assunto'], ['Ideia para o site', 'Informação que falta', 'Possível erro nos dados', 'Outro assunto'], true)
    || $campos['mensagem'] === '') responder(400, 'Preencha a sugestão.');
if ($campos['email'] !== '' && !filter_var($campos['email'], FILTER_VALIDATE_EMAIL)) responder(400, 'Informe um e-mail válido.');

// Limite por endereço de rede, sem confiar em cabeçalhos fornecidos pelo visitante.
$ip = $_SERVER['REMOTE_ADDR'] ?? '';
$arquivo = sys_get_temp_dir() . '/fiscaliza-sugestao-' . hash('sha256', $ip);
$limite = @fopen($arquivo, 'c+');
if (!$limite || !flock($limite, LOCK_EX)) responder(503, 'Serviço temporariamente indisponível.');
$tentativas = json_decode(stream_get_contents($limite), true);
$agora = time();
$tentativas = array_values(array_filter(is_array($tentativas) ? $tentativas : [], function ($t) use ($agora) { return is_int($t) && $t > $agora - 600; }));
if (count($tentativas) >= 5) { flock($limite, LOCK_UN); fclose($limite); responder(429, 'Limite de envios atingido. Tente novamente mais tarde.'); }
$tentativas[] = $agora;
ftruncate($limite, 0); rewind($limite); fwrite($limite, json_encode($tentativas)); fflush($limite);
flock($limite, LOCK_UN); fclose($limite);

$corpo = "Assunto: " . $campos['assunto'] . "\n\nSugestão:\n" . $campos['mensagem'] .
    "\n\nNome: " . ($campos['nome'] ?: 'Não informado') .
    "\nE-mail: " . ($campos['email'] ?: 'Não informado') .
    "\nCidade: " . ($campos['cidade'] ?: 'Não informada');
$cabecalhos = "From: Fiscaliza Varginha <contato@fiscalizavarginha.com.br>\r\n" .
    "Content-Type: text/plain; charset=UTF-8\r\n";
if ($campos['email'] !== '') $cabecalhos .= 'Reply-To: ' . $campos['email'] . "\r\n";
if (!@mail('contato@fiscalizavarginha.com.br', 'Nova sugestao - Fiscaliza Varginha', $corpo, $cabecalhos)) {
    responder(503, 'Não foi possível enviar agora. Tente novamente ou use outra forma de envio.');
}
responder(200, 'Sugestão aceita para envio. Obrigado por contribuir.');
