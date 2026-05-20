import type { Entidade } from "@/data/entidades";
import { categoriasDaEntidade } from "@/data/categoriasGasto";
import {
  totalComDadoReal,
  ultimaAtualizacaoGeral,
} from "@/data/loaderDadosReais";

interface Props {
  entidade: Entidade;
}

function formatarISO(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function StatusDados({ entidade }: Props) {
  const totalCategorias = categoriasDaEntidade(entidade.id).length;
  const totalReais = totalComDadoReal(entidade.id);
  const atualizacao = formatarISO(ultimaAtualizacaoGeral());
  const percentual = totalCategorias > 0 ? Math.round((totalReais / totalCategorias) * 100) : 0;

  const aindaSemDadosReais = totalReais === 0;

  return (
    <section
      aria-label="Status dos dados"
      style={{
        marginTop: 14,
        padding: 14,
        background: aindaSemDadosReais ? "#fff8e1" : "#ebfbee",
        border: `1px solid ${aindaSemDadosReais ? "#ffe082" : "#b2f2bb"}`,
        borderRadius: "var(--radius-md)",
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 18,
            lineHeight: 1,
          }}
          aria-hidden="true"
        >
          {aindaSemDadosReais ? "ℹ️" : "✓"}
        </span>
        <div style={{ flex: 1, minWidth: 240 }}>
          <strong>
            {aindaSemDadosReais
              ? "Plataforma em fase de calibragem"
              : `${totalReais} de ${totalCategorias} categorias com dados reais auditados`}
          </strong>
          <div style={{ marginTop: 4, color: "var(--color-text-muted)" }}>
            {aindaSemDadosReais ? (
              <>
                Os valores mostrados ainda são <strong>estimativas</strong>{" "}
                baseadas em médias de municípios similares — marcados com{" "}
                <strong>≈ Estimativa</strong>. À medida que o scraper coleta
                dados reais do Portal da Transparência, eles substituem
                automaticamente as estimativas e ganham o selo{" "}
                <strong>✓ Real auditado</strong>.
              </>
            ) : (
              <>
                {percentual}% das categorias têm dado real extraído do Portal
                da Transparência oficial. As demais seguem como estimativa
                marcada como <strong>≈</strong>.
                {atualizacao && (
                  <>
                    {" "}
                    Última atualização: <strong>{atualizacao}</strong>.
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {!aindaSemDadosReais && (
        <div
          style={{
            marginTop: 10,
            height: 6,
            background: "rgba(0,0,0,0.06)",
            borderRadius: 999,
            overflow: "hidden",
          }}
          role="progressbar"
          aria-valuenow={percentual}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${percentual}% das categorias com dado real`}
        >
          <div
            style={{
              width: `${percentual}%`,
              height: "100%",
              background: "var(--color-success)",
              transition: "width 0.4s ease",
            }}
          />
        </div>
      )}
    </section>
  );
}
