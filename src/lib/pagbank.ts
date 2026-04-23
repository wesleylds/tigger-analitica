import type { Plan } from '../types'

export type PagBankCheckoutStatus =
  | 'idle'
  | 'pending'
  | 'paid'
  | 'expired'
  | 'cancelled'
  | 'under_review'
  | 'failed'

export interface PagBankPaymentProfile {
  taxId: string
  phoneNumber: string
}

export interface PagBankCheckoutRecord {
  provider: 'pagbank' | 'asaas'
  referenceId: string
  orderId: string
  chargeId: string | null
  qrCodeText: string
  qrCodeImageUrl: string | null
  amountCents: number
  status: PagBankCheckoutStatus
  createdAt: number
  expiresAt: number
  lastCheckedAt: number | null
  paidAt: number | null
}

export interface PagBankCheckoutActionResult {
  ok: boolean
  message: string
  checkout?: PagBankCheckoutRecord | null
}

export const pagBankActivatedPlanId: Plan['id'] = 'Pro'

export const normalizeTaxId = (value: string) => value.replace(/\D/g, '').slice(0, 11)

export const normalizePhoneNumber = (value: string) => {
  const digits = value.replace(/\D/g, '')

  return digits.startsWith('55') && digits.length > 11 ? digits.slice(2, 13) : digits.slice(0, 11)
}

export const validatePagBankPaymentProfile = ({ phoneNumber, taxId }: PagBankPaymentProfile) => {
  const normalizedTaxId = normalizeTaxId(taxId)
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber)

  if (normalizedTaxId.length !== 11) {
    return 'Informe um CPF valido para gerar o Pix no PagBank.'
  }

  if (normalizedPhoneNumber.length < 10) {
    return 'Informe um celular valido para o PagBank gerar a cobranca.'
  }

  return null
}

export const normalizePagBankStatus = (value: unknown): PagBankCheckoutStatus => {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()

  if (normalized === 'PAID') return 'paid'
  if (normalized === 'WAITING' || normalized === 'PENDING' || normalized === 'AUTHORIZED') {
    return 'pending'
  }
  if (normalized === 'CANCELED' || normalized === 'CANCELLED') return 'cancelled'
  if (normalized === 'EXPIRED') return 'expired'
  if (normalized === 'IN_ANALYSIS' || normalized === 'UNDER_REVIEW') return 'under_review'
  if (normalized === 'DECLINED' || normalized === 'FAILED') return 'failed'

  return 'idle'
}

export const isPagBankPendingStatus = (status: PagBankCheckoutStatus) => status === 'pending'
export const isPagBankPaidStatus = (status: PagBankCheckoutStatus) => status === 'paid'
export const isPagBankFinishedStatus = (status: PagBankCheckoutStatus) =>
  ['paid', 'expired', 'cancelled', 'failed'].includes(status)

export const formatPagBankCountdown = (expiresAt: number, referenceTimestamp = Date.now()) => {
  const remainingMs = Math.max(0, expiresAt - referenceTimestamp)
  const totalSeconds = Math.floor(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export const parsePagBankCheckoutRecord = (value: unknown): PagBankCheckoutRecord | null => {
  if (!value || typeof value !== 'object') return null

  const candidate = value as Partial<PagBankCheckoutRecord>
  const referenceId = typeof candidate.referenceId === 'string' ? candidate.referenceId.trim() : ''
  const orderId = typeof candidate.orderId === 'string' ? candidate.orderId.trim() : ''
  const qrCodeText = typeof candidate.qrCodeText === 'string' ? candidate.qrCodeText.trim() : ''
  const amountCents =
    typeof candidate.amountCents === 'number' && Number.isFinite(candidate.amountCents)
      ? candidate.amountCents
      : 0
  const expiresAt =
    typeof candidate.expiresAt === 'number' && Number.isFinite(candidate.expiresAt)
      ? candidate.expiresAt
      : 0
  const createdAt =
    typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
      ? candidate.createdAt
      : Date.now()
  const status = normalizePagBankStatus(candidate.status)

  if (!referenceId || !orderId || !qrCodeText || amountCents <= 0 || expiresAt <= 0) {
    return null
  }

  return {
    provider: candidate.provider === 'asaas' ? 'asaas' : 'pagbank',
    referenceId,
    orderId,
    chargeId: typeof candidate.chargeId === 'string' && candidate.chargeId.trim() ? candidate.chargeId : null,
    qrCodeText,
    qrCodeImageUrl:
      typeof candidate.qrCodeImageUrl === 'string' && candidate.qrCodeImageUrl.trim()
        ? candidate.qrCodeImageUrl
        : null,
    amountCents,
    status,
    createdAt,
    expiresAt,
    lastCheckedAt:
      typeof candidate.lastCheckedAt === 'number' && Number.isFinite(candidate.lastCheckedAt)
        ? candidate.lastCheckedAt
        : null,
    paidAt:
      typeof candidate.paidAt === 'number' && Number.isFinite(candidate.paidAt)
        ? candidate.paidAt
        : null,
  }
}
