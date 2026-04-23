import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { bbtipsLeagueCatalogByPlatform } from '../data/bbtipsCatalog'
import {
  formatPagBankCountdown,
  isPagBankPendingStatus,
  normalizePhoneNumber,
  normalizeTaxId,
  type PagBankCheckoutActionResult,
  type PagBankCheckoutRecord,
  type PagBankPaymentProfile,
} from '../lib/pagbank'

interface PlansPageProps {
  accessStatusLabel: string
  accessStatusDescription: string
  accessTone: 'trial' | 'pending' | 'active'
  billingCycleDays: number
  currentPlan: string
  paymentAmountLabel: string
  paymentAvailable: boolean
  paymentGatewayReady: boolean
  paymentProviderLabel: string
  pagBankEnv: 'production' | 'sandbox'
  paymentProfile: PagBankPaymentProfile
  activeCheckout: PagBankCheckoutRecord | null
  planCountdownLabel: string
  planEndsAt?: number | null
  supportTelegramLink: string
  userName: string
  onCreatePagBankOrder: (profile: PagBankPaymentProfile) => Promise<PagBankCheckoutActionResult>
  onMarkPaymentSent: () => PagBankCheckoutActionResult
  onOpenAccount: () => void
  onRefreshPagBankOrder: () => Promise<PagBankCheckoutActionResult>
  onSavePaymentProfile: (profile: PagBankPaymentProfile) => { ok: boolean; message: string }
}

const formatDateTime = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Agora'
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(value)
}

