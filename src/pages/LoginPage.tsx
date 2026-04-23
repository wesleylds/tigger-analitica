import { useState, type FormEvent } from 'react'
import type { CaptureActionResult, CaptureLoginPayload } from './CapturePage'

interface LoginPageProps {
  currentUserName?: string | null
  isAuthenticated: boolean
  paymentRequired: boolean
  onContinueToClientArea: () => void
  onLogin: (payload: CaptureLoginPayload) => CaptureActionResult
  onLogout: () => void
  onOpenCapture: () => void
  onOpenPlansPage: () => void
}

export function LoginPage({
  currentUserName,
  isAuthenticated,
  paymentRequired,
  onContinueToClientArea,
  onLogin,
  onLogout,
  onOpenCapture,
  onOpenPlansPage,
}: LoginPageProps) {
  const [form, setForm] = useState<CaptureLoginPayload>({
    email: '',
    password: '',
  })
  const [feedback, setFeedback] = useState<CaptureActionResult | null>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const payload: CaptureLoginPayload = {
      email: form.email.trim(),
      password: form.password,
    }

    if (!payload.email || !payload.password) {
      setFeedback({
        ok: false,
        message: 'Informe email e senha para continuar.',
      })
      return
    }

    setFeedback(onLogin(payload))
  }

  return (
    <section className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <img src="/images/tigger-logo.png" alt="Tigger Analytics" />
          <strong>Tigger Analytics.</strong>
        </div>

        <div className="login-head">
          <h1>Bem-vindo</h1>
          <p>Entre com sua conta para continuar no ambiente do Tigger.</p>
        </div>

        {isAuthenticated && (
          <div className={`login-status-strip ${paymentRequired ? 'is-pending' : 'is-ready'}`}>
            <strong>{currentUserName ?? 'Conta reconhecida'}</strong>
            <p>
              {paymentRequired
                ? 'Sua conta foi reconhecida, mas o acesso esta aguardando pagamento.'
                : 'Sua conta ja esta conectada. Se quiser, voce pode ir direto para a area interna.'}
            </p>

            <div className="login-status-actions">
              {paymentRequired ? (
                <button type="button" className="solid-button" onClick={onOpenPlansPage}>
                  Ir para pagamento
                </button>
              ) : (
                <button type="button" className="solid-button" onClick={onContinueToClientArea}>
                  Entrar na area do cliente
                </button>
              )}

              <button type="button" className="ghost-button" onClick={onLogout}>
                Usar outra conta
              </button>
            </div>
          </div>
        )}

        {feedback && (
          <div className={`login-feedback ${feedback.ok ? 'is-success' : 'is-error'}`}>
            {feedback.message}
          </div>
        )}

        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              placeholder="voce@seudominio.com"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  email: event.target.value,
                }))
              }
            />
          </label>

          <label>
            <span>Senha</span>
            <input
              type="password"
              value={form.password}
              placeholder="Sua senha"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
            />
          </label>

          <button type="submit" className="solid-button login-submit">
            Entrar
          </button>
        </form>

        <div className="login-footer">
          <button type="button" className="login-link-button" onClick={onOpenCapture}>
            Nao tem conta? Criar conta ou testar 5 horas
          </button>
          <span>Se o acesso estiver aguardando renovacao, o Pix aparece somente em Planos.</span>
        </div>
      </div>
    </section>
  )
}
