import { useMemo, useState } from "react";
import type { Entidade } from "@/data/entidades";
import type { CategoriaGasto } from "@/data/categoriasGasto";
import {
  categoriasDaEntidade,
  estimativaPara,
} from "@/data/categoriasGasto";
import { valorRealDe } from "@/data/loaderDadosReais";
import {
  buscarCategorias,
  SUGESTOES_POPULARES,
} from "@/lib/buscaGastos";

function formatarDataBR(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

interface Props {
  entidade: Entidade;
}

export function BuscaGastos({ entidade }: Props) {
  const [termo, setTermo] = useState("");
  const [selecionada, setSelecionada] = useState<CategoriaGasto | null>(null);

  const catsEntidade = useMemo(
    () => categoriasDaEntidade(entidade.id),
    [entidade.id],
  );

  const resultados = useMemo(
    () => buscarCategorias(termo, catsEntidade),
    [termo, catsEntidade],
  );

  const mostrarSugestoes = termo.length >= 2 && resultados.length > 0 && !selecionada;
  const semResultado = termo.length >= 2 && resultados.length === 0 && !selecionada;

  function escolher(cat: CategoriaGasto) {
    setSelecionada(cat);
    setTermo(cat.rotulo);
  }

  function limpar() {
    setSelecionada(null);
    setTermo("");
  }

  function buscarNoPortal() {
    window.open(
      entidade.id === "prefeitura"
        ? "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA=="
        : "https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==",
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <section
      id="busca-gastos"
      aria-labelledby="busca-title"
      style={{
        background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))",
        borderRadius: "var(--radius-lg)",
        padding: 28,
        marginTop: 20,
        color: "#ffffff",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <h2
        id="busca-title"
        style={{
          fontSize: 24,
          fontWeight: 800,
          margin: 0,
          color: "#ffffff",
        }}
      >
        🔎 Quanto a {entidade.nome} gastou com…?
      </h2>
      <p style={{ fontSize: 14, marginTop: 6, opacity: 0.9, lineHeight: 1.55 }}>
        Digite uma palavra — combustível, lanches, café, asfalto, medicamentos —
        e veja a categoria orçamentária, estimativa anual e os pontos a
        fiscalizar.
      </p>

      <div style={{ position: "relative", marginTop: 18 }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            background: "#ffffff",
            borderRadius: "var(--radius-md)",
            padding: 6,
            alignItems: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              fontSize: 20,
              paddingLeft: 8,
              color: "var(--color-text-muted)",
            }}
          >
            🔍
          </span>
          <input
            type="search"
            value={termo}
            onChange={(e) => {
              setTermo(e.target.value);
              setSelecionada(null);
            }}
            placeholder="Digite uma palavra (ex: combustível, café, asfalto…)"
            aria-label="Buscar categoria de gasto"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 16,
              padding: "10px 4px",
              color: "var(--color-text)",
              background: "transparent",
              minWidth: 0,
            }}
          />
          {termo && (
            <button
              onClick={limpar}
              aria-label="Limpar busca"
              style={{
                color: "var(--color-text-muted)",
                padding: "6px 10px",
                fontSize: 14,
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Autocomplete dropdown */}
        {mostrarSugestoes && (
          <div
            role="listbox"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "calc(100% + 4px)",
              background: "var(--color-surface)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-border)",
              boxShadow: "var(--shadow-lg)",
              overflow: "hidden",
              zIndex: 10,
              maxHeight: 320,
              overflowY: "auto",
            }}
          >
            {resultados.map((r) => {
              const real = valorRealDe(entidade.id, r.categoria.id);
              return (
                <button
                  key={r.categoria.id}
                  role="option"
                  aria-selected={false}
                  onClick={() => escolher(r.categoria)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    padding: "12px 14px",
                    border: "none",
                    background: "transparent",
                    color: "var(--color-text)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--color-surface-alt)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span style={{ fontSize: 22 }} aria-hidden="true">
                    {r.categoria.icone}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 14 }}>
                        {r.categoria.rotulo}
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: 1,
                          padding: "2px 6px",
                          borderRadius: 999,
                          background: real
                            ? "var(--color-success)"
                            : "var(--color-warning)",
                          color: "#ffffff",
                        }}
                      >
                        {real ? "Real" : "Estim."}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--color-text-muted)",
                        marginTop: 2,
                      }}
                    >
                      {real?.valorFormatado ??
                        estimativaPara(r.categoria, entidade.id) ??
                        "—"}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--color-primary)",
                      fontWeight: 700,
                    }}
                  >
                    Ver →
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Sugestões populares */}
      {!selecionada && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1,
              opacity: 0.75,
              marginBottom: 8,
            }}
          >
            Buscas populares
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SUGESTOES_POPULARES.map((s) => (
              <button
                key={s}
                onClick={() => setTermo(s)}
                style={{
                  background: "rgba(255,255,255,0.12)",
                  color: "#ffffff",
                  border: "1px solid rgba(255,255,255,0.25)",
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sem resultado — oferece busca no portal mesmo assim */}
      {semResultado && (
        <div
          style={{
            marginTop: 16,
            background: "rgba(255,255,255,0.12)",
            border: "1px solid rgba(255,255,255,0.25)",
            borderRadius: "var(--radius-md)",
            padding: 16,
          }}
        >
          <p style={{ fontSize: 14, lineHeight: 1.55 }}>
            Não encontrei uma categoria pré-mapeada para "{termo}". Mas você
            pode buscar diretamente no Portal da Transparência oficial.
          </p>
          <button
            onClick={buscarNoPortal}
            style={{
              marginTop: 10,
              background: "var(--color-accent)",
              color: "var(--color-primary-dark)",
              padding: "10px 18px",
              borderRadius: "var(--radius-md)",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            Buscar "{termo}" no portal →
          </button>
        </div>
      )}

      {/* Resultado selecionado */}
      {selecionada && (
        <ResultadoCategoria
          categoria={selecionada}
          entidade={entidade}
          onNovaBusca={limpar}
        />
      )}
    </section>
  );
}

function ResultadoCategoria({
  categoria,
  entidade,
  onNovaBusca,
}: {
  categoria: CategoriaGasto;
  entidade: Entidade;
  onNovaBusca: () => void;
}) {
  const real = valorRealDe(entidade.id, categoria.id);
  const estimativa = estimativaPara(categoria, entidade.id);
  const portalUrl = real?.fonteUrl ?? entidade.portalTransparencia;

  return (
    <div
      style={{
        marginTop: 18,
        background: "var(--color-surface)",
        color: "var(--color-text)",
        borderRadius: "var(--radius-md)",
        padding: 20,
        boxShadow: "var(--shadow-md)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
          marginBottom: 16,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            background: "var(--color-primary-light)",
            borderRadius: "var(--radius-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            flexShrink: 0,
          }}
        >
          {categoria.icone}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "var(--color-text-muted)",
            }}
          >
            Categoria de gasto
          </div>
          <h3 style={{ fontSize: 22, fontWeight: 800, margin: "2px 0" }}>
            {categoria.rotulo}
          </h3>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Rubrica: {categoria.rubrica}
          </div>
        </div>
        <button
          onClick={onNovaBusca}
          style={{
            border: "1px solid var(--color-border)",
            padding: "6px 10px",
            borderRadius: "var(--radius-sm)",
            fontSize: 12,
            fontWeight: 600,
            background: "var(--color-surface-alt)",
            color: "var(--color-text)",
            whiteSpace: "nowrap",
          }}
        >
          Nova busca
        </button>
      </div>

      {/* Card de valor — REAL se disponível, ESTIMATIVA caso contrário */}
      <div
        style={{
          background: real ? "var(--color-camara-light)" : entidade.corLight,
          borderLeft: real
            ? "4px solid var(--color-success)"
            : `4px solid ${entidade.cor}`,
          borderRadius: "var(--radius-sm)",
          padding: 14,
          marginBottom: 16,
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
              background: real ? "var(--color-success)" : "var(--color-warning)",
              color: "#ffffff",
            }}
          >
            {real ? "✓ Dado real auditado" : "≈ Estimativa"}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: real ? "var(--color-success)" : entidade.cor,
            }}
          >
            {real
              ? `${real.periodo} — ${entidade.nome}`
              : `Estimativa anual da ${entidade.nome}`}
          </span>
        </div>

        <div
          style={{
            fontSize: 24,
            fontWeight: 800,
            marginTop: 6,
            color: "var(--color-text)",
          }}
        >
          {real?.valorFormatado ?? estimativa ?? "Não aplicável a esta entidade"}
        </div>

        {real ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              marginTop: 4,
              lineHeight: 1.5,
            }}
          >
            Extraído do Portal da Transparência em{" "}
            {formatarDataBR(real.atualizadoEm)} —{" "}
            {real.qtdEmpenhos.toLocaleString("pt-BR")} empenhos identificados.
          </div>
        ) : (
          <div
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              marginTop: 4,
              lineHeight: 1.5,
            }}
          >
            Valor estimado com base em médias de municípios similares. O valor
            real está no portal oficial — clique abaixo.
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 14,
        }}
      >
        <div>
          <h4
            style={{
              fontSize: 13,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: 0.8,
              marginBottom: 8,
              color: "var(--color-text)",
            }}
          >
            🧾 O que está incluído
          </h4>
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {categoria.exemplos.map((ex) => (
              <li
                key={ex}
                style={{
                  fontSize: 13,
                  lineHeight: 1.45,
                  paddingLeft: 14,
                  position: "relative",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 2,
                    color: entidade.cor,
                    fontWeight: 800,
                  }}
                >
                  •
                </span>
                {ex}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4
            style={{
              fontSize: 13,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: 0.8,
              marginBottom: 8,
              color: "var(--color-warning)",
            }}
          >
            🚩 O que verificar
          </h4>
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {categoria.oQueVerificar.map((v) => (
              <li
                key={v}
                style={{
                  fontSize: 13,
                  lineHeight: 1.45,
                  paddingLeft: 14,
                  position: "relative",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 2,
                    color: "var(--color-warning)",
                    fontWeight: 800,
                  }}
                >
                  ?
                </span>
                {v}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <a
        href={portalUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          marginTop: 18,
          background: entidade.cor,
          color: "#ffffff",
          padding: "12px 20px",
          borderRadius: "var(--radius-md)",
          fontWeight: 700,
          fontSize: 14,
          textDecoration: "none",
        }}
      >
        Ver dados reais no Portal da Transparência →
      </a>
    </div>
  );
}