export function PlansPage({
  accessStatusLabel,
  accessStatusDescription,
  accessTone,
  billingCycleDays,
  currentPlan,
  paymentAmountLabel,
  paymentAvailable,
  paymentGatewayReady,
  paymentProviderLabel,
  pagBankEnv,
  paymentProfile,
  activeCheckout,
  planCountdownLabel,
  planEndsAt = null,
  supportTelegramLink,
  userName,
  onCreatePagBankOrder,
  onMarkPaymentSent,
  onOpenAccount,
  onRefreshPagBankOrder,
  onSavePaymentProfile,
}: PlansPageProps) {
  const [form, setForm] = useState<PagBankPaymentProfile>(paymentProfile)
  const lastSyncedProfileRef = useRef<PagBankPaymentProfile>(paymentProfile)
  const [feedback, setFeedback] = useState<PagBankCheckoutActionResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [generatedQrDataUrl, setGeneratedQrDataUrl] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [referenceTimestamp, setReferenceTimestamp] = useState(() => Date.now())
  const totalLeagues = useMemo(
    () =>
      Object.values(bbtipsLeagueCatalogByPlatform).reduce((total, leagues) => total + leagues.length, 0),
    [],
  )
  const planEndsLabel = useMemo(() => formatDateTime(planEndsAt), [planEndsAt])
  const checkoutPending = Boolean(activeCheckout && isPagBankPendingStatus(activeCheckout.status))
  const checkoutExpired = Boolean(activeCheckout && activeCheckout.status === 'expired')
  const checkoutCountdown = activeCheckout
    ? formatPagBankCountdown(activeCheckout.expiresAt, referenceTimestamp)
    : '30:00'
  const qrPreviewUrl = generatedQrDataUrl ?? activeCheckout?.qrCodeImageUrl ?? null
  const showManualProof =
    Boolean(activeCheckout?.status === 'under_review') || Boolean(feedback && !feedback.ok)
  const supportMessage = activeCheckout
    ? [
        'Comprovante de pagamento Tigger Analytics',
        `Cliente: ${userName}`,
        `Pedido: ${activeCheckout.orderId}`,
        `Referencia: ${activeCheckout.referenceId}`,
        `Valor: ${paymentAmountLabel}`,
      ].join('\n')
    : ''

  useEffect(() => {
    const previousProfile = lastSyncedProfileRef.current
    const externalChanged =
      previousProfile.phoneNumber !== paymentProfile.phoneNumber || previousProfile.taxId !== paymentProfile.taxId

    if (!externalChanged) {
      return
    }

    setForm((current) => {
      const userIsEditing =
        current.phoneNumber !== previousProfile.phoneNumber || current.taxId !== previousProfile.taxId

      return userIsEditing ? current : paymentProfile
    })

    lastSyncedProfileRef.current = paymentProfile
  }, [paymentProfile])

  useEffect(() => {
    let active = true

    if (!activeCheckout?.qrCodeText) {
      setGeneratedQrDataUrl(null)
      return () => {
        active = false
      }
    }

    void QRCode.toDataURL(activeCheckout.qrCodeText, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 520,
    })
      .then((dataUrl: string) => {
        if (active) {
          setGeneratedQrDataUrl(dataUrl)
        }
      })
      .catch(() => {
        if (active) {
          setGeneratedQrDataUrl(null)
        }
      })

    return () => {
      active = false
    }
  }, [activeCheckout])

  useEffect(() => {
    if (!checkoutPending) return

    const timer = window.setInterval(() => {
      setReferenceTimestamp(Date.now())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [checkoutPending])

  useEffect(() => {
    if (!checkoutPending || !activeCheckout) return

    const interval = window.setInterval(() => {
      if (Date.now() >= activeCheckout.expiresAt) {
        setFeedback({
          ok: false,
          message: 'Esse QR Code expirou. Gere um novo pedido para continuar.',
        })
        return
      }

      void onRefreshPagBankOrder().then((result) => {
        if (!result.ok || result.checkout?.status === 'paid' || result.checkout?.status === 'expired') {
          setFeedback(result)
        }
      })
    }, 8000)

    return () => window.clearInterval(interval)
  }, [activeCheckout, checkoutPending, onRefreshPagBankOrder])

  const handleCopyPix = async () => {
    if (!activeCheckout?.qrCodeText) return

    try {
      await navigator.clipboard.writeText(activeCheckout.qrCodeText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  const handleSaveProfile = () => {
    setFeedback(
      onSavePaymentProfile({
        phoneNumber: normalizePhoneNumber(form.phoneNumber),
        taxId: normalizeTaxId(form.taxId),
      }),
    )
  }

  const handleCreateOrder = async () => {
    setIsBusy(true)
    const result = await onCreatePagBankOrder({
      phoneNumber: normalizePhoneNumber(form.phoneNumber),
      taxId: normalizeTaxId(form.taxId),
    })
    setFeedback(result)
    setIsBusy(false)
  }

  const handleRefreshOrder = async () => {
    setIsBusy(true)
    const result = await onRefreshPagBankOrder()
    setFeedback(result)
    setIsBusy(false)
  }

  const handleMarkPaymentSent = () => {
    const result = onMarkPaymentSent()
    setFeedback(result)
  }

  const handleCopySupportMessage = async () => {
    if (!supportMessage) return

    try {
      await navigator.clipboard.writeText(supportMessage)
      setFeedback({
        ok: true,
        message: 'Mensagem do comprovante copiada. Agora envie no Telegram com o print do Pix.',
      })
    } catch {
      setFeedback({
        ok: false,
        message: 'Nao foi possivel copiar a mensagem do comprovante.',
      })
    }
  }

  const handleOpenQr = () => {
    if (!qrPreviewUrl) return
    window.open(qrPreviewUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <section className="page-grid plans-access-page">
      <section className="page-header-panel plans-access-hero">
        <div className="plans-access-copy">
          <span className="eyebrow">planos</span>
          <h1>Checkout do acesso</h1>
          <p>Dados do pagador, QR Code, confirmacao e liberacao do acesso ficam concentrados aqui.</p>

          <div className="account-hero-pills">
            <span className={`account-status-pill is-${accessTone}`}>{accessStatusLabel}</span>
            <span className="account-soft-pill">{currentPlan}</span>
            <span className="account-soft-pill">
              {`${paymentProviderLabel} ${pagBankEnv === 'production' ? 'producao' : 'teste'}`}
            </span>
          </div>
        </div>

        <div className={`plans-status-card is-${accessTone}`}>
          <span className="eyebrow">resumo</span>
          <strong>{paymentAmountLabel}</strong>
          <p>{accessStatusDescription}</p>

          <div className="plans-status-grid">
            <div>
              <span>Cliente</span>
              <strong>{userName}</strong>
            </div>
            <div>
              <span>Valor mensal</span>
              <strong>{paymentAmountLabel}</strong>
            </div>
            <div>
              <span>Validade</span>
              <strong>{billingCycleDays} dias</strong>
            </div>
            <div>
              <span>Status do checkout</span>
              <strong>
                {activeCheckout
                  ? activeCheckout.status === 'paid'
                    ? 'Pago'
                    : activeCheckout.status === 'expired'
                      ? 'Expirado'
                      : 'Aguardando Pix'
                  : 'Ainda nao gerado'}
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section className="plans-access-grid plans-access-grid-payment">
        <article className="detail-panel plans-payment-panel">
          <div className="account-panel-head">
            <span className="eyebrow">checkout</span>
            <h2>Pagamento em 3 etapas</h2>
            <p>{`Preencha os dados do pagador, gere o QR de 30 minutos no ${paymentProviderLabel} e confirme o pagamento.`}</p>
          </div>

          <div className="plans-checkout-steps">
            <div className={`plans-checkout-step ${form.taxId && form.phoneNumber ? 'is-ready' : ''}`}>
              <span>01</span>
              <strong>Dados do pagador</strong>
            </div>
            <div className={`plans-checkout-step ${activeCheckout ? 'is-ready' : ''}`}>
              <span>02</span>
              <strong>QR Code de 30 min</strong>
            </div>
            <div className={`plans-checkout-step ${activeCheckout?.status === 'paid' ? 'is-ready' : ''}`}>
              <span>03</span>
              <strong>Confirmacao</strong>
            </div>
          </div>

          {!paymentGatewayReady && (
            <div className="account-feedback is-error">
              {`Configure Supabase + ${paymentProviderLabel} neste ambiente para gerar pedidos reais.`}
            </div>
          )}

          <div className="plans-payment-profile">
            <label>
              <span>CPF do pagador</span>
              <input
                value={form.taxId}
                placeholder="000.000.000-00"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    taxId: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Celular do pagador</span>
              <input
                value={form.phoneNumber}
                placeholder="(11) 99999-9999"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    phoneNumber: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <div className="detail-actions">
            <button type="button" className="ghost-button" onClick={handleSaveProfile}>
              Salvar dados
            </button>
            <button type="button" className="solid-button" onClick={handleCreateOrder} disabled={isBusy || !paymentAvailable}>
              {activeCheckout && !checkoutExpired ? 'Gerar novo QR' : `Gerar QR ${paymentProviderLabel}`}
            </button>
          </div>

          {feedback && (
            <div className={`account-feedback ${feedback.ok ? 'is-success' : 'is-error'}`}>
              {feedback.message}
            </div>
          )}

          {activeCheckout && (
            <div className="plans-payment-grid plans-payment-live">
              <div className="account-payment-qr-card">
                {qrPreviewUrl ? (
                  <img
                    src={qrPreviewUrl}
                    alt={`QR Code Pix ${paymentProviderLabel}`}
                    className="account-payment-qr"
                  />
                ) : (
                  <div className="account-payment-placeholder">QR Pix indisponivel no momento.</div>
                )}

                <small>
                  {activeCheckout.status === 'paid'
                    ? 'Pagamento confirmado.'
                    : activeCheckout.status === 'expired'
                      ? 'Esse QR expirou.'
                      : `Expira em ${checkoutCountdown}`}
                </small>

                <p className="account-payment-qr-hint">
                  Se o leitor falhar no QR, use o Pix copia e cola. Ele costuma ser mais confiavel no ambiente de teste.
                </p>

                {qrPreviewUrl && (
                  <button type="button" className="ghost-button account-payment-qr-button" onClick={handleOpenQr}>
                    Abrir QR ampliado
                  </button>
                )}
              </div>

              <div className="account-payment-code-block">
                <div className="plans-payment-meta">
                  <div className="account-copy-field">
                    <span>Status</span>
                    <strong>
                      {activeCheckout.status === 'paid'
                        ? 'Pago'
                        : activeCheckout.status === 'under_review'
                          ? 'Aguardando confirmacao'
                        : activeCheckout.status === 'expired'
                          ? 'Expirado'
                          : 'Aguardando Pix'}
                    </strong>
                  </div>

                  <div className="account-copy-field">
                    <span>Pedido</span>
                    <strong>{activeCheckout.orderId}</strong>
                  </div>
                </div>

                <label className="account-copy-area">
                  <span>Pix copia e cola</span>
                  <textarea readOnly rows={7} value={activeCheckout.qrCodeText} />
                </label>

                <div className="detail-actions">
                  <button
                    type="button"
                    className="solid-button"
                    onClick={handleCopyPix}
                    disabled={!activeCheckout.qrCodeText}
                  >
                    {copied ? 'Pix copiado' : 'Copiar Pix'}
                  </button>
                  <button type="button" className="ghost-button" onClick={handleRefreshOrder} disabled={isBusy}>
                    {`Conferir no ${paymentProviderLabel}`}
                  </button>
                  <button type="button" className="ghost-button" onClick={handleMarkPaymentSent} disabled={isBusy}>
                    Ja paguei
                  </button>
                </div>

                {showManualProof && (
                  <div className="plans-proof-card">
                    <div className="account-panel-head">
                      <span className="eyebrow">contingencia</span>
                      <h3>Suporte manual</h3>
                      <p>Essa etapa so aparece quando a confirmacao automatica nao resolveu sozinha.</p>
                    </div>

                    <label className="account-copy-area">
                      <span>Mensagem pronta</span>
                      <textarea readOnly rows={5} value={supportMessage} />
                    </label>

                    <div className="detail-actions">
                      <button type="button" className="ghost-button" onClick={handleCopySupportMessage}>
                        Copiar mensagem
                      </button>
                      {supportTelegramLink ? (
                        <a
                          className="solid-button plans-telegram-link"
                          href={supportTelegramLink}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Abrir Telegram
                        </a>
                      ) : (
                        <span className="plans-proof-hint">Preencha `VITE_SUPPORT_TELEGRAM_LINK` para abrir direto o seu Telegram.</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </article>

        <article className="detail-panel plans-summary-panel">
          <div className="account-panel-head">
            <span className="eyebrow">essencial</span>
            <h2>Resumo do acesso</h2>
            <p>Somente o necessario para entender o momento da conta e do pedido.</p>
          </div>

          <div className="plans-status-grid">
            <div>
              <span>Status</span>
              <strong>{accessStatusLabel}</strong>
            </div>
            <div>
              <span>Plano mostrado</span>
              <strong>{currentPlan}</strong>
            </div>
            <div>
              <span>Valido ate</span>
              <strong>{paymentAvailable ? 'Apos confirmacao' : planEndsLabel}</strong>
            </div>
            <div>
              <span>Cobertura</span>
              <strong>{`4 casas / ${totalLeagues} ligas`}</strong>
            </div>
          </div>

          {activeCheckout && (
            <div className="plans-order-summary">
              <div className="account-copy-field">
                <span>Referencia</span>
                <strong>{activeCheckout.referenceId}</strong>
              </div>
              <div className="account-copy-field">
                <span>Ultima conferencia</span>
                <strong>{activeCheckout.lastCheckedAt ? formatDateTime(activeCheckout.lastCheckedAt) : 'Ainda nao consultado'}</strong>
              </div>
            </div>
          )}

          <div className="detail-actions">
            <button type="button" className="ghost-button" onClick={onOpenAccount}>
              Voltar para conta
            </button>
            {activeCheckout && (
              <button type="button" className="ghost-button" onClick={handleRefreshOrder} disabled={isBusy}>
                Conferir agora
              </button>
            )}
          </div>

          {activeCheckout?.status === 'paid' && (
            <div className="account-feedback is-success">
              Pagamento confirmado. O acesso fica valido por {billingCycleDays} dias e o contador mensal assume a partir da liberacao.
            </div>
          )}

          {!activeCheckout && (
            <div className="account-billing-ok">
              <strong>Nenhum checkout aberto agora.</strong>
              <p>Quando o pedido for criado, o QR e a conferencia aparecem aqui.</p>
            </div>
          )}

          {!paymentAvailable && (
            <div className="account-billing-ok">
              <strong>Pagamento nao necessario neste momento.</strong>
              <p>Hoje restam {planCountdownLabel.toLowerCase()} de acesso ativo.</p>
            </div>
          )}
        </article>
      </section>
    </section>
  )
}
