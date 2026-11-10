<?php
// Resolve na Betha, no momento do clique, um arquivo vinculado à ficha oficial.
// Endereços assinados são temporários e nunca são gravados no painel.
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function falhar($codigo, $mensagem, $ficha = '') {
    http_response_code($codigo);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Documento indisponível</title><body><p>' . htmlspecialchars($mensagem, ENT_QUOTES, 'UTF-8') . '</p>';
    if ($ficha !== '') echo '<p><a href="' . htmlspecialchars($ficha, ENT_QUOTES, 'UTF-8') . '">Abrir a ficha oficial na Betha</a></p>';
    echo '</body></html>';
    exit;
}

function obter($url, $headers = []) {
    if (!function_exists('curl_init')) return null;
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 20, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_USERAGENT => 'FiscalizaVarginha/1.0', CURLOPT_PROTOCOLS => CURLPROTO_HTTPS]);
    $conteudo = curl_exec($ch);
    $codigo = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $codigo === 200 && is_string($conteudo) && strlen($conteudo) <= 2000000 ? $conteudo : null;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') falhar(405, 'Método não permitido.');
$portal = $_GET['orgao'] ?? '';
$id = $_GET['ficha'] ?? '';
$arquivo = $_GET['arquivo'] ?? '';
$portais = ['prefeitura' => ['y7mn01LGqd_HCvGtj6VPwA==', '83043'], 'camara' => ['-iAWLe1kr2VQcrW9k2AUBg==', '324812']];
if (!is_string($portal) || !isset($portais[$portal]) || !is_string($id) || !preg_match('/\A[\w:%-]{1,120}\z/D', $id)
    || !is_string($arquivo) || !preg_match('/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/iD', $arquivo)) {
    falhar(400, 'Identificação de documento inválida.');
}
[$hash, $consulta] = $portais[$portal];
$ficha = 'https://transparencia.betha.cloud/#/' . $hash . '/consulta/' . $consulta . '/detalhe/' . rawurlencode($id);
$query = http_build_query(['client_id' => '91a97459-f1d8-4b29-b5fa-2e51d1692623', 'response_type' => 'token',
    'redirect_uri' => 'https://transparencia.betha.cloud/auth-callback.html', 'scope' => 'transparencia.public',
    'silent' => 'true', 'access_mode' => 'anonymous', 'callback' => '__jp0']);
$auth = obter('https://plataforma-oauth.betha.cloud/auth/oauth2/authorize?' . $query);
if (!is_string($auth) || !preg_match('/\A\s*__jp0\((.*)\);?\s*\z/sD', $auth, $m)) falhar(503, 'Não foi possível consultar a Betha agora.', $ficha);
$credencial = json_decode($m[1], true);
$token = $credencial['accessToken'] ?? '';
if (!is_string($token) || $token === '' || preg_match('/[\r\n]/', $token)) falhar(503, 'Não foi possível consultar a Betha agora.', $ficha);
$headers = ['Authorization: Bearer ' . $token, 'app-context: ' . base64_encode(json_encode(['portal' => $hash], JSON_UNESCAPED_SLASHES)), 'Accept: application/json, text/plain, */*'];
$api = 'https://api.transparencia.betha.cloud/transparencia/api';
$detail = json_decode(obter($api . '/busca/' . $consulta . '/detalhes/' . rawurlencode($id), $headers) ?? '', true);
$documentos = is_array($detail) ? ($detail['documentosRelacionados'] ?? null) : null;
if (!is_array($documentos)) falhar(503, 'A lista de documentos não está disponível. Consulte a ficha oficial.', $ficha);
$vinculado = false;
foreach ($documentos as $doc) if (is_array($doc) && is_string($doc['arquivo'] ?? null) && strcasecmp($doc['arquivo'], $arquivo) === 0) { $vinculado = true; break; }
if (!$vinculado) falhar(404, 'Este arquivo não foi localizado na ficha oficial atual.', $ficha);
$link = trim(obter($api . '/arquivo/' . rawurlencode($arquivo), $headers) ?? '');
$partes = parse_url($link);
if (!is_array($partes) || ($partes['scheme'] ?? '') !== 'https' || ($partes['host'] ?? '') !== 's3.sa-east-1.amazonaws.com'
    || isset($partes['user']) || isset($partes['pass']) || isset($partes['port'])
    || strpos($partes['path'] ?? '', '/transparencia.betha.cloud/contratos/') !== 0
    || stripos($partes['path'] ?? '', $arquivo) === false || preg_match('/[\r\n]/', $link)) {
    falhar(503, 'O endereço do arquivo não pôde ser confirmado. Consulte a ficha oficial.', $ficha);
}
header('Location: ' . $link, true, 302);
exit;
