import { useMemo, useState, type FormEvent } from 'react'
import { bbtipsLeagueCatalogByPlatform } from '../data/bbtipsCatalog'
import { virtualPlatformOptions } from '../data/staticData'
import { getPlatformLabel } from '../lib/platformLabel'
import type { NotificationChannel, Platform } from '../types'

export interface CaptureAccountPayload {
  name: string
  email: string
  password: string
  favoritePlatform: Platform
  notificationChannel: NotificationChannel
  notificationContact: string
}

export interface CaptureLoginPayload {
  email: string
  password: string
}

export interface CaptureActionResult {
  ok: boolean
  message: string
}

interface CapturePageProps {
  currentPlatform: Platform
  currentUserName?: string | null
  isAuthenticated: boolean
  onContinueToClientArea: () => void
  onCreateAccount: (payload: CaptureAccountPayload) => CaptureActionResult
  onLogin: (payload: CaptureLoginPayload) => CaptureActionResult
  onOpenLoginPage: () => void
  onOpenPlansPage: () => void
  onSelectPlatform: (platform: Platform) => void
  onStartTrial: (payload: CaptureAccountPayload) => CaptureActionResult
  paymentAmountLabel?: string
  paymentRequired?: boolean
}

type AuthTab = 'trial' | 'signup' | 'login'

const notificationChannelOptions: NotificationChannel[] = ['WhatsApp', 'Telegram']

const authTabContent: Record<AuthTab, { eyebrow: string; title: string; description: string }> = {
  trial: {
    eyebrow: 'teste de 5 horas',
    title: 'Entre primeiro, veja a leitura e pague so se fizer sentido.',
    description:
      'O teste foi deixado leve para a pessoa sentir a rotina do painel antes de assumir o plano mensal.',
  },
  signup: {
    eyebrow: 'criar conta',
    title: 'Deixe a conta pronta e o caminho para pagar sem atrito.',
    description:
      'Cadastro objetivo, com casa favorita e contato salvo para aviso de renovacao quando o plano estiver perto de vencer.',
  },
  login: {
    eyebrow: 'entrar',
    title: 'Quem ja tem conta entra direto e resolve tudo rapido.',
    description:
      'Login simples para voltar ao ambiente interno ou concluir o pagamento quando a conta estiver aguardando liberacao.',
  },
}

