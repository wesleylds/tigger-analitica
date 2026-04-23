import { useEffect, useMemo, useState } from 'react'
import type { MatchRecord } from '../types'

interface MaximaPanelProps {
  onHighlightChange?: (slotKeys: string[]) => void
  records: MatchRecord[]
}

interface ScorePair {
  away: number
  home: number
}

interface MaximaMetric {
  currentStreak: number
  maxStreak: number
  maxRecords: MatchRecord[]
}

interface MaximaCardData extends MaximaMetric {
  key: string
  label: string
  totalGames: number
}

interface MaximaMarketDefinition {
  key: string
  label: string
  resolve: (record: MatchRecord, ft: ScorePair, ht: ScorePair) => boolean
}

const maximaDefinitions: MaximaMarketDefinition[] = [
  { key: 'btts-yes', label: 'Ambas Marcam SIM', resolve: (_record, ft) => ft.home > 0 && ft.away > 0 },
  { key: 'btts-no', label: 'Ambas Marcam NÃO', resolve: (_record, ft) => !(ft.home > 0 && ft.away > 0) },
  { key: 'over-05', label: 'Over 0.5', resolve: (_record, ft) => ft.home + ft.away >= 1 },
  { key: 'over-15', label: 'Over 1.5', resolve: (_record, ft) => ft.home + ft.away >= 2 },
  { key: 'over-25', label: 'Over 2.5', resolve: (_record, ft) => ft.home + ft.away >= 3 },
  { key: 'over-35', label: 'Over 3.5', resolve: (_record, ft) => ft.home + ft.away >= 4 },
  { key: 'under-05', label: 'Under 0.5', resolve: (_record, ft) => ft.home + ft.away < 1 },
  { key: 'under-15', label: 'Under 1.5', resolve: (_record, ft) => ft.home + ft.away < 2 },
  { key: 'under-25', label: 'Under 2.5', resolve: (_record, ft) => ft.home + ft.away < 3 },
  { key: 'under-35', label: 'Under 3.5', resolve: (_record, ft) => ft.home + ft.away < 4 },
  { key: 'goals-0', label: 'Total de Gols 0', resolve: (_record, ft) => ft.home + ft.away === 0 },
  { key: 'goals-1', label: 'Total de Gols 1', resolve: (_record, ft) => ft.home + ft.away === 1 },
  { key: 'goals-2', label: 'Total de Gols 2', resolve: (_record, ft) => ft.home + ft.away === 2 },
  { key: 'goals-3', label: 'Total de Gols 3', resolve: (_record, ft) => ft.home + ft.away === 3 },
  { key: 'goals-4-plus', label: 'Total de Gols 4+', resolve: (_record, ft) => ft.home + ft.away >= 4 },
  {
    key: 'comeback-yes',
    label: 'Viradinha SIM',
    resolve: (_record, ft, ht) =>
      (ht.home < ht.away && ft.home > ft.away) ||
      (ht.home > ht.away && ft.home < ft.away),
  },
]

const parseScorePair = (score: string) => {
  const [home, away] = String(score ?? '')
    .split(/[x-]/i)
    .map(Number)

  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return null
  }

  return { away, home }
}

const buildMaximaMetric = (
  records: MatchRecord[],
  predicate: (record: MatchRecord, ft: ScorePair, ht: ScorePair) => boolean,
): MaximaMetric => {
  let currentStreak = 0

  for (const record of records) {
    const ft = parseScorePair(record.scoreFT)
    const ht = parseScorePair(record.scoreHT) ?? ft

    if (!ft || !ht) continue
    if (predicate(record, ft, ht)) break

    currentStreak += 1
  }

  let maxStreak = 0
  let runningStreak = 0
  let maxRecords: MatchRecord[] = []
  let runningRecords: MatchRecord[] = []

  for (const record of records) {
    const ft = parseScorePair(record.scoreFT)
    const ht = parseScorePair(record.scoreHT) ?? ft

    if (!ft || !ht) continue

    if (predicate(record, ft, ht)) {
      runningStreak = 0
      runningRecords = []
      continue
    }

    runningStreak += 1
    runningRecords.push(record)

    if (runningStreak > maxStreak) {
      maxStreak = runningStreak
      maxRecords = [...runningRecords]
    }
  }

  return {
    currentStreak,
    maxStreak,
    maxRecords,
  }
}

