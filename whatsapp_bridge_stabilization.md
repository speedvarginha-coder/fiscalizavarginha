# Estabilização da Ponte de WhatsApp (Hostinger Node.js)

Este guia descreve a atualização da ponte de WhatsApp para impedir que múltiplos processos do Phusion Passenger disputem a mesma sessão do Baileys.

## Como a solução funciona

- Cada processo tenta reservar a porta local `127.0.0.1:59876`.
- O processo que consegue reservar a porta torna-se o **Master** e é o único que abre uma conexão com o WhatsApp.
- Os demais processos tornam-se **réplicas** e encaminham suas requisições HTTP ao Master.
- As réplicas repetem a eleição periodicamente. Se o Master for encerrado, uma delas assume a porta e restabelece a conexão.

## Antes de atualizar

1. Abra o hPanel da Hostinger e acesse a aplicação Node.js de `whatsapp.fiscalizavarginha.com.br`.
2. Anote a pasta raiz e o arquivo de inicialização atuais.
3. Faça backup da pasta `auth_info`. Ela contém a sessão do WhatsApp e deve ser preservada para evitar uma nova leitura de QR Code.
4. Pare a aplicação Node.js.
5. Gere uma chave aleatória nova, com pelo menos 48 caracteres. Configure-a como `WHATSAPP_API_KEY` no ambiente da aplicação ou grave-a, sem quebra de linha adicional, em `whatsapp-bridge/.apikey`. Não versione nem reutilize a chave antiga.
6. O serviço escuta em `127.0.0.1` por padrão. Defina `HOST` explicitamente somente quando um proxy reverso ou a plataforma exigir outro endereço.

## Atualização recomendada pelo ZIP

1. Envie `whatsapp-bridge.zip` para a pasta raiz da aplicação.
2. Substitua apenas estes arquivos:
   - `server.js`
   - `package.json`
   - `package-lock.json`
   - `ecosystem.config.js`
3. Não exclua nem sobrescreva a pasta `auth_info`.
4. Execute a instalação das dependências no painel, se ela for solicitada.
5. Inicie ou implante novamente a aplicação.

## Validação

1. Abra `https://whatsapp.fiscalizavarginha.com.br`. Quando solicitado, informe qualquer usuário e use a chave configurada como senha.
2. Confirme que o painel carrega e mostra o estado da conexão.
3. Se aparecer um QR Code, leia-o no WhatsApp do celular.
4. Faça um único envio de teste.
5. Nos logs, confirme que apenas um processo informa `Rodando como MASTER ativa`; os demais, se existirem, devem informar `Rodando como RÉPLICA passiva`.

## Docker Compose

1. Crie um `.env` local baseado em `docker-compose.env.example`; todos os campos obrigatórios devem ser preenchidos e mantidos fora do controle de versão.
2. Use uma tag fixa em `EVOLUTION_IMAGE`, não `latest`.
3. Defina `DATABASE_CONNECTION_URI` com os mesmos dados de `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB`, usando o host interno `postgres`.
4. Postgres e Redis não publicam portas no host. A Evolution publica `8080` apenas em loopback por padrão; altere `EVOLUTION_BIND_ADDRESS` somente se houver uma necessidade de rede documentada.

## Reversão

Se a aplicação não iniciar, pare-a, restaure os quatro arquivos do backup e mantenha a pasta `auth_info` no lugar. Depois, inicie novamente a aplicação.
