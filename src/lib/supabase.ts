import { createClient } from '@supabase/supabase-js'
import { appConfig, hasSupabaseConfig } from './appConfig'

export const supabase =
  hasSupabaseConfig
    ? createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
      },
    })
    : null
