# Easy Analytics API Notes

Captura inicial realizada em `2026-04-12` usando login autenticado e Playwright.

## Endpoints localizados

- Auth callback: `POST /api/auth/callback/login`
- Auth session: `GET /api/auth/session`
- tRPC base: `https://app.easycoanalytics.com.br/api/trpc`
- tRPC encontrados nas capturas:
  - `user.Profile`
  - `systemUpdate.list`
  - `betano.GetChamps`
  - `bet365.GetChamps`
  - `subscription.getMyUpgrade`
  - `botStrategy.list`

## Feed em tempo real

O bundle privado do Easy expõe um socket em:

- `wss://api.easycoanalytics.com.br`

O cliente envia:

```json
{ "provider": "BETANO", "sub": "british-derbies" }
```

via evento `subscribe`, e recebe atualizações no evento `update`.

## Providers já mapeados

### BETANO

- `british-derbies`
- `liga-espanhola`
- `scudetto-italiano`
- `campeonato-italiano`
- `copa-das-estrelas`
- `campeões`
- `clássicos-da-américa`
- `copa-america`
- `euro`
- `copa`

### BET365

- `copa_do_mundo`
- `euro cup`
- `premiership`
- `super_liga_sul-americana`

## Scripts locais

- Captura autenticada de páginas e endpoints:
  - `npm run scrape:sites`
- Captura direta do websocket do Easy:
  - `npm run scrape:easy-live -- BETANO`
  - `npm run scrape:easy-live -- BET365`

## Capturas úteis já geradas

- Easy autenticado com snapshots:
  - `captures/easycoanalytics-2026-04-12T16-22-02-447Z`
- Betano via websocket:
  - `captures/easy-live-2026-04-12T16-25-10-229Z`
- Bet365 via websocket:
  - `captures/easy-live-2026-04-12T16-25-19-683Z`

## Observações

- `historicosbet.com` respondeu com bloqueio do Cloudflare no ambiente de automação atual.
- O feed websocket do Easy já retorna partidas finalizadas em volume suficiente para substituir os mocks.
