import { useMemo, useState, type FormEvent } from 'react'
import { virtualPlatformOptions } from '../data/staticData'
import { getPlatformLabel } from '../lib/platformLabel'
import type { NotificationChannel, Platform } from '../types'

interface AccountUpdatePayload {
  name: string
  email: string
  password: string
  favoritePlatform: Platform
  notificationChannel: NotificationChannel
  notificationContact: string
}

interface AccountActionResult {
  ok: boolean
  message: string
}

interface AccountPageProps {
  billingCycleDays: number
  currentPlan: string
  favoritePlatform: Platform
  name: string
  email: string
  createdAt?: number | null
  planCountdownLabel: string
  planEndsAt?: number | null
  trialEndsAt?: number | null
  isTrialActive: boolean
  accessStatusLabel: string
  accessStatusDescription: string
  accessTone: 'trial' | 'pending' | 'active'
  paymentAmountLabel: string
  paymentAvailable: boolean
  notificationChannel: NotificationChannel
  notificationContact: string
  onLogout: () => void
  onOpenPlans: () => void
  onUpdateAccount: (payload: AccountUpdatePayload) => AccountActionResult
}

const notificationChannelOptions: NotificationChannel[] = ['WhatsApp', 'Telegram']

const formatDateTime = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Ainda nao definido'
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(value)
}

const formatDate = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Hoje'
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value)
}

export function AccountPage({
  billingCycleDays,
  currentPlan,
  favoritePlatform,
  name,
  email,
  createdAt = null,
  planCountdownLabel,
  planEndsAt = null,
  trialEndsAt = null,
  isTrialActive,
  accessStatusLabel,
  accessStatusDescription,
  accessTone,
  paymentAmountLabel,
  paymentAvailable,
  notificationChannel,
  notificationContact,
  onLogout,
  onOpenPlans,
  onUpdateAccount,
}: AccountPageProps) {
  const [form, setForm] = useState<AccountUpdatePayload>({
    name,
    email,
    password: '',
    favoritePlatform,
    notificationChannel,
    notificationContact,
  })
  const [feedback, setFeedback] = useState<AccountActionResult | null>(null)

  const memberSinceLabel = useMemo(() => formatDate(createdAt), [createdAt])
  const planEndsLabel = useMemo(() => formatDateTime(planEndsAt), [planEndsAt])
  const trialEndsLabel = useMemo(() => formatDateTime(trialEndsAt), [trialEndsAt])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFeedback(
      onUpdateAccount({
        ...form,
        email: form.email.trim(),
        name: form.name.trim(),
      }),
    )
  }

  return (
    <section className="page-grid account-client-page">
      <section className="page-header-panel account-client-hero">
        <div className="account-hero-copy">
          <span className="eyebrow">conta</span>
          <h1>Conta do cliente</h1>
          <p>Perfil, acesso e dados principais ficam aqui. Pagamentos ficam na pagina de planos.</p>

          <div className="account-hero-pills">
            <span className={`account-status-pill is-${accessTone}`}>{accessStatusLabel}</span>
            <span className="account-soft-pill">{currentPlan}</span>
            <span className="account-soft-pill">{getPlatformLabel(favoritePlatform)}</span>
          </div>

          <div className="account-hero-actions">
            {paymentAvailable && (
              <button type="button" className="solid-button" onClick={onOpenPlans}>
                Ir para planos
              </button>
            )}
            <button type="button" className="ghost-button" onClick={onLogout}>
              Sair da conta
            </button>
          </div>
        </div>

        <div className={`account-status-card is-${accessTone}`}>
          <span className="eyebrow">status</span>
          <strong>{accessStatusLabel}</strong>
          <p>{accessStatusDescription}</p>

          <div className="account-status-metrics">
            <div>
              <span>Conta criada em</span>
              <strong>{memberSinceLabel}</strong>
            </div>
            <div>
              <span>Teste / janela atual</span>
              <strong>{isTrialActive ? trialEndsLabel : 'Sem teste rodando'}</strong>
            </div>
            <div>
              <span>Validade do acesso</span>
              <strong>{paymentAvailable ? `${billingCycleDays} dias` : planCountdownLabel}</strong>
            </div>
            <div>
              <span>Valido ate</span>
              <strong>{paymentAvailable ? 'Ao ativar o plano' : planEndsLabel}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="account-client-grid">
        <article className="detail-panel account-form-panel">
          <div className="account-panel-head">
            <span className="eyebrow">dados</span>
            <h2>Atualizar conta</h2>
            <p>Altere apenas o necessario e mantenha o perfil pronto para o proximo acesso.</p>
          </div>

          <form className="form-grid" onSubmit={handleSubmit}>
            <label>
              <span>Nome</span>
              <input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Email</span>
              <input
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Nova senha</span>
              <input
                type="password"
                value={form.password}
                placeholder="Deixe em branco para manter a atual"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Plataforma favorita</span>
              <select
                value={form.favoritePlatform}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    favoritePlatform: event.target.value as Platform,
                  }))
                }
              >
                {virtualPlatformOptions.map((platform) => (
                  <option key={platform} value={platform}>
                    {getPlatformLabel(platform)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Canal de aviso</span>
              <select
                value={form.notificationChannel}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notificationChannel: event.target.value as NotificationChannel,
                  }))
                }
              >
                {notificationChannelOptions.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>{form.notificationChannel === 'WhatsApp' ? 'WhatsApp' : 'Telegram'}</span>
              <input
                value={form.notificationContact}
                placeholder={
                  form.notificationChannel === 'WhatsApp' ? '(11) 99999-9999' : '@seuusuario ou numero'
                }
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notificationContact: event.target.value,
                  }))
                }
              />
            </label>

            <div className="detail-actions full-width">
              <button type="submit" className="solid-button">
                Salvar alteracoes
              </button>
            </div>
          </form>

          {feedback && (
            <p className={`account-feedback ${feedback.ok ? 'is-success' : 'is-error'}`}>
              {feedback.message}
            </p>
          )}
        </article>

        <article className="detail-panel account-billing-panel">
          <div className="account-panel-head">
            <span className="eyebrow">financeiro</span>
            <h2>Planos e pagamentos</h2>
            <p>A parte financeira fica separada para a conta continuar limpa e facil de entender.</p>
          </div>

          <div className="account-billing-highlight">
            <strong>{paymentAvailable ? paymentAmountLabel : 'Sem cobranca aberta'}</strong>
            <span>
              {paymentAvailable
                ? isTrialActive
                  ? 'Pagamento opcional durante o teste'
                  : 'Pagamento pendente'
                : 'Sem pendencia financeira'}
            </span>
          </div>

          <div className="account-minimal-list">
            <div className="account-minimal-item">
              <span>Plano atual</span>
              <strong>{currentPlan}</strong>
            </div>
            <div className="account-minimal-item">
              <span>Validade mensal</span>
              <strong>{paymentAvailable ? `${billingCycleDays} dias` : planCountdownLabel}</strong>
            </div>
            <div className="account-minimal-item">
              <span>Aviso de renovacao</span>
              <strong>{`${notificationChannel} - ${notificationContact || 'Nao definido'}`}</strong>
            </div>
          </div>

          <div className="detail-actions">
            <button type="button" className="solid-button" onClick={onOpenPlans}>
              Abrir planos
            </button>
          </div>
        </article>
      </section>
    </section>
  )
}
