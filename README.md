# Studio Agathaa — site + agendamento

Node/Express + SQLite (arquivo único). Sem conta e sem sinal para a cliente; painel em `/admin`.

## Rodar local
1. `cp .env.example .env` e preencha.
2. `npm install && node --env-file=.env server.js` (Node 20+) → http://localhost:3000
3. O arquivo do banco e as tabelas são criados na primeira subida; a conta da proprietária vem de `OWNER_EMAIL`/`OWNER_PASSWORD`.

## Publicar (GitHub + Render)
1. `git init && git add . && git commit -m "Studio Agathaa" && git push` para um repositório **privado**.
2. Render → serviço Web → Environment: `JWT_SECRET`, `OWNER_EMAIL`, `OWNER_PASSWORD` (12+), `NODE_ENV=production` e `DATABASE_FILE=/var/data/agathaa.db`.
3. **Obrigatório para não perder dados:** Settings → Disks → Add Disk, mount path `/var/data`. Disco exige plano pago; no plano free o arquivo SQLite é apagado a cada deploy/reinício.
4. Acesse `/admin`, entre e cadastre: serviços → profissionais (horários e serviços) → configurações (endereço, horários, mapa).
5. Domínio próprio: Render → Settings → Custom Domains.
6. Fotos: coloque `.jpg/.png/.webp` em `public/gallery/` e faça commit.

## Regras garantidas
- Conflito de horário: gatilho no SQLite que recusa horários sobrepostos + transação síncrona + revalidação no servidor.
- Preço/duração congelados em cada reserva. Link de gestão com token de 256 bits (só o hash fica no banco).
- Antecedência mínima, horizonte e prazo de cancelamento vêm de `settings`.
- Horário fixo de Brasília (UTC-3).

## Pendente (não implementado)
- **Envio** de e-mail/WhatsApp: a reserva grava em `notification_outbox`, mas não há worker nem provedor ligado.
- Reagendamento pela cliente (hoje: cancelar e reservar de novo), bloqueios/folgas/férias pelo painel (tabela `schedule_blocks` pronta), edição de profissionais e usuários extras, visão semanal/mensal.
- CSP desativada (páginas usam script inline); CSRF coberto por cookie `SameSite=Lax` + JSON.
- Textos "Sobre" e política de privacidade são provisórios. Sem serviços, preços ou fotos inventados.
- Backup: copie `agathaa.db` periodicamente (Render → Shell ou snapshots do disco).
