import { RecordDetailPanel } from '../components/RecordDetailPanel'
import {
  densityModes,
  formatOddValue,
  historyViews,
  percentageFormatter,
  scoreForTime,
  stampFormatter,
} from '../lib/ui'
import type {
  DensityMode,
  FiltersState,
  HistoryView,
  MatchRecord,
} from '../types'

interface HistoryPageProps {
  densityMode: DensityMode
  filters: FiltersState
  historyHighlights: MatchRecord[]
  historyView: HistoryView
  leagueGroups: Array<{ league: string; total: number; greens: number; lastScore: string }>
  onCreateAlert: () => void
  onCreateBot: () => void
  onDensityModeChange: (mode: DensityMode) => void
  onHistoryViewChange: (view: HistoryView) => void
  onOpenBots: () => void
  selectedRecord: MatchRecord | null
  sequenceGroups: Array<{
    label: string
    total: number
    greens: number
    latest?: MatchRecord
  }>
  setSelectedRecord: (record: MatchRecord) => void
  timelineGroups: Array<[string, MatchRecord[]]>
}

export function HistoryPage({
  densityMode,
  filters,
  historyHighlights,
  historyView,
  leagueGroups,
  onCreateAlert,
  onCreateBot,
  onDensityModeChange,
  onHistoryViewChange,
  onOpenBots,
  selectedRecord,
  sequenceGroups,
  setSelectedRecord,
  timelineGroups,
}: HistoryPageProps) {
  return (
    <section className="page-grid">
      <section className="page-header-panel">
        <div>
          <span className="eyebrow">historico profundo</span>
          <h1>Leitura crua e densa</h1>
          <p>
            Muitos registros, filtro fino, agrupamento por liga, timeline e sequencia para
            aprofundar sem perder velocidade.
          </p>
        </div>
        <div className="header-media">
          <img src="/images/history-tunnel.png" alt="Historico" />
        </div>
      </section>

      <section className="utility-panel">
        <div className="view-switch">
          {historyViews.map((view) => (
            <button
              key={view}
              type="button"
              className={`utility-button ${historyView === view ? 'active' : ''}`}
              onClick={() => onHistoryViewChange(view)}
            >
              {view}
            </button>
          ))}
        </div>
        <div className="view-switch">
          {densityModes.map((density) => (
            <button
              key={density}
              type="button"
              className={`utility-button ${densityMode === density ? 'active' : ''}`}
              onClick={() => onDensityModeChange(density)}
            >
              {density}
            </button>
          ))}
        </div>
      </section>

      <section className="history-layout">
        <div className="history-panel">
          {historyView === 'Tabela' && (
            <div className="table-wrap">
              <table className={`history-table ${densityMode === 'Compacta' ? 'is-compact' : ''}`}>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Liga</th>
                    <th>Mercado</th>
                    <th>Odd</th>
                    <th>Times</th>
                    <th>Placar</th>
                    <th>Sequencia</th>
                    <th>Tendencia</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {historyHighlights.map((record) => (
                    <tr
                      key={record.id}
                      className={selectedRecord?.id === record.id ? 'selected' : ''}
                      onClick={() => setSelectedRecord(record)}
                    >
                      <td>{stampFormatter.format(record.timestamp)}</td>
                      <td>{record.league}</td>
                      <td>{filters.market}</td>
                      <td>{formatOddValue(record.odds[filters.market])}</td>
                      <td>
                        {record.homeTeam} x {record.awayTeam}
                      </td>
                      <td>{scoreForTime(record, filters.timeMode)}</td>
                      <td>{record.sequencePattern}</td>
                      <td>{record.tendency}</td>
                      <td>{record.marketResults[filters.market] ? 'Green' : 'Red'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {historyView === 'Timeline' && (
            <div className="timeline-list">
              {timelineGroups.map(([label, records]) => (
                <div key={label} className="timeline-group">
                  <h3>{label}</h3>
                  <div className="timeline-flow">
                    {records.slice(0, 10).map((record) => (
                      <button
                        key={record.id}
                        type="button"
                        className="timeline-item"
                        onClick={() => setSelectedRecord(record)}
                      >
                        <strong>
                          {String(record.hour).padStart(2, '0')}:{String(record.minuteSlot).padStart(2, '0')}
                        </strong>
                        <span>{record.league}</span>
                        <small>{scoreForTime(record, filters.timeMode)}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {historyView === 'Liga' && (
            <div className="group-list">
              {leagueGroups.map((group) => (
                <div key={group.league} className="group-row">
                  <strong>{group.league}</strong>
                  <span>{percentageFormatter.format(group.total ? group.greens / group.total : 0)}</span>
                  <small>
                    {group.greens}/{group.total} | ultimo {group.lastScore}
                  </small>
                </div>
              ))}
            </div>
          )}

          {historyView === 'Sequencia' && (
            <div className="group-list">
              {sequenceGroups.map((group) => (
                <button
                  key={group.label}
                  type="button"
                  className="group-row sequence-row"
                  onClick={() => group.latest && setSelectedRecord(group.latest)}
                >
                  <strong>{group.label}</strong>
                  <span>{percentageFormatter.format(group.greens / group.total)}</span>
                  <small>
                    {group.total} blocos | {group.latest?.league}
                  </small>
                </button>
              ))}
            </div>
          )}
        </div>

        <RecordDetailPanel
          filters={filters}
          onCreateAlert={onCreateAlert}
          onCreateBot={onCreateBot}
          onOpenBots={onOpenBots}
          record={selectedRecord}
        />
      </section>
    </section>
  )
}
