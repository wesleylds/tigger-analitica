# Auditoria visual detalhada do Easy Analytics

Captura base usada nesta analise:

- [report.md](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/report.md)
- [summary.json](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/summary.json)

Prints principais:

- [betano-viewport.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/betano-viewport.png)
- [betano-overview.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/betano-overview.png)
- [bet365-viewport.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/bet365-viewport.png)
- [bet365-overview.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/bet365-overview.png)

Seções isoladas:

- [betano-topbar.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/betano-topbar.png)
- [betano-filters.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/betano-filters.png)
- [betano-header.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/betano-header.png)
- [betano-matrix.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/betano-matrix.png)
- [betano-footer-actions.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/betano-footer-actions.png)
- [bet365-topbar.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/bet365-topbar.png)
- [bet365-filters.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/bet365-filters.png)
- [bet365-matrix.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/bet365-matrix.png)
- [bet365-footer-actions.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/bet365-footer-actions.png)

Menus capturados:

- [betano-menu-futebol-virtual.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/betano-menu-futebol-virtual.png)
- [betano-menu-extras.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/betano-menu-extras.png)
- [betano-menu-ligas.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/betano-menu-ligas.png)
- [betano-menu-tempo.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/betano-menu-tempo.png)
- [bet365-menu-futebol-virtual.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/bet365-menu-futebol-virtual.png)
- [bet365-menu-extras.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/bet365-menu-extras.png)
- [bet365-menu-tempo.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/bet365-menu-tempo.png)

## O que a UI real tem

1. A página abre com um título central grande do contexto:
`Futebol Virtual - Betano` ou `Futebol Virtual - Bet365`.

2. Abaixo do título existe uma barra de filtros horizontal única com cinco campos:
`Ligas`, `Tempo`, `Mercado`, `Odds`, `Últimas Horas`.

3. O valor padrão capturado no Easy foi:
- `Todos`
- `FT`
- `Ambas Marcam Sim`
- `Selecione as Odds`
- `12 horas`

4. No topo existe uma navegação curta:
- `Dashboard`
- `Futebol Virtual`
- `Criar Bots`
- `Extras`
- `Chamar Suporte`

5. O menu `Futebol Virtual` real capturado mostra:
- `Kiron`
- `Kiron (Bet365)`
- `Betano`
- `Bet365`

6. O menu `Extras` real capturado mostra:
- `Sugestões`
- `Indique e Ganhe 50%`
- `Grupo da Plataforma`

7. O menu `Ligas` da Betano capturado mostra:
- `Todos`
- `British Derbies`
- `Liga Espanhola`
- `Scudetto Italiano`
- `Campeonato Italiano`
- `Copa das Estrelas`
- `Campeões`
- `Clássicos da América`
- `Copa America`
- `Euro`
- `Brasileirão Betano`

8. O menu `Tempo` capturado mostra:
- `FT`
- `HT`
- `FT + HT`

## Estrutura real da análise

1. Cada bloco de liga tem esta ordem:
- nome da liga
- barra percentual verde/vermelha
- linha de toggles
- matriz
- rodapé de ações

2. Os toggles da linha superior são minimalistas e não parecem botões cheios:
- `Ver Video`
- `Ver Times`
- `Ranking nos Próximos`
- `Horas Pagantes`

3. O rodapé operacional do card não é pequeno nem opcional. No Easy ele traz:
- `Modo Trader`
- `Tendência`
- `Máxima`
- `Ranking`
- `Próximos Jogos`
- `Calculadora Martingale`

4. A matriz capturada usa:
- `20` colunas de minuto
- `3` colunas-resumo no fim: `%`, `Greens`, `Total`
- primeira coluna fixa de hora
- linha superior com percentual por coluna
- linha logo abaixo com número de greens por coluna

5. Medida estrutural capturada na grade:
- estilo detectado: `grid-template-columns: 88.0309px repeat(20, 44.0154px) 57.2201px 57.2201px 57.2201px;`

Isso confirma um desenho muito mais rígido e operacional do que o nosso atual.

## Diferenças críticas entre o Easy e o nosso app

1. O Easy não parece um app montado por blocos independentes.
Ele parece uma superfície contínua e compacta.

2. O Easy não apoia a leitura numa única área centralizada com “cara de hero”.
Ele sobe a análise para cima e reduz a sensação de vitrine.

3. O Easy trabalha com múltiplos blocos de liga na mesma página.
Isso ficou claro em [betano-overview.png](C:/Users/WESLLEY/Desktop/tigger analitica/captures/easy-ui-audit-2026-04-12T17-21-31-711Z/betano-overview.png), onde várias ligas aparecem empilhadas.

4. O nosso app ainda está muito mais próximo de:
- uma leitura única central
- um card principal isolado
- ações distribuídas em lugares errados

5. O Easy é muito mais seco em:
- borda
- padding
- densidade
- hierarquia
- repetição de blocos

6. O Easy trata a matriz como corpo principal do produto.
No nosso, ainda sobra sensação de interface antes da grade.

## Decisão correta para a próxima fase

Se o objetivo é aproximar visualmente de verdade, a home de análise precisa ser reestruturada assim:

1. Título central do contexto `Futebol Virtual - Betano/Bet365`.
2. Barra de filtros global única.
3. Lista vertical de cards de ligas.
4. Cada card de liga com:
- nome
- barra percentual
- toggles curtos
- matriz 20xN
- rodapé de ações

Sem isso, qualquer ajuste só de CSS vai continuar parecendo uma aproximação amadora.
