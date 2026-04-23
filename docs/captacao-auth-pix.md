# Captacao, Auth e Pix

## Objetivo

Esta pagina publica (`/captacao`) foi separada da dashboard interna para cumprir dois papeis:

- captar novos clientes
- permitir criacao de conta e login
- liberar 5 horas de teste
- travar o acesso depois do teste
- apresentar cobranca Pix de `R$ 19,90`

## O que ja ficou preparado

- pagina publica separada da dashboard do cliente
- fluxo de cadastro, login e teste no frontend
- trava visual de acesso apos o fim do teste
- geracao de Pix copia e cola + QR Code com a chave:
  - `b7bbe350-fff9-4384-8623-31b172df6311`
- configuracao centralizada em `.env.example`
- base de banco e policies em:
  - `supabase/migrations/20260421_customer_access.sql`
- funcao para gerar cobranca segura no backend em:
  - `supabase/functions/create-pix-charge/index.ts`

## PagBank

Tambem ficou preparada a estrutura do PagBank para substituir o Pix estatico:

- checkout em etapas na pagina `Planos`
- pedido real via `POST /orders`
- QR Code com validade de `30 minutos`
- botao `Ja fiz o pagamento` para consulta manual
- polling automatico do status enquanto o checkout estiver aberto
- webhook com validacao do header `x-authenticity-token`

Arquivos principais:

- `supabase/functions/create-pagbank-order/index.ts`
- `supabase/functions/check-pagbank-order/index.ts`
- `supabase/functions/pagbank-webhook/index.ts`
- `supabase/functions/_shared/pagbank.ts`
- `supabase/migrations/20260421_pagbank_orders.sql`

## O que e necessario para subir em producao

### 1. Auth real

Configurar:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

E aplicar a migration do Supabase.

### 2. Segredos fora do frontend

No backend/Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PIX_KEY`
- `PIX_MERCHANT_NAME`
- `PIX_MERCHANT_CITY`
- `PIX_AMOUNT_CENTS`

### 3. Confirmacao profissional do pagamento

Com chave Pix aleatoria propria, o sistema consegue:

- gerar o QR Code
- gerar o copia e cola
- travar o acesso

Mas para liberacao **automatica** do acesso apos o pagamento, ainda e preciso uma integracao com API/webhook do banco ou PSP.

Sem webhook bancario/PSP, a confirmacao do Pix fica manual.

### 4. PagBank em producao

Para ativacao imediata com PagBank:

- `PAGBANK_ENV=production`
- `PAGBANK_TOKEN=<token de producao>`
- `PAGBANK_NOTIFICATION_URL=https://seu-projeto.supabase.co/functions/v1/pagbank-webhook`
- `PAGBANK_PLAN_AMOUNT_CENTS=1990`

No frontend:

- `VITE_PAGBANK_ENV=production`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Observacao:

- no modelo atual do app, a liberacao automatica vale para a sessao/conta local do navegador
- para centralizar isso de forma 100% profissional entre dispositivos, o proximo passo e migrar a conta local para auth real no Supabase ou backend proprio

## Caminho recomendado para nivel profissional completo

1. Supabase Auth para sessao real
2. Supabase Edge Functions para gerar cobranca segura
3. PSP/banco com webhook para aprovar pagamento automaticamente
4. Atualizacao automatica de `customer_accounts.access_status`
5. Liberacao da dashboard somente para contas `active` ou `trialing`
