import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  extractAsaasOrderSnapshot,
  verifyAsaasWebhookToken,
} from '../_shared/asaas.ts'
import { corsHeaders } from '../_shared/cors.ts'
import {
  extractPagBankOrderSnapshot,
  verifyPagBankAuthenticityToken,
} from '../_shared/pagbank.ts'

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
    const payload = await request.text()
    let receivedSignature: string | null = null
    let parsed: Record<string, unknown>
    let snapshot

    if (paymentProvider === 'asaas') {
      if (!verifyAsaasWebhookToken(request)) {
        return buildResponse(401, {
          error: 'Token do webhook do Asaas invalido.',
        })
      }

      parsed = JSON.parse(payload) as Record<string, unknown>
      snapshot = extractAsaasOrderSnapshot({
        payment: parsed.payment ?? parsed,
        qrCode: {},
      })
    } else {
      receivedSignature = request.headers.get('x-authenticity-token')
      const isTrusted = await verifyPagBankAuthenticityToken({
        payload,
        receivedSignature,
      })

      if (!isTrusted) {
        return buildResponse(401, {
          error: 'Assinatura do webhook do PagBank invalida.',
        })
      }

      parsed = JSON.parse(payload) as Record<string, unknown>
      snapshot = extractPagBankOrderSnapshot(parsed)
    }

    if (admin) {
      await admin.from('pagbank_orders').upsert(
        {
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

      await admin.from('pagbank_notifications').insert({
        authenticity_token: receivedSignature,
        order_id: snapshot.orderId,
        payload: parsed,
        reference_id: snapshot.referenceId,
        status: snapshot.status,
      })
    }

    return buildResponse(200, {
      ok: true,
      orderId: snapshot.orderId,
      status: snapshot.status,
    })
  } catch (error) {
    return buildResponse(500, {
      error:
        error instanceof Error
          ? error.message
          : paymentProvider === 'asaas'
            ? 'Erro inesperado ao processar webhook do Asaas.'
            : 'Erro inesperado ao processar webhook do PagBank.',
    })
  }
})
