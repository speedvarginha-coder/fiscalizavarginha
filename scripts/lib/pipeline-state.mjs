// Um "ultimo sucesso" so pode significar pipeline inteiro concluido: coleta
// validada, deploy confirmado e fase final. Carimbar antes do deploy (fase
// "validada") fazia um deploy falho continuar parecendo saudavel e mascarava o
// alerta de coleta parada.
export function deveRegistrarSucesso(payload) {
  return payload?.coleta === "SUCESSO"
    && payload?.fase === "final"
    && payload?.deploy === "SUCESSO";
}
