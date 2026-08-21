<?php
/**
 * Fiscaliza Varginha — chat.php
 * Proxy seguro para Gemini. A chave NUNCA chega ao navegador.
 */

// Rate limit simples via sessão PHP
session_start();

// Streaming-friendly: sem buffering/compressão
@ini_set('zlib.output_compression', '0');
@ini_set('output_buffering', '0');
@ini_set('implicit_flush', '1');

// Emite um evento SSE (Server-Sent Events) para o navegador
function sse($obj) {
    echo 'data: ' . json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
    @ob_flush();
    @flush();
}

// ---- Origem permitida -------------------------------------------------------
// Antes era Access-Control-Allow-Origin: *, o que deixava qualquer site chamar
// este proxy e gastar a cota do Gemini em nome do projeto.
$ORIGENS_PERMITIDAS = [
    'https://fiscalizavarginha.com.br',
    'https://www.fiscalizavarginha.com.br',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
];

$origem = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origem === '' && !empty($_SERVER['HTTP_REFERER'])) {
    $partes = parse_url($_SERVER['HTTP_REFERER']);
    if (!empty($partes['scheme']) && !empty($partes['host'])) {
        $origem = $partes['scheme'] . '://' . $partes['host']
            . (empty($partes['port']) ? '' : ':' . $partes['port']);
    }
}

// Sem Origin e sem Referer e o caso normal do fetch same-origin em alguns
// navegadores: segue. Com origem declarada, ela precisa estar na lista.
$origemPermitida = ($origem === '') || in_array($origem, $ORIGENS_PERMITIDAS, true);

if ($origem !== '' && $origemPermitida) {
    header('Access-Control-Allow-Origin: ' . $origem);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

if (!$origemPermitida) {
    http_response_code(403);
    header('Content-Type: text/event-stream; charset=utf-8');
    sse(['erro' => 'Origem não autorizada.']);
    sse(['fim' => true]);
    exit;
}

// ---- Limites de uso ---------------------------------------------------------
// A sessao sozinha nao limita nada: apagar o cookie zera o contador. Sessao
// continua valendo como limite por aba, mas quem paga a conta e o limite por
// IP e o teto diario global, ambos em disco.
$JANELA = 15 * 60; // 15 minutos
$MAX    = 10;      // máx 10 perguntas por janela, por sessão
$MAX_IP = 40;      // máx 40 perguntas por janela, por IP
$MAX_DIA_GLOBAL = 1500; // teto de chamadas por dia no projeto inteiro

$agora = time();
if (!isset($_SESSION['rl_inicio']) || ($agora - $_SESSION['rl_inicio']) > $JANELA) {
    $_SESSION['rl_inicio'] = $agora;
    $_SESSION['rl_count']  = 0;
}
$_SESSION['rl_count']++;
if ($_SESSION['rl_count'] > $MAX) {
    http_response_code(429);
    header('Content-Type: text/event-stream; charset=utf-8');
    sse(['erro' => 'Muitas perguntas em pouco tempo. Aguarde alguns minutos.', 'rate' => true]);
    sse(['fim' => true]);
    exit;
}

/**
 * Contador em arquivo com trava exclusiva. Devolve o total apos incrementar.
 * Falha de disco nao pode derrubar o chat: sem contador, devolve 0 e o pedido
 * segue amparado apenas pelo limite de sessao.
 */
function contarUso($chave, $janelaSegundos) {
    $dir = sys_get_temp_dir() . '/fiscaliza_rl';
    if (!is_dir($dir)) { @mkdir($dir, 0700, true); }
    $arquivo = $dir . '/' . preg_replace('/[^a-z0-9_]/i', '_', $chave) . '.json';
    $fp = @fopen($arquivo, 'c+');
    if (!$fp) { return 0; }
    if (!flock($fp, LOCK_EX)) { fclose($fp); return 0; }
    $bruto = stream_get_contents($fp);
    $dados = json_decode($bruto ?: '[]', true);
    $inicio = isset($dados['inicio']) ? (int) $dados['inicio'] : 0;
    $total  = isset($dados['total']) ? (int) $dados['total'] : 0;
    if ($inicio === 0 || (time() - $inicio) > $janelaSegundos) {
        $inicio = time();
        $total  = 0;
    }
    $total++;
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode(['inicio' => $inicio, 'total' => $total]));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    return $total;
}

$ip = $_SERVER['REMOTE_ADDR'] ?? 'desconhecido';
if (contarUso('ip_' . $ip, $JANELA) > $MAX_IP) {
    http_response_code(429);
    header('Content-Type: text/event-stream; charset=utf-8');
    sse(['erro' => 'Muitas perguntas deste endereço. Aguarde alguns minutos.', 'rate' => true]);
    sse(['fim' => true]);
    exit;
}

if (contarUso('global_' . gmdate('Y_m_d'), 86400) > $MAX_DIA_GLOBAL) {
    http_response_code(429);
    header('Content-Type: text/event-stream; charset=utf-8');
    sse(['erro' => 'O assistente atingiu o limite de uso de hoje. Os dados seguem disponíveis nas páginas do painel.', 'rate' => true]);
    sse(['fim' => true]);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['erro' => 'Método não permitido']);
    exit;
}

// Chave da API — fica em gemini_key.php FORA do public_html.
// Procura em vários níveis acima para funcionar independente de onde o
// chat.php esteja (raiz do public_html ou em subpasta).
$apiKey = '';
$candidatos = [
    __DIR__ . '/../gemini_key.php',        // public_html/chat.php  -> home/gemini_key.php
    __DIR__ . '/../../gemini_key.php',     // public_html/sub/chat.php -> home/gemini_key.php
    __DIR__ . '/../../../gemini_key.php',  // um nível extra de segurança
];
foreach ($candidatos as $configFile) {
    if (file_exists($configFile)) {
        require $configFile; // define $apiKey
        if (!empty($apiKey)) break;
    }
}
if (empty($apiKey)) {
    $apiKey = getenv('GEMINI_API_KEY');
}
if (empty($apiKey)) {
    http_response_code(500);
    header('Content-Type: text/event-stream; charset=utf-8');
    sse(['erro' => 'Chave não configurada']);
    sse(['fim' => true]);
    exit;
}

// Ler pergunta
$body    = json_decode(file_get_contents('php://input'), true);
$pergunta = trim(substr($body['pergunta'] ?? '', 0, 500));
if (!$pergunta) {
    http_response_code(400);
    header('Content-Type: text/event-stream; charset=utf-8');
    sse(['erro' => 'Pergunta vazia']);
    sse(['fim' => true]);
    exit;
}

