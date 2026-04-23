import type { Platform } from '../types'

const normalizeVideoKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const betanoStreams: Record<string, string> = {
  brasileirao_betano:
    'https://stoiximan-br.live.inspiredvss.co.uk/live/soccer3brasilerio/stream_0/soccer3brasilerio.m3u8',
  brasileirao:
    'https://stoiximan-br.live.inspiredvss.co.uk/live/soccer3brasilerio/stream_0/soccer3brasilerio.m3u8',
  classicos_da_america:
    'https://stoiximan-br.live.inspiredvss.co.uk/live/soccercopabr/stream_0/soccercopabr.m3u8',
  classicas_da_america:
    'https://stoiximan-br.live.inspiredvss.co.uk/live/soccercopabr/stream_0/soccercopabr.m3u8',
  classicos:
    'https://stoiximan-br.live.inspiredvss.co.uk/live/soccercopabr/stream_0/soccercopabr.m3u8',
  classicas:
    'https://stoiximan-br.live.inspiredvss.co.uk/live/soccercopabr/stream_0/soccercopabr.m3u8',
  copa:
    'https://stoiximanintl.live.inspiredvss.co.uk/live/soccer3copaamerica/stream_0/soccer3copaamerica.m3u8',
  euro:
    'https://stoiximanintl.live.inspiredvss.co.uk/live/soccer3international/stream_0/soccer3international.m3u8',
  british_derbies:
    'https://vfvideo-s03live-vs001.akamaized.net/live/_definst_/vwmf1_srvg-england-1024x576-1000k-mr-v3_channel0/chunklist.m3u8',
  british:
    'https://vfvideo-s03live-vs001.akamaized.net/live/_definst_/vwmf1_srvg-england-1024x576-1000k-mr-v3_channel0/chunklist.m3u8',
  liga_espanhola:
    'https://vfvideo-s03live-vs001.akamaized.net/live/_definst_/vwmf2_srvg-spain-1024x576-1000k-mr-v3_channel0/chunklist.m3u8',
  espanhola:
    'https://vfvideo-s03live-vs001.akamaized.net/live/_definst_/vwmf2_srvg-spain-1024x576-1000k-mr-v3_channel0/chunklist.m3u8',
  scudetto_italiano:
    'https://vfvideo-s03live-vs001.akamaized.net/live/_definst_/vwmf3_srvg-italy-1024x576-1000k-mr-v3_channel0/chunklist.m3u8',
  scudetto:
    'https://vfvideo-s03live-vs001.akamaized.net/live/_definst_/vwmf3_srvg-italy-1024x576-1000k-mr-v3_channel0/chunklist.m3u8',
  campeonato_italiano:
    'https://stoiximan-br.live.inspiredvss.co.uk/live/soccerserieAbr/stream_0/soccerserieAbr.m3u8',
  italiano:
    'https://stoiximan-br.live.inspiredvss.co.uk/live/soccerserieAbr/stream_0/soccerserieAbr.m3u8',
  copa_das_estrelas:
    'https://stoiximan-br.live.inspiredvss.co.uk/live/soccerstarsbr/stream_0/soccerstarsbr.m3u8',
  estrelas:
    'https://stoiximan-br.live.inspiredvss.co.uk/live/soccerstarsbr/stream_0/soccerstarsbr.m3u8',
}

const playPixStreams: Record<string, string> = {
  ita:
    'https://st10.net4media.net:8082/kiron-online/c80294b4-V111-ItalianSingle-8d39-d62f99df883d/chunks.m3u8',
  italia:
    'https://st10.net4media.net:8082/kiron-online/c80294b4-V111-ItalianSingle-8d39-d62f99df883d/chunks.m3u8',
  italy:
    'https://st10.net4media.net:8082/kiron-online/c80294b4-V111-ItalianSingle-8d39-d62f99df883d/chunks.m3u8',
  eng:
    'https://st10.net4media.net:8082/kiron-online/182e2783-V196-FootballEnglish-Single-9123a3720830/chunks.m3u8',
  inglaterra:
    'https://st10.net4media.net:8082/kiron-online/182e2783-V196-FootballEnglish-Single-9123a3720830/chunks.m3u8',
  england:
    'https://st10.net4media.net:8082/kiron-online/182e2783-V196-FootballEnglish-Single-9123a3720830/chunks.m3u8',
  spa:
    'https://st10.net4media.net:8082/kiron-online/59f62056-V36-FootballSpanish-Single-40443b566608/chunks.m3u8',
  espanha:
    'https://st10.net4media.net:8082/kiron-online/59f62056-V36-FootballSpanish-Single-40443b566608/chunks.m3u8',
  spain:
    'https://st10.net4media.net:8082/kiron-online/59f62056-V36-FootballSpanish-Single-40443b566608/chunks.m3u8',
  bra:
    'https://st12.net4media.net:8082/KironBrazilianSingle/199/playlist.m3u8',
  brasil:
    'https://st12.net4media.net:8082/KironBrazilianSingle/199/playlist.m3u8',
  brazil:
    'https://st12.net4media.net:8082/KironBrazilianSingle/199/playlist.m3u8',
  lat:
    'https://st12.net4media.net:8082/KironLatamSingle/199/playlist.m3u8',
  latam:
    'https://st12.net4media.net:8082/KironLatamSingle/199/playlist.m3u8',
  latino:
    'https://st12.net4media.net:8082/KironLatamSingle/199/playlist.m3u8',
  latin:
    'https://st12.net4media.net:8082/KironLatamSingle/199/playlist.m3u8',
}

const streamCatalog: Record<Platform, Record<string, string>> = {
  Betano: betanoStreams,
  Bet365: {},
  'Express 365': {},
  PlayPix: playPixStreams,
}

export const getStreamUrl = (
  platform: Platform,
  ...candidates: Array<string | null | undefined>
) => {
  const platformStreams = streamCatalog[platform]

  for (const candidate of candidates) {
    if (!candidate) continue

    const exact = platformStreams[normalizeVideoKey(candidate)]
    if (exact) {
      return exact
    }
  }

  return undefined
}
