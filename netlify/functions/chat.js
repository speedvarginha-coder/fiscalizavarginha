/* Fiscaliza Varginha — netlify/functions/chat.js
 * Proxy seguro para Gemini. A chave NUNCA chega ao navegador.
 * Proteções: rate limit por IP + domínio restrito na conta Google.
 */
const https = require("https");

// Rate limit: 10 perguntas por IP a cada 15 minutos (janela deslizante simples)
const ipMap = new Map();
const MAX_POR_JANELA = 10;
const JANELA_MS = 15 * 60 * 1000;

function checarRateLimit(ip) {
  const agora = Date.now();
  const janela = Math.floor(agora / JANELA_MS);
  const chave = `${ip}:${janela}`;
  const atual = ipMap.get(chave) || 0;
  if (atual >= MAX_POR_JANELA) return false;
  ipMap.set(chave, atual + 1);
  // Limpa entradas antigas periodicamente
  if (ipMap.size > 2000) {
    const janelaAtual = janela;
    for (const [k] of ipMap) {
      if (!k.endsWith(`:${janelaAtual}`)) ipMap.delete(k);
    }
  }
  return true;
}

// Contexto fixo com dados reais de Varginha (atualizado a cada deploy)
const CONTEXTO = `
Você é o assistente do painel Fiscaliza Varginha, uma ferramenta de transparência pública.
Responda SEMPRE em português brasileiro, de forma clara, direta e acessível ao cidadão comum.
Tom: neutro, honesto, sem acusações. Dados são pistas, não provas.
Nunca invente dados. Se não souber, diga que o cidadão deve verificar na fonte oficial.
Mantenha respostas curtas (máx 3 parágrafos). Use bullet points quando ajudar.

DADOS REAIS DE VARGINHA-MG (coletados automaticamente):

PREFEITURA 2026 (jan–jun):
- Total pago a fornecedores externos: R$ 145.752.084,15
- Número de credores: 10.000 registros
- Contratos ativos: 888
- Obras públicas: 130

Top 5 fornecedores da Prefeitura em 2026:
1. Hospital Regional do Sul de Minas – R$ 34.049.240,66 (saúde)
2. PAVICAN Pavimentação e Terraplenagem – R$ 9.627.998,16 (asfalto/obras)
3. Viação Real Transporte Urbano – R$ 7.939.204,75 (transporte)
4. Varian Medical Systems – R$ 7.819.347,76 (equipamentos médicos)
5. Unimed – R$ 5.432.273,38 (saúde)

CÂMARA MUNICIPAL 2026:
- 17 vereadores ativos
- Total gasto: R$ 5.925.535,01
- 3.031 empenhos registrados

EMENDAS IMPOSITIVAS (2025, base SAPL):
- 357 emendas registradas
- Total: R$ 17.841.369,18
- 1.584 matérias legislativas analisadas

LAI — Lei de Acesso à Informação:
- Prazo de resposta: 20 dias úteis
- Canal: e-SIC da Prefeitura de Varginha
- O painel tem 21 modelos prontos de pedido em cobrar.html

Links úteis do painel:
- Prefeitura: /prefeitura.html
- Câmara: /camara.html
- Como cobrar: /cobrar.html
- Relatórios: /relatorios.html
- Pessoal: /pessoal.html
`.trim();

function chamarGemini(pergunta) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return reject(new Error("Chave não configurada"));

    const body = JSON.stringify({
      contents: [{
        parts: [{
          text: CONTEXTO + "\n\nPergunta do cidadão: " + pergunta
        }]
      }],
      generationConfig: {
        maxOutputTokens: 400,
        temperature: 0.3,
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      ],
    });

    const model = "gemini-2.5-flash";
    const options = {
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          console.log("[chat] Gemini status:", res.statusCode, "keys:", Object.keys(json).join(","));
          if (json.error) {
            console.error("[chat] Gemini error:", JSON.stringify(json.error));
            return reject(new Error("Gemini error: " + json.error.message));
          }
          if (json.promptFeedback) {
            console.error("[chat] Safety block:", JSON.stringify(json.promptFeedback));
          }
          const texto = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          const finishReason = json?.candidates?.[0]?.finishReason || "?";
          if (!texto) {
            console.error("[chat] Sem texto. finishReason:", finishReason, "candidates:", JSON.stringify(json.candidates || []).slice(0, 300));
            return reject(new Error("Sem resposta do Gemini (finishReason: " + finishReason + ")"));
          }
          resolve(texto);
        } catch (e) {
          console.error("[chat] Parse error. Body:", data.slice(0, 400));
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const CORS = {
  "Access-Control-Allow-Origin": "https://fiscaliza-varginha.netlify.app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: "Method not allowed" };
  }

  // Rate limit
  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (!checarRateLimit(ip)) {
    return {
      statusCode: 429,
      headers: CORS,
      body: JSON.stringify({ erro: "Muitas perguntas em pouco tempo. Aguarde alguns minutos." }),
    };
  }

  // Validar pergunta
  let pergunta = "";
  try {
    const body = JSON.parse(event.body || "{}");
    pergunta = String(body.pergunta || "").trim().slice(0, 500);
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ erro: "Corpo inválido" }) };
  }
  if (!pergunta) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ erro: "Pergunta vazia" }) };
  }

  // Chamar Gemini
  try {
    const resposta = await chamarGemini(pergunta);
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ resposta }),
    };
  } catch (err) {
    console.error("[chat]", err.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ erro: "Erro ao consultar IA. Tente novamente." }),
    };
  }
};