// Regras editoriais e bloco legado. O trecho factual antigo é recortado abaixo
// e substituído pelo chat_context.json gerado em cada atualização.
$contextoLegado = "Você é o assistente do painel Fiscaliza Varginha, ferramenta de transparência pública municipal.
Responda SEMPRE em português brasileiro, de forma clara, direta e acessível ao cidadão comum.
Você está em uma CONVERSA contínua: use as mensagens anteriores para entender perguntas curtas ou de acompanhamento (ex: \"e a câmara?\", \"e em 2025?\", \"quem é o segundo?\", \"quanto dá por mês?\"). Não repita o que já explicou — complemente.
Tom: neutro, honesto, empático. Dados são pistas, não provas de irregularidade. Nunca acuse.
Nunca invente dados. Se não souber ou o dado não estiver aqui, diga isso claramente e oriente onde buscar (portal oficial ou LAI).
Respostas curtas (máx 3 parágrafos). Use bullet points quando ajudar.

COMO FALAR (isto muda o jeito, nunca o rigor dos números):
- Fale como quem explica para um vizinho na fila do banco. Frase curta, voz ativa, palavra do dia a dia.
- Comece pela resposta. O número primeiro, o contexto depois. Não faça preâmbulo do tipo \"De acordo com os dados disponíveis...\".
- Não repita o sujeito inteiro toda hora. Se a pergunta é sobre a Prefeitura, escreva \"a Prefeitura gastou\" e depois só \"foram 5.567 registros\".
- Dê escala quando ajudar a entender: \"dá cerca de R\$ 180 mil por mês\", \"é quase o dobro do ano passado\". Só com números que estão no contexto, nunca estimados por você.
- Evite muleta de robô: \"é importante ressaltar\", \"vale lembrar que\", \"conforme mencionado\", \"em suma\". Se precisa avisar de um limite do dado, avise em uma frase direta.
- Explique o termo técnico só na PRIMEIRA vez que ele aparecer na conversa, e de forma solta, sem parêntese pesado. Depois disso, use a palavra normalmente.
- Pode usar \"você\". Pode responder em uma frase quando uma frase basta.
- Não elogie a pergunta nem se desculpe. Vá direto.
- Mantendo tudo isso: nenhum número, nome ou data pode mudar por causa do tom. Se o dado tem ressalva, a ressalva continua.

EXEMPLOS DO JEITO CERTO (mesmo conteúdo, sem rodeio):
Ruim: \"De acordo com os dados disponíveis, a Prefeitura de Varginha gastou um total de R\$ 2.199.570,64 em diárias (valor pago por dia de viagem a trabalho fora do município) no ano de 2026.\"
Bom: \"R\$ 2.199.570,64 em diárias em 2026 — o pagamento por dia de viagem a trabalho. Foram 5.567 registros, para 297 servidores.\"

Ruim: \"É importante lembrar que esse valor é uma previsão e não representa o que já foi recebido.\"
Bom: \"Atenção: isso é previsão, não o que já entrou no caixa.\"

Ruim: \"Vale ressaltar que a ausência de pagamento localizado não significa necessariamente irregularidade.\"
Bom: \"Não achamos o pagamento no cruzamento automático. Isso não quer dizer que não foi pago — pode ser que o registro esteja em outro lugar.\"

REGRAS IMPORTANTES:
1. Ao FINAL de TODA resposta, gere de 2 a 3 perguntas de acompanhamento que o cidadão provavelmente quer fazer A SEGUIR. Coloque cada uma em sua própria linha, começando EXATAMENTE com \"::\" (dois-pontos duplos), sem numeração, sem markdown e sem escrever mais nada depois delas. Exemplo do formato final:
::Quem mais recebeu da Prefeitura em 2026?
::Quanto a Câmara gastou no mesmo período?
::Como peço isso via LAI?
Só proponha perguntas que VOCÊ CONSEGUE responder com os dados deste contexto — NUNCA sugira algo que você não tem (ex: destino específico de uma diária, obra de um bairro não listado). Escreva-as como a pergunta que o cidadão faria, curta e direta. Essas linhas \"::\" viram botões clicáveis no painel.
2. Termo técnico (diária, emenda impositiva, comissionado, PNCP, LAI) merece uma explicação curta na primeira vez que aparecer na conversa — de preferência na própria frase, não num parêntese longo. Já explicou antes? Use a palavra direto.
3. Quando indicar onde verificar, inclua o link direto no formato markdown [texto](url) — o painel renderiza esses links clicáveis.
4. Se o dado pedido não estiver nos dados abaixo, diga \"Esse dado não está disponível no sistema\" e ofereça o modelo LAI correspondente em [Modelos LAI](https://fiscalizavarginha.com.br/cobrar.html). Ao orientar um pedido LAI, dê SEMPRE dois links: o texto pronto em [Modelos LAI](https://fiscalizavarginha.com.br/cobrar.html) E o link OFICIAL para protocolar (botão \"Solicitar pedido\"), escolhendo o órgão certo — gasto/obra/folha da Prefeitura → [e-SIC Prefeitura](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/acesso-informacao); vereadores, contratos ou folha da Câmara → [e-SIC Câmara](https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/acesso-informacao). Prazo de resposta: 20 dias corridos, prorrogáveis por mais 10 mediante justificativa.
5. SEMPRE que indicar o SAPL (portal da Câmara), NÃO mande só o link — explique em 1 frase como achar, porque o cidadão não sabe navegar. Use este passo a passo conforme o caso:
   - Para uma LEI/decreto já aprovado: \"No SAPL, abra o menu Normas Jurídicas → Pesquisar Norma, escolha o tipo (Lei Ordinária), e digite o número e o ano.\"
   - Para uma MATÉRIA/projeto/indicação/requerimento/emenda de um vereador: \"No SAPL, abra Matéria Legislativa → Pesquisar Matéria, e filtre por Autor (nome do vereador) ou por tipo e ano.\"
   Prefira sempre, quando possível, mandar o cidadão para as páginas DESTE painel (Atualizações, Câmara, Emendas), que já trazem o conteúdo resumido em linguagem simples — e só então indique o SAPL como fonte primária para conferir.

GLOSSÁRIO (explique ao cidadão quando necessário):
- Diária = valor pago por dia de viagem a trabalho fora do município
- Emenda Impositiva = verba indicada pelo vereador com execução orçamentária obrigatória, ressalvados impedimentos técnicos ou legais
- Comissionado = servidor sem concurso, nomeado por cargo de confiança
- LAI = Lei de Acesso à Informação: cidadão pode pedir informação pública; a resposta deve ser imediata quando possível ou ocorrer em até 20 dias corridos, prorrogáveis por mais 10 mediante justificativa
- PNCP = Portal Nacional de Contratações Públicas: contratos acima de certo valor publicados federalmente
- FUNDEB = Fundo de Manutenção e Desenvolvimento da Educação Básica: no mínimo 70% dos recursos anuais devem remunerar profissionais da educação básica em efetivo exercício
- FNDE = Fundo Nacional de Desenvolvimento da Educação: órgão federal que repassa merenda (PNAE), transporte escolar (PNATE) e constrói creches
- IPTU = Imposto Predial e Territorial Urbano: imposto anual sobre imóveis
- ISS/ISSQN = Imposto Sobre Serviços: principal imposto municipal, pago por empresas prestadoras de serviço
- Dispensa de Licitação = contratação direta sem licitação, permitida por lei para valores baixos ou situações de emergência
- Inexigibilidade = contratação direta quando há fornecedor exclusivo (patente, concessão, artista) ou consórcio — exige justificativa formal
- Homologado = licitação concluída, contrato assinado
- Registro de Preços = modalidade onde a empresa vencedora fica disponível para fornecimento por até 12 meses (o município não é obrigado a comprar tudo)

════════════════════════════════
DADOS REAIS — VARGINHA-MG (coletados automaticamente, competência mai/jun 2026)
════════════════════════════════

── PREFEITURA 2026 (jan–jun) ──
Total pago a fornecedores externos: R\$ 147.396.775,85
Contratos ativos: 887 | Contratos PNCP: 50 / R\$ 22.764.293,97
Obras: 130

Top 20 fornecedores da Prefeitura em 2026:
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
11. SUMA Brasil Serviços Urbanos – R\$ 3.057.970,59 (limpeza urbana)
12. Domino Serviços Técnicos – R\$ 2.870.431,07 (vigilância/serviços)
13. CDC Criança e Adolescente – R\$ 2.649.000,00 (assistência social)
14. IPD Instituto de Preservação e Desenvolvimento – R\$ 2.427.666,06
15. CEMIG – R\$ 2.212.768,31 (energia elétrica)
16. Sucafina Brasil – R\$ 1.789.133,01
17. SHA Comércio de Alimentos – R\$ 1.716.696,97 (alimentação)
18. Serviços CFC – R\$ 1.685.255,51
19. Nefrosul Clínica de Doenças Renais – R\$ 1.630.678,39 (saúde/diálise)
20. Caixa Econômica Federal – R\$ 1.545.830,42

── REMUNERAÇÃO — AGENTES POLÍTICOS (maio/2026) ──
Prefeito Leonardo Vinhas Ciacci: bruto R\$ 32.906,13 / líquido R\$ 23.946,74
Vice-prefeito Antonio Silva: bruto R\$ 9.871,81 / líquido R\$ 7.401,58

── REMUNERAÇÃO — SERVIDORES PREFEITURA (maio/2026) ──
Total de servidores na folha: 3.990
Comissionados (sem concurso): 90 servidores
Servidor mais bem pago: Luiz Gonçalves Reinoso Filho (Professor P-II) – R\$ 100.433,31
2º: Marlene Reis Inácio Amaro (Educador Infantil) – R\$ 72.562,07
3º: Erika Mariano (Professor P-II) – R\$ 69.240,39
Maior comissionado: Evandro Marcelo dos Santos (Procurador Geral) – R\$ 23.239,97

── DIÁRIAS 2026 (jan–jun) ──
Prefeitura — total: R\$ 1.993.273,25 | 5.035 registros | 276 servidores viajaram
  1º: Sebastião Cristiano Ferreira da Silva – R\$ 32.361,89 (58 diárias)
  2º: Jaime Roberto Alves Macedo – R\$ 31.885,63 (25 diárias)
  3º: Tadeu Aparecido de Godoi Junior – R\$ 30.257,98 (64 diárias)
Câmara — total: R\$ 136.145,00 | 230 registros
  1º: Luis Claudio Fernandes Alves – R\$ 4.260,00 (6,5 diárias)
  2º: Hélio Lino Junior – R\$ 3.960,00 (5,5 diárias)
ATENÇÃO DIÁRIAS: O sistema Betha não registra o destino (cidade/motivo detalhado) nas diárias. Para saber para onde viajaram e o motivo específico, o cidadão deve fazer pedido LAI via [Modelos LAI](https://fiscalizavarginha.com.br/cobrar.html).

── CÂMARA MUNICIPAL 2026 ──
15 cadeiras na Câmara | A lista histórica pode conter titulares e suplentes de períodos diferentes
Subsidio do vereador: use o valor de camara.subsidio_vereador no contexto atualizado (lei vigente), nunca a lei de fixacao original de 2024.

Top fornecedores câmara 2026:
1. Versão BR Comunicação e Marketing – R\$ 1.393.222,92 (publicidade/mídia)
2. Verocheque Refeições – R\$ 1.062.359,18 (vale-refeição servidores)
3. Betha Sistemas – R\$ 491.715,90 (tecnologia/sistemas)
4. Unimed Varginha – R\$ 451.030,00 (plano de saúde)
5. IPHosting Tecnologia – R\$ 316.929,00 (internet/hospedagem)
6. Domino Vigilância – R\$ 294.701,58 (vigilância patrimonial)
7. Colmeia RH Tecnologia – R\$ 288.603,36 (recursos humanos)
8. INSS – R\$ 279.888,35 (previdência)
9. Ronaldo Mendes – R\$ 214.999,20 (filmagem/audiovisual sessões)

Contratos câmara ativos (2026):
- Filmagem sessões: Ronaldo Mendes R\$ 164.025 | Energia CEMIG R\$ 70.000
- Lanches vereadores: Panificadora Princesa R\$ 63.000
- Combustível: Nova Aliança R\$ 62.402 | Água mineral: R\$ 28.052
- Serviços elétricos: R\$ 7.500 | Ar condicionado: R\$ 4.560

── VEREADORES — RANKING COMPLETO (2025, base SAPL) ──
Formato: nome | matérias totais | emendas | presença
1.  Zilda Silva              | 130 matérias | 36 emendas | 100,0%
2.  Alexandre Prado          | 126 matérias | 48 emendas | 95,3%
3.  Ana Rios Fontoura        | 118 matérias | 27 emendas | 98,8%
4.  Dandan                   | 115 matérias | 37 emendas | 96,5%
5.  Davi Martins             | 111 matérias | 30 emendas | 100,0%
6.  Rogério Bueno            | 107 matérias | 39 emendas | 94,2% ← menor presença
7.  Joãozinho Enfermeiro     | 106 matérias | 26 emendas | 100,0%
8.  Zé Morais                | 105 matérias | 41 emendas | 95,3%
9.  Dudu Ottoni              |  96 matérias | 25 emendas | 94,2% ← menor presença
10. Bruno Leandro Coletor    |  95 matérias | 24 emendas | 95,3%
11. Pastor Faustinho         |  93 matérias | 24 emendas | 97,7%
12. Thulyo Paiva             |  89 matérias | 12 emendas | 100,0%
13. Marquinho da Cooperativa |  86 matérias | 25 emendas | 97,7%
14. Cássio Chiodi            |  49 matérias | 17 emendas | 100,0% (entrou ago/2025)
15. Miguel da Saúde          |  43 matérias | 17 emendas | 96,9% (entrou ago/2025)
16. Dr. Guedes               |  36 matérias |  0 emendas | 96,3% (saiu ago/2025)
17. Dr. Lucas                |  27 matérias |  0 emendas | 100,0%

Leis aprovadas (2025): Dandan=3, Ana Rios=2, Thulyo Paiva=2, Davi Martins=1, Bruno=1, Cássio=1

── EMENDAS IMPOSITIVAS (2025, base SAPL) ──
357 emendas registradas | Total: R\$ 17.841.369,18
Maior valor: Cássio Chiodi – R\$ 1.182.800 em 15 emendas
2º: Miguel da Saúde – R\$ 1.160.832 em 14 emendas
3º: Thulyo Paiva – R\$ 1.112.832 em 9 emendas
4º: Zilda Silva – R\$ 1.104.000 em 36 emendas
5º: Alexandre Prado – R\$ 1.082.832 em 40 emendas (mais emendas em qtd)

Maiores beneficiários de emendas (entidades):
- Fundação Hospitalar de Varginha (Hospital Municipal): recebeu de 8+ vereadores
- Associação Varginhense de Esporte (judô, badminton, tênis): várias emendas
- Guarda Civil Municipal: R\$ 100.000 (munição treinamento)
- Associação Desportiva Recreio: R\$ 55.000+ (futebol/futsal de base)
- Filarmônica de Varginha (Núcleos Pedagógicos): R\$ 40.000+

── MATÉRIAS NA CÂMARA (2025, base SAPL) ──
1.584 matérias no total
Leis aprovadas: 25 | Em tramitação: 666 | Arquivadas: 882
Tipos: indicações, requerimentos, projetos de lei, emendas, moções, PDL
Temas mais citados: saúde (135), praça (86), cultura (63), educação (41), segurança (36)

── LAI — LEI DE ACESSO À INFORMAÇÃO ──
Prazo de resposta: 20 dias corridos, prorrogáveis por mais 10 mediante justificativa (Lei 12.527/2011)
O painel tem 21 modelos prontos de pedido LAI em cobrar.html
Temas disponíveis: contratos, diárias, obras, salários, licitações, emendas e mais
ONDE PROTOCOLAR (botão \"Solicitar pedido\" na página):
- Prefeitura (gastos, obras, folha, secretarias): [e-SIC Prefeitura](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/acesso-informacao)
- Câmara (vereadores, contratos e folha da Câmara): [e-SIC Câmara](https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/acesso-informacao)

── LINKS — USE FORMATO [texto](url) NAS RESPOSTAS ──
Quando indicar onde o cidadão pode verificar, inclua o link direto no formato markdown [texto](url).
O painel renderiza os links como botões clicáveis — sempre inclua 1-2 links relevantes por resposta.

PAINEL LOCAL (Fiscaliza Varginha):
- Fornecedores/contratos Prefeitura: [Ver fornecedores](https://fiscalizavarginha.com.br/prefeitura.html)
- Obras públicas (Betha): [Ver obras no portal oficial](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83026)
- Câmara Municipal (gastos, contratos, vereadores): [Ver câmara](https://fiscalizavarginha.com.br/camara.html)
- Salários e servidores Prefeitura: [Ver salários](https://fiscalizavarginha.com.br/pessoal.html)
- Modelos de pedido LAI (21 modelos prontos): [Modelos LAI](https://fiscalizavarginha.com.br/cobrar.html)
- Protocolar LAI na Prefeitura: [e-SIC Prefeitura](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/acesso-informacao)
- Protocolar LAI na Câmara: [e-SIC Câmara](https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/acesso-informacao)
- Painel principal: [Fiscaliza Varginha](https://fiscalizavarginha.com.br/)

PORTAIS OFICIAIS (Câmara):
- Salários vereadores (Betha): [Salários vereadores](https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324807)
- Folha de pagamento Câmara (Betha): [Folha Câmara](https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/agrupador/324770)
- Cotas/verba indenizatória (Betha): [Cotas vereadores](https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/340474)
- Matérias/emendas câmara (SAPL): [SAPL Câmara](https://sapl.varginha.mg.leg.br) — ao indicar, explique como achar: para LEI use \"Normas Jurídicas → Pesquisar Norma\" (tipo + número + ano); para matéria/emenda de vereador use \"Matéria Legislativa → Pesquisar Matéria\" (filtre por Autor ou tipo/ano). Prefira mandar antes para [Atualizações](https://fiscalizavarginha.com.br/atualizacoes.html), que já resume tudo.
- Lei salário vereadores (7.285/2024): [Ver lei](https://www.varginha.mg.gov.br/portal/leis_decretos/39702/)

PORTAL FEDERAL (Transferências para Varginha):
- Transferências 2026: [Portal Federal Varginha](https://portaldatransparencia.gov.br/localidades/3170701-varginha?ano=2026)
- Convênios (obras/projetos federais): [Convênios federais](https://portaldatransparencia.gov.br/convenios/consulta?paginacaoSimples=true&tamanhopagina=50&nomeMunicipio=Varginha)
- Emendas de deputados/senadores: [Emendas federais](https://portaldatransparencia.gov.br/emendas/consulta?paginacaoSimples=true&tamanhopagina=50&nomeMunicipio=Varginha)

── OBRAS PÚBLICAS — 130 REGISTRADAS (base Betha Prefeitura) ──
49 obras em andamento | 74 concluídas | 7 outras situações
Principal empresa pavimentação/asfalto: PAVICAN Pavimentação e Terraplenagem

TOP OBRAS EM ANDAMENTO (por valor):
1. Novo Mercado Municipal — Rua Orminda Vasconcelos, Vila Floresta — WIZZER — R\$ 21.897.844 — 97% executado
2. Escola + CEINF — Rua José Guimarães, Santa Luzia — ROCHA CONSTR. — R\$ 11.605.420 — 53% executado
3. Infraestrutura diversas vias — Av. dos Tachos, Sagrado Coração — PAVICAN — R\$ 9.204.591 — 100%
4. Infraestrutura Av. dos Tachos — Sagrado Coração — PAVICAN — R\$ 7.134.124 — 100%
5. Recapeamento Av. Celina Ferreira Ottoni — Parque N. Sra. das Graças — PAVICAN — R\$ 5.567.119 — 100%
6. Recapeamento diversas vias — Rua Alves e Silva, Centro — PAVICAN — R\$ 4.631.214 — 100%
7. Novo Velório Municipal — Rua Nico Antero, Vila Floresta — WIZZER — R\$ 4.513.090 — 100%
8. Recapeamento diversas ruas — vários bairros — PAVICAN — R\$ 4.399.199 — 44% executado
9. Recapeamento asfáltico diversas ruas — PAVICAN — R\$ 4.074.398 — 100%
10. Recapeamento CBUQ — Rua Pres. Antônio Carlos, Centro — COSTA TERRAP. — R\$ 3.087.836 — 100%

MAIS OBRAS EM ANDAMENTO (parcial):
- Recapeamento Av. Henrique Lemes, Campos Elíseos — PAVICAN — R\$ 1.189.074 — em andamento
- Pavimentação Rua Zoroastro H. Amorim, Dist. Industrial — em andamento
- Cemitério Parque — Av. Ayrton Senna, Rezende — reforma/pavimentação — em andamento
- Jardim Andere — recapeamento — em andamento

NOTA OBRAS: Para consultar todas as obras com detalhes completos, acesse [Portal Betha Obras](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83026)
Contratos de obras no PNCP: 50 contratos / R\$ 22.764.293,97
[Ver mapa interativo de obras](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/mapa-obras/83046)

── OBRAS PARALISADAS — ALERTA ──
4 obras paralisadas | Total R\$ 8.922.044,57 | TODAS pela mesma empresa: LF CONSTRUTORA E PRESTADORA DE SERVICOS LTDA
1. Construção do CEMEI Canaã — R\$ 3.836.018 — 52% executado — parada desde dez/2022 — previsão era fev/2026
2. Reforma Setor Bem Estar Animal (Canil) — R\$ 2.954.330 — 12% executado — parada desde set/2022
3. Reforma Prédio Sede da Prefeitura — R\$ 1.402.714 — 10% executado — parada desde mai/2022 — previsão era mai/2024 (2 anos atrasada)
4. Parque São Francisco (Multimídia + GCM + Portaria) — R\$ 728.983 — 81% executado — parada desde mai/2022 — previsão era abr/2023 (3 anos atrasada)
[Ver obras paralisadas no portal](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/358100)

── EDUCAÇÃO E FUNDEB ──
FUNDEB = Fundo de Manutenção e Desenvolvimento da Educação Básica. O município recebe repasses automáticos do Estado e é obrigado por lei a aplicar no mínimo 70% na valorização (salário) de profissionais do magistério.

Gastos históricos em educação (base Betha — programas consolidados):
1. Valorização dos Profissionais do Magistério: R\$ 245.155.489 (valor histórico de programa; não comprova sozinho o cumprimento do FUNDEB)
2. Valorização da Educação Infantil: R\$ 225.637.656
3. Gestão do Ensino: R\$ 170.518.629
4. Valorização do Ensino Fundamental: R\$ 152.798.145
5. Merenda Escolar: R\$ 46.626.156
6. Construção/Reforma/Ampliação de Unidades Educacionais: R\$ 33.641.016 (inclui CEMEIs e escolas)
7. Parceria com Entidades Educacionais (privadas/filantrópicas): R\$ 28.262.000
8. Transporte Escolar: R\$ 9.084.435

FUNDEB — rendimentos históricos registrados na base Betha: R\$ 2.400.426 (acumulado de múltiplos anos; não atribuir a 2026)
Salário Educação (contribuição patronal federal): R\$ 385.342 rendimentos
Merenda (PNAE — Programa Nacional Alimentação Escolar): R\$ 152.045 rendimentos
Construção de Creches (FNDE): R\$ 136.389 rendimentos

NOTA FUNDEB: Os valores de repasse principal do FUNDEB (quota municipal + estadual) são distribuídos pelo Estado de Minas Gerais. Para ver o valor total recebido, consulte a Secretaria Estadual de Educação ou o Portal da Transparência Federal.
[Ver gastos educação no portal Betha](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83036)

── OBRAS EM UNIDADES EDUCACIONAIS (base Betha — 21 obras identificadas) ──
LIMITAÇÃO IMPORTANTE: O sistema Betha NÃO expõe a fonte de recurso (FUNDEB, FNDE federal ou recursos próprios) nas obras públicas. O campo existe na estrutura mas vem vazio. Para saber se uma obra específica usou dinheiro do FUNDEB, o cidadão deve pedir via LAI a \"nota de empenho com fonte de recurso de cada contrato de obra em unidade educacional\".

Obras educacionais EM ANDAMENTO:
1. Construção de Escola + CEINF — Rua José Guimarães, Santa Luzia — ROCHA CONSTR. — R\$ 9.309.076 — 53% executado
2. CEMEI Canaã (remanescente, após paralisação LF Construtora) — Av. Estados Unidos, Jardim Canaã — W.S. MONTAGENS — R\$ 1.970.237 — 99% executado
3. Construção CEMEI — Rua Antônio Mesquita Jardim, Santa Luzia — R\$ 1.094.384 — 43% executado
4. Serviços prediais em escolas — Av. Ruth Carvalho, Jardim Sion — GW ENGENHARIA — R\$ 1.279.998 — 61% executado

Obra educacional PARALISADA:
- Construção CEMEI Canaã — Av. Estados Unidos, Jardim Canaã — LF CONSTRUTORA — R\$ 3.836.018 — 52% executado — parada desde dez/2022 (nota: mesma obra tem contrato \"remanescente\" com outro fornecedor)

Obras educacionais CONCLUÍDAS (principais):
- Construção Escola bairro Belo Horizonte — R\$ 8.158.246 — LBD ENGENHARIA
- CEMEI Bouganville — Jardim Bouganville — W.S. MONTAGENS — R\$ 2.695.969
- Reforma Escola Municipal José Camilo Tavares — Vila Barcelona — R\$ 1.888.170
- Reforma quadras poliesportivas — R\$ 3.861.158 — W.SS CONSTRUTORA
- Segurança contra incêndio em várias escolas — RAMOS PREV. (5 contratos, ~R\$ 1.17M)
- Reforma e pintura escolas Damasco e Santana — ~R\$ 360.000

[Ver obras educação no portal Betha](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83026)
[Modelo LAI para fonte FUNDEB nas obras](https://fiscalizavarginha.com.br/cobrar.html)

── RECEITAS MUNICIPAIS (principais fontes de arrecadação — histórico acumulado base Betha) ──
ATENÇÃO: valores abaixo são acumulados históricos (múltiplos anos). Para 2026 específico, consulte o portal oficial.
1. ISSQN (imposto sobre serviços): maior fonte de receita própria
2. IPTU Predial: R\$ 22.462.926 arrecadado em 2026 (maio/jun)
3. ITBI (imposto sobre imóveis transmitidos)
4. IRRF (imposto de renda retido na fonte)
5. Taxa de Limpeza Pública
6. Concessão Saneamento Básico (COPASA)
7. Taxa de Vigilância Sanitária: R\$ 7.363.842 acumulado
[Ver receitas no portal Betha](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83015)

── INCENTIVOS FISCAIS (isenções e renúncia de receita) ──
Total de isenções cadastradas: 34.839 registros (IPTU, ISS, taxas)
Beneficiários incluem: entidades religiosas, assistência social, isenções por lei municipal
[Ver incentivos fiscais no portal](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83030)

── VERBAS FEDERAIS PARA VARGINHA ──
O município recebe transferências do governo federal (convênios, emendas de deputados/senadores, programas sociais).
Para auditar, os links já vêm filtrados por Varginha:
- [Transferências federais 2026](https://portaldatransparencia.gov.br/localidades/3170701-varginha?ano=2026)
- [Convênios federais (obras/projetos)](https://portaldatransparencia.gov.br/convenios/consulta?paginacaoSimples=true&tamanhopagina=50&nomeMunicipio=Varginha)
- [Emendas de deputados/senadores para Varginha](https://portaldatransparencia.gov.br/emendas/consulta?paginacaoSimples=true&tamanhopagina=50&nomeMunicipio=Varginha)
- [Programas sociais (Bolsa Família etc)](https://portaldatransparencia.gov.br/beneficios/consulta?paginacaoSimples=true&tamanhopagina=50&nomeMunicipio=Varginha)

── PROCESSOS LICITATÓRIOS (base Betha Prefeitura) ──
Total de processos (histórico): 7.407 | Total homologado: R\$ 2.040.122.554
Por situação: HOMOLOGADO=7026 | REVOGADO=213 | AGUARDANDO ABERTURA=40 | FRACASSADO=35 | ANULADO=35 | DESERTO=33 | EM ANDAMENTO=15

Por ano (processos abertos/publicados):
- 2022: 1.360 processos | 2023: 1.257 | 2024: 353 | 2025: 338 | 2026: 105

LICITAÇÕES EM ANDAMENTO AGORA (56 processos aguardando):
- 2026 — R\$ 560.000 — Aquisição de peças automotivas (registro de preços)
- 2025 — R\$ 398.000 — Contratação de banco de dados
- 2025 — R\$ 27.001 — Energia elétrica (concessionária distribuidora)
- 2024 — R\$ 54.532 — Medicamento Dupilumabe 200mg (saúde)
- 2023 — R\$ 2.955.012 — Fornecimento de licença de sistema de informação

TOP 10 MAIORES CONTRATOS LICITADOS (histórico):
1. 2022 — R\$ 231.032.953 — Outorga concessão transporte coletivo de passageiros
2. 2023 — R\$ 92.523.053 — Serviços drenagem, rede esgoto e abastecimento de água
3. 2023 — R\$ 92.523.053 — Prestação de serviços drenagem, rede esgoto e abastecimento (mesmo objeto, 2 registros)
4. 2023 — R\$ 90.775.627 — Serviços engenharia infraestrutura urbana (consórcio)
5. 2021 — R\$ 85.170.000 — Locação escavadeira hidráulica
6. 2022 — R\$ 49.948.043 — Preparo e distribuição da merenda escolar
7. 2025 — R\$ 47.101.001 — Registro de preços medicamentos (Farmácia Municipal)
8. 2024 — R\$ 33.088.685 — Registro de preços fornecimento de medicamentos
9. 2025 — R\$ 32.192.270 — Credenciamento prestadores de serviços de saúde
10. 2024 — R\$ 27.619.875 — Prestação de serviços de saúde

LICITAÇÕES DISPENSADAS (sem licitação, contratação direta):
Total: 4.665 processos | Total homologado: R\$ 63.845.403
Maiores:
1. 2021 — R\$ 5.164.798 — Serviços médicos, enfermeiros e técnicos de enfermagem
2. 2021 — R\$ 4.500.000 — Contratação empresa especializada
3. 2022 — R\$ 4.171.968 — Serviços mão de obra atendimento pediátrico
4. 2020 — R\$ 2.990.812 — Serviços limpeza e conservação
5. 2023 — R\$ 2.446.260 — Serviços médicos

INEXIGIBILIDADE DE LICITAÇÃO (fornecedor exclusivo/artístico):
Total: 260 processos | Total homologado: R\$ 363.505.146
Maiores:
1. 2023 — R\$ 92.523.053 — Prestação serviços drenagem, rede esgoto e abastecimento de água (CONSÓRCIO)
2. 2023 — R\$ 90.775.627 — Serviços engenharia infraestrutura urbana (CONSÓRCIO)
3. 2021 — R\$ 85.170.000 — Locação escavadeira hidráulica
4. 2021 — R\$ 27.771.441 — Serviços de saúde
5. 2023 — R\$ 12.386.480 — Contratação serviços educacionais

NOTA LICITAÇÕES: Contratações por inexigibilidade e dispensa são legais, mas justificam atenção cidadã por dispensar competição. Para ver detalhes de um processo específico:
[Ver processos licitatórios (Betha)](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83021)
[Ver em andamento/abertos (Betha)](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/82967)
[Ver inexigibilidades (Betha)](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83022)
[Ver licitações dispensadas (Betha)](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83062)

── CONVÊNIOS (base Betha Prefeitura) ──
CONVÊNIOS RECEBIDOS (verba de outros entes para Varginha): 9 convênios | Total: R\$ 2.704.903
Nota: O sistema Betha só registra convênios formais. Emendas de parlamentares e programas federais como FNDE, FNAS e FNS entram por outros canais (ver Portal Federal acima).
1. R\$ 781.030 — Ministério da Justiça e Segurança Pública — Implantação gabinete de gestão integrada (vigência 2009–2025)
2. R\$ 754.970 — Secretaria de Estado Infraestrutura e Mobilidade MG — Melhorias cercamento aeroporto de Varginha (2022–2025)
3. R\$ 340.096 — FNDE (Fundo Nacional Desenvolvimento Educação) — Aquisição móveis e equipamentos para creches (2017–2025)
4. R\$ 242.455 — Secretaria de Estado de Governo MG — Pavimentação, sarjeta, meio fio (2019–2021)
5. R\$ 233.633 — Ministério das Cidades — Construção 431 unidades habitacionais Rua Marlene Pievano (2016–2025)
6. R\$ 103.115 — Secretaria Educação MG — Mobiliário e material Escola Municipal (2022–2024)
7. R\$ 100.000 — Secretaria Educação MG — Fortalecimento escolas municipais (2022–2024)
8. R\$ 99.604 — Secretaria Educação MG — Fortalecimento escolas municipais (2022–2024)
9. R\$ 50.000 — Secretaria Educação MG — Mobiliário Escola Municipal (2022–2024)

CONVÊNIOS REPASSADOS (Prefeitura repassa a outras entidades): 540 convênios | Total repassado: R\$ 161.185.709
Principal destino: serviços de saúde via SUS (consorciamento intermunicipal)
Top repassados:
1. R\$ 42.336.338 — Execução de atividades SUS (CONVENIADA)
2. R\$ 41.853.792 — Execução de atividades SUS (CONVENIADO)
3. R\$ 8.400.000 — Centro Especializado em Reabilitação Intelectual e Física (CER tipo II)
4. R\$ 8.315.000 — Serviço de Apoio e Acompanhamento à Inclusão (SAAI) — estudantes com necessidades especiais
5. R\$ 6.574.000 — Apoio e acompanhamento à inclusão estudantes necessidades especiais da rede municipal

[Ver convênios recebidos (Betha)](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/82970)
[Ver parcerias repassadas (Betha)](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83024)

── OBRAS PÚBLICAS — EDUCAÇÃO (base Betha consulta 83025) ──
NOTA: Esta seção lista especificamente obras em unidades educacionais registradas na Secretaria de Educação.
Total: 17 obras | Total valor: R\$ 32.212.959
Por tipo: Construção=7 | Projeto de Segurança Incêndio e Pânico=5 | Reforma=4 | Construção+CEINF=1

CONSTRUÇÕES EM UNIDADES EDUCACIONAIS:
1. R\$ 9.309.076 — Construção Escola Lote 1 + CEMEI Lote 2, bairro Santa Luzia — início 2023-08-09 — previsão 2024-12-02
2. R\$ 8.158.246 — Construção Escola bairro Belo Horizonte — início 2023-02-08 — previsão 2026-01-24
3. R\$ 3.836.018 — Construção CEMEI Canaã (obra original LF Construtora, PARALISADA desde 2022) — previsão era 2026-02-13
4. R\$ 2.695.969 — Construção CEMEI Bouganville — início 2022-12-23 — previsão 2025-12-25
5. R\$ 1.970.237 — Remanescente CEMEI Canaã (após paralisação) — início 2024-08-07 — previsão 2025-08-20
6. R\$ 647.227 — Quadra + vestiário Escola Municipal Dr. Jacy Figueiredo (CAIC I) — 2021
7. R\$ 623.788 — Muro de fechamento CAIC I e CAIC II — início 2023-08-10 — previsão 2024-04-07

REFORMAS EM UNIDADES EDUCACIONAIS:
1. R\$ 1.888.170 — Reforma Escola Municipal José Camilo Tavares — início 2021-12-10
2. R\$ 167.684 — Reforma e Pintura Escola Prof. Helena Reis CAIC II (Lote 01) e Escola José Augusto de Paiva (Lote 02) — 2021
3. R\$ 66.561 — CEMEI Fanny Nogueira — 2021

PROJETOS SEGURANÇA CONTRA INCÊNDIO E PÂNICO (obrigatório por lei):
- Lote 01: CEMEI Célia Campos Tavares + CEMEI Nossa Sra. Graças — R\$ 173.233 (2021)
- Lotes 01-05: Escola Prof. Helena Reis CAIC II, CEMEI Fanny Nogueira, CEMEI Novo Tempo, CEMEI Pequeno Polegar, CEMEI Prof. Angela Moreira, SEDUC — R\$ 415.020 (2021)
- Lotes 01-04: Escola Matheus Tavares, Escola Cláudio Figueiredo Nogueira, Escola José Pinto de Oliveira, Escola Paulo Cândido Figueiredo — R\$ 143.086 (2022)
- Escola Antônio de Pádua Amâncio (Lote 01) + Escola Maria Aparecida Abreu (Lote 02) — R\$ 118.337 (2022)
- 4 lotes (Escola Justiniano de Resende, CEMEI Clery Forjaz, CEMEI Santusa Rabelo, +4) — R\$ 0 (2021 — sem valor lançado)

LIMITAÇÃO: Este consulta (83025) NÃO inclui campo de fonte de recurso. Não é possível confirmar via API se obra usou FUNDEB, FNDE ou recurso próprio.
[Ver obras educação no portal (Betha)](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83025)

── PUBLICAÇÕES ESTRUTURADAS (Diário Oficial + Câmara) ──
O painel resume automaticamente, com IA, cada ato do Diário Oficial de Varginha e cada matéria da Câmara (SAPL). São cerca de 1.700 publicações com: tipo (lei, decreto, portaria, edital, extrato de contrato, licitação, indicação, requerimento, projeto de lei), resumo em linguagem simples, o que propõe, por que acompanhar, envolvidos e valores quando há.
Se o cidadão perguntar sobre uma lei, decreto, portaria, edital ou publicação recente do Diário/Câmara, oriente a abrir a página de Atualizações e buscar pelo número ou tema.
[Ver publicações (Diário + Câmara)](https://fiscalizavarginha.com.br/atualizacoes.html)

── PORTAL DE EMENDAS (municipais, estaduais e federais) ──
Página dedicada com 295 emendas destinadas a Varginha, total aprox. R\$ 28 milhões (73 beneficiários; maior emenda R\$ 2,57 milhões). Mostra quem recebeu, valor, finalidade, ano e órgão, com link para a fonte oficial (Câmara para municipais; Portal Betha para estaduais/federais). Permite buscar por entidade, esfera e ano, e baixar CSV.
[Ver Portal de Emendas](https://fiscalizavarginha.com.br/emendas/)

── IDENTIFICAÇÃO OFICIAL ──
CNPJ Prefeitura de Varginha: 18.240.380/0001-38 | CNPJ-IBGE: 3170701
Status sanções CEIS/CNEP: nenhuma registrada para fornecedores ativos (verificado jun/2026)";

// O bloco histórico acima é mantido temporariamente apenas para facilitar a
// migração. Ele NÃO é enviado à IA: os valores correntes vêm do resumo gerado
// automaticamente em cada coleta de dados.
$regrasContexto = strstr($contextoLegado, "════════", true);
$arquivoContextoAtual = __DIR__ . '/data/chunks/chat_context.json';
$jsonContextoAtual = @file_get_contents($arquivoContextoAtual);
$dadosContextoAtual = $jsonContextoAtual ? json_decode($jsonContextoAtual, true) : null;

if (is_array($dadosContextoAtual)) {
    $contexto = $regrasContexto . "

DADOS ATUAIS E AUTORITATIVOS DO PAINEL:
Use exclusivamente o JSON abaixo para qualquer número que possa mudar com o tempo.
Não recupere números de memória e não trate previsão, orçamento, contrato e pagamento como se fossem a mesma coisa.
Quando o JSON trouxer ressalva ou observação, ela deve acompanhar a resposta.

" . json_encode($dadosContextoAtual, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "

FONTES PARA CONFERÊNCIA:
- Painel: https://fiscalizavarginha.com.br/
- Prefeitura/Betha: https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==
- Câmara/Betha: https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==
- SAPL: https://sapl.varginha.mg.leg.br/
- Modelos LAI: https://fiscalizavarginha.com.br/cobrar.html
";
} else {
    $contexto = $regrasContexto . "

AVISO: o resumo atualizado de dados não está disponível nesta execução.
Não informe valores numéricos. Diga claramente que o dado está temporariamente indisponível e encaminhe o cidadão à fonte oficial ou ao modelo LAI correspondente.
";
}

// ---- Histórico da conversa (multi-turn) ----
$historico = $body['historico'] ?? [];
$contents  = [];
if (is_array($historico)) {
    foreach (array_slice($historico, -8) as $msg) {
        $papel = (($msg['papel'] ?? '') === 'model') ? 'model' : 'user';
        $txt   = trim(substr($msg['texto'] ?? '', 0, 1200));
        if ($txt === '') continue;
        $contents[] = ['role' => $papel, 'parts' => [['text' => $txt]]];
    }
}
// Pergunta atual (último turno)
$contents[] = ['role' => 'user', 'parts' => [['text' => $pergunta]]];

$payload = json_encode([
    'system_instruction' => ['parts' => [['text' => $contexto]]],
    'contents'           => $contents,
    'generationConfig' => [
        'maxOutputTokens' => 1000,
        'temperature'     => 0.3,
        'thinkingConfig'  => ['thinkingBudget' => 0],
    ],
    'safetySettings' => [
        ['category' => 'HARM_CATEGORY_HARASSMENT',        'threshold' => 'BLOCK_MEDIUM_AND_ABOVE'],
        ['category' => 'HARM_CATEGORY_HATE_SPEECH',       'threshold' => 'BLOCK_MEDIUM_AND_ABOVE'],
        ['category' => 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'threshold' => 'BLOCK_MEDIUM_AND_ABOVE'],
        ['category' => 'HARM_CATEGORY_DANGEROUS_CONTENT', 'threshold' => 'BLOCK_MEDIUM_AND_ABOVE'],
    ],
]);

$model = 'gemini-2.5-flash';
$apiHost = 'generativelanguage.googleapis.com';
$url   = "https://{$apiHost}/v1beta/models/{$model}:streamGenerateContent?alt=sse&key={$apiKey}";

// Resolve o IP no PHP (síncrono). A hospedagem compartilhada bloqueia o
// resolver assíncrono do cURL ("getaddrinfo() thread failed to start"),
// então passamos o IP pronto via CURLOPT_RESOLVE.
$apiIp = gethostbyname($apiHost);
$curlResolve = ($apiIp !== $apiHost) ? ["{$apiHost}:443:{$apiIp}"] : [];

// Resposta em streaming (SSE) para o navegador
header('Content-Type: text/event-stream; charset=utf-8');
header('Cache-Control: no-cache');
header('X-Accel-Buffering: no'); // desliga buffering de proxy
while (ob_get_level() > 0) { @ob_end_flush(); }

$buffer  = '';
$gotText = false;

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_POST          => true,
    CURLOPT_POSTFIELDS    => $payload,
    CURLOPT_HTTPHEADER    => ['Content-Type: application/json'],
    CURLOPT_TIMEOUT       => 60,
    CURLOPT_RESOLVE       => $curlResolve,
    // Repassa cada trecho de texto da Gemini ao navegador assim que chega
    CURLOPT_WRITEFUNCTION => function ($ch, $data) use (&$buffer, &$gotText) {
        $buffer .= $data;
        while (($pos = strpos($buffer, "\n")) !== false) {
            $line   = trim(substr($buffer, 0, $pos));
            $buffer = substr($buffer, $pos + 1);
            if ($line === '' || strpos($line, 'data:') !== 0) continue;
            $jsonStr = trim(substr($line, 5));
            if ($jsonStr === '' || $jsonStr === '[DONE]') continue;
            $obj   = json_decode($jsonStr, true);
            $delta = $obj['candidates'][0]['content']['parts'][0]['text'] ?? '';
            if ($delta !== '') {
                $gotText = true;
                sse(['delta' => $delta]);
            }
        }
        return strlen($data);
    },
]);
curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if (!$gotText) {
    if ($status === 429) {
        sse(['erro' => 'IA temporariamente indisponível. Tente novamente em alguns minutos.', 'rate' => true]);
    } else {
        sse(['erro' => 'Não consegui responder agora. Tente novamente em instantes.']);
    }
}
sse(['fim' => true]);
exit;
