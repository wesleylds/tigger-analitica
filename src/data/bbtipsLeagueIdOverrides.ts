import type { Platform } from '../types'

export interface BbtipsLeagueIdOverride {
  id: number
  note: string
  source: 'bbtips-ui-network'
  verifiedAt: string
}

export interface BbtipsLeagueIdAuditTab {
  key: string
  labels: string[]
}

export interface BbtipsLeagueIdAuditTarget {
  endpointPattern: string
  pageUrl: string
  tabs: BbtipsLeagueIdAuditTab[]
}

export const bbtipsLeagueIdOverridesByPlatform: Partial<
  Record<Platform, Record<string, BbtipsLeagueIdOverride>>
> = {
  Betano: {
    classicos: {
      id: 2,
      note: 'Confirmado na BB Tips autenticada ao abrir a aba Classicos.',
      source: 'bbtips-ui-network',
      verifiedAt: '2026-04-22T00:00:00-03:00',
    },
    copa: {
      id: 3,
      note: 'Confirmado na BB Tips autenticada ao clicar na aba Copa.',
      source: 'bbtips-ui-network',
      verifiedAt: '2026-04-22T00:07:00-03:00',
    },
    euro: {
      id: 4,
      note: 'Confirmado na BB Tips autenticada na grade da Betano.',
      source: 'bbtips-ui-network',
      verifiedAt: '2026-04-22T00:00:00-03:00',
    },
    america: {
      id: 5,
      note: 'Confirmado na BB Tips autenticada ao clicar na aba America.',
      source: 'bbtips-ui-network',
      verifiedAt: '2026-04-22T00:08:00-03:00',
    },
  },
}

export const bbtipsLeagueIdAuditTargetsByPlatform: Partial<Record<Platform, BbtipsLeagueIdAuditTarget>> = {
  Betano: {
    endpointPattern: 'betanoFutebolVirtual',
    pageUrl: 'https://app.bbtips.com.br/betano/futebol/horarios',
    tabs: [
      { key: 'classicos', labels: ['Classicos', 'Clássicos'] },
      { key: 'copa', labels: ['Copa'] },
      { key: 'euro', labels: ['Euro'] },
      { key: 'america', labels: ['America'] },
      { key: 'british', labels: ['British'] },
      { key: 'espanhola', labels: ['Espanhola'] },
      { key: 'scudetto', labels: ['Scudetto'] },
      { key: 'italiano', labels: ['Italiano'] },
      { key: 'estrelas', labels: ['Estrelas'] },
      { key: 'campeoes', labels: ['Campeoes', 'Campeões'] },
    ],
  },
  PlayPix: {
    endpointPattern: 'PlayPixFutebolVirtual',
    pageUrl: 'https://app.bbtips.com.br/playpix/futebol/horarios',
    tabs: [
      { key: 'ita', labels: ['ITA'] },
      { key: 'eng', labels: ['ENG'] },
      { key: 'spa', labels: ['SPA'] },
      { key: 'bra', labels: ['BRA'] },
      { key: 'lat', labels: ['LAT'] },
    ],
  },
}
