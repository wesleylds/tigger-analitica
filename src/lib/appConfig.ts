const parsePixAmount = (value: string | undefined, fallback: number) => {
  const normalized = Number.parseFloat(String(value ?? '').replace(',', '.'))
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback
}

const normalizePaymentProvider = (value: string | undefined) => {
  const normalized = String(value ?? 'pagbank').trim().toLowerCase()
  return normalized === 'asaas' ? 'asaas' : 'pagbank'
}

const formatPaymentProviderLabel = (provider: 'pagbank' | 'asaas') =>
  provider === 'asaas' ? 'Asaas' : 'PagBank'

const normalizeEnvironment = (value: string | undefined) =>
  String(value ?? 'sandbox').trim().toLowerCase() === 'production' ? 'production' : 'sandbox'

const paymentProvider = normalizePaymentProvider(import.meta.env.VITE_PAYMENT_PROVIDER)

export const appConfig = {
  pixAmount: parsePixAmount(import.meta.env.VITE_PIX_AMOUNT, 19.9),
  pixKey: String(import.meta.env.VITE_PIX_KEY ?? 'b7bbe350-fff9-4384-8623-31b172df6311').trim(),
  pixMerchantCity: String(import.meta.env.VITE_PIX_MERCHANT_CITY ?? 'SAO PAULO').trim(),
  pixMerchantName: String(import.meta.env.VITE_PIX_MERCHANT_NAME ?? 'TIGGER ANALYTICS').trim(),
  paymentProvider,
  paymentProviderLabel: formatPaymentProviderLabel(paymentProvider),
  pagBankEnv: normalizeEnvironment(
    paymentProvider === 'asaas' ? import.meta.env.VITE_ASAAS_ENV : import.meta.env.VITE_PAGBANK_ENV,
  ),
  siteUrl: String(
    import.meta.env.VITE_SITE_URL ??
      (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:5173'),
  ).trim(),
  supportTelegramLink: String(import.meta.env.VITE_SUPPORT_TELEGRAM_LINK ?? '').trim(),
  supabaseAnonKey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim(),
  supabaseUrl: String(import.meta.env.VITE_SUPABASE_URL ?? '').trim(),
} as const

export const hasSupabaseConfig =
  appConfig.supabaseUrl.length > 0 && appConfig.supabaseAnonKey.length > 0
