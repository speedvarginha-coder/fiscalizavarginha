<?php
/**
 * Fiscaliza Varginha — avalie.php
 *
 * Grava as avaliacoes da secao Avalie e devolve os agregados.
 *
 * Servico da cidade   -> sem login, cooldown por IP
 * Prefeito e vereador -> exige ID token do Google, uma avaliacao por pessoa
 * Obra ou investimento-> sem login, entra como pendente de conferencia
 *
 * Os registros brutos ficam FORA do public_html porque guardam hash de IP e
 * de conta. O que vai ao ar e apenas o agregado em data/chunks/avalie_resumo.json.
 */

header('Content-Type: application/json; charset=utf-8');

$origem = $_SERVER['HTTP_ORIGIN'] ?? '';
$origemPermitida = $origem === ''
    || in_array($origem, [
        'https://www.fiscalizavarginha.com.br',
        'https://fiscalizavarginha.com.br',
    ], true)
    || preg_match('#^http://(?:127\.0\.0\.1|localhost)(?::\d+)?$#', $origem);

if (!$origemPermitida) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'erro' => 'Origem nao autorizada.']);
    exit;
}
if ($origem !== '') {
    header('Access-Control-Allow-Origin: ' . $origem);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

const CLIENT_ID       = '481086614738-g2tgkd3lj81epst2utgbc8ou0hbe72b0.apps.googleusercontent.com';
const COOLDOWN_SVC    = 30 * 24 * 3600;  // 30 dias por IP e area
const MAX_OBRAS_DIA   = 5;               // contribuicoes por IP por dia
const MAX_POSTS_HORA  = 20;              // teto geral por IP
const MAX_CORPO_BYTES = 16384;
const NOTA_MIN        = 1;
const NOTA_MAX        = 10;

const CRITERIOS = [
    'transparencia', 'honestidade', 'atendimento',
    'promessas', 'presenca', 'comunicacao', 'gestao'
];

const SERVICOS_VALIDOS = [
    'Saúde', 'Educação', 'Segurança', 'Transporte público',
    'Infraestrutura', 'Limpeza urbana', 'Saneamento',
    'Iluminação pública', 'Habitação e urbanismo', 'Assistência social',
    'Meio ambiente', 'Vigilância sanitária', 'Causa animal',
    'Desenvolvimento econômico', 'Desenvolvimento rural',
    'Esporte e juventude', 'Cultura e patrimônio', 'Lazer e eventos',
    'Turismo', 'Gestão e burocracia',
];

const REGIOES_VALIDAS = [
    '', 'Centro', 'Vila Paiva', 'Jardim Andere', 'Santa Maria', 'Sion',
    'Bom Pastor', 'Imaculada', 'Rio Verde', 'Carvalhos', 'Zona rural',
    'Outro bairro',
];

const TIPOS_OBRA_VALIDOS = [
    'Obra parada ou atrasada', 'Obra entregue com problema',
    'Equipamento comprado que não chegou', 'Projeto anunciado que não saiu',
    'Outro',
];

function responde($obj, $status = 200) {
    http_response_code($status);
    echo json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function erro($msg, $status = 400) {
    responde(['ok' => false, 'erro' => $msg], $status);
}

/** Diretorio dos registros brutos, um nivel acima do public_html. */
function dir_dados() {
    $configurado = getenv('FISCALIZA_AVALIE_DIR');
    if (is_string($configurado) && trim($configurado) !== '') {
        $configurado = rtrim($configurado, '/\\');
        if (is_dir($configurado)
            || @mkdir($configurado, 0700, true)
            || is_dir($configurado)) {
            return $configurado;
        }
        return null;
    }
    $candidatos = [
        __DIR__ . '/../avalie_dados',
        __DIR__ . '/../../avalie_dados',
    ];
    foreach ($candidatos as $d) {
        if (is_dir($d)) return $d;
    }
    $alvo = $candidatos[0];
    if (@mkdir($alvo, 0700, true) || is_dir($alvo)) return $alvo;
    return null;
}

/** Sal fixo por instalacao: sem ele o hash de IP seria reversivel por forca bruta. */
function sal() {
    $dir = dir_dados();
    if (!$dir) return 'sal-de-emergencia-sem-disco';
    $arq = $dir . '/sal.txt';
    if (is_file($arq)) {
        $s = trim(@file_get_contents($arq));
        if ($s !== '') return $s;
    }
    $s = bin2hex(random_bytes(32));
    @file_put_contents($arq, $s, LOCK_EX);
    @chmod($arq, 0600);
    return $s;
}

function anonimo($valor) {
    return substr(hash('sha256', sal() . '|' . $valor), 0, 32);
}

function ip_em_cidr($ip, $cidr) {
    $partes = explode('/', trim((string)$cidr), 2);
    $rede = trim($partes[0] ?? '');
    $ipBin = @inet_pton($ip);
    $redeBin = @inet_pton($rede);
    if ($ipBin === false || $redeBin === false || strlen($ipBin) !== strlen($redeBin)) {
        return false;
    }

    $maxBits = strlen($ipBin) * 8;
    $bits = count($partes) === 2 ? filter_var($partes[1], FILTER_VALIDATE_INT) : $maxBits;
    if ($bits === false || $bits < 0 || $bits > $maxBits) return false;

    $bytesInteiros = intdiv($bits, 8);
    if ($bytesInteiros > 0
        && substr($ipBin, 0, $bytesInteiros) !== substr($redeBin, 0, $bytesInteiros)) {
        return false;
    }
    $bitsRestantes = $bits % 8;
    if ($bitsRestantes === 0) return true;

    $mascara = (0xFF << (8 - $bitsRestantes)) & 0xFF;
    return (ord($ipBin[$bytesInteiros]) & $mascara)
        === (ord($redeBin[$bytesInteiros]) & $mascara);
}

function proxy_confiavel($ip) {
    $configurado = trim((string)getenv('FISCALIZA_TRUSTED_PROXIES'));
    if ($configurado === '' || !filter_var($ip, FILTER_VALIDATE_IP)) return false;
    foreach (preg_split('/[\s,;]+/', $configurado, -1, PREG_SPLIT_NO_EMPTY) as $cidr) {
        if (ip_em_cidr($ip, $cidr)) return true;
    }
    return false;
}

function ip_cliente() {
    $remoto = trim((string)($_SERVER['REMOTE_ADDR'] ?? ''));
    if (!filter_var($remoto, FILTER_VALIDATE_IP)) return '0.0.0.0';

    // Nunca confia em X-Forwarded-For por padrao. O servidor precisa declarar
    // os IPs/CIDRs de seus proxies em FISCALIZA_TRUSTED_PROXIES.
    if (!proxy_confiavel($remoto)) return $remoto;

    $encaminhados = explode(',', (string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''));
    $encaminhados[] = $remoto;
    // Percorre da direita para a esquerda e ignora apenas proxies autorizados.
    // Isso impede que um visitante escolha o IP inserindo um valor falso à esquerda.
    for ($i = count($encaminhados) - 1; $i >= 0; $i--) {
        $candidato = trim($encaminhados[$i]);
        if (!filter_var($candidato, FILTER_VALIDATE_IP)) continue;
        if (proxy_confiavel($candidato)) continue;
        return $candidato;
    }
    return $remoto;
}

/** Faixa /24 (IPv4) ou /64 (IPv6): pega quem alterna o ultimo octeto. */
function faixa_ip($ip) {
    if (strpos($ip, ':') !== false) {
        $binario = @inet_pton($ip);
        if ($binario === false || strlen($binario) !== 16) return $ip;
        // Mantem os 64 bits da rede e zera os 64 bits do dispositivo.
        return inet_ntop(substr($binario, 0, 8) . str_repeat("\0", 8));
    }
    $p = explode('.', $ip);
    return count($p) === 4 ? "$p[0].$p[1].$p[2]" : $ip;
}

function caminho($nome) {
    $dir = dir_dados();
    return $dir ? $dir . '/' . $nome : null;
}

function le_linhas($nome) {
    $arq = caminho($nome);
    if (!$arq || !is_file($arq)) return [];
    $out = [];
    foreach (file($arq, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $linha) {
        $obj = json_decode($linha, true);
        if (is_array($obj)) $out[] = $obj;
    }
    return $out;
}

function grava_linha($nome, $registro) {
    $arq = caminho($nome);
    if (!$arq) return false;
    $linha = json_encode($registro, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    $ok = @file_put_contents($arq, $linha, FILE_APPEND | LOCK_EX);
    if ($ok !== false) @chmod($arq, 0600);
    return $ok !== false;
}

function carrega_historico() {
    $historico = [];
    foreach (['servicos.jsonl', 'representantes.jsonl', 'obras.jsonl'] as $nome) {
        $historico[$nome] = le_linhas($nome);
    }
    return $historico;
}

/**
 * Serializa o ciclo ler -> decidir -> gravar entre os workers do PHP.
 * O bloqueio fica fora do public_html.
 */
function com_bloqueio_mutacao(callable $operacao) {
    $arq = caminho('.mutacoes.lock');
    if (!$arq) erro('Armazenamento indisponivel no servidor.', 500);

    $handle = @fopen($arq, 'c');
    if ($handle === false || !@flock($handle, LOCK_EX)) {
        if (is_resource($handle)) @fclose($handle);
        erro('Nao foi possivel proteger o registro da avaliacao.', 503);
    }
    @chmod($arq, 0600);

    try {
        return $operacao();
    } finally {
        @flock($handle, LOCK_UN);
        @fclose($handle);
    }
}

/** Teto geral por IP: barra o script que dispara em rajada. */
function checa_teto_geral($ipHash, array $historico = null) {
    $historico = $historico ?? carrega_historico();
    $corte = time() - 3600;
    $n = 0;
    foreach (['servicos.jsonl', 'representantes.jsonl', 'obras.jsonl'] as $arq) {
        foreach (($historico[$arq] ?? []) as $r) {
            if (($r['ip'] ?? '') === $ipHash && ($r['ts'] ?? 0) >= $corte) $n++;
        }
    }
    if ($n >= MAX_POSTS_HORA) {
        erro('Muitos envios em pouco tempo. Tente novamente mais tarde.', 429);
    }
}

function nota_valida($v) {
    return is_numeric($v) && $v >= NOTA_MIN && $v <= NOTA_MAX;
}

function texto($v, $max) {
    $s = trim((string)$v);
    $s = preg_replace('/\s+/u', ' ', $s);
    return mb_substr($s, 0, $max, 'UTF-8');
}

function chave_voto_servico(array $registro) {
    if (!empty($registro['voto_id'])) return (string)$registro['voto_id'];
    return 'legado:' . hash('sha256', implode('|', [
        (string)($registro['ts'] ?? ''),
        (string)($registro['ip'] ?? ''),
        (string)($registro['area'] ?? ''),
    ]));
}

function voto_servico_corrigivel(array $registros, $ipHash, $area, $agora) {
    $encontrado = null;
    foreach ($registros as $registro) {
        if (($registro['ip'] ?? '') !== $ipHash || ($registro['area'] ?? '') !== $area) continue;
        if (($agora - ($registro['ts'] ?? 0)) >= COOLDOWN_SVC) continue;
        if ($encontrado === null || ($registro['ts'] ?? 0) >= ($encontrado['ts'] ?? 0)) {
            $encontrado = $registro;
        }
    }
    return $encontrado;
}

function configuracao_avaliacao($arquivoConfig = null) {
    $arq = $arquivoConfig ?: __DIR__ . '/data/chunks/avalie_config.json';
    if (!is_file($arq)) return null;
    $config = json_decode((string)@file_get_contents($arq), true);
    if (!is_array($config)
        || !is_array($config['prefeito'] ?? null)
        || !is_string($config['prefeito']['nome'] ?? null)
        || !is_array($config['vereadores_excluidos'] ?? null)) {
        return null;
    }
    return $config;
}

function representante_valido($alvo, $arquivoVereadores = null, $arquivoConfig = null) {
    $config = configuracao_avaliacao($arquivoConfig);
    if (!$config) return false;
    if ($alvo === $config['prefeito']['nome']) return true;

    $arq = $arquivoVereadores ?: __DIR__ . '/data/chunks/vereadores.json';
    if (!is_file($arq)) return false;
    $lista = json_decode((string)@file_get_contents($arq), true);
    if (!is_array($lista)) return false;

    $fora = $config['vereadores_excluidos'];
    foreach ($lista as $vereador) {
        $nome = $vereador['nome'] ?? '';
        if ($nome === $alvo && !in_array($nome, $fora, true)) return true;
    }
    return false;
}

/**
 * Valida o ID token no proprio Google.
 * ponytail: usa o endpoint tokeninfo (uma chamada de rede por login) em vez de
 * verificar a assinatura RSA localmente. Se o volume crescer, trocar por
 * validacao local das chaves de https://www.googleapis.com/oauth2/v3/certs.
 */
function verifica_token_google($idToken) {
    if (!is_string($idToken) || strlen($idToken) < 20 || strlen($idToken) > 4096) {
        return null;
    }
    $host = 'oauth2.googleapis.com';
    $ip   = gethostbyname($host);
    $resolve = ($ip !== $host) ? ["{$host}:443:{$ip}"] : [];

    $ch = curl_init("https://{$host}/tokeninfo?id_token=" . urlencode($idToken));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_RESOLVE        => $resolve,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code !== 200 || !$body) return null;
    $d = json_decode($body, true);
    if (!is_array($d)) return null;

    if (($d['aud'] ?? '') !== CLIENT_ID) return null;
    if (!in_array($d['iss'] ?? '', ['accounts.google.com', 'https://accounts.google.com'], true)) return null;
    if ((int)($d['exp'] ?? 0) < time()) return null;
    if (empty($d['sub'])) return null;

    return $d['sub'];
}

function grava_resumo_atomico($destino, $resumo) {
    if (!is_dir(dirname($destino))) return false;
    $json = json_encode(
        $resumo,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT
    );
    if ($json === false) return false;

    $temporario = $destino . '.tmp.' . bin2hex(random_bytes(6));
    if (@file_put_contents($temporario, $json, LOCK_EX) === false) return false;
    @chmod($temporario, 0644);
    if (@rename($temporario, $destino)) return true;

    @unlink($temporario);
    return false;
}

/** Recalcula o agregado publico. Nenhum hash sai daqui. */
function regenera_resumo(array $historico = null) {
    $historico = $historico ?? carrega_historico();
    // Correcoes mantem o mesmo voto_id: somente a versao mais recente entra no agregado.
    $ultimosVotos = [];
    foreach (($historico['servicos.jsonl'] ?? []) as $r) {
        $ultimosVotos[chave_voto_servico($r)] = $r;
    }

    $servicos = [];
    foreach ($ultimosVotos as $r) {
        $a = $r['area'] ?? '';
        if ($a === '') continue;
        if (!isset($servicos[$a])) $servicos[$a] = ['notas' => [], 'regioes' => []];
        $servicos[$a]['notas'][] = (float)$r['nota'];
        $reg = $r['regiao'] ?? '';
        if ($reg !== '') {
            $servicos[$a]['regioes'][$reg] = ($servicos[$a]['regioes'][$reg] ?? 0) + 1;
        }
    }

    $areas = [];
    foreach ($servicos as $nome => $d) {
        sort($d['notas']);
        $n = count($d['notas']);
        $areas[] = [
            'area'    => $nome,
            'n'       => $n,
            'mediana' => $n ? mediana($d['notas']) : null,
            'media'   => $n ? round(array_sum($d['notas']) / $n, 1) : null,
            'regioes' => (object)$d['regioes'],
        ];
    }

    // Uma avaliacao por pessoa e por alvo: o registro mais recente vence.
    $ultima = [];
    foreach (($historico['representantes.jsonl'] ?? []) as $r) {
        $chave = ($r['conta'] ?? '') . '|' . ($r['alvo'] ?? '');
        $ultima[$chave] = $r;
    }
    $porAlvo = [];
    foreach ($ultima as $r) {
        $alvo = $r['alvo'] ?? '';
        if ($alvo === '') continue;
        $porAlvo[$alvo][] = (float)($r['media'] ?? 0);
    }
    $reps = [];
    foreach ($porAlvo as $alvo => $medias) {
        sort($medias);
        $reps[] = [
            'alvo'    => $alvo,
            'n'       => count($medias),
            'mediana' => mediana($medias),
            'media'   => round(array_sum($medias) / count($medias), 1),
        ];
    }

    $obras = $historico['obras.jsonl'] ?? [];
    $pendentes = 0;
    foreach ($obras as $o) { if (($o['status'] ?? 'pendente') === 'pendente') $pendentes++; }

    $resumo = [
        'gerado_em'       => date('c'),
        'aviso'           => 'Percepcao declarada por moradores. Amostra nao representativa. Nao e indicador oficial.',
        'servicos'        => $areas,
        'representantes'  => $reps,
        'obras_recebidas' => count($obras),
        'obras_pendentes' => $pendentes,
    ];

    $destino = __DIR__ . '/data/chunks/avalie_resumo.json';
    if (!grava_resumo_atomico($destino, $resumo)) {
        erro('Nao foi possivel atualizar o resumo publico.', 500);
    }
    return $resumo;
}

function mediana(array $ordenado) {
    $n = count($ordenado);
    if ($n === 0) return null;
    $meio = intdiv($n, 2);
    return $n % 2 ? round($ordenado[$meio], 1) : round(($ordenado[$meio - 1] + $ordenado[$meio]) / 2, 1);
}

// ---------------------------------------------------------------- roteamento

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (($_GET['acao'] ?? '') === 'saude') {
        $dir = dir_dados();
        responde([
            'ok' => $dir !== null && is_writable($dir),
            'armazenamento' => $dir !== null && is_writable($dir) ? 'disponivel' : 'indisponivel',
        ], $dir !== null && is_writable($dir) ? 200 : 503);
    }
    $arq = __DIR__ . '/data/chunks/avalie_resumo.json';
    if (is_file($arq)) {
        echo file_get_contents($arq);
        exit;
    }
    responde(regenera_resumo());
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    erro('Metodo nao permitido', 405);
}

if (!dir_dados() || !is_writable(dir_dados())) {
    erro('Armazenamento indisponivel no servidor.', 500);
}

$tamanhoInformado = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($tamanhoInformado > MAX_CORPO_BYTES) erro('Envio grande demais.', 413);
$corpo = file_get_contents('php://input');
if ($corpo === false || strlen($corpo) > MAX_CORPO_BYTES) erro('Envio grande demais.', 413);
$entrada = json_decode($corpo, true);
if (!is_array($entrada)) erro('Corpo invalido.');

$ip      = ip_cliente();
$ipHash  = anonimo($ip);
$faixa   = anonimo(faixa_ip($ip));
$agora   = time();

switch ($entrada['acao'] ?? '') {

    case 'servico': {
        $area = texto($entrada['area'] ?? '', 60);
        $nota = $entrada['nota'] ?? null;
        $regiao = texto($entrada['regiao'] ?? '', 40);
        if (!in_array($area, SERVICOS_VALIDOS, true)) erro('Area de servico invalida.');
        if (!in_array($regiao, REGIOES_VALIDAS, true)) erro('Regiao invalida.');
        if (!nota_valida($nota)) erro('Nota deve ser de 1 a 10.');

        $resultado = com_bloqueio_mutacao(function () use (
            $ipHash, $faixa, $agora, $area, $nota, $regiao
        ) {
            $historico = carrega_historico();
            checa_teto_geral($ipHash, $historico);
            $anterior = voto_servico_corrigivel(
                $historico['servicos.jsonl'],
                $ipHash,
                $area,
                $agora
            );
            $corrigindo = $anterior !== null;
            $registro = [
                'ts'      => $agora,
                'voto_id' => $corrigindo
                    ? chave_voto_servico($anterior)
                    : bin2hex(random_bytes(16)),
                'area'    => $area,
                'nota'    => (int)$nota,
                'regiao'  => $regiao,
                'ip'      => $ipHash,
                'faixa'   => $faixa,
            ];
            if (!grava_linha('servicos.jsonl', $registro)) {
                erro('Nao foi possivel registrar a avaliacao.', 500);
            }
            $historico['servicos.jsonl'][] = $registro;
            return [
                'corrigindo' => $corrigindo,
                'resumo' => regenera_resumo($historico),
            ];
        });
        responde([
            'ok' => true,
            'mensagem' => $resultado['corrigindo']
                ? 'Avaliação corrigida. A nota anterior foi substituída.'
                : 'Obrigado. Sua avaliação foi registrada.',
            'resumo' => $resultado['resumo'],
        ]);
    }

    case 'representante': {
        // Evita que tokens invalidos sejam usados para disparar chamadas ilimitadas ao Google.
        // O teto e conferido novamente dentro do bloqueio antes da gravacao.
        checa_teto_geral($ipHash);
        $sub = verifica_token_google($entrada['id_token'] ?? '');
        if (!$sub) erro('Entre com sua conta Google para avaliar.', 401);

        $alvo = texto($entrada['alvo'] ?? '', 80);
        if (!representante_valido($alvo)) erro('Representante nao reconhecido.');

        $notas = [];
        foreach (CRITERIOS as $c) {
            $v = $entrada['notas'][$c] ?? null;
            if (!nota_valida($v)) erro("Nota invalida em: $c");
            $notas[$c] = (int)$v;
        }

        $registro = [
            'ts'    => $agora,
            'alvo'  => $alvo,
            'notas' => $notas,
            'media' => round(array_sum($notas) / count($notas), 2),
            'conta' => anonimo($sub),
            'ip'    => $ipHash,
            'faixa' => $faixa,
        ];
        $resumo = com_bloqueio_mutacao(function () use ($ipHash, $registro) {
            $historico = carrega_historico();
            checa_teto_geral($ipHash, $historico);
            if (!grava_linha('representantes.jsonl', $registro)) {
                erro('Nao foi possivel registrar a avaliacao.', 500);
            }
            $historico['representantes.jsonl'][] = $registro;
            return regenera_resumo($historico);
        });
        responde(['ok' => true, 'resumo' => $resumo]);
    }

    case 'obra': {
        $descricao = texto($entrada['descricao'] ?? '', 1200);
        $tipo = texto($entrada['tipo'] ?? '', 60);
        $local = texto($entrada['local'] ?? '', 160);
        if (!in_array($tipo, TIPOS_OBRA_VALIDOS, true)) erro('Tipo de contribuicao invalido.');
        if (mb_strlen($local, 'UTF-8') < 3) erro('Informe o local da obra ou investimento.');
        if (mb_strlen($descricao, 'UTF-8') < 15) {
            erro('Descreva com um pouco mais de detalhe o que voce viu.');
        }

        $registro = [
            'ts'        => $agora,
            'tipo'      => $tipo,
            'local'     => $local,
            'descricao' => $descricao,
            'status'    => 'pendente',
            'ip'        => $ipHash,
            'faixa'     => $faixa,
        ];
        com_bloqueio_mutacao(function () use ($ipHash, $agora, $registro) {
            $historico = carrega_historico();
            checa_teto_geral($ipHash, $historico);
            $hoje = 0;
            foreach ($historico['obras.jsonl'] as $r) {
                if (($r['ip'] ?? '') === $ipHash && ($agora - ($r['ts'] ?? 0)) < 86400) $hoje++;
            }
            if ($hoje >= MAX_OBRAS_DIA) {
                erro('Limite de contribuicoes por dia atingido.', 429);
            }
            if (!grava_linha('obras.jsonl', $registro)) {
                erro('Nao foi possivel registrar a contribuicao.', 500);
            }
            $historico['obras.jsonl'][] = $registro;
            regenera_resumo($historico);
        });
        responde(['ok' => true, 'mensagem' => 'Recebido. Vai ao ar depois de conferido contra contrato, empenho e pagamento.']);
    }
}

erro('Acao desconhecida.');
