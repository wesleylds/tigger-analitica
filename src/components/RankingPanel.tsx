import { useMemo } from 'react'
import { percentageFormatter } from '../lib/ui'
import {
  buildTeamRankingRows,
  getMarketHitLabel,
  getRankingLimitLabel,
  getRankingScopeLabel,
  parseRankingLimit,
  rankingLimitOptions,
  rankingScopeOptions,
  type RankingLimit,
  type RankingScope,
} from '../lib/teamRanking'
import type { MatchRecord } from '../types'

interface RankingPanelProps {
  limit: RankingLimit
  market: string
  onLimitChange: (limit: RankingLimit) => void
  onScopeChange: (scope: RankingScope) => void
  records: MatchRecord[]
  scope: RankingScope
}

const normalizeMarketLabel = (market: string) =>
  market.replace('Nao', 'Não').replace('NÃ£o', 'Não')

const getToneClass = (rate: number) => {
  if (rate >= 0.7) return 'is-excellent'
  if (rate >= 0.5) return 'is-good'
  return 'is-regular'
}

export function RankingPanel({
  limit,
  market,
  onLimitChange,
  onScopeChange,
  records,
  scope,
}: RankingPanelProps) {
  const rows = useMemo(() => buildTeamRankingRows(records, market, scope, limit), [limit, market, records, scope])
  const marketLabel = normalizeMarketLabel(market)
  const hitLabel = getMarketHitLabel(market)

  return (
    <section className="ranking-panel">
      <div className="ranking-panel-header">
        <div className="ranking-panel-title-row">
          <span className="ranking-panel-icon" aria-hidden="true">
            R
          </span>
          <div className="ranking-panel-title">
            <h3>{`${getRankingLimitLabel(limit)} - ${marketLabel}`}</h3>
            <p>{`Ranking ${getRankingScopeLabel(scope).toLowerCase()} baseado na fonte atual da liga`}</p>
          </div>
        </div>

        <div className="ranking-panel-controls" aria-label="Controles do ranking">
          <div className="ranking-scope-tabs" role="group" aria-label="Tipo de ranking">
            {rankingScopeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={scope === option.value ? 'active' : ''}
                onClick={() => onScopeChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="ranking-limit-select">
            <span>Mostrar</span>
            <select value={String(limit)} onChange={(event) => onLimitChange(parseRankingLimit(event.target.value))}>
              {rankingLimitOptions.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="ranking-empty-state">
          <strong>Ranking</strong>
          <p>Os dados dessa liga ainda nao sao suficientes para montar a tabela.</p>
        </div>
      ) : (
        <div className="ranking-board">
          <header className="ranking-board-head">
            <span>#</span>
            <span>Equipe</span>
            <span>P</span>
            <span>J</span>
            <span>V</span>
            <span>E</span>
            <span>D</span>
            <span>GP</span>
            <span>GC</span>
            <span>SG</span>
            <span>{`Qtd ${hitLabel}`}</span>
            <span>{`% ${hitLabel}`}</span>
          </header>

          <div className="ranking-board-body">
            {rows.map((row, index) => {
              const goalDiff = row.goalsFor - row.goalsAgainst
              const toneClass = getToneClass(row.hitRate)

              return (
                <article key={row.id} className="ranking-row">
                  <div className={`ranking-rank ${toneClass}`}>{index + 1}</div>
                  <div className="ranking-team-copy">
                    <strong>{row.label}</strong>
                    <span>{getRankingScopeLabel(scope)}</span>
                  </div>
                  <div>{row.points}</div>
                  <div>{row.games}</div>
                  <div>{row.wins}</div>
                  <div>{row.draws}</div>
                  <div>{row.losses}</div>
                  <div>{row.goalsFor}</div>
                  <div>{row.goalsAgainst}</div>
                  <div>{goalDiff > 0 ? `+${goalDiff}` : goalDiff}</div>
                  <div>{row.hits}</div>
                  <div className="ranking-rate-wrap">
                    <strong className={toneClass}>{percentageFormatter.format(row.hitRate)}</strong>
                    <span className="ranking-rate-bar">
                      <span className={toneClass} style={{ width: `${Math.max(row.hitRate * 100, 8)}%` }} />
                    </span>
                  </div>
                </article>
              )
            })}
          </div>

          <footer className="ranking-board-legend">
            <span><i className="is-excellent" /> {">="}70% Excelente</span>
            <span><i className="is-good" /> 50-69% Bom</span>
            <span><i className="is-regular" /> {'<'}50% Regular</span>
          </footer>
        </div>
      )}
    </section>
  )
}
