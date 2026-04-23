import { formatHour, formatOddValue, scoreForTime, stampFormatter } from '../lib/ui'
import { getPlatformLabel } from '../lib/platformLabel'
import type { FiltersState, MatchRecord } from '../types'

interface RecordDetailPanelProps {
  filters: FiltersState
  onCreateAlert: () => void
  onCreateBot: () => void
  onOpenBots: () => void
  record: MatchRecord | null
}

export function RecordDetailPanel({
  filters,
  onCreateAlert,
  onCreateBot,
  onOpenBots,
  record,
}: RecordDetailPanelProps) {
  if (!record) {
    return (
      <div className="detail-panel">
        <p className="muted">Sem leitura para o recorte atual.</p>
      </div>
    )
  }

  return (
    <aside className="detail-panel">
      <div className="detail-media">
        <img src={record.leagueImage} alt={record.league} />
      </div>
      <div className="detail-block">
        <span className="eyebrow">
          {getPlatformLabel(record.platform)} | {record.league}
        </span>
        <h3>
          {record.homeTeam} x {record.awayTeam}
        </h3>
        <p>
          Rodada {record.round} | {stampFormatter.format(record.timestamp)} |{' '}
          {formatHour(record.hour, record.minuteSlot)}
        </p>
      </div>
      <div className="detail-scoreline">
        <div>
          <span>HT</span>
          <strong>{record.scoreHT}</strong>
        </div>
        <div>
          <span>FT</span>
          <strong>{record.scoreFT}</strong>
        </div>
        <div>
          <span>Odd</span>
          <strong>{formatOddValue(record.odds[filters.market])}</strong>
        </div>
      </div>
      <div className="detail-grid">
        <div>
          <span>Leitura</span>
          <strong>{scoreForTime(record, filters.timeMode)}</strong>
        </div>
        <div>
          <span>Sequencia</span>
          <strong>{record.sequencePattern}</strong>
        </div>
        <div>
          <span>Status mercado</span>
          <strong>{record.marketResults[filters.market] ? 'Green' : 'Red'}</strong>
        </div>
      </div>
      <div className="tag-row">
        {record.tags.map((tag) => (
          <span key={tag} className="tag">
            {tag}
          </span>
        ))}
      </div>
      <div className="detail-actions">
        <button type="button" className="solid-button" onClick={onCreateBot}>
          Salvar como bot
        </button>
        <button type="button" className="ghost-button" onClick={onCreateAlert}>
          Gerar alerta
        </button>
        <button type="button" className="ghost-button" onClick={onOpenBots}>
          Abrir bots
        </button>
      </div>
    </aside>
  )
}
