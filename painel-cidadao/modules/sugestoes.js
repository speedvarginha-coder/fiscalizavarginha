/* Sugestões enviadas pelo servidor; opções manuais em caso de falha. */
(function () {
  'use strict';
  const key = 'fiscaliza.sugestao.ocultada.ate';
  const week = 7 * 24 * 60 * 60 * 1000;
  const css = document.createElement('style');
  css.textContent = '.convite-sugestao{position:fixed;z-index:999;right:20px;bottom:126px;width:min(360px,calc(100vw - 32px));box-sizing:border-box;padding:20px;border:1px solid #d6e3e9;border-radius:16px;background:#fff;color:#192a3b;box-shadow:0 10px 35px #1a304b33;font:15px/1.5 system-ui,sans-serif}.convite-sugestao h2{font-size:17px;line-height:1.3;margin:0 30px 8px 0;color:#123c5b}.convite-sugestao p{margin:0 0 14px}.convite-sugestao__close,.sugestao-dialogo__close{position:absolute;right:12px;top:10px;border:0;background:transparent;color:#41566b;font-size:24px;line-height:1;cursor:pointer;padding:6px}.convite-sugestao__actions{display:flex;gap:8px;flex-wrap:wrap}.convite-sugestao__actions button,.sugestao-dialogo button,.sugestao-dialogo a{border:1px solid #00569b;border-radius:7px;padding:9px 13px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none}.convite-sugestao__actions button:first-child,.sugestao-dialogo__primary{background:#00569b;color:#fff}.convite-sugestao__actions button:last-child,.sugestao-dialogo__secondary{background:#fff;color:#00569b}.convite-sugestao :focus-visible,.sugestao-dialogo :focus-visible{outline:3px solid #f5a900;outline-offset:2px}.sugestao-dialogo{position:fixed;box-sizing:border-box;width:min(680px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;border:1px solid #d6e3e9;border-radius:16px;padding:24px;background:#fff;color:#192a3b;box-shadow:0 15px 55px #10253f66;font:15px/1.5 system-ui,sans-serif}.sugestao-dialogo::backdrop{background:#10253f99}.sugestao-dialogo h2{font-size:22px;line-height:1.3;margin:0 35px 8px 0;color:#123c5b}.sugestao-dialogo p{margin:0 0 14px}.sugestao-dialogo label{display:block;font-weight:700;margin:12px 0 4px}.sugestao-dialogo input,.sugestao-dialogo select,.sugestao-dialogo textarea{box-sizing:border-box;width:100%;padding:10px;border:1px solid #a9bcc9;border-radius:7px;font:inherit;color:#192a3b;background:#fff}.sugestao-dialogo textarea{min-height:115px;resize:vertical}.sugestao-dialogo__grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.sugestao-dialogo__footer{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:16px}.sugestao-dialogo__note{font-size:13px;color:#40576c;margin-top:12px!important}@media(max-width:600px){.convite-sugestao{right:16px;bottom:82px;padding:16px;max-height:min(55vh,350px);overflow:auto}.sugestao-dialogo{padding:18px}.sugestao-dialogo__grid{grid-template-columns:1fr;gap:0}}';
  document.head.appendChild(css);

  const dialog = document.createElement('dialog');
  dialog.className = 'sugestao-dialogo';
  dialog.setAttribute('aria-labelledby', 'sugestao-titulo');
  dialog.innerHTML = '<button type="button" class="sugestao-dialogo__close" aria-label="Fechar formulário de sugestão">×</button><h2 id="sugestao-titulo">Envie sua sugestão</h2><p>Conte o que pode melhorar ou informe um dado que precisa de conferência.</p><form><label for="sugestao-assunto">Sobre o quê?</label><select id="sugestao-assunto" name="assunto"><option>Ideia para o site</option><option>Informação que falta</option><option>Possível erro nos dados</option><option>Outro assunto</option></select><label for="sugestao-mensagem">Sua sugestão</label><textarea id="sugestao-mensagem" name="mensagem" maxlength="1000" required placeholder="Descreva sua sugestão. Se possível, informe a página e o link da fonte oficial."></textarea><div class="sugestao-dialogo__grid"><div><label for="sugestao-nome">Seu nome (opcional)</label><input id="sugestao-nome" name="nome" maxlength="100" autocomplete="name"></div><div><label for="sugestao-email">Seu e-mail (opcional)</label><input id="sugestao-email" name="email" type="email" maxlength="160" autocomplete="email"></div></div><label for="sugestao-cidade">Sua cidade (opcional)</label><input id="sugestao-cidade" name="cidade" maxlength="100" autocomplete="address-level2"><p class="sugestao-dialogo__note">Os dados preenchidos serão incluídos no e-mail. O site não envia nem armazena esta mensagem: revise e envie pelo seu aplicativo de e-mail.</p><div class="sugestao-dialogo__footer"><button type="submit" class="sugestao-dialogo__primary">Preparar e-mail</button><button type="button" class="sugestao-dialogo__secondary" data-fechar>Cancelar</button></div><p role="status" class="sugestao-dialogo__note" data-sugestao-status></p></form>';
  document.body.appendChild(dialog);
  const form = dialog.querySelector('form');
  form.querySelector('.sugestao-dialogo__note').textContent = 'Sua sugestão e os dados informados serão enviados à equipe por e-mail.';
  const enviar = form.querySelector('[type="submit"]');
  enviar.textContent = 'Enviar sugestão';
  const status = dialog.querySelector('[data-sugestao-status]');
  const opcoes = document.createElement('div');
  opcoes.hidden = true;
  opcoes.className = 'sugestao-dialogo__opcoes';
  opcoes.innerHTML = '<p><strong>Outra forma de enviar:</strong></p><div class="sugestao-dialogo__footer"><a data-gmail target="_blank" rel="noopener noreferrer" class="sugestao-dialogo__primary">Abrir no Gmail</a><a data-aplicativo class="sugestao-dialogo__secondary">Abrir no aplicativo de e-mail</a><button type="button" data-copiar class="sugestao-dialogo__secondary">Copiar mensagem</button></div><p class="sugestao-dialogo__note">Destinatário: contato@fiscalizavarginha.com.br. Nestas opções, revise e envie a mensagem no seu e-mail.</p>';
  status.before(opcoes);
  const sucesso = document.createElement('div');
  sucesso.hidden = true;
  sucesso.innerHTML = '<p role="status"><strong>Sugestão aceita para envio. Obrigado por contribuir.</strong></p><p>O servidor aceitou a mensagem para encaminhamento.</p><button type="button" class="sugestao-dialogo__secondary" data-outra>Enviar outra sugestão</button>';
  form.after(sucesso);
  sucesso.querySelector('[data-outra]').addEventListener('click', () => {
    form.reset(); sucesso.hidden = true; form.hidden = false; status.textContent = ''; opcoes.hidden = true;
    form.querySelector('#sugestao-assunto').focus();
  });
  let textoParaCopiar = '';
  let trigger = null;
  function openDialog(event) {
    if (event) event.preventDefault();
    trigger = document.activeElement;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('#sugestao-assunto').focus();
  }
  function closeDialog() { dialog.close(); }
  dialog.querySelector('.sugestao-dialogo__close').addEventListener('click', closeDialog);
  dialog.querySelector('[data-fechar]').addEventListener('click', closeDialog);
  dialog.addEventListener('close', () => { if (trigger && trigger.isConnected) trigger.focus(); });
  document.querySelectorAll('[data-abrir-sugestao]').forEach(link => link.addEventListener('click', openDialog));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const lines = ['Sugestão: ' + data.get('mensagem'), '', 'Nome: ' + (data.get('nome') || 'Não informado'), 'E-mail: ' + (data.get('email') || 'Não informado'), 'Cidade: ' + (data.get('cidade') || 'Não informada')];
    const subject = 'Fiscaliza Varginha — ' + data.get('assunto');
    const body = lines.join('\n');
    const destinatario = 'contato@fiscalizavarginha.com.br';
    dialog.querySelector('[data-aplicativo]').href = 'mailto:' + destinatario + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    const params = new URLSearchParams({ view: 'cm', fs: '1', to: destinatario, su: subject, body: body });
    dialog.querySelector('[data-gmail]').href = 'https://mail.google.com/mail/?' + params.toString();
    textoParaCopiar = 'Para: ' + destinatario + '\nAssunto: ' + subject + '\n\n' + body;
    opcoes.hidden = true;
    status.textContent = 'Enviando sugestão…';
    enviar.disabled = true;
    try {
      const resposta = await fetch('/sugestao.php', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assunto: data.get('assunto'), mensagem: data.get('mensagem'), nome: data.get('nome'), email: data.get('email'), cidade: data.get('cidade') })
      });
      const resultado = await resposta.json();
      if (!resposta.ok || resultado.ok !== true) throw new Error(resultado.mensagem || 'Não foi possível enviar agora.');
      form.hidden = true;
      sucesso.hidden = false;
      sucesso.querySelector('[data-outra]').focus();
    } catch (_) {
      status.textContent = 'Não foi possível enviar automaticamente. Tente novamente ou escolha uma opção abaixo.';
      opcoes.hidden = false;
    } finally {
      enviar.disabled = false;
    }
  });
  form.addEventListener('input', () => { opcoes.hidden = true; status.textContent = ''; });
  form.addEventListener('change', () => { opcoes.hidden = true; status.textContent = ''; });
  opcoes.querySelector('[data-copiar]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(textoParaCopiar);
      status.textContent = 'Mensagem copiada. Cole no seu e-mail e envie para contato@fiscalizavarginha.com.br.';
    } catch (_) {
      window.prompt('Copie a mensagem e cole no seu e-mail:', textoParaCopiar);
      status.textContent = 'Copie a mensagem e envie para contato@fiscalizavarginha.com.br.';
    }
  });

  function show() {
    if (!document.body || document.querySelector('[data-convite-sugestao]')) return;
    if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) { window.setTimeout(show, 10000); return; }
    const box = document.createElement('aside');
    box.className = 'convite-sugestao';
    box.setAttribute('data-convite-sugestao', '');
    box.setAttribute('aria-labelledby', 'convite-sugestao-titulo');
    box.innerHTML = '<button type="button" class="convite-sugestao__close" aria-label="Fechar convite para sugestões">×</button><h2 id="convite-sugestao-titulo">Ajude a melhorar o Fiscaliza Varginha</h2><p>Encontrou um dado que precisa de correção ou tem uma sugestão? Conte para a equipe.</p><div class="convite-sugestao__actions"><button type="button" data-abrir>Escrever sugestão</button><button type="button" data-sugestao-depois>Agora não</button></div>';
    function dismiss() {
      try { localStorage.setItem(key, String(Date.now() + week)); } catch (_) {}
      const focused = box.contains(document.activeElement);
      box.remove();
      if (focused) document.body.focus({ preventScroll: true });
      document.removeEventListener('keydown', onKey);
    }
    function onKey(event) { if (event.key === 'Escape' && box.contains(document.activeElement) && !dialog.open) dismiss(); }
    box.querySelector('.convite-sugestao__close').addEventListener('click', dismiss);
    box.querySelector('[data-sugestao-depois]').addEventListener('click', dismiss);
    box.querySelector('[data-abrir]').addEventListener('click', openDialog);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(box);
  }
  let suppressed = false;
  try { suppressed = Number(localStorage.getItem(key)) > Date.now(); } catch (_) {}
  if (!suppressed) window.setTimeout(show, 30000);
})();
