# Studio Agathaa — site + agendamento

Node/Express + SQLite (sql.js). Sem conta e sem sinal para a cliente; painel em `/admin`.

## Rodar local
1. `npm install && node --env-file=.env server.js` (Node 18+).
2. Abra http://localhost:3000 → login em `/admin` com credenciais do `.env`.

## Publicar (GitHub + Render)
1. Crie um repositório privado no GitHub.
2. Em `Render Dashboard`, novo serviço → Git, escolha o repo.
3. Environment: `JWT_SECRET` (gerado), `OWNER_EMAIL`, `OWNER_PASSWORD` (12+), `NODE_ENV=production`, `DATABASE_FILE=/tmp/agathaa.db`.
4. Faça o deploy.

**Nota sobre dados:** o arquivo SQLite fica em `/tmp` na Render, que é apagado em cada reinício. Os dados são perdidos no plano free. Para guardar, você precisa copiar manualmente o arquivo ou fazer backup periódico.

## Dados a cadastrar (no painel)
- Serviços (Nails e Lashes), com preço, duração e descrição.
- Profissionais (com horários e serviços habilitados).
- Endereço, horários e link do mapa (em Configurações).

## O que funciona
- Site público com serviços, galeria e agendamento sem conta/sem sinal.
- Cada cliente tem um link único para ver ou cancelar sua reserva.
- Servidor revalida disponibilidade e impede conflito de horário com gatilho do banco.
- Painel com login seguro, agenda, gerenciamento de serviços e profissionais.

## Ainda não pronto
- Envio de e-mail/WhatsApp (filas criadas, provedor não ligado).
- A cliente remarcar pelo site (hoje cancela e agenda de novo).
- Folgas/férias pelo painel.
- Usuários da equipe extras.

## Fotos
- Coloque fotos em `public/gallery/` e comite no GitHub (elas aparecem na galeria do site).
- A foto principal vem de `public/img/agatha.jpg`.
