import { useState } from "react";
import { Header } from "@/components/citizen/Header";
import { EntityTabs } from "@/components/citizen/EntityTabs";
import { BuscaGastos } from "@/components/citizen/BuscaGastos";
import { StatusDados } from "@/components/citizen/StatusDados";
import { Hero } from "@/components/citizen/Hero";
import { OndeVaiDinheiro } from "@/components/citizen/OndeVaiDinheiro";
import { Licitacoes } from "@/components/citizen/Licitacoes";
import { FolhaPagamento } from "@/components/citizen/FolhaPagamento";
import { Diarias } from "@/components/citizen/Diarias";
import { Vereadores } from "@/components/citizen/Vereadores";
import { Diferencas } from "@/components/citizen/Diferencas";
import { ComoFiscalizar } from "@/components/citizen/ComoFiscalizar";
import { Canais } from "@/components/citizen/Canais";
import { Footer } from "@/components/citizen/Footer";
import { ENTIDADES, type EntidadeId } from "@/data/entidades";

export function App() {
  const [entidadeAtiva, setEntidadeAtiva] = useState<EntidadeId>("prefeitura");
  const entidade = ENTIDADES[entidadeAtiva];

  return (
    <>
      <Header />

      <main className="container" style={{ paddingBottom: 32, flex: 1 }}>
        <div
          style={{
            marginTop: 20,
            padding: 16,
            background: "var(--color-surface)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border)",
            fontSize: 14,
            lineHeight: 1.55,
          }}
        >
          <strong>👋 Bem-vindo.</strong> Em Varginha, o dinheiro público é
          administrado por dois órgãos com papéis diferentes: a{" "}
          <strong style={{ color: "var(--color-prefeitura)" }}>Prefeitura</strong>{" "}
          (Executivo) e a{" "}
          <strong style={{ color: "var(--color-camara)" }}>Câmara</strong>{" "}
          (Legislativo). Escolha abaixo qual deles você quer acompanhar.
        </div>

        <EntityTabs active={entidadeAtiva} onChange={setEntidadeAtiva} />

        <BuscaGastos entidade={entidade} />
        <StatusDados entidade={entidade} />

        <Hero entidade={entidade} />
        <OndeVaiDinheiro entidade={entidade} />
        <Licitacoes entidade={entidade} />
        <FolhaPagamento entidade={entidade} />
        <Diarias entidade={entidade} />
        {entidadeAtiva === "camara" && <Vereadores entidade={entidade} />}
        <ComoFiscalizar entidade={entidade} />
        <Diferencas />
        <Canais entidade={entidade} />
      </main>

      <Footer />
    </>
  );
}
