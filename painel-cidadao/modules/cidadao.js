/* Cobertura, séries disponíveis e acompanhamento pessoal. Sem envio de dados. */
(function () {
  'use strict';
  window.FISCALIZA = window.FISCALIZA || {};
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const brl = v => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v);
  const date = v => v && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString('pt-BR') : 'Não informada';
  const safeURL = v => { try { const u = new URL(v); return ['https:','http:'].includes(u.protocol) ? u.href : ''; } catch (_) { return ''; } };
  const statusLabels = {ok:'Dentro do prazo de atualização',preserved:'Base anterior preservada',partial:'Parcial',manual:'Conferência manual',stale:'Desatualizada',failed:'Coleta falhou',unknown:'Situação não informada'};
  let pending;
  function load() {
    if (!pending) pending = fetch('data/chunks/fiscalizacao_cidada.json',{cache:'no-cache'})
      .then(r=>{if(!r.ok) throw Error();return r.json();})
      .then(d=>{if(d.schema_version!==1 || !Array.isArray(d.fontes) || !Array.isArray(d.series)) throw Error();return d;})
      .catch(e=>{pending=null;throw e;});
    return pending;
  }
  function download(name,text,type) {
    const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function coverageQuestion(s) {
    const questions = {
      prefeitura: 'Solicito as fichas oficiais dos contratos, seus aditivos e documentos de fiscalização e entrega. Informar o período completo publicado, os registros ausentes e o local de consulta.',
      diarias: 'Solicito, para cada diária ou empenho do período indicado, beneficiário, datas, destino, finalidade, autorização da viagem e prestação de contas. Distinguir empenho de viagem efetivamente realizada e ocultar dados pessoais sensíveis.',
      licitacoes_resultados: 'Solicito os resultados de licitação por compra e item: fornecedor vencedor, valor homologado, quantidade, unidade, data, ata e endereço dos documentos oficiais.',
      fundacao_cultural: 'Solicito, por contrato, o processo de contratação, modalidade ou fundamento da contratação direta, edital quando aplicável, aditivos, pagamentos vinculados e documentos de entrega.',
      fontes_emendas_2026: 'Solicito a identificação de cada emenda e exercício orçamentário, beneficiário, empenhos, liquidações, pagamentos e documentos de entrega vinculados à emenda. Distinguir repasses ao beneficiário de execução específica da emenda.'
    };
    const orgao = s.id === 'fundacao_cultural' ? 'Fundação Cultural' : s.id.startsWith('camara') ? 'Câmara' : ['prefeitura','diarias','fontes_emendas_2026'].includes(s.id) ? 'Prefeitura' : 'Outro';
    const pedido = (questions[s.id] || 'Solicito os registros e documentos oficiais do conjunto indicado, seu período de cobertura, data de atualização e orientação para acessar informações não disponíveis no portal.') + '\nConjunto: ' + s.label + '\nPeríodo de interesse: [INFORMAR INÍCIO E FIM].\nLimitação observada no painel: ' + (s.reason || 'Cobertura não comprovada') + '\nSolicito resposta em formato aberto, com indicação da fonte oficial. Confirmar o órgão responsável antes de protocolar.';
    return trackingLink('Cobertura: ' + s.label, orgao, pedido, '');
  }
  async function initCoverage() {
    const page=document.body.dataset.page;
    const host=document.querySelector('[data-cobertura-cidada]') || document.querySelector('.bigheader');
    if (!host || host.querySelector('[data-coverage-content]')) return;
    const box=document.createElement('section');box.className='source-coverage';box.dataset.coverageContent='';box.setAttribute('aria-label','Cobertura e atualização dos dados');
    host.appendChild(box);
    const render=async()=>{
      box.innerHTML='<p role="status">Consultando cobertura das fontes…</p>';
      try {
        const data=await load();
        const ids={prefeitura:['prefeitura','diarias','pncp','licitacoes_resultados','cnpjs','diario'],camara:['camara_betha','camara_anos','diarias','publicacoes_estruturadas'],pessoal:['pessoal'],fundacao:['fundacao_cultural'],relatorios:null,conformidade:null};
        const fontes=data.fontes.filter(s=>!ids[page] || ids[page].includes(s.id));
        const emAtencao=fontes.filter(s=>['preserved','partial','stale','failed','unknown'].includes((window.FISCALIZA.utils?.statusFonteAtual(s) || s).status)).length;
        box.innerHTML=`<p class="source-coverage__overview" role="status">${emAtencao ? `${emAtencao} de ${fontes.length} fontes nesta página precisam de atenção ou têm situação desconhecida.` : `${fontes.length} fontes nesta página; confira os períodos e as limitações.`}</p><div data-operacao-cobertura></div><details><summary><b>Cobertura, períodos e tentativas de coleta</b></summary><p>Período dos registros disponíveis não garante que todos os registros do intervalo tenham sido coletados. Uma tentativa recente não torna uma base preservada atualizada.</p><div class="source-coverage__grid">${fontes.map(s=>{
          const current=window.FISCALIZA.utils?.statusFonteAtual(s) || s;
          return `<article class="source-coverage__item source-coverage__item--${esc(current.status || 'unknown')}"><h3>${esc(s.label)}</h3><p><strong>${esc(statusLabels[current.status] || statusLabels.unknown)}</strong></p><p>Período: ${esc(s.periodo)}</p><p>Data informada para a base: ${esc(date(s.source_updated_at))}<br>Última tentativa registrada: ${esc(date(s.checked_at))}</p>${s.detalhes?.length ? `<ul>${s.detalhes.map(d=>`<li>${esc(d.conjunto)}: ${esc(d.situacao || 'situação não informada')}<br>Última coleta completa: ${esc(date(d.ultima_completa))}<br>Última tentativa: ${esc(date(d.tentativa))}</li>`).join('')}</ul>`:'<p>Última coleta completa por conjunto: não informada.</p>'}<p>${esc(s.reason)}</p>${s.tentativa_financeira ? `<p>Última rotina financeira concluída em ${esc(date(s.tentativa_financeira.concluido_em))}: ${esc(s.tentativa_financeira.ciclo === 'falha' ? 'ciclo falhou; consulte o estado da base preservada' : s.tentativa_financeira.situacao === 'preservado' ? 'nova consulta de diárias inconclusiva; base anterior preservada' : s.tentativa_financeira.situacao === 'ok' ? 'consulta executada; o detalhamento pode estar incompleto' : 'diárias não verificadas nesta rotina')}.</p>` : ''}${s.lacunas?.length ? `<ul>${s.lacunas.map(g=>`<li>${esc(g)}</li>`).join('')}</ul>` : ''}${s.amostra ? `<p>Conferência amostral em ${esc(date(s.amostra.executado_em))}: ${esc(s.amostra.status)}; ${esc(s.amostra.registros)} registro(s) comparados, ${esc(s.amostra.divergencias)} com divergência. ${esc(s.amostra.limite)} Amostra não certifica a base inteira.</p>` : '<p>Conferência amostral: ainda não registrada.</p>'}${coverageQuestion(s)}</article>`;
        }).join('')}</div><p>Quando o período ou a data não estiverem informados, a cobertura não foi comprovada. Consulte a fonte e solicite o recorte necessário ao órgão.</p><p>Resumo gerado em ${esc(date(data.gerado_em))}.</p></details>`;
        const aviso=box.querySelector('[data-operacao-cobertura]');
        fetch('operacao.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(op=>{
          const run=op?.last_completed_run;
          if (!run || !run.finished_at) { aviso.textContent='Resultado da última rotina principal não informado.'; return; }
          if (run.coleta==='FALHA' || run.deploy==='FALHA' || run.fase!=='final' || run.deploy!=='SUCESSO') {
            aviso.textContent=`Rotina principal em ${date(run.finished_at)}: atualização ou publicação não confirmada. Consulte o monitoramento; as datas das fontes abaixo se referem à base disponível.`;
          }
        }).catch(()=>{aviso.textContent='Situação da última rotina principal indisponível; confira as datas das fontes.';});
      } catch (_) { box.innerHTML='<p role="status">Cobertura indisponível. Isso não confirma ausência de dados.</p><button type="button">Tentar novamente</button>';box.querySelector('button').onclick=render; }
    };render();
  }
  function initHistory() {
    const host=document.querySelector('[data-evolucao-cidada]');if(!host)return;
    host.innerHTML='<h2>Evolução dos valores disponíveis</h2><p>Escolha uma série para consultar o histórico e seus limites.</p><button type="button" data-load-history>Consultar histórico</button><div data-history-result></div>';
    host.querySelector('[data-load-history]').onclick=async function(){
      const area=host.querySelector('[data-history-result]');this.disabled=true;area.innerHTML='<p role="status">Carregando séries…</p>';
      try {
        const data=await load();
        area.innerHTML=`<label>Série<select data-series>${data.series.map((s,i)=>`<option value="${i}">${esc(s.orgao)} · ${esc(s.titulo)}</option>`).join('')}</select></label><div data-series-content></div>`;
        const select=area.querySelector('[data-series]');
        const render=()=>{
          const s=data.series[Number(select.value)], target=area.querySelector('[data-series-content]');
          const rawSource=data.fontes.find(f=>f.id===s.fonte);
          const source=rawSource && (window.FISCALIZA.utils?.statusFonteAtual(rawSource) || rawSource);
          target.innerHTML=`<p><strong>${esc(s.frequencia==='mensal'?'Série mensal dos registros disponíveis':'Série anual; detalhamento mensal indisponível')}</strong></p><p>${esc(s.limite)}</p>${safeURL(s.url_fonte)?`<p><a href="${esc(safeURL(s.url_fonte))}" target="_blank" rel="noopener">Consultar a fonte oficial desta série</a></p>`:""}<p>${esc(statusLabels[source?.status] || statusLabels.unknown)}. Última tentativa: ${esc(date(source?.checked_at))}.</p><p>Não preenchemos meses ausentes com zero. ${s.excluidos} registro(s) sem data/valor adequado excluído(s) desta série.</p><div class="citizen-table" role="region" tabindex="0" aria-label="Valores por período"><table><caption>${esc(s.orgao)} · ${esc(s.titulo)}</caption><thead><tr><th scope="col">Período</th><th scope="col">Registros</th><th scope="col">Valor</th></tr></thead><tbody>${s.pontos.map(p=>`<tr><th scope="row">${esc(p.periodo)}</th><td>${p.registros==null?'Não informado':p.registros}</td><td>${brl(p.valor)}</td></tr>`).join('')}</tbody></table></div>${s.pontos.length?'<button type="button" data-series-csv>Baixar CSV desta série</button>':'<p>Nenhum período verificável nesta série.</p>'}${s.frequencia==='mensal' && s.pontos.length>1 ? `<div class="citizen-form"><label>Período inicial<select data-compare-from>${s.pontos.map((p,i)=>`<option value="${i}">${p.periodo}</option>`).join('')}</select></label><label>Período final<select data-compare-to>${s.pontos.map((p,i)=>`<option value="${i}" ${i===s.pontos.length-1?'selected':''}>${p.periodo}</option>`).join('')}</select></label><p role="status" data-series-delta></p></div>`:''}<p>As diferenças descrevem o recorte da base atual. Meses podem ter cobertura distinta; uma variação não comprova aumento de gasto, irregularidade ou mudança no serviço.</p><a href="cobrar.html#acompanhamento">Acompanhar uma pergunta sobre estes valores</a>`;
          const compare=()=>{const a=s.pontos[Number(target.querySelector('[data-compare-from]').value)],b=s.pontos[Number(target.querySelector('[data-compare-to]').value)]; const diff=b.valor-a.valor;target.querySelector('[data-series-delta]').textContent=`Diferença entre ${a.periodo} e ${b.periodo}: ${brl(diff)} · ${a.valor>0?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(diff/a.valor*100)+'%':'percentual não calculável com base zero ou negativa'}. Registros: ${a.registros} → ${b.registros}.`;};
          target.querySelectorAll('[data-compare-from],[data-compare-to]').forEach(el=>el.onchange=compare);if(target.querySelector('[data-series-delta]'))compare();
          target.querySelector('[data-series-csv]')?.addEventListener('click',()=>{
            const csv=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
            const rows=[['Órgão','Série','Período','Registros','Valor','Fonte','Última tentativa','Limitações'],...s.pontos.map(p=>[s.orgao,s.titulo,p.periodo,p.registros,p.valor,s.url_fonte || s.fonte,source?.checked_at,s.limite])];
            download(`${s.id}.csv`,'\uFEFF'+rows.map(r=>r.map(csv).join(';')).join('\r\n'),'text/csv;charset=utf-8');
          });
        };select.onchange=render;render();this.hidden=true;
      }catch(_){area.innerHTML='<p role="status">Histórico indisponível. Tente novamente; não interpretar como valor zero.</p>';this.disabled=false;}
    };
  }
  const STORE='fiscaliza.cobrancas.v1';
  const fields=['id','assunto','orgao','protocolo','enviado','retorno','situacao','fonte','pedido','resposta'];
  const read=()=>{const raw=JSON.parse(localStorage.getItem(STORE)||'[]');if(!Array.isArray(raw))throw Error();return raw.filter(r=>r&&typeof r.id==='string').slice(0,200);};
  function initTracking(){
    const host=document.querySelector('[data-acompanhamento-cidada]');if(!host)return;
    host.innerHTML=`<h2>Minhas cobranças</h2><p>Registre um pedido já enviado ou organize uma pergunta. Os dados ficam somente neste navegador e podem ser perdidos ao limpar os dados do site. Baixe uma cópia para guardar. Nenhum pedido é enviado por este formulário.</p><form class="citizen-form" data-tracking-form><input type="hidden" name="id"><label>Assunto<input name="assunto" required maxlength="240"></label><label>Órgão<select name="orgao"><option>Prefeitura</option><option>Câmara</option><option>Fundação Cultural</option><option>Outro</option></select></label><label>Protocolo oficial (se já enviado)<input name="protocolo" maxlength="160"></label><label>Data de envio<input type="date" name="enviado"></label><label>Data para conferir o retorno<input type="date" name="retorno"></label><label>Etapa da cobrança<select name="situacao"><option value="rascunho">Rascunho</option><option value="aguardando">Aguardando resposta</option><option value="respondida">Respondida</option><option value="encerrada">Encerrada</option></select></label><label>Link da fonte<input type="url" name="fonte" maxlength="1800" placeholder="https://"></label><label>Pergunta enviada ou planejada<textarea name="pedido" maxlength="6000"></textarea></label><label>Resposta e próxima providência<textarea name="resposta" maxlength="6000"></textarea></label><div><button type="submit">Salvar acompanhamento</button> <button type="reset">Novo registro</button></div></form><p role="status" data-tracking-status></p><button type="button" data-tracking-export>Baixar cópia dos acompanhamentos</button><div data-tracking-list></div>`;
    const form=host.querySelector('form'),feedback=host.querySelector('[data-tracking-status]'),list=host.querySelector('[data-tracking-list]');
    const field=k=>form.elements.namedItem(k);
    const render=()=>{
      let records;try{records=read();}catch(_){feedback.textContent='Não foi possível ler o armazenamento deste navegador. Os registros existentes não foram substituídos.';return;}
      list.innerHTML=records.length?records.map(r=>`<article class="report-note"><h3>${esc(r.assunto)}</h3><p>${esc(r.orgao)} · ${esc(r.situacao)} · Protocolo: ${esc(r.protocolo || 'Ainda não registrado')}</p><p>Envio: ${esc(r.enviado || 'Não informado')} · Conferir retorno: ${esc(r.retorno || 'Não informado')}</p><p>${esc(r.pedido)}</p><p>Resposta/próxima providência: ${esc(r.resposta || 'Ainda não registrada')}</p>${safeURL(r.fonte)?`<a href="${esc(safeURL(r.fonte))}" target="_blank" rel="noopener">Conferir fonte</a>`:''}<p><button type="button" data-edit-tracking="${esc(r.id)}">Atualizar resposta ou protocolo</button> <button type="button" data-delete-tracking="${esc(r.id)}">Excluir registro</button></p></article>`).join(''):'<p>Nenhuma cobrança registrada neste navegador.</p>';
    };
    form.onsubmit=event=>{
      event.preventDefault();
      const record=Object.fromEntries(fields.map(k=>[k,field(k).value.trim()]));
      if(record.fonte && !safeURL(record.fonte)){feedback.textContent='Use um link http ou https para a fonte.';return;}
      if(record.retorno && record.enviado && record.retorno<record.enviado){feedback.textContent='A data para conferir o retorno deve ser igual ou posterior ao envio.';return;}
      try{
        const records=read();record.id=record.id || crypto.randomUUID();const i=records.findIndex(r=>r.id===record.id);
        if(i>=0)records[i]=record;else{if(records.length>=200)throw Error();records.unshift(record);}
        localStorage.setItem(STORE,JSON.stringify(records));field('id').value=record.id;feedback.textContent='Acompanhamento salvo somente neste navegador. O pedido precisa ser enviado no canal oficial.';render();
      }catch(_){feedback.textContent='Não foi possível salvar. O armazenamento pode estar bloqueado ou cheio. Copie seus dados antes de sair.';}
    };
    list.onclick=event=>{
      const edit=event.target.closest('[data-edit-tracking]'),del=event.target.closest('[data-delete-tracking]');if(!edit&&!del)return;
      try{let records=read();const id=edit?edit.dataset.editTracking:del.dataset.deleteTracking;
        if(edit){const record=records.find(r=>r.id===id);fields.forEach(k=>field(k).value=record[k] || '');field('assunto').focus();}
        else{records=records.filter(r=>r.id!==id);localStorage.setItem(STORE,JSON.stringify(records));if(field('id').value===id)form.reset();feedback.textContent='Registro excluído deste navegador.';render();}
      }catch(_){feedback.textContent='Não foi possível acessar os registros. Nada foi alterado.';}
    };
    host.querySelector('[data-tracking-export]').onclick=()=>{try{download('minhas-cobrancas.json',JSON.stringify({exportado_em:new Date().toISOString(),cobrancas:read()},null,2),'application/json');}catch(_){feedback.textContent='Não foi possível exportar os registros deste navegador.';}};
    const restoreLabel=document.createElement('label');restoreLabel.className='citizen-restore';restoreLabel.textContent='Restaurar uma cópia dos acompanhamentos';
    const restore=document.createElement('input');restore.type='file';restore.accept='.json,application/json';restoreLabel.appendChild(restore);host.querySelector('[data-tracking-export]').after(restoreLabel);
    restore.onchange=async()=>{
      const file=restore.files[0];if(!file)return;
      try{
        if(file.size>3_000_000)throw Error();const payload=JSON.parse(await file.text());
        if(!Array.isArray(payload.cobrancas)||payload.cobrancas.length>200)throw Error();
        const incoming=payload.cobrancas.map(r=>{
          if(!r || !fields.every(k=>typeof r[k]==='string') || !r.id || !r.assunto || !['rascunho','aguardando','respondida','encerrada'].includes(r.situacao))throw Error();
          if(fields.some(k=>r[k].length>(['pedido','resposta'].includes(k)?6000:1800)) || (r.fonte && !safeURL(r.fonte)))throw Error();
          return Object.fromEntries(fields.map(k=>[k,r[k]]));
        });
        const records=read(),ids=new Set(records.map(r=>r.id));
        for(const r of incoming)if(!ids.has(r.id)){records.push(r);ids.add(r.id);}
        if(records.length>200)throw Error();localStorage.setItem(STORE,JSON.stringify(records));
        feedback.textContent='Cópia restaurada neste navegador. Registros com o mesmo identificador foram mantidos sem substituição.';render();
      }catch(_){feedback.textContent='Não foi possível restaurar esta cópia. Verifique o arquivo e o armazenamento. Os registros atuais foram mantidos.';}
      restore.value='';
    };
    const params=new URLSearchParams(location.search);for(const k of ['assunto','orgao','fonte','pedido'])if(params.has(k))field(k).value=params.get(k).slice(0,k==='pedido'?6000:1800);
    render();
  }
  function trackingLink(assunto,orgao,pedido,fonte){
    const params=new URLSearchParams({assunto:String(assunto).slice(0,240),orgao,fonte:safeURL(fonte),pedido:String(pedido).slice(0,6000)});
    return `<a class="btn-link" href="cobrar.html?${esc(params.toString())}#acompanhamento">Acompanhar esta cobrança</a>`;
  }
  function trail(c,orgao,info){
    const catalogoConsultado = info?.status === 'disponivel' || info?.status === 'sem_documentos';
    const docs=info?.status==='disponivel' && Array.isArray(info.documentos)?info.documentos:[];
    const stages=[['Contrato e anexos',/contrat|termo de contrata/i,'contrato assinado e anexos'],['Aditivos',/adit|apostil|\bad\s*\d/i,'todos os aditivos ou declaração de que não existem'],['Empenho e liquidação',/\bempenhos?\b|\bliquida(?:ção|ções|cao|coes)\b/i,'empenhos e liquidações vinculados ao contrato'],['Notas fiscais e pagamentos',/\bnotas?\s+fisca(?:l|is)\b|\bpagamentos?\b|\bfaturas?\b/i,'notas fiscais e comprovantes de pagamento vinculados ao contrato'],['Entrega e fiscalização',/\brecebimento\b|\bfiscaliza(?:ção|cao)\b|\bmedi(?:ção|ções|cao|coes)\b|\bentregas?\b/i,'termos de recebimento, medições e relatórios do fiscal']];
    const question=`Sobre o contrato ${c.numero || 'sem número'}/${c.ano || ''} de ${orgao}, fornecedor ${c.contratado || 'não informado'}, solicito ${stages.map(s=>s[2]).join('; ')}. Indicar o vínculo de cada empenho, liquidação, pagamento e entrega com este contrato e explicar documentos não disponíveis. Fonte consultada: ${safeURL(c.fonte_url) || 'ficha individual não localizada'}.`;
    const params=new URLSearchParams({assunto:`Contrato ${c.numero || ''}/${c.ano || ''} · ${c.contratado || ''}`.slice(0,240),orgao,fonte:safeURL(c.fonte_url),pedido:question});
    return `<section class="citizen-trail" data-citizen-trail="${esc(JSON.stringify({c:{numero:c.numero,ano:c.ano,contratado:c.contratado,fonte_url:c.fonte_url},orgao}))}"><h4>Do contrato à entrega: o que conseguimos conferir?</h4><p>O catálogo de anexos foi conferido em ${esc(date(info?.verificado_em))}. Nomes de arquivos são pistas; não confirmam o conteúdo nem a entrega.</p><ol>${stages.map(([name,pattern,ask],idx)=>{const found=docs.filter(d=>idx<2 ? window.FISCALIZA.dossie?.classificarDocumento(d)===(idx===0?'contrato':'aditivo') : pattern.test(`${d.tipo || ''} ${d.nome || ''}`));return `<li><strong>${esc(name)}</strong>: ${found.length?`o catálogo lista ${found.length} arquivo(s) possivelmente relacionado(s); conferir conteúdo`:catalogoConsultado?'documento desta etapa não localizado no catálogo consultado':'disponibilidade não confirmada; a consulta documental está indisponível ou inconclusiva'}${found.length?`<ul>${found.map(d=>`<li>${esc(d.nome || d.tipo)}</li>`).join('')}</ul>`:''}<p>Pergunta: solicitar ${esc(ask)}.</p></li>`;}).join('')}</ol><p>Pagamentos de um fornecedor e valores globais de contrato não comprovam vínculo entre si. Ausência no catálogo não comprova ausência de publicação ou de entrega. Aditivos podem não se aplicar.</p><a class="btn-link" href="cobrar.html?${esc(params.toString())}#acompanhamento">Acompanhar esta cobrança</a></section>`;
  }
  function init(){initCoverage();initHistory();initTracking();}
  window.FISCALIZA.cidadao={initCoverage,trail,trackingLink};
  window.addEventListener('fiscaliza:ready',init,{once:true});
  if(document.body.dataset.page==='monitoramento')init();
})();