export function MaximaPanel({ onHighlightChange, records }: MaximaPanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const orderedFinished = useMemo(
    () =>
      [...records]
        .filter((record) => parseScorePair(record.scoreFT))
        .sort((left, right) => right.timestamp - left.timestamp),
    [records],
  )

  const cards = useMemo<MaximaCardData[]>(
    () =>
      maximaDefinitions.map((definition) => {
        const metric = buildMaximaMetric(orderedFinished, definition.resolve)

        return {
          key: definition.key,
          label: definition.label,
          totalGames: orderedFinished.length,
          ...metric,
        }
      }),
    [orderedFinished],
  )

  const selectedCard = cards.find((card) => card.key === selectedKey) ?? null

  useEffect(() => {
    onHighlightChange?.(
      selectedCard
        ? selectedCard.maxRecords.map((record) => `${record.hour}-${record.minuteSlot}`)
        : [],
    )

    return () => {
      onHighlightChange?.([])
    }
  }, [onHighlightChange, selectedCard])

  if (cards.length === 0) {
    return (
      <section className="maxima-panel maxima-panel-empty">
        <div className="maxima-empty-state">
          <strong>{'M\u00e1xima'}</strong>
          <p>{'Os dados finalizados dessa liga ainda nao sao suficientes para montar as sequencias.'}</p>
        </div>
      </section>
    )
  }

  return (
    <section className="maxima-panel">
      <div className="maxima-header">
        <div className="maxima-title-row">
          <span className="maxima-icon" aria-hidden="true">
            {'\u26a1'}
          </span>
          <div className="maxima-title-copy">
            <h3>{'M\u00e1xima'}</h3>
            <p>
              <strong>{'M\u00e1xima:'}</strong>{' '}
              {'Refere-se a maior sequencia sem sair de tal mercado.'}
            </p>
            <p>
              <strong>{'Atual:'}</strong>{' '}
              {'Mostra a quantidade de jogos recentes sem sair do mercado.'}
            </p>
          </div>
        </div>
      </div>

      <div className="maxima-grid">
        {cards.map((card) => {
          const maxShare = card.totalGames ? Math.round((card.maxStreak / card.totalGames) * 100) : 0
          const currentShare = card.totalGames ? Math.round((card.currentStreak / card.totalGames) * 100) : 0
          const isSelected = selectedKey === card.key

          return (
            <article key={card.key} className={`maxima-card ${isSelected ? 'is-selected' : ''}`}>
              <header className="maxima-card-head">
                <h4>{card.label}</h4>
              </header>

              <div className="maxima-card-metrics">
                <div className="maxima-card-stat is-max">
                  <span className="maxima-card-kicker">{'M\u00c1XIMA'}</span>
                  <strong>{card.maxStreak}</strong>
                  <span className="maxima-progress">
                    <span style={{ width: `${Math.max(maxShare, card.maxStreak > 0 ? 3 : 0)}%` }} />
                  </span>
                  <small>{maxShare}% dos jogos</small>
                </div>

                <div className="maxima-card-stat is-current">
                  <span className="maxima-card-kicker">ATUAL</span>
                  <strong>{card.currentStreak}</strong>
                  <span className="maxima-progress">
                    <span style={{ width: `${Math.max(currentShare, card.currentStreak > 0 ? 3 : 0)}%` }} />
                  </span>
                  <small>{currentShare}% dos jogos</small>
                </div>
              </div>

              <button
                type="button"
                className={`maxima-card-action ${isSelected ? 'is-active' : ''}`}
                onClick={() => setSelectedKey((current) => (current === card.key ? null : card.key))}
              >
                <span aria-hidden="true">{isSelected ? '\u2715' : '\u2315'}</span>
                <span>{isSelected ? 'Fechar' : 'Ver horarios'}</span>
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}

