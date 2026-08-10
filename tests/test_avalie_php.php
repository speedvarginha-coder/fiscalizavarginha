<?php
/**
 * Check minimo do avalie.php. Roda sem servidor e sem rede:
 *   php tests/test_avalie_php.php
 *
 * Cobre o que quebra silenciosamente: mediana, agrupamento por faixa de IP,
 * cooldown, uma-avaliacao-por-pessoa e validacao de nota.
 */

define('MODO_TESTE', true);

$RAIZ = dirname(__DIR__) . '/painel-cidadao';
$tmp  = sys_get_temp_dir() . '/avalie_teste_' . getmypid();
@mkdir($tmp, 0700, true);

// Carrega so as funcoes puras do avalie.php, sem executar o roteamento.
$fonte = file_get_contents($RAIZ . '/avalie.php');
$corte = strpos($fonte, '// ---------------------------------------------------------------- roteamento');
if ($corte === false) {
    fwrite(STDERR, "FALHOU: marcador de roteamento sumiu do avalie.php\n");
    exit(1);
}
$inicio = strpos($fonte, 'const CLIENT_ID');
if ($inicio === false) {
    fwrite(STDERR, "FALHOU: inicio da configuracao sumiu do avalie.php\n");
    exit(1);
}
$fonte = substr($fonte, $inicio, $corte - $inicio);
$fonte = str_replace('<?php', '', $fonte);
eval($fonte);

$falhas = 0;
function checa($cond, $msg) {
    global $falhas;
    if ($cond) {
        echo "  ok   $msg\n";
    } else {
        echo "  FALHOU  $msg\n";
        $falhas++;
    }
}

echo "mediana\n";
checa(mediana([5]) === 5.0 || mediana([5]) == 5, 'um elemento devolve ele mesmo');
checa(mediana([1, 2, 3, 4]) == 2.5, 'par tira a media dos dois do meio');
checa(mediana([1, 2, 9]) == 2, 'impar pega o do meio, nao a media');
checa(mediana([]) === null, 'lista vazia devolve null');
// A razao de existir mediana: um voto extremo nao pode mover o resultado.
checa(mediana([7, 7, 7, 7, 10]) == 7, 'nota extrema nao desloca a mediana');

echo "faixa de IP\n";
checa(faixa_ip('189.45.12.9') === '189.45.12', 'IPv4 corta o ultimo octeto');
checa(faixa_ip('189.45.12.9') === faixa_ip('189.45.12.240'), 'mesma /24 agrupa');
checa(faixa_ip('189.45.13.9') !== faixa_ip('189.45.12.9'), '/24 diferente nao agrupa');
checa(faixa_ip('2804:14d:8::1') === '2804:14d:8::', 'IPv6 normaliza a faixa /64');
checa(faixa_ip('2804:14d:8::1') === faixa_ip('2804:14d:8::2'), 'mesma /64 IPv6 comprimida agrupa');
checa(faixa_ip('2804::1') === faixa_ip('2804::2'), 'IPv6 muito comprimido tambem agrupa');
checa(faixa_ip('2804:0:0:1::1') !== faixa_ip('2804::1'), '/64 IPv6 diferente nao agrupa');

echo "IP real e proxies\n";
checa(ip_em_cidr('203.0.113.45', '203.0.113.0/24'), 'CIDR IPv4 inclui endereco da rede');
checa(!ip_em_cidr('203.0.114.45', '203.0.113.0/24'), 'CIDR IPv4 recusa outra rede');
checa(ip_em_cidr('2001:db8::5', '2001:db8::/32'), 'CIDR IPv6 inclui endereco da rede');
checa(!ip_em_cidr('2001:db9::5', '2001:db8::/32'), 'CIDR IPv6 recusa outra rede');

$serverOriginal = $_SERVER;
putenv('FISCALIZA_TRUSTED_PROXIES');
$_SERVER['REMOTE_ADDR'] = '198.51.100.10';
$_SERVER['HTTP_X_FORWARDED_FOR'] = '203.0.113.20';
checa(ip_cliente() === '198.51.100.10', 'ignora cabecalho de proxy nao autorizado');

