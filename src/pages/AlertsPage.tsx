import type { AlertItem } from '../types'

interface AlertsPageProps {
  alerts: AlertItem[]
  notificationPrefs: Record<string, boolean>
  onOpenAnalysis: () => void
  onOpenBots: () => void
  onToggleAlert: (id: string) => void
  onTogglePreference: (key: string) => void
}

export function AlertsPage({
  alerts,
  notificationPrefs,
  onOpenAnalysis,
  onOpenBots,
  onToggleAlert,
  onTogglePreference,
}: AlertsPageProps) {
  return (
    <section className="page-grid">
      <section className="page-header-panel">
        <div>
          <span className="eyebrow">alertas</span>
          <h1>Sinais e historico de disparo</h1>
          <p>Tudo curto, util e ligado ao que esta vivo na matriz, no historico e nos bots.</p>
        </div>
        <div className="header-media">
          <img src="/images/control-grid.png" alt="Alertas" />
        </div>
      </section>

      <section className="alerts-layout">
        <div className="alerts-panel">
          <div className="usage-strip">
            <div>
              <span>Ativos</span>
              <strong>{alerts.filter((alert) => alert.status === 'Ativo').length}</strong>
            </div>
            <div>
              <span>Disparados</span>
              <strong>{alerts.filter((alert) => alert.status === 'Disparado').length}</strong>
            </div>
            <div>
              <span>Silenciados</span>
              <strong>{alerts.filter((alert) => alert.status === 'Silenciado').length}</strong>
            </div>
          </div>

          {alerts.map((alert) => (
            <article key={alert.id} className="alert-card">
              <div>
                <strong>{alert.name}</strong>
                <span>{alert.criterion}</span>
                <small>
                  {alert.origin} | {new Date(alert.timestamp).toLocaleString('pt-BR')}
                </small>
              </div>
              <div className="alert-actions">
                <span className={`status-pill is-${alert.status.toLowerCase()}`}>{alert.status}</span>
                <button type="button" className="micro-button" onClick={() => onToggleAlert(alert.id)}>
                  {alert.status === 'Ativo' ? 'Silenciar' : 'Ativar'}
                </button>
              </div>
            </article>
          ))}
        </div>

        <div className="detail-panel">
          <div className="editor-head">
            <span className="eyebrow">preferencias</span>
            <h2>Canal de entrega</h2>
          </div>
          <div className="preference-list">
            {Object.entries(notificationPrefs).map(([key, value]) => (
              <label key={key} className="preference-row">
                <span>{key}</span>
                <input type="checkbox" checked={value} onChange={() => onTogglePreference(key)} />
              </label>
            ))}
          </div>
          <div className="detail-actions">
            <button type="button" className="solid-button" onClick={onOpenBots}>
              Vincular bot
            </button>
            <button type="button" className="ghost-button" onClick={onOpenAnalysis}>
              Abrir analise
            </button>
          </div>
        </div>
      </section>
    </section>
  )
}
