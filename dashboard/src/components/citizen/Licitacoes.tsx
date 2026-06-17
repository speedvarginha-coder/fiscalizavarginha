import { useMemo, useState } from "react";
import type { Entidade, LicitacaoRecente } from "@/data/entidades";
import type { LicitacaoReal, ContratoReal } from "@/data/loaderDadosReais";
import { licitacoesReais, contratosReais } from "@/data/loaderDadosReais";
import { normalizar } from "@/lib/buscaGastos";

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
 * Detecta padrões no objeto/modalidade que merecem atenção do cidadão.
 * Não são acusações — são pontos onde a fiscalização concentra esforços.
 */
function detectarAlertas(objeto: string, extra = ""): Alerta[] {
  const alertas: Alerta[] = [];
  const txt = (objeto + " " + extra).toLowerCase();

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
    txt.includes("automotor") ||
    txt.includes("corolla") ||
    txt.includes("toyota")
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
  const lic = licitacoesReais(entidade.id);
  const con = contratosReais(entidade.id);
  const temReal = !!lic || !!con;

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
            Licitações e contratos
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

      {temReal ? (
        <ListasReais entidade={entidade} lic={lic} con={con} />
      ) : (
        <Estimativa entidade={entidade} />
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

/* ---------- Listas reais (Câmara) ---------- */

type Aba = "licitacoes" | "contratos";

function ListasReais({
  entidade,
  lic,
  con,
}: {
  entidade: Entidade;
  lic: ReturnType<typeof licitacoesReais>;
  con: ReturnType<typeof contratosReais>;
}) {
  const [aba, setAba] = useState<Aba>(lic ? "licitacoes" : "contratos");
  const ativa = aba === "licitacoes" ? lic : con;

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {lic && (
          <AbaBtn
            ativo={aba === "licitacoes"}
            cor={entidade.cor}
            onClick={() => setAba("licitacoes")}
          >
            Licitações ({lic.totalHits})
          </AbaBtn>
        )}
        {con && (
          <AbaBtn
            ativo={aba === "contratos"}
            cor={entidade.cor}
            onClick={() => setAba("contratos")}
          >
            Contratos ({con.totalHits})
          </AbaBtn>
        )}
      </div>

      {ativa && (
        <div
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            marginBottom: 10,
          }}
        >
          ✓ Dado real do Portal da Transparência · mostrando os {ativa.mostrando}{" "}
          maiores de {ativa.totalHits} · atualizado em{" "}
          {formatarData(ativa.atualizadoEm)}
        </div>
      )}

      {aba === "licitacoes" && lic ? (
        <ListaBuscavel
          itens={lic.registros}
          cor={entidade.cor}
          corLight={entidade.corLight}
          placeholder="🔍 Filtrar licitações por objeto, modalidade ou situação…"
          textoDe={(r) => [r.objeto, r.modalidade, r.situacao, r.numero]}
          render={(r) => <LicitacaoCard r={r} cor={entidade.cor} corLight={entidade.corLight} />}
          chave={(r, i) => r.numero + i}
        />
      ) : aba === "contratos" && con ? (
        <ListaBuscavel
          itens={con.registros}
          cor={entidade.cor}
          corLight={entidade.corLight}
          placeholder="🔍 Filtrar contratos por objeto, empresa ou CNPJ…"
          textoDe={(r) => [r.objeto, r.contratado, r.cnpjCpf, r.situacao, r.tipo]}
          render={(r) => <ContratoCard r={r} cor={entidade.cor} corLight={entidade.corLight} />}
          chave={(r, i) => r.numero + i}
        />
      ) : null}
    </>
  );
}

