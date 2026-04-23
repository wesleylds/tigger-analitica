import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  createAsaasPixCharge,
} from '../_shared/asaas.ts'
import { corsHeaders } from '../_shared/cors.ts'
import {
  buildPagBankNotificationUrl,
  buildPagBankOrderBody,
  extractPagBankOrderSnapshot,
  fetchPagBankJson,
  normalizePhoneNumber,
  normalizeTaxId,
} from '../_shared/pagbank.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const defaultAmountCents = Number(Deno.env.get('PAGBANK_PLAN_AMOUNT_CENTS') ?? '1990')
const paymentProvider = String(Deno.env.get('PAYMENT_PROVIDER') ?? 'pagbank').trim().toLowerCase()

const buildResponse = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })

const admin =
  supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = (await request.json()) as Record<string, unknown>
    const accountId = String(body.accountId ?? '').trim()
    const customerName = String(body.customerName ?? '').trim()
    const customerEmail = String(body.customerEmail ?? '').trim().toLowerCase()
    const customerTaxId = normalizeTaxId(String(body.customerTaxId ?? ''))
    const customerPhone = normalizePhoneNumber(String(body.customerPhone ?? ''))
    const amountCents =
      typeof body.amountCents === 'number' && Number.isFinite(body.amountCents)
        ? Math.trunc(body.amountCents)
        : defaultAmountCents
    const expiresInMinutes =
      typeof body.expiresInMinutes === 'number' && Number.isFinite(body.expiresInMinutes)
        ? Math.max(5, Math.min(60, Math.trunc(body.expiresInMinutes)))
        : 30

    if (!accountId || !customerName || !customerEmail || customerTaxId.length !== 11 || customerPhone.length < 10) {
      return buildResponse(400, {
        error: 'Informe accountId, nome, email, CPF e celular validos para gerar o Pix.',
      })
    }

    const referenceId = `${accountId}-${Date.now()}`
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString()
    const snapshot =
      paymentProvider === 'asaas'
        ? await createAsaasPixCharge({
            accountId,
            amountCents,
            customerEmail,
            customerName,
            customerPhone,
            customerTaxId,
            expiresAt,
            referenceId,
          })
        : extractPagBankOrderSnapshot(
            await fetchPagBankJson('/orders', {
              body: JSON.stringify(
                buildPagBankOrderBody({
                  amountCents,
                  customerEmail,
                  customerName,
                  customerPhone,
                  customerTaxId,
                  expiresAt,
                  notificationUrl: buildPagBankNotificationUrl(),
                  referenceId,
                }),
              ),
              idempotencyKey: crypto.randomUUID(),
              method: 'POST',
            }),
          )

    if (!snapshot.orderId || !snapshot.qrCodeText) {
      return buildResponse(502, {
        error:
          paymentProvider === 'asaas'
            ? 'O Asaas nao devolveu os dados do QR Code como esperado.'
            : 'O PagBank nao devolveu os dados do QR Code como esperado.',
      })
    }

    if (admin) {
      await admin.from('pagbank_orders').upsert(
        {
          account_id: accountId,
          amount_cents: snapshot.amountCents,
          charge_id: snapshot.chargeId,
          customer_email: snapshot.customerEmail,
          customer_name: snapshot.customerName,
          customer_phone: snapshot.customerPhone,
          customer_tax_id: snapshot.customerTaxId,
          expires_at: snapshot.expiresAt,
          notification_url:
            paymentProvider === 'asaas' ? null : buildPagBankNotificationUrl(),
          order_id: snapshot.orderId,
          paid_at: snapshot.paidAt,
          provider: paymentProvider,
          qr_code_image_url: snapshot.qrCodeImageUrl,
          qr_code_text: snapshot.qrCodeText,
          raw_last_status: snapshot.raw,
          raw_response: snapshot.raw,
          reference_id: snapshot.referenceId,
          status: snapshot.status,
        },
        {
          onConflict: 'order_id',
        },
      )
    }

    return buildResponse(200, {
      amountCents: snapshot.amountCents,
      chargeId: snapshot.chargeId,
      customerEmail: snapshot.customerEmail,
      expiresAt: snapshot.expiresAt,
      orderId: snapshot.orderId,
      paidAt: snapshot.paidAt,
      provider: paymentProvider,
      qrCodeImageUrl: snapshot.qrCodeImageUrl,
      qrCodeText: snapshot.qrCodeText,
      referenceId: snapshot.referenceId,
      status: snapshot.status,
    })
  } catch (error) {
    return buildResponse(500, {
      error:
        error instanceof Error
          ? error.message
          : paymentProvider === 'asaas'
            ? 'Erro inesperado ao criar pedido no Asaas.'
            : 'Erro inesperado ao criar pedido no PagBank.',
    })
  }
})
