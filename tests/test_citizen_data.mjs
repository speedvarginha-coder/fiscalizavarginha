import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregate,buildCitizenData} from '../scripts/generate-citizen-data.mjs';

test('cobertura distingue amostra, falha e lacunas por campo',()=>{
  const d=buildCitizenData({status_fontes:{domains:{diarias:{status:'partial'},fontes_emendas_2026:{status:'partial'}}},
    diarias:{prefeitura:[{destino:'',finalidade:'curso'},{destino:'BH',finalidade:''}]},
    emendas_prefeitura:{geradoEm:'2026-09-05',resumo:{relatorios:6,relatoriosLidosPorInteiro:4,emendasNaoLidas:4}},
    financial_status:{executado_em:'2026-10-28T12:00:00Z',fontes:{reconciliacao:'preservado'}},
    amostras:{executado_em:'2026-10-28T12:00:00Z',conjuntos:{diarias:{status:'conferido',registros:[{campos:{valor:'divergente'}}],limite:'Amostra parcial'}}}});
  const daily=d.fontes.find(s=>s.id==='diarias'), em=d.fontes.find(s=>s.id==='fontes_emendas_2026');
  assert.match(daily.lacunas[0],/1 de 2 registros sem destino e 1 sem finalidade/);
  assert.equal(daily.amostra.divergencias,1);assert.equal(daily.amostra.registros,1);
  assert.match(em.detalhes[0].situacao,/preservada/);assert.equal(em.detalhes[0].ultima_completa,null);
  assert.match(em.lacunas[0],/4 de 6 lidos integralmente/);
});
test('cobertura avisa quando valor contratual preservado diverge da ficha',()=>{
 const d=buildCitizenData({status_fontes:{domains:{prefeitura:{status:'partial'}}},
  prefeitura:{contratos:[{fonte_url:'https://exemplo/ficha',valor:100}]},
  contratos_documentos:{'https://exemplo/ficha':{divergencia:{valor_painel:100,valor_fonte:120}}}});
 assert.match(d.fontes[0].lacunas.join(' '),/1 contratos têm diferença/);
 assert.match(d.fontes[0].lacunas.join(' '),/totais usam os valores do painel/);
});

test('série preserva lacunas, rejeita datas impossíveis e valores ausentes',()=>{
  const result=aggregate([{d:'2026-01-01',v:0},{d:'2026-03-03',v:20},{d:'2026-02-30',v:80},{d:'2026-01-05',v:null},{d:'',v:1}], 'd','v');
  assert.deepEqual(result,{pontos:[{periodo:'2026-01',registros:1,valor:0},{periodo:'2026-03',registros:1,valor:20}],excluidos:3});
});
test('despesas anuais não são divididas artificialmente em meses',()=>{
  const d=buildCitizenData({prefeitura:{ano_atual:2026,total_externo_atual:1200}});
  const s=d.series.find(s=>s.id==='prefeitura_despesas');
  assert.equal(s.frequencia,'anual');assert.deepEqual(s.pontos,[{periodo:'2026',valor:1200,registros:null}]);
});
test('emendas usam exercício explícito, nunca ano da proposição como execução',()=>{
  const d=buildCitizenData({emendas:[{ano:'2025',exercicioOrcamentario:'2026',valor_brl:120},{ano:'2025',valor_brl:30}]});
  const s=d.series.find(s=>s.id==='emendas');assert.deepEqual(s.pontos,[{periodo:'2026',valor:120,registros:1}]);assert.equal(s.excluidos,1);
});
test('tentativa e última coleta completa são preservadas separadamente',()=>{
  const d=buildCitizenData({status_fontes:{domains:{prefeitura:{status:'preserved',checked_at:'2026-10-20'}}},prefeitura:{contratos:[{data_assinatura:'2025-01-10',valor:50}],coleta_frescor:{datasets:{contratos:{checked_at:'2026-10-20',last_complete_at:'2026-10-03',status:'preservada'}}}}});
  assert.equal(d.fontes[0].status,'preserved');assert.equal(d.fontes[0].source_updated_at,undefined);assert.equal(d.fontes[0].detalhes[0].ultima_completa,'2026-10-03');assert.match(d.fontes[0].periodo,/2025-01/);
});

test('cobertura conta fichas e campos ausentes sem alterar valores ou supor modalidade',()=>{
 const data={status_fontes:{domains:{prefeitura:{},diarias:{},fundacao_cultural:{}}},prefeitura:{contratos:[{valor:100},{valor:200,fonte_url:'https://example.com'}]},diarias:{prefeitura:[{destino:'',finalidade:'',valor_total:10}]},fundacao_cultural:{contratos:[{valor:30,modalidade:''}]}};
 const result=buildCitizenData(data);
 assert.match(result.fontes.find(s=>s.id==='prefeitura').lacunas[0],/1 de 2 contratos/);
 assert.match(result.fontes.find(s=>s.id==='diarias').lacunas[0],/1 de 1 registros/);
 assert.match(result.fontes.find(s=>s.id==='fundacao_cultural').lacunas.join(' '),/não é possível deduzir/);
 assert.equal(data.prefeitura.contratos[0].valor,100);
});

test('resultados parciais exibem tentativa e registros sem data individual',()=>{
 const d=buildCitizenData({status_fontes:{domains:{licitacoes_resultados:{status:'partial'}}},licitacoes_resultados:{status:'partial',gerado_em:'2026-10-26',ultima_coleta_completa_em:null,registros:[{data_publicacao:'2025-01-01'},{data_publicacao:'2026-03-01',resultados_consultados_em:'2026-10-26'}]}});
 const f=d.fontes[0];assert.match(f.periodo,/2025-01 a 2026-03/);assert.match(f.lacunas[0],/1 de 2 compras/);assert.equal(f.detalhes[0].ultima_completa,null);assert.equal(f.detalhes[0].tentativa,'2026-10-26');
});

test('tentativa financeira é distinta da data da base preservada',()=>{
 const d=buildCitizenData({status_fontes:{domains:{diarias:{status:'partial',source_updated_at:'2026-10-01'}}},diarias:{},financial_status:{executado_em:'2026-10-27T18:00:00Z',status:'parcial',fontes:{diarias:'preservado'}}});
 const f=d.fontes[0];assert.equal(f.source_updated_at,'2026-10-01');assert.equal(f.tentativa_financeira.situacao,'preservado');assert.equal(f.tentativa_financeira.concluido_em,'2026-10-27T18:00:00Z');
});

test('publicidade informa intervalo mensal sem somar investimentos às despesas',()=>{
 const d=buildCitizenData({status_fontes:{domains:{publicidade_camara:{status:'ok'}}},publicidade_camara:{investimentos:[{periodo:'2026-10',total_centavos:100},{periodo:'2006-04',total_centavos:200}]}});
 assert.match(d.fontes[0].periodo,/2006-04 a 2026-10/);
 assert.equal(d.series.some(s=>s.fonte==='publicidade_camara'),false);
});