function AbaBtn({
  ativo,
  cor,
  onClick,
  children,
}: {
  ativo: boolean;
  cor: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px",
        borderRadius: 999,
        border: `1.5px solid ${ativo ? cor : "var(--color-border)"}`,
        background: ativo ? cor : "transparent",
        color: ativo ? "#fff" : "var(--color-text)",
        fontWeight: 700,
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/** Lista genérica com busca + paginação. */
function ListaBuscavel<T>({
  itens,
  cor,
  corLight,
  placeholder,
  textoDe,
  render,
  chave,
}: {
  itens: T[];
  cor: string;
  corLight: string;
  placeholder: string;
  textoDe: (item: T) => string[];
  render: (item: T) => React.ReactNode;
  chave: (item: T, i: number) => string;
}) {
  const PASSO = 10;
  const [mostrar, setMostrar] = useState(PASSO);
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const q = normalizar(busca);
    if (q.length < 2) return itens;
    return itens.filter((item) =>
      textoDe(item).some((c) => normalizar(c).includes(q)),
    );
    // textoDe é estável por aba; itens muda quando troca de aba
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, itens]);

  const visiveis = filtrados.slice(0, mostrar);
  const restantes = filtrados.length - mostrar;

  return (
    <>
      <input
        type="search"
        value={busca}
        onChange={(e) => {
          setBusca(e.target.value);
          setMostrar(PASSO);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{
          width: "100%",
          padding: "10px 14px",
          fontSize: 14,
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          marginBottom: 12,
          background: "var(--color-surface)",
          color: "var(--color-text)",
        }}
      />

      {filtrados.length === 0 && (
        <p
          style={{
            fontSize: 13,
            color: "var(--color-text-muted)",
            padding: "12px 0",
          }}
        >
          Nenhum resultado encontrado para "{busca}".
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {visiveis.map((item, i) => (
          <div key={chave(item, i)}>{render(item)}</div>
        ))}
      </div>

      {restantes > 0 && (
        <button
          onClick={() => setMostrar((m) => m + PASSO)}
          style={{
            marginTop: 12,
            width: "100%",
            padding: "10px 16px",
            border: `1.5px solid ${cor}`,
            borderRadius: "var(--radius-md)",
            background: corLight,
            color: cor,
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Ver mais {Math.min(PASSO, restantes)} de {restantes} restantes
        </button>
      )}
    </>
  );
}

function LicitacaoCard({
  r,
  cor,
  corLight,
}: {
  r: LicitacaoReal;
  cor: string;
  corLight: string;
}) {
  const alertas = detectarAlertas(r.objeto, r.modalidade);
  return (
    <article
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
          background: corLight,
          color: cor,
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
            color: cor,
            fontWeight: 700,
          }}
        >
          {r.modalidade}
          {r.situacao && (
            <span style={{ color: "var(--color-text-muted)" }}> · {r.situacao}</span>
          )}
        </div>
        <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{r.numero}</div>
        <div
          style={{
            fontSize: 13,
            color: "var(--color-text-muted)",
            marginTop: 4,
            lineHeight: 1.45,
          }}
        >
          {r.objeto}
        </div>
        {alertas.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
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
                }}
              >
                ⚑ {a.rotulo}
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
        <div style={{ fontWeight: 800, color: "var(--color-text)", fontSize: 14 }}>
          {r.valorHomologado > 0
            ? r.valorHomologadoFormatado
            : r.valorEstimadoFormatado}
        </div>
        <div style={{ marginTop: 2 }}>
          {r.valorHomologado > 0 ? "homologado" : "estimado"}
        </div>
        {r.data && (
          <div style={{ marginTop: 6, color: "var(--color-text)" }}>
            {formatarData(r.data)}
          </div>
        )}
      </div>
    </article>
  );
}

function ContratoCard({
  r,
  cor,
  corLight,
}: {
  r: ContratoReal;
  cor: string;
  corLight: string;
}) {
  const alertas = detectarAlertas(r.objeto, r.tipo);
  return (
    <article
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
          background: corLight,
          color: cor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        📝
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 1,
            color: cor,
            fontWeight: 700,
          }}
        >
          {r.tipo || "Contrato"}
          {r.situacao && (
            <span style={{ color: "var(--color-text-muted)" }}> · {r.situacao}</span>
          )}
        </div>
        <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>
          {r.contratado || r.numero}
        </div>
        {r.cnpjCpf && (
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 1 }}>
            CNPJ/CPF: {r.cnpjCpf}
          </div>
        )}
        <div
          style={{
            fontSize: 13,
            color: "var(--color-text-muted)",
            marginTop: 4,
            lineHeight: 1.45,
          }}
        >
          {r.objeto}
        </div>
        {alertas.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
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
                }}
              >
                ⚑ {a.rotulo}
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
        <div style={{ fontWeight: 800, color: "var(--color-text)", fontSize: 14 }}>
          {r.valorFinalFormatado}
        </div>
        <div style={{ marginTop: 2 }}>valor final</div>
        {r.data && (
          <div style={{ marginTop: 6, color: "var(--color-text)" }}>
            {formatarData(r.data)}
          </div>
        )}
      </div>
    </article>
  );
}

/* ---------- Estimativa (fallback — Prefeitura) ---------- */

function Estimativa({ entidade }: { entidade: Entidade }) {
  const licitacoes = entidade.licitacoesRecentes ?? [];
  const temDados = licitacoes.length > 0 && licitacoes[0].data !== "—";

  if (!temDados) {
    return (
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
        A {entidade.nome} publica suas licitações no portal oficial. Use o botão
        acima para consultar.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {licitacoes.map((licit: LicitacaoRecente) => {
        const alertas = detectarAlertas(licit.objeto);
        return (
          <article
            key={licit.numero}
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
                {licit.modalidade}
              </div>
              <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>
                {licit.numero}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--color-text-muted)",
                  marginTop: 4,
                  lineHeight: 1.45,
                }}
              >
                {licit.objeto}
              </div>
              {alertas.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
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
                      }}
                    >
                      ⚑ {a.rotulo}
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
              <div style={{ fontWeight: 700, color: "var(--color-text)", fontSize: 13 }}>
                {formatarData(licit.data)}
              </div>
              <div style={{ marginTop: 2 }}>publicação</div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