putenv('FISCALIZA_TRUSTED_PROXIES=10.0.0.0/8,2001:db8:ffff::/48');
$_SERVER['REMOTE_ADDR'] = '10.0.0.8';
$_SERVER['HTTP_X_FORWARDED_FOR'] = '192.0.2.99, 203.0.113.20';
checa(ip_cliente() === '203.0.113.20', 'usa o salto real mais proximo do proxy autorizado');
$_SERVER['REMOTE_ADDR'] = '2001:db8:ffff::8';
$_SERVER['HTTP_X_FORWARDED_FOR'] = '2001:db8:1234::20';
checa(ip_cliente() === '2001:db8:1234::20', 'aceita proxy IPv6 explicitamente autorizado');
putenv('FISCALIZA_TRUSTED_PROXIES');
$_SERVER = $serverOriginal;

echo "anonimizacao\n";
checa(anonimo('1.2.3.4') === anonimo('1.2.3.4'), 'mesmo valor gera o mesmo hash');
checa(anonimo('1.2.3.4') !== anonimo('1.2.3.5'), 'valores diferentes geram hashes diferentes');
checa(strpos(anonimo('1.2.3.4'), '1.2.3.4') === false, 'o IP nao aparece no hash');

echo "validacao de nota\n";
checa(nota_valida(1) && nota_valida(10), 'aceita os extremos validos');
checa(!nota_valida(0) && !nota_valida(11), 'recusa fora da faixa');
checa(!nota_valida('abc') && !nota_valida(null), 'recusa lixo');

echo "listas oficiais\n";
checa(in_array('Saúde', SERVICOS_VALIDOS, true), 'aceita servico publicado na tela');
checa(!in_array('Servico inventado', SERVICOS_VALIDOS, true), 'recusa servico inventado');
checa(in_array('', REGIOES_VALIDAS, true), 'permite nao informar regiao');
checa(!in_array('Cidade vizinha', REGIOES_VALIDAS, true), 'recusa regiao fora da lista');
checa(in_array('Obra parada ou atrasada', TIPOS_OBRA_VALIDOS, true), 'aceita tipo de obra publicado');
checa(!in_array('Tipo inventado', TIPOS_OBRA_VALIDOS, true), 'recusa tipo de obra inventado');
$arquivoVereadores = $RAIZ . '/data/chunks/vereadores.json';
$arquivoConfig = $RAIZ . '/data/chunks/avalie_config.json';
checa(
    representante_valido('Leonardo Vinhas Ciacci', $arquivoVereadores, $arquivoConfig),
    'aceita o prefeito cadastrado'
);
checa(
    representante_valido('Zilda Silva', $arquivoVereadores, $arquivoConfig),
    'aceita vereador presente nos dados'
);
checa(
    !representante_valido('Pessoa Inventada', $arquivoVereadores, $arquivoConfig),
    'recusa representante inventado'
);
checa(
    !representante_valido('Dr. Lucas', $arquivoVereadores, $arquivoConfig),
    'recusa nome fora da legislatura atual'
);

$fonteCompleta = file_get_contents($RAIZ . '/avalie.php');
checa(strpos($fonteCompleta, "Access-Control-Allow-Origin: *") === false, 'nao libera chamadas de qualquer site');
checa(strpos($fonteCompleta, 'MAX_CORPO_BYTES') !== false, 'limita o tamanho do envio');
checa(strpos($fonteCompleta, 'if (is_file($arq))') !== false, 'GET serve o resumo existente sem regenerar');
checa(strpos($fonteCompleta, 'com_bloqueio_mutacao') !== false, 'serializa leitura, decisao e gravacao');
checa(strpos($fonteCompleta, 'flock($handle, LOCK_EX)') !== false, 'usa bloqueio exclusivo entre workers');
checa(strpos($fonteCompleta, 'grava_resumo_atomico') !== false, 'publica o resumo por troca atomica');
checa(strpos($fonteCompleta, 'FISCALIZA_TRUSTED_PROXIES') !== false, 'proxy so e aceito quando configurado');

$htaccess = file_get_contents($RAIZ . '/.htaccess');
checa(strpos($htaccess, 'X-Content-Type-Options "nosniff"') !== false, 'impede deteccao insegura de conteudo');
checa(strpos($htaccess, 'X-Frame-Options "DENY"') !== false, 'impede enquadramento do site');
checa(strpos($htaccess, 'same-origin-allow-popups') !== false, 'preserva login Google por janela');

