# BB Tips League ID Audit

Last checked: 2026-04-22 (America/Sao_Paulo)

## Confirmed live on BB Tips

Platform: Betano

- `Classicos` -> `liga=2`
- `Copa` -> `liga=3`
- `Euro` -> `liga=4`
- `America` -> `liga=5`

Confirmed by opening the authenticated BB Tips page and observing the live requests fired by each tab:

- `https://api.bbtips.com.br/api/betanoFutebolVirtual?liga=3&Horas=Horas12&dadosAlteracao=&filtros=`
  after clicking `Copa`
- `https://api.bbtips.com.br/api/betanoFutebolVirtual?liga=5&Horas=Horas12&dadosAlteracao=&filtros=`
  after clicking `America`

## Local fixes applied

- `src/data/bbtipsCatalog.ts`
  - `Betano.copa.id` changed from `5` to `3`
  - `Betano.america.id` changed from `3` to `5`
- `src/data/bbtipsLeagueIdOverrides.ts`
  - confirmed live IDs are now stored in a dedicated override layer consumed by the catalog at runtime

- `src/App.tsx`
  - matrix state version bumped to invalidate persisted league/filter state after the ID swap

## Pending verification

Platform: Bet365

- Current local mapping is saved in `src/data/bbtipsCatalog.ts`
- Not replicated from the Betano fix because the source was unavailable during this audit
- Must be checked against the live authenticated BB Tips page before changing any IDs

Platform: Express 365

- Current local mapping is saved in `src/data/bbtipsCatalog.ts`
- Not replicated from the Betano fix because the source was unavailable during this audit
- Must be checked against the live authenticated BB Tips page before changing any IDs

## Recheck command

Run the reusable audit with:

```bash
npm run bbtips:audit-league-ids -- Betano
```

The report is saved under `captures/bbtips-league-id-audit/`.
