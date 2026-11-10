<?php
// Conta visitas por página e por dia. Não guarda IP, cookie, navegador nem
// termo de busca: só "página X foi aberta N vezes no dia D".
// GET devolve os totais dos dois últimos meses; POST soma uma visita.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const PAGINAS = ['home', 'prefeitura', 'camara', 'pessoal', 'fundacao', 'relatorios', 'atualizacoes',
    'cobrar', 'marcadores', 'monitoramento', 'conformidade', 'sobre', 'avalie', 'emendas'];

// Pasta oculta ao lado do script; o .htaccess do site nega acesso a dotfiles.
$dir = __DIR__ . '/.fiscaliza_uso';
$arquivoDoMes = function ($mes) use ($dir) { return $dir . '/' . $mes . '.json'; };
$ler = function ($caminho) {
    $dados = is_file($caminho) ? json_decode((string)@file_get_contents($caminho), true) : null;
    return is_array($dados) ? $dados : [];
};

$metodo = $_SERVER['REQUEST_METHOD'] ?? '';
if ($metodo === 'GET') {
    $meses = [gmdate('Y-m', strtotime('first day of last month')), gmdate('Y-m')];
    $dias = [];
    foreach ($meses as $mes) $dias += $ler($arquivoDoMes($mes));
    ksort($dias);
    echo json_encode(['aviso' => 'Visitas por página e dia; nenhum dado de visitante é guardado.', 'dias' => $dias], JSON_UNESCAPED_UNICODE);
    exit;
}
if ($metodo !== 'POST') { http_response_code(405); exit; }

$origem = $_SERVER['HTTP_ORIGIN'] ?? '';
if (!in_array($origem, ['https://fiscalizavarginha.com.br', 'https://www.fiscalizavarginha.com.br'], true)) {
    http_response_code(403); exit;
}
$entrada = file_get_contents('php://input', false, null, 0, 257);
$dados = is_string($entrada) && strlen($entrada) <= 256 ? json_decode($entrada, true) : null;
$pagina = is_array($dados) && is_string($dados['p'] ?? null) ? $dados['p'] : '';
if (!in_array($pagina, PAGINAS, true)) { http_response_code(400); exit; }

// ponytail: sem limite por visitante (exigiria guardar IP). Quem quiser inflar
// o contador consegue; se virar problema, limitar por IP com hash diário.
if (!is_dir($dir)) @mkdir($dir, 0700, true);
$fp = @fopen($arquivoDoMes(gmdate('Y-m')), 'c+');
if (!$fp || !flock($fp, LOCK_EX)) { http_response_code(503); exit; }
$mes = json_decode(stream_get_contents($fp) ?: '[]', true);
if (!is_array($mes)) $mes = [];
$hoje = gmdate('Y-m-d');
$mes[$hoje][$pagina] = (int)($mes[$hoje][$pagina] ?? 0) + 1;
rewind($fp); ftruncate($fp, 0); fwrite($fp, json_encode($mes)); fflush($fp);
flock($fp, LOCK_UN); fclose($fp);
http_response_code(204);
