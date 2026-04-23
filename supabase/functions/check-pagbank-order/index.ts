import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchAsaasPaymentSnapshot } from '../_shared/asaas.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { extractPagBankOrderSnapshot, fetchPagBankJson } from '../_shared/pagbank.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
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
    const orderId = String(body.orderId ?? '').trim()
    const accountId = String(body.accountId ?? '').trim()
    const expiresAtFallback = String(body.expiresAt ?? '').trim()

    if (!orderId) {
      return buildResponse(400, {
        error:
          paymentProvider === 'asaas'
            ? 'Informe o orderId para consultar o pagamento no Asaas.'
            : 'Informe o orderId para consultar o pagamento no PagBank.',
      })
    }

    const snapshot =
      paymentProvider === 'asaas'
        ? await fetchAsaasPaymentSnapshot({
            expiresAtFallback,
            paymentId: orderId,
          })
        : extractPagBankOrderSnapshot(
            await fetchPagBankJson(`/orders/${orderId}`, {
              method: 'GET',
            }),
          )

    if (admin) {
      await admin.from('pagbank_orders').upsert(
        {
          account_id: accountId || null,
          amount_cents: snapshot.amountCents,
          charge_id: snapshot.chargeId,
          customer_email: snapshot.customerEmail,
          customer_name: snapshot.customerName,
          customer_phone: snapshot.customerPhone,
          customer_tax_id: snapshot.customerTaxId,
          expires_at: snapshot.expiresAt,
          order_id: snapshot.orderId,
          paid_at: snapshot.paidAt,
          provider: paymentProvider,
          qr_code_image_url: snapshot.qrCodeImageUrl,
          qr_code_text: snapshot.qrCodeText,
          raw_last_status: snapshot.raw,
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
            ? 'Erro inesperado ao consultar pedido no Asaas.'
            : 'Erro inesperado ao consultar pedido no PagBank.',
    })
  }
})
