import { marketOptions, periodOptions, platformOptions } from '../data/staticData'
import { getPlatformLabel } from '../lib/platformLabel'
import type { Bot, BotDraft, FiltersState, Market, Period, Platform } from '../types'

interface BotsPageProps {
  activePlan: {
    id: string
    botsLimit: number
    historyDepth: string
  }
  botDraft: BotDraft
  botLimitReached: boolean
  bots: Bot[]
  filters: FiltersState
  isEditing: boolean
  leagueOptions: string[]
  onCreateFromCurrentFilters: () => void
  onDelete: (id: string) => void
  onDraftChange: (draft: BotDraft) => void
  onDuplicate: (bot: Bot) => void
  onSave: () => void
  onSelect: (id: string | null) => void
  onToggleStatus: (id: string) => void
}

export function BotsPage({
  activePlan,
  botDraft,
  botLimitReached,
  bots,
  filters,
  isEditing,
  leagueOptions,
  onCreateFromCurrentFilters,
  onDelete,
  onDraftChange,
  onDuplicate,
  onSave,
  onSelect,
  onToggleStatus,
}: BotsPageProps) {
  return (
    <section className="page-grid">
      <section className="page-header-panel">
        <div>
          <span className="eyebrow">bots e automacao leve</span>
          <h1>Bots ligados a leitura</h1>
          <p>
            Salve combinacoes do que ja esta funcionando na matriz, no historico ou no ranking.
            Nada burocratico, tudo operacional.
          </p>
        </div>
        <div className="header-media">
          <img src="/images/control-grid.png" alt="Bots" />
        </div>
      </section>

      <section className="bots-layout">
        <div className="bots-panel">
          <div className="usage-strip">
            <div>
              <span>Plano</span>
              <strong>{activePlan.id}</strong>
            </div>
            <div>
              <span>Uso</span>
              <strong>
                {bots.length}/{activePlan.botsLimit}
              </strong>
            </div>
            <div>
              <span>Historico</span>
              <strong>{activePlan.historyDepth}</strong>
            </div>
          </div>

          <div className="bot-actions">
            <button
              type="button"
              className="solid-button"
              onClick={onCreateFromCurrentFilters}
              disabled={botLimitReached}
            >
              Criar do filtro atual
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={onCreateFromCurrentFilters}
              disabled={botLimitReached}
            >
              Salvar da matriz
            </button>
          </div>

          <div className="bot-list">
            {bots.map((bot) => (
              <article key={bot.id} className={`bot-card ${isEditing && botDraft.name === bot.name ? 'active' : ''}`}>
                <button type="button" className="bot-main" onClick={() => onSelect(bot.id)}>
                  <strong>{bot.name}</strong>
                  <span>{bot.description}</span>
                  <small>
                    {bot.platform} | {bot.market} | {bot.criteria.length} criterios
                  </small>
                </button>
                <div className="bot-controls">
                  <button type="button" className="micro-button" onClick={() => onToggleStatus(bot.id)}>
                    {bot.status === 'Ativo' ? 'Pausar' : 'Ativar'}
                  </button>
                  <button
                    type="button"
                    className="micro-button"
                    onClick={() => onDuplicate(bot)}
                    disabled={botLimitReached}
                  >
                    Duplicar
                  </button>
                  <button type="button" className="micro-button danger" onClick={() => onDelete(bot.id)}>
                    Excluir
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="bot-editor">
          <div className="editor-head">
            <span className="eyebrow">{isEditing ? 'editar bot' : 'novo bot'}</span>
            <h2>{botDraft.name}</h2>
          </div>

          <div className="form-grid">
            <label>
              <span>Nome</span>
              <input
                value={botDraft.name}
                onChange={(event) => onDraftChange({ ...botDraft, name: event.target.value })}
              />
            </label>
            <label>
              <span>Descricao</span>
              <input
                value={botDraft.description}
                onChange={(event) => onDraftChange({ ...botDraft, description: event.target.value })}
              />
            </label>
            <label>
              <span>Plataforma</span>
              <select
                value={botDraft.platform}
                onChange={(event) =>
                  onDraftChange({ ...botDraft, platform: event.target.value as Platform })
                }
              >
                {platformOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Liga</span>
              <select
                value={botDraft.league}
                onChange={(event) => onDraftChange({ ...botDraft, league: event.target.value })}
              >
                {leagueOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Mercado</span>
              <select
                value={botDraft.market}
                onChange={(event) => onDraftChange({ ...botDraft, market: event.target.value as Market })}
              >
                {marketOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Periodo</span>
              <select
                value={botDraft.period}
                onChange={(event) => onDraftChange({ ...botDraft, period: event.target.value as Period })}
              >
                {periodOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select
                value={botDraft.status}
                onChange={(event) => onDraftChange({ ...botDraft, status: event.target.value as Bot['status'] })}
              >
                <option value="Ativo">Ativo</option>
                <option value="Pausado">Pausado</option>
              </select>
            </label>
            <label>
              <span>Prioridade</span>
              <select
                value={botDraft.priority}
                onChange={(event) =>
                  onDraftChange({ ...botDraft, priority: event.target.value as Bot['priority'] })
                }
              >
                <option value="Alta">Alta</option>
                <option value="Media">Media</option>
                <option value="Baixa">Baixa</option>
              </select>
            </label>
            <label className="full-width">
              <span>Criterios</span>
              <textarea
                rows={5}
                value={botDraft.criteria}
                onChange={(event) => onDraftChange({ ...botDraft, criteria: event.target.value })}
              />
            </label>
          </div>

          <div className="editor-actions">
            <button type="button" className="solid-button" onClick={onSave}>
              Salvar bot
            </button>
            <button type="button" className="ghost-button" onClick={onCreateFromCurrentFilters}>
              Resetar com filtros atuais
            </button>
          </div>

          <div className="muted">
            Contexto atual: {getPlatformLabel(filters.platform)} | {filters.league} | {filters.market}
          </div>
        </div>
      </section>
    </section>
  )
}
