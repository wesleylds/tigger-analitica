import type { Platform } from '../types'

const platformLabelMap: Record<Platform, string> = {
  Betano: 'Betano',
  Bet365: 'Bet365',
  'Express 365': 'Express 365',
  PlayPix: 'Kiron',
}

export const getPlatformLabel = (platform: Platform) => platformLabelMap[platform] ?? platform
