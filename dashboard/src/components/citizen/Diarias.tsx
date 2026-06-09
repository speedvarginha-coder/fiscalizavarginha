import { useMemo, useState } from "react";
import type { Entidade, DiariaItem } from "@/data/entidades";
import type { DiariaRegistro } from "@/data/loaderDadosReais";
import { valorRealDe, diariasRegistros } from "@/data/loaderDadosReais";
import { normalizar } from "@/lib/buscaGastos";

interface Props {
  entidade: Entidade;
}

function formatarDataBR(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

export function Diarias({ entidade }: Props) {
  const info = entidade.diarias;
  if (!info) return null;

  const real = valorRealDe(entidade.id, "diarias");
  const registros = diariasRegistros(entidade.id);

  return (
    <section
      id="diarias"
      aria-labelledby="diarias-title"
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
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3
            id="diarias-title"
            style={{ fontSize: 22, fontWeight: 800, margin: 0 }}
          >
            Diárias de viagem
          </h3>
          <p
            style={{
              color: "var(--color-text-muted)",
              fontSize: 14,
              marginTop: 4,
              maxWidth: 620,
            }}
          >
            Toda diária paga pela {entidade.nome} deve mostrar publicamente{" "}
            <strong>quem viajou, em que função, para onde, por quê e quanto recebeu</strong>.
            Veja abaixo a tabela legal e os campos a fiscalizar.
          </p>
        </div>

        <a
          href={real?.fonteUrl ?? info.urlConsulta}
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
          Ver diárias no portal →
        </a>
      </div>

      {/* Total real gasto com diárias no período (quando disponível) */}
      {real && (
        <div
          style={{
            marginBottom: 20,
            background: "var(--color-camara-light)",
            borderLeft: "4px solid var(--color-success)",
            borderRadius: "var(--radius-md)",
            padding: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: 1,
                padding: "3px 8px",
                borderRadius: 999,
                background: "var(--color-success)",
                color: "#ffffff",
              }}
            >
              ✓ Dado real auditado
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: "var(--color-success)",
              }}
            >
              {real.periodo} — {entidade.nome}
            </span>
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 800,
              marginTop: 6,
              color: "var(--color-text)",
            }}
          >
            {real.valorFormatado}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--color-text-muted)",
              marginTop: 4,
              lineHeight: 1.5,
            }}
          >
            Total pago em diárias no período —{" "}
            <strong>{real.qtdEmpenhos.toLocaleString("pt-BR")}</strong> diárias
            registradas. Extraído do Portal da Transparência em{" "}
            {formatarDataBR(real.atualizadoEm)}.
          </div>
        </div>
      )}

      {/* Tabela legal de valores por função */}
      <div
        style={{
          marginBottom: 22,
          background: entidade.corLight,
          borderRadius: "var(--radius-md)",
          padding: 16,
          border: `1px solid ${entidade.cor}25`,
        }}
      >
        <h4
          style={{
            fontSize: 14,
            fontWeight: 800,
            margin: 0,
            color: entidade.cor,
            textTransform: "uppercase",
            letterSpacing: 0.8,
            marginBottom: 12,
          }}
        >
          📜 Valor da diária por função (lei)
        </h4>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {info.tabelaValores.map((linha) => (
            <div
              key={linha.cargo}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 12,
                padding: "10px 14px",
                background: "var(--color-surface)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {linha.cargo}
                </div>
                {linha.observacao && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-muted)",
                      marginTop: 2,
                    }}
                  >
                    {linha.observacao}
                  </div>
                )}
              </div>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 15,
                  color: entidade.cor,
                  whiteSpace: "nowrap",
                }}
              >
                {linha.valor}
              </div>
            </div>
          ))}
        </div>

        {info.acrescimoEspecial && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              fontSize: 13,
              background: "var(--color-surface)",
              borderRadius: "var(--radius-sm)",
              borderLeft: `3px solid ${entidade.cor}`,
              lineHeight: 1.5,
            }}
          >
            <strong>Acréscimo:</strong> {info.acrescimoEspecial}
          </div>
        )}

        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            color: "var(--color-text-muted)",
          }}
        >
          Fonte legal: {info.fonteLegal}
        </div>
      </div>

      {/* Diárias reais (quando coletadas) ou exemplos ilustrativos */}
      {registros.length > 0 ? (
        <DiariasReais registros={registros} cor={entidade.cor} />
      ) : (
        <>
          <h4 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>
            Como cada diária aparece no portal
          </h4>
          <p
            style={{
              fontSize: 13,
              color: "var(--color-text-muted)",
              marginBottom: 12,
              lineHeight: 1.5,
            }}
          >
            Os exemplos abaixo mostram a estrutura completa de uma diária
            pública. No portal oficial você terá o nome do servidor e o valor
            real.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {info.exemplos.map((ex, i) => (
              <DiariaCard key={i} item={ex} cor={entidade.cor} />
            ))}
          </div>
        </>
      )}

      <div
        style={{
          marginTop: 18,
          padding: 14,
          background: "#fff8e1",
          border: "1px solid #ffe082",
          borderRadius: "var(--radius-md)",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        <strong>🚩 Sinais que pedem fiscalização:</strong>
        <ul style={{ listStylePosition: "inside", marginTop: 6, paddingLeft: 4 }}>
          <li>
            Mesma pessoa viajando com altíssima frequência para o mesmo destino
          </li>
          <li>
            Motivo da viagem genérico demais ("reunião", "evento") sem detalhe
          </li>
          <li>
            Diárias com valor acima do estabelecido na lei para aquela função
          </li>
          <li>
            Viagens em datas que coincidem com feriados ou fins de semana
          </li>
          <li>
            Diárias pagas a cargos comissionados em volume desproporcional
          </li>
        </ul>
        <div style={{ marginTop: 8 }}>
          Encontrou algo suspeito? Denuncie ao{" "}
          <strong>TCE-MG</strong> ou <strong>MP-MG</strong> — pode ser anônimo.
        </div>
      </div>
    </section>
  );
}

