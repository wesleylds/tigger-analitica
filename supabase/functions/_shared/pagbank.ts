export interface PagBankOrderSnapshot {
  amountCents: number
  chargeId: string | null
  customerEmail: string
  customerName: string
  customerPhone: string
  customerTaxId: string
  expiresAt: string
  orderId: string
  paidAt: string | null
  qrCodeImageUrl: string | null
  qrCodeText: string
  raw: Record<string, unknown>
  referenceId: string
  status: string
}

const jsonHeaders = {
  accept: 'application/json',
  'content-type': 'application/json',
}

const cleanDigits = (value: string) => value.replace(/\D/g, '')

export const normalizePagBankStatus = (value: unknown) => {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()

  return normalized || 'WAITING'
}

export const resolvePagBankBaseUrl = () => {
  const env = String(Deno.env.get('PAGBANK_ENV') ?? 'sandbox').trim().toLowerCase()

  return env === 'production'
    ? 'https://api.pagseguro.com'
    : 'https://sandbox.api.pagseguro.com'
}

export const getPagBankToken = () => String(Deno.env.get('PAGBANK_TOKEN') ?? '').trim()

export const buildPagBankAuthHeaders = (idempotencyKey?: string) => {
  const token = getPagBankToken()

  if (!token) {
    throw new Error('PAGBANK_TOKEN nao configurado.')
  }

  return {
    ...jsonHeaders,
    Authorization: `Bearer ${token}`,
    ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
  }
}

export const normalizeTaxId = (value: string) => cleanDigits(value).slice(0, 11)

export const normalizePhoneNumber = (value: string) => {
  const digits = cleanDigits(value)
  return digits.startsWith('55') && digits.length > 11 ? digits.slice(2, 13) : digits.slice(0, 11)
}

export const buildPagBankPhonePayload = (value: string) => {
  const normalized = normalizePhoneNumber(value)

  if (normalized.length < 10) {
    throw new Error('Telefone invalido para gerar cobranca no PagBank.')
  }

  return {
    area: normalized.slice(0, 2),
    country: '55',
    number: normalized.slice(2),
    type: 'MOBILE',
  }
}

export const buildPagBankNotificationUrl = () => {
  const explicitUrl = String(Deno.env.get('PAGBANK_NOTIFICATION_URL') ?? '').trim()
  if (explicitUrl) return explicitUrl

  const supabaseUrl = String(Deno.env.get('SUPABASE_URL') ?? '').trim()
  return supabaseUrl ? `${supabaseUrl}/functions/v1/pagbank-webhook` : ''
}

export const buildPagBankOrderBody = ({
  amountCents,
  customerEmail,
  customerName,
  customerPhone,
  customerTaxId,
  expiresAt,
  notificationUrl,
  referenceId,
}: {
  amountCents: number
  customerEmail: string
  customerName: string
  customerPhone: string
  customerTaxId: string
  expiresAt: string
  notificationUrl?: string
  referenceId: string
}) => ({
  customer: {
    email: customerEmail.trim(),
    name: customerName.trim(),
    phones: [buildPagBankPhonePayload(customerPhone)],
    tax_id: normalizeTaxId(customerTaxId),
  },
  items: [
    {
      name: 'Plano Tigger Analytics',
      quantity: 1,
      reference_id: 'tigger-monthly-plan',
      unit_amount: amountCents,
    },
  ],
  notification_urls: notificationUrl ? [notificationUrl] : undefined,
  qr_codes: [
    {
      amount: {
        value: amountCents,
      },
      expiration_date: expiresAt,
    },
  ],
  reference_id: referenceId,
})

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const pickQrCodeImageUrl = (value: unknown) => {
  const links = asArray(asRecord(value).links)
  const imageLink = links.find((entry) => {
    const link = asRecord(entry)
    return (
      String(link.media ?? '').toLowerCase() === 'image/png' ||
      String(link.type ?? '').toLowerCase() === 'image/png'
    )
  })

  return imageLink ? String(asRecord(imageLink).href ?? '').trim() || null : null
}

const pickChargeStatus = (payload: Record<string, unknown>) => {
  const charges = asArray(payload.charges)
  const charge = asRecord(charges[0])

  return {
    chargeId: String(charge.id ?? '').trim() || null,
    paidAt: String(charge.paid_at ?? charge.paidAt ?? '').trim() || null,
    status:
      String(charge.status ?? '').trim() ||
      String(payload.status ?? '').trim() ||
      'WAITING',
  }
}

export const extractPagBankOrderSnapshot = (payload: unknown): PagBankOrderSnapshot => {
  const record = asRecord(payload)
  const qrCode = asRecord(asArray(record.qr_codes)[0])
  const charge = pickChargeStatus(record)
  const customer = asRecord(record.customer)
  const phones = asArray(customer.phones)
  const firstPhone = asRecord(phones[0])
  const customerPhone = `${String(firstPhone.area ?? '').trim()}${String(firstPhone.number ?? '').trim()}`
  const expiresAt =
    String(qrCode.expiration_date ?? record.expiration_date ?? '').trim() ||
    new Date(Date.now() + 30 * 60 * 1000).toISOString()

  return {
    amountCents: Number(asRecord(qrCode.amount).value ?? asRecord(asArray(record.items)[0]).unit_amount ?? 0),
    chargeId: charge.chargeId,
    customerEmail: String(customer.email ?? '').trim(),
    customerName: String(customer.name ?? '').trim(),
    customerPhone,
    customerTaxId: normalizeTaxId(String(customer.tax_id ?? customer.taxId ?? '').trim()),
    expiresAt,
    orderId: String(record.id ?? '').trim(),
    paidAt: charge.paidAt,
    qrCodeImageUrl: pickQrCodeImageUrl(qrCode),
    qrCodeText: String(qrCode.text ?? qrCode.payload ?? '').trim(),
    raw: record,
    referenceId: String(record.reference_id ?? record.referenceId ?? '').trim(),
    status: normalizePagBankStatus(charge.status),
  }
}

export const fetchPagBankJson = async (
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
) => {
  const response = await fetch(`${resolvePagBankBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...buildPagBankAuthHeaders(init.idempotencyKey),
      ...(init.headers ?? {}),
    },
  })

  const raw = await response.text()
  const json = raw ? JSON.parse(raw) : {}

  if (!response.ok) {
    throw new Error(
      `PagBank respondeu ${response.status}: ${typeof json?.message === 'string' ? json.message : raw}`,
    )
  }

  return json as Record<string, unknown>
}

const encoder = new TextEncoder()

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('')

export const buildAuthenticitySignature = async ({
  payload,
  token,
}: {
  payload: string
  token: string
}) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${token}-${payload}`))
  return toHex(digest)
}

export const verifyPagBankAuthenticityToken = async ({
  payload,
  receivedSignature,
}: {
  payload: string
  receivedSignature: string | null
}) => {
  const token = getPagBankToken()
  if (!token || !receivedSignature) return false

  const expected = await buildAuthenticitySignature({
    payload,
    token,
  })

  return expected === receivedSignature.trim().toLowerCase()
}