$configAvaliacao = json_decode(
    file_get_contents($RAIZ . '/data/chunks/avalie_config.json'),
    true
);
checa(is_array($configAvaliacao), 'configuracao compartilhada de representantes e JSON valido');
checa(
    ($configAvaliacao['prefeito']['nome'] ?? '') === 'Leonardo Vinhas Ciacci',
    'prefeito vem da configuracao compartilhada'
);
checa(
    in_array('Dr. Lucas', $configAvaliacao['vereadores_excluidos'] ?? [], true),
    'exclusoes vem da configuracao compartilhada'
);
checa(
    strpos($fonteCompleta, "\$fora = ['Marquinho da Cooperativa'") === false,
    'backend nao duplica a lista de exclusao'
);
$fonteAvalieHtml = file_get_contents($RAIZ . '/avalie.html');
checa(
    strpos($fonteAvalieHtml, 'var FORA_DA_LISTA') === false,
    'frontend nao duplica a lista de exclusao'
);

echo "publicacao atomica do resumo\n";
$arquivoResumoTeste = $tmp . '/resumo.json';
file_put_contents($arquivoResumoTeste, '{"versao":1}');
$gravouResumo = grava_resumo_atomico($arquivoResumoTeste, ['versao' => 2]);
$resumoGravado = json_decode((string)file_get_contents($arquivoResumoTeste), true);
checa($gravouResumo, 'substitui um resumo que ja existe');
checa(($resumoGravado['versao'] ?? null) === 2, 'leitor recebe o resumo novo completo');

echo "saneamento de texto\n";
checa(texto('  a   b  ', 50) === 'a b', 'colapsa espaco e apara');
checa(mb_strlen(texto(str_repeat('x', 999), 10), 'UTF-8') === 10, 'corta no limite');
checa(texto('Saúde', 50) === 'Saúde', 'preserva acento');

echo "correcao dentro do prazo\n";
$agora = time();
$registros = [
    ['ip' => 'H1', 'area' => 'Saude',    'ts' => $agora - 3600, 'voto_id' => 'V1'],
    ['ip' => 'H1', 'area' => 'Educacao', 'ts' => $agora - 3600, 'voto_id' => 'V2'],
    ['ip' => 'H2', 'area' => 'Saude',    'ts' => $agora - 3600, 'voto_id' => 'V3'],
    ['ip' => 'H1', 'area' => 'Saude',    'ts' => $agora - (40 * 24 * 3600), 'voto_id' => 'V0'],
];
checa(voto_servico_corrigivel($registros, 'H1', 'Saude', $agora)['voto_id'] === 'V1', 'mesmo IP e area localiza o voto recente');
checa(voto_servico_corrigivel($registros, 'H1', 'Transporte', $agora) === null, 'area diferente cria outro voto');
checa(voto_servico_corrigivel($registros, 'H3', 'Saude', $agora) === null, 'IP diferente cria outro voto');
$antigos = [['ip' => 'H9', 'area' => 'Saude', 'ts' => $agora - (40 * 24 * 3600)]];
checa(voto_servico_corrigivel($antigos, 'H9', 'Saude', $agora) === null, 'passados 40 dias cria uma nova avaliacao');

$original = ['ts' => 1, 'ip' => 'H1', 'area' => 'Saude'];
$correcao = ['ts' => 2, 'ip' => 'H1', 'area' => 'Saude', 'voto_id' => chave_voto_servico($original)];
checa(chave_voto_servico($original) === chave_voto_servico($correcao), 'correcao conserva a identidade anonima do voto');
$ultimos = [];
foreach ([$original, $correcao] as $r) $ultimos[chave_voto_servico($r)] = $r;
checa(count($ultimos) === 1 && $ultimos[array_key_first($ultimos)]['ts'] === 2, 'correcao substitui, sem somar outro voto');

echo "uma avaliacao por pessoa e por alvo\n";
$linhas = [
    ['conta' => 'A', 'alvo' => 'Fulano', 'media' => 4.0, 'ts' => 1],
    ['conta' => 'A', 'alvo' => 'Fulano', 'media' => 9.0, 'ts' => 2], // trocou de ideia
    ['conta' => 'B', 'alvo' => 'Fulano', 'media' => 6.0, 'ts' => 3],
];
$ultima = [];
foreach ($linhas as $r) { $ultima[$r['conta'] . '|' . $r['alvo']] = $r; }
checa(count($ultima) === 2, 'duas contas contam como duas avaliacoes, nao tres');
checa($ultima['A|Fulano']['media'] == 9.0, 'a reavaliacao substitui a anterior');
$medias = array_map(fn($r) => $r['media'], array_values($ultima));
sort($medias);
checa(mediana($medias) == 7.5, 'o agregado usa so a versao mais recente de cada conta');

echo "\n";
@unlink($arquivoResumoTeste);
@rmdir($tmp);
if ($falhas) {
    echo "$falhas verificacao(oes) falharam\n";
    exit(1);
}
echo "tudo passou\n";