function DiariasReais({
  registros,
  cor,
}: {
  registros: DiariaRegistro[];
  cor: string;
}) {
  const PASSO = 10;
  const [mostrar, setMostrar] = useState(PASSO);
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const q = normalizar(busca);
    if (q.length < 2) return registros;
    return registros.filter((r) =>
      [r.credor, r.cargo, r.destino, r.finalidade].some((c) =>
        normalizar(c).includes(q),
      ),
    );
  }, [busca, registros]);

  const visiveis = filtrados.slice(0, mostrar);
  const restantes = filtrados.length - mostrar;

  return (
    <>
      <h4 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>
        Diárias pagas no período — quem viajou
      </h4>
      <p
        style={{
          fontSize: 13,
          color: "var(--color-text-muted)",
          marginBottom: 12,
          lineHeight: 1.5,
        }}
      >
        Lista real extraída do Portal da Transparência, da maior para a menor.
        Nome, cargo, destino e motivo são informação pública (Lei 12.527/2011).
      </p>

      <input
        type="search"
        value={busca}
        onChange={(e) => {
          setBusca(e.target.value);
          setMostrar(PASSO);
        }}
        placeholder="🔍 Filtrar por nome, cargo ou destino…"
        aria-label="Filtrar diárias"
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
          Nenhuma diária encontrada para "{busca}".
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visiveis.map((r, i) => (
          <article
            key={i}
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-surface-alt)",
              padding: "12px 14px",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              alignItems: "start",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{r.credor}</div>
              {r.cargo && (
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    color: "var(--color-text-muted)",
                    marginTop: 1,
                  }}
                >
                  {r.cargo}
                </div>
              )}
              <div
                style={{
                  fontSize: 13,
                  color: "var(--color-text)",
                  marginTop: 6,
                  lineHeight: 1.45,
                }}
              >
                {r.destino && (
                  <span>
                    📍 <strong>{r.destino}</strong>
                  </span>
                )}
                {r.periodo && (
                  <span style={{ color: "var(--color-text-muted)" }}>
                    {" "}
                    · {r.periodo}
                  </span>
                )}
              </div>
              {r.finalidade && (
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--color-text-muted)",
                    marginTop: 4,
                    lineHeight: 1.45,
                  }}
                >
                  {r.finalidade}
                </div>
              )}
            </div>
            <div
              style={{
                fontWeight: 800,
                fontSize: 15,
                color: cor,
                whiteSpace: "nowrap",
                textAlign: "right",
              }}
            >
              {r.valorFormatado}
            </div>
          </article>
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
            background: "transparent",
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

function DiariaCard({ item, cor }: { item: DiariaItem; cor: string }) {
  return (
    <article
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-surface-alt)",
        padding: 14,
        position: "relative",
      }}
    >
      {item.ilustrativo && (
        <span
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            fontSize: 10,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 1,
            color: "var(--color-text-muted)",
            background: "var(--color-surface)",
            padding: "2px 7px",
            borderRadius: 999,
            border: "1px dashed var(--color-border-strong)",
          }}
          title="Exemplo ilustrativo — dados reais estão no portal oficial"
        >
          Exemplo
        </span>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 10,
        }}
      >
        <Campo rotulo="Servidor" valor={item.servidor} destaque={false} />
        <Campo
          rotulo="Função / Cargo"
          valor={item.funcao}
          destaque={true}
          cor={cor}
        />
        <Campo rotulo="Destino" valor={item.destino} destaque={false} />
        <Campo rotulo="Período" valor={item.diasOuPeriodo} destaque={false} />
        <Campo rotulo="Motivo" valor={item.motivo} destaque={false} />
        <Campo
          rotulo="Valor pago"
          valor={item.valor}
          destaque={true}
          cor={cor}
        />
      </div>
    </article>
  );
}

function Campo({
  rotulo,
  valor,
  destaque,
  cor,
}: {
  rotulo: string;
  valor: string;
  destaque: boolean;
  cor?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "var(--color-text-muted)",
        }}
      >
        {rotulo}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: destaque ? 800 : 600,
          color: destaque && cor ? cor : "var(--color-text)",
          marginTop: 2,
          lineHeight: 1.35,
        }}
      >
        {valor}
      </div>
    </div>
  );
}
