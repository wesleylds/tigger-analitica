import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildPixPayload } from '../_shared/pix.ts'
import { corsHeaders } from '../_shared/cors.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const pixKey = Deno.env.get('PIX_KEY') ?? 'b7bbe350-fff9-4384-8623-31b172df6311'
const pixMerchantName = Deno.env.get('PIX_MERCHANT_NAME') ?? 'TIGGER ANALYTICS'
const pixMerchantCity = Deno.env.get('PIX_MERCHANT_CITY') ?? 'SAO PAULO'
const pixAmountCents = Number(Deno.env.get('PIX_AMOUNT_CENTS') ?? '1990')

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) {
      return new Response(JSON.stringify({ error: 'Authorization header ausente.' }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      })
    }

    const admin = createClient(supabaseUrl, serviceRoleKey)
    const token = authorization.replace('Bearer ', '').trim()
    const {
      data: { user },
      error: authError,
    } = await admin.auth.getUser(token)

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Sessao invalida.' }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      })
    }

    const { data: account, error: accountError } = await admin
      .from('customer_accounts')
      .select('id, display_name, email, access_status')
      .eq('id', user.id)
      .maybeSingle()

    if (accountError || !account) {
      return new Response(JSON.stringify({ error: 'Conta nao encontrada.' }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      })
    }

    const { payload, txid } = buildPixPayload({
      amount: pixAmountCents / 100,
      city: pixMerchantCity,
      key: pixKey,
      merchantName: pixMerchantName,
      reference: `${user.id}-${Date.now()}`,
    })

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()

    const { data: charge, error: chargeError } = await admin
      .from('pix_charges')
      .insert({
        amount_cents: pixAmountCents,
        expires_at: expiresAt,
        metadata: {
          source: 'capture_page',
        },
        pix_key: pixKey,
        qr_payload: payload,
        status: 'pending',
        txid,
        user_id: user.id,
      })
      .select('id, amount_cents, status, qr_payload, txid, expires_at, pix_key')
      .single()

    if (chargeError || !charge) {
      return new Response(JSON.stringify({ error: 'Nao foi possivel gerar a cobranca Pix.' }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      })
    }

    await admin
      .from('customer_accounts')
      .update({
        access_status: 'pending_payment',
        pix_key: pixKey,
      })
      .eq('id', user.id)

    return new Response(
      JSON.stringify({
        amountCents: charge.amount_cents,
        chargeId: charge.id,
        expiresAt: charge.expires_at,
        pixKey: charge.pix_key,
        qrPayload: charge.qr_payload,
        status: charge.status,
        txid: charge.txid,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Erro inesperado ao gerar Pix.',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    )
  }
})