export function CapturePage({
  currentPlatform,
  currentUserName,
  isAuthenticated,
  onContinueToClientArea,
  onCreateAccount,
  onLogin,
  onOpenLoginPage,
  onOpenPlansPage,
  onSelectPlatform,
  onStartTrial,
  paymentAmountLabel = 'R$ 19,90',
  paymentRequired = false,
}: CapturePageProps) {
  const [authTab, setAuthTab] = useState<AuthTab>('trial')
  const [feedback, setFeedback] = useState<CaptureActionResult | null>(null)
  const [accountForm, setAccountForm] = useState<CaptureAccountPayload>({
    name: '',
    email: '',
    password: '',
    favoritePlatform: currentPlatform,
    notificationChannel: 'WhatsApp',
    notificationContact: '',
  })
  const [loginForm, setLoginForm] = useState<CaptureLoginPayload>({
    email: '',
    password: '',
  })

  const totalLeagues = useMemo(
    () =>
      virtualPlatformOptions.reduce(
        (total, platform) => total + bbtipsLeagueCatalogByPlatform[platform].length,
        0,
      ),
    [],
  )

  const platformCards = useMemo(
    () =>
      virtualPlatformOptions.map((platform) => {
        const leagues = bbtipsLeagueCatalogByPlatform[platform]

        return {
          isActive: platform === currentPlatform,
          platform,
          total: leagues.length,
        }
      }),
    [currentPlatform],
  )

  const activeTabContent = authTabContent[authTab]
  const contactPlaceholder =
    accountForm.notificationChannel === 'WhatsApp' ? '(11) 99999-9999' : '@seuusuario ou numero'
  const paymentTitle = `Plano mensal por ${paymentAmountLabel}, com validade de 30 dias.`
  const paymentDescription = paymentRequired
    ? 'A conta ja foi reconhecida. O pagamento continua fora da captacao, na etapa de planos.'
    : 'A captacao fica limpa: apresenta o produto, recebe os dados e leva o cliente para a etapa certa.'
  const sellingPoints = useMemo(
    () => [
      'Matriz principal organizada por casa e liga',
      'Filtros claros para leitura rapida',
      'Historico, ranking e contexto no mesmo ambiente',
      `Pix mensal de ${paymentAmountLabel} com validade de 30 dias`,
    ],
    [paymentAmountLabel],
  )

  const jumpToAuth = (tab: AuthTab) => {
    setAuthTab(tab)
    setFeedback(null)
    window.requestAnimationFrame(() => {
      document.getElementById('capture-auth')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  const handleAccountSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const payload: CaptureAccountPayload = {
      name: accountForm.name.trim(),
      email: accountForm.email.trim(),
      password: accountForm.password,
      favoritePlatform: accountForm.favoritePlatform,
      notificationChannel: accountForm.notificationChannel,
      notificationContact: accountForm.notificationContact.trim(),
    }

    if (!payload.name || !payload.email || !payload.password || !payload.notificationContact) {
      setFeedback({
        ok: false,
        message: 'Preencha nome, email, senha e o contato de WhatsApp ou Telegram para continuar.',
      })
      return
    }

    const result = authTab === 'trial' ? onStartTrial(payload) : onCreateAccount(payload)
    setFeedback(result)
  }

  const handleLoginSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const payload: CaptureLoginPayload = {
      email: loginForm.email.trim(),
      password: loginForm.password,
    }

    if (!payload.email || !payload.password) {
      setFeedback({
        ok: false,
        message: 'Informe email e senha para entrar.',
      })
      return
    }

    setFeedback(onLogin(payload))
  }

  return (
    <section className="capture-page capture-page-simple">
      <section className="capture-hero capture-hero-simple">
        <div className="capture-hero-copy">
          <span className="eyebrow">captacao do cliente</span>
          <h1>O Tigger mostra a leitura do futebol virtual de um jeito claro e pronto para usar.</h1>
          <p>
            Aqui o foco nao e enfeitar. E ajudar a pessoa a criar a conta, testar o painel e enxergar
            rapido porque o plano mensal vale a pena.
          </p>

          <div className="capture-hero-pills">
            <span className="capture-chip">4 casas no mesmo ecossistema</span>
            <span className="capture-chip">{`${totalLeagues} ligas disponiveis hoje`}</span>
            <span className="capture-chip">Teste gratuito de 5 horas</span>
            <span className="capture-chip">{`${paymentAmountLabel} por 30 dias`}</span>
          </div>

          <div className="capture-hero-actions">
            <button type="button" className="solid-button" onClick={() => jumpToAuth('trial')}>
              Testar agora
            </button>
            <button
              type="button"
              className="ghost-button capture-ghost-button"
              onClick={onOpenLoginPage}
            >
              Ja tenho conta
            </button>
          </div>
        </div>

        <aside className="capture-offer-card">
          <span className="eyebrow">plano mensal</span>
          <strong>{paymentAmountLabel}</strong>
          <p>{paymentTitle}</p>

          <div className="capture-value-list">
            {sellingPoints.map((item) => (
              <article key={item} className="capture-value-item">
                <span />
                <strong>{item}</strong>
              </article>
            ))}
          </div>

          <div className="capture-route-note">
            <strong>Conta e Planos ficam separados.</strong>
            <p>
              Conta cuida do perfil. Planos cuida do Pix, renovacao e continuidade do acesso.
            </p>
          </div>

          {isAuthenticated && (
            <div className="capture-session-inline">
              <strong>{currentUserName ?? 'Conta reconhecida'}</strong>
              <p>
                {paymentRequired
                  ? 'Seu login foi reconhecido. O Pix segue na etapa de pagamento, sem aparecer aqui na captacao.'
                  : 'Sua conta ja esta pronta. Se quiser, voce pode voltar direto para a area interna.'}
              </p>

              {paymentRequired ? (
                <button type="button" className="solid-button" onClick={onOpenPlansPage}>
                  Ir para planos
                </button>
              ) : (
                <button type="button" className="solid-button" onClick={onContinueToClientArea}>
                  Ir para a area do cliente
                </button>
              )}
            </div>
          )}
        </aside>
      </section>

      <section className="capture-surface capture-platform-strip">
        <div className="capture-section-head">
          <div>
            <span className="eyebrow">casas e ligas</span>
            <h2>Escolha a casa favorita ja no cadastro.</h2>
            <p>
              A conta sai pronta com a preferencia salva, mas a pessoa continua com acesso ao
              ecossistema completo.
            </p>
          </div>
        </div>

        <div className="capture-platform-compact-grid">
          {platformCards.map((platformCard) => (
            <button
              key={platformCard.platform}
              type="button"
              className={`capture-platform-option ${platformCard.isActive ? 'is-active' : ''}`}
              onClick={() => {
                onSelectPlatform(platformCard.platform)
                setAccountForm((current) => ({
                  ...current,
                  favoritePlatform: platformCard.platform,
                }))
              }}
            >
              <strong>{getPlatformLabel(platformCard.platform)}</strong>
              <span>{`${platformCard.total} ligas`}</span>
            </button>
          ))}
        </div>
      </section>

      <section id="capture-auth" className="capture-auth-section capture-auth-section-simple">
        <div className="capture-auth-panel">
          <span className="eyebrow">{activeTabContent.eyebrow}</span>
          <h2>{activeTabContent.title}</h2>
          <p>{activeTabContent.description}</p>

          <div className="capture-auth-tabs">
            <button
              type="button"
              className={authTab === 'trial' ? 'active' : ''}
              onClick={() => {
                setAuthTab('trial')
                setFeedback(null)
              }}
            >
              Teste 5h
            </button>
            <button
              type="button"
              className={authTab === 'signup' ? 'active' : ''}
              onClick={() => {
                setAuthTab('signup')
                setFeedback(null)
              }}
            >
              Criar conta
            </button>
            <button
              type="button"
              className={authTab === 'login' ? 'active' : ''}
              onClick={() => {
                setAuthTab('login')
                setFeedback(null)
              }}
            >
              Entrar
            </button>
          </div>

          {feedback && (
            <div className={`capture-feedback ${feedback.ok ? 'is-success' : 'is-error'}`}>
              {feedback.message}
            </div>
          )}

          {authTab === 'login' ? (
            <form className="capture-form-grid" onSubmit={handleLoginSubmit}>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={(event) =>
                    setLoginForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  placeholder="voce@seudominio.com"
                />
              </label>

              <label>
                <span>Senha</span>
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) =>
                    setLoginForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  placeholder="Sua senha"
                />
              </label>

              <button type="submit" className="solid-button">
                Entrar na area do cliente
              </button>
            </form>
          ) : (
            <form className="capture-form-grid" onSubmit={handleAccountSubmit}>
              <label>
                <span>Nome</span>
                <input
                  value={accountForm.name}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Seu nome"
                />
              </label>

              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={accountForm.email}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  placeholder="voce@seudominio.com"
                />
              </label>

              <label>
                <span>Senha</span>
                <input
                  type="password"
                  value={accountForm.password}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  placeholder="Crie uma senha"
                />
              </label>

              <label>
                <span>Casa favorita</span>
                <select
                  value={accountForm.favoritePlatform}
                  onChange={(event) =>
                    setAccountForm((current) => ({
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

              <div className="capture-contact-grid">
                <label>
                  <span>Canal de aviso</span>
                  <select
                    value={accountForm.notificationChannel}
                    onChange={(event) =>
                      setAccountForm((current) => ({
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
                  <span>{accountForm.notificationChannel === 'WhatsApp' ? 'WhatsApp' : 'Telegram'}</span>
                  <input
                    value={accountForm.notificationContact}
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        notificationContact: event.target.value,
                      }))
                    }
                    placeholder={contactPlaceholder}
                  />
                </label>
              </div>

              <p className="capture-inline-note">
                Quando faltarem 5 dias ou menos para renovar, o site lembra disso dentro da area do
                cliente. O contato fica salvo para a etapa de notificacao externa.
              </p>

              <button type="submit" className="solid-button">
                {authTab === 'trial' ? 'Liberar meu teste' : 'Criar minha conta'}
              </button>
            </form>
          )}
        </div>

        <aside className="capture-payment-panel capture-payment-panel-simple">
          <span className="eyebrow">proximo passo</span>
          <h3>{paymentTitle}</h3>
          <p>{paymentDescription}</p>

          <div className="capture-payment-cta">
            <div className="capture-payment-cta-highlight">
              <span>Plano mensal</span>
              <strong>{paymentAmountLabel}</strong>
              <p>
                Depois do cadastro, o QR Code aparece somente na etapa de pagamento. Aqui a proposta
                e deixar a entrada do cliente limpa e objetiva.
              </p>
            </div>

            <div className="capture-payment-actions">
              {paymentRequired ? (
                <button type="button" className="solid-button" onClick={onOpenPlansPage}>
                  Ir para planos
                </button>
              ) : (
                <button type="button" className="solid-button" onClick={() => jumpToAuth('signup')}>
                  Quero criar minha conta
                </button>
              )}

              <button
                type="button"
                className="ghost-button capture-ghost-button"
                onClick={paymentRequired ? onOpenLoginPage : () => jumpToAuth('trial')}
              >
                {paymentRequired ? 'Voltar para login' : 'Quero testar primeiro'}
              </button>
            </div>
          </div>
        </aside>
      </section>
    </section>
  )
}
