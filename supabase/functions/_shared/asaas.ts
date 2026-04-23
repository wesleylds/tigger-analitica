export interface AsaasOrderSnapshot {
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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

export const normalizeAsaasTaxId = (value: string) => cleanDigits(value).slice(0, 11)

export const normalizeAsaasPhoneNumber = (value: string) => {
  const digits = cleanDigits(value)
  return digits.startsWith('55') && digits.length > 11 ? digits.slice(2, 13) : digits.slice(0, 11)
}

export const normalizeAsaasStatus = (value: unknown) => {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()

  if (!normalized) return 'PENDING'
  if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(normalized)) return 'PAID'
  if (['PENDING', 'AWAITING_RISK_ANALYSIS'].includes(normalized)) return 'PENDING'
  if (['OVERDUE'].includes(normalized)) return 'EXPIRED'
  if (['REFUNDED', 'REFUND_REQUESTED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'DELETED'].includes(normalized)) {
    return 'CANCELLED'
  }
  return normalized
}

export const resolveAsaasBaseUrl = () => {
  const env = String(Deno.env.get('ASAAS_ENV') ?? 'sandbox').trim().toLowerCase()
  return env === 'production' ? 'https://api.asaas.com' : 'https://api-sandbox.asaas.com'
}

export const getAsaasApiKey = () => String(Deno.env.get('ASAAS_API_KEY') ?? '').trim()

export const buildAsaasHeaders = () => {
  const token = getAsaasApiKey()
  if (!token) {
    throw new Error('ASAAS_API_KEY nao configurado.')
  }

  return {
    ...jsonHeaders,
    access_token: token,
  }
}

export const buildAsaasWebhookUrl = () => {
  const explicitUrl = String(Deno.env.get('ASAAS_WEBHOOK_URL') ?? '').trim()
  if (explicitUrl) return explicitUrl

  const supabaseUrl = String(Deno.env.get('SUPABASE_URL') ?? '').trim()
  return supabaseUrl ? `${supabaseUrl}/functions/v1/pagbank-webhook` : ''
}

export const getAsaasWebhookToken = () => String(Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? '').trim()

export const fetchAsaasJson = async (
  path: string,
  init: RequestInit = {},
) => {
  const response = await fetch(`${resolveAsaasBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...buildAsaasHeaders(),
      ...(init.headers ?? {}),
    },
  })

  const raw = await response.text()
  const json = raw ? JSON.parse(raw) : {}

  if (!response.ok) {
    throw new Error(
      `Asaas respondeu ${response.status}: ${
        typeof asRecord(json).errors?.[0]?.description === 'string'
          ? String(asRecord(asArray(asRecord(json).errors)[0]).description)
          : raw
      }`,
    )
  }

  return json as Record<string, unknown>
}

export const ensureAsaasCustomer = async ({
  accountId,
  customerEmail,
  customerName,
  customerPhone,
  customerTaxId,
}: {
  accountId: string
  customerEmail: string
  customerName: string
  customerPhone: string
  customerTaxId: string
}) => {
  const normalizedTaxId = normalizeAsaasTaxId(customerTaxId)
  const normalizedPhone = normalizeAsaasPhoneNumber(customerPhone)

  const query = new URLSearchParams({
    cpfCnpj: normalizedTaxId,
    email: customerEmail.trim().toLowerCase(),
  })
  const existing = await fetchAsaasJson(`/v3/customers?${query.toString()}`, {
    method: 'GET',
  })

  const existingCustomer = asRecord(asArray(existing.data)[0])
  if (String(existingCustomer.id ?? '').trim()) {
    return String(existingCustomer.id)
  }

  const created = await fetchAsaasJson('/v3/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: customerName.trim(),
      cpfCnpj: normalizedTaxId,
      email: customerEmail.trim().toLowerCase(),
      mobilePhone: normalizedPhone,
      externalReference: accountId,
      notificationDisabled: true,
    }),
  })

  const customerId = String(created.id ?? '').trim()
  if (!customerId) {
    throw new Error('O Asaas nao devolveu o cliente criado.')
  }

  return customerId
}

export const createAsaasPixCharge = async ({
  accountId,
  amountCents,
  customerEmail,
  customerName,
  customerPhone,
  customerTaxId,
  expiresAt,
  referenceId,
}: {
  accountId: string
  amountCents: number
  customerEmail: string
  customerName: string
  customerPhone: string
  customerTaxId: string
  expiresAt: string
  referenceId: string
}) => {
  const customerId = await ensureAsaasCustomer({
    accountId,
    customerEmail,
    customerName,
    customerPhone,
    customerTaxId,
  })

  const dueDate = new Date().toISOString().slice(0, 10)
  const payment = await fetchAsaasJson('/v3/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: customerId,
      billingType: 'PIX',
      value: Number((amountCents / 100).toFixed(2)),
      dueDate,
      description: 'Plano Tigger Analytics',
      externalReference: referenceId,
    }),
  })

  const paymentId = String(payment.id ?? '').trim()
  if (!paymentId) {
    throw new Error('O Asaas nao devolveu o identificador da cobranca.')
  }

  const qrCode = await fetchAsaasJson(`/v3/payments/${paymentId}/pixQrCode`, {
    method: 'GET',
  })

  return extractAsaasOrderSnapshot({
    expiresAtFallback: expiresAt,
    payment,
    qrCode,
  })
}

export const fetchAsaasPaymentSnapshot = async ({
  expiresAtFallback,
  paymentId,
}: {
  expiresAtFallback?: string
  paymentId: string
}) => {
  const payment = await fetchAsaasJson(`/v3/payments/${paymentId}`, {
    method: 'GET',
  })

  let qrCode: Record<string, unknown> = {}
  const normalizedStatus = normalizeAsaasStatus(payment.status)

  if (normalizedStatus === 'PENDING' || normalizedStatus === 'PAID') {
    try {
      qrCode = await fetchAsaasJson(`/v3/payments/${paymentId}/pixQrCode`, {
        method: 'GET',
      })
    } catch {
      qrCode = {}
    }
  }

  return extractAsaasOrderSnapshot({
    expiresAtFallback,
    payment,
    qrCode,
  })
}

export const extractAsaasOrderSnapshot = ({
  expiresAtFallback,
  payment,
  qrCode,
}: {
  expiresAtFallback?: string
  payment: unknown
  qrCode?: unknown
}): AsaasOrderSnapshot => {
  const paymentRecord = asRecord(payment)
  const qrCodeRecord = asRecord(qrCode)
  const customerRecord = asRecord(paymentRecord.customer)

  const encodedImage = String(qrCodeRecord.encodedImage ?? '').trim()
  const expirationDate = String(qrCodeRecord.expirationDate ?? '').trim()
  const paymentDate = String(
    paymentRecord.clientPaymentDate ??
      paymentRecord.confirmedDate ??
      paymentRecord.paymentDate ??
      '',
  ).trim()
  const status = normalizeAsaasStatus(paymentRecord.status)

  return {
    amountCents: Math.round(Number(paymentRecord.value ?? 0) * 100),
    chargeId: String(paymentRecord.id ?? '').trim() || null,
    customerEmail: String(customerRecord.email ?? paymentRecord.email ?? '').trim(),
    customerName: String(customerRecord.name ?? paymentRecord.name ?? '').trim(),
    customerPhone: normalizeAsaasPhoneNumber(
      String(customerRecord.mobilePhone ?? paymentRecord.mobilePhone ?? '').trim(),
    ),
    customerTaxId: normalizeAsaasTaxId(
      String(customerRecord.cpfCnpj ?? paymentRecord.cpfCnpj ?? '').trim(),
    ),
    expiresAt: expiresAtFallback || expirationDate || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    orderId: String(paymentRecord.id ?? '').trim(),
    paidAt: paymentDate || null,
    qrCodeImageUrl: encodedImage ? `data:image/png;base64,${encodedImage}` : null,
    qrCodeText: String(qrCodeRecord.payload ?? paymentRecord.pixQrCode ?? '').trim(),
    raw: {
      payment: paymentRecord,
      qrCode: qrCodeRecord,
    },
    referenceId: String(paymentRecord.externalReference ?? '').trim(),
    status,
  }
}

export const verifyAsaasWebhookToken = (request: Request) => {
  const expectedToken = getAsaasWebhookToken()
  if (!expectedToken) return true

  const receivedToken =
    request.headers.get('asaas-access-token') ??
    request.headers.get('Asaas-Access-Token') ??
    ''

  return receivedToken.trim() === expectedToken
}
