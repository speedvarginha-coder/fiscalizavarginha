import type { Entidade, LicitacaoRecente } from "@/data/entidades";

interface Props {
  entidade: Entidade;
}

interface Alerta {
  rotulo: string;
  cor: string;
  tooltip: string;
}

function formatarData(iso: string): string {
  if (!iso || iso === "—") return iso;
  const [ano, mes, dia] = iso.split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

/**
 * Detecta padrões na licitação que merecem atenção do cidadão.
 * Não são acusações — são pontos onde a fiscalização concentra esforços.
 */
function detectarAlertas(lic: LicitacaoRecente): Alerta[] {
  const alertas: Alerta[] = [];
  const txt = lic.objeto.toLowerCase();

  if (txt.includes("registro de preços")) {
    alertas.push({
      rotulo: "Registro de preços",
      cor: "#1c7ed6",
      tooltip:
        "Contrato 'em aberto' — a entidade pode comprar quando quiser, dentro do prazo. Vale acompanhar quanto foi efetivamente comprado.",
    });
  }
  if (
    txt.includes("veículo") ||
    txt.includes("veiculo") ||
    txt.includes("automotor")
  ) {
    alertas.push({
      rotulo: "Bem de alto valor",
      cor: "#e8590c",
      tooltip:
        "Veículos costumam ter valor unitário alto. Compare o preço com tabelas FIPE e licitações de outras cidades.",
    });
  }
  if (txt.includes("equipamento") || txt.includes("gerador")) {
    alertas.push({
      rotulo: "Equipamento",
      cor: "#7048e8",
      tooltip:
        "Equipamentos específicos podem direcionar a licitação para poucos fornecedores. Veja quantos participaram.",
    });
  }
  if (txt.includes("dispensa") || txt.includes("inexigibilidade")) {
    alertas.push({
      rotulo: "Sem disputa",
      cor: "#c92a2a",
      tooltip:
        "Contratação sem licitação (dispensa/inexigibilidade). Exige justificativa robusta. Item sensível.",
    });
  }

  return alertas;
}

export function Licitacoes({ entidade }: Props) {
  const licitacoes = entidade.licitacoesRecentes ?? [];
  const temDados = licitacoes.length > 0 && licitacoes[0].data !== "—";

  return (
    <section
      id="licitacoes"
      aria-labelledby="lic-title"
      style={{
        background: "var(--color-surface)",
        borderRadius: "var(--radius-lg)",
        padding: 24,
        marginTop: 16,
        boxShadow: "var(--shadow-sm)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <div>
          <h3 id="lic-title" style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
            Licitações recentes
          </h3>
          <p
            style={{
              color: "var(--color-text-muted)",
              fontSize: 14,
              marginTop: 4,
              maxWidth: 580,
            }}
          >
            Cada compra da {entidade.nome} acima de um valor mínimo precisa
            passar por licitação. Acompanhar essas publicações é o primeiro
            passo da fiscalização.
          </p>
        </div>

        <a
          href={entidade.portalLicitacoes}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: entidade.cor,
            color: "#ffffff",
            padding: "10px 16px",
            borderRadius: "var(--radius-md)",
            fontSize: 13,
            fontWeight: 700,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Ver todas →
        </a>
      </div>

      {temDados ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {licitacoes.map((lic) => {
            const alertas = detectarAlertas(lic);
            return (
              <article
                key={lic.numero}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 14,
                  alignItems: "flex-start",
                  padding: "14px",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-surface-alt)",
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "var(--radius-md)",
                    background: entidade.corLight,
                    color: entidade.cor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  📋
                </div>

                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      color: entidade.cor,
                      fontWeight: 700,
                    }}
                  >
                    {lic.modalidade}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>
                    {lic.numero}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--color-text-muted)",
                      marginTop: 4,
                      lineHeight: 1.45,
                    }}
                  >
                    {lic.objeto}
                  </div>
                  {alertas.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        marginTop: 8,
                      }}
                    >
                      {alertas.map((a) => (
                        <span
                          key={a.rotulo}
                          title={a.tooltip}
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#fff",
                            background: a.cor,
                            padding: "3px 8px",
                            borderRadius: 999,
                            cursor: "help",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span aria-hidden="true">⚑</span> {a.rotulo}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    textAlign: "right",
                    fontSize: 12,
                    color: "var(--color-text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      color: "var(--color-text)",
                      fontSize: 13,
                    }}
                  >
                    {formatarData(lic.data)}
                  </div>
                  <div style={{ marginTop: 2 }}>publicação</div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            padding: 20,
            background: "var(--color-surface-alt)",
            border: "1px dashed var(--color-border)",
            borderRadius: "var(--radius-md)",
            textAlign: "center",
            color: "var(--color-text-muted)",
            fontSize: 14,
            lineHeight: 1.55,
          }}
        >
          A {entidade.nome} publica suas licitações no portal oficial. Use o
          botão acima para consultar.
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          padding: 14,
          background: "#fff8e1",
          border: "1px solid #ffe082",
          borderRadius: "var(--radius-md)",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        <strong>🔎 O que verificar em cada licitação:</strong>
        <ul style={{ listStylePosition: "inside", marginTop: 6, paddingLeft: 4 }}>
          <li>
            <strong>Objeto:</strong> faz sentido para a cidade?
          </li>
          <li>
            <strong>Valor estimado:</strong> está dentro do preço de mercado?
          </li>
          <li>
            <strong>Número de participantes:</strong> teve competição real?
          </li>
          <li>
            <strong>Vencedor:</strong> a mesma empresa ganha tudo? Por quê?
          </li>
          <li>
            <strong>Aditivos:</strong> o valor original cresceu muito depois?
          </li>
        </ul>
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--color-text-muted)" }}>
          Os selos coloridos (⚑) indicam pontos que costumam exigir mais atenção.
          Passe o mouse para entender cada um.
        </div>
      </div>
    </section>
  );
}
