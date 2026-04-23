import type { LeagueDefinition, Platform } from '../types'
import { bbtipsLeagueIdOverridesByPlatform } from './bbtipsLeagueIdOverrides'

export type BbtipsProvider = 'BETANO' | 'BET365' | 'PLAYPIX'

export interface BbtipsLeagueCatalogEntry extends LeagueDefinition {
  id: number
  key: string
  provider: BbtipsProvider
  sub: string
  subAliases?: string[]
  champParam: string
}

const baseBbtipsLeagueCatalogByPlatform: Record<Platform, BbtipsLeagueCatalogEntry[]> = {
  Betano: [
    {
      id: 2,
      key: 'classicos',
      provider: 'BETANO',
      name: 'Classicos da America',
      sub: 'cl\u00e1ssicos-da-am\u00e9rica',
      subAliases: [
        'classicos',
        'classicos da america',
        'classicos_da_america',
        'classicos-da-america',
        'cl\u00e1ssicos-da-am\u00e9rica',
        'clÃ¡ssicos-da-amÃ©rica',
      ],
      champParam: 'cl\u00e1ssicos-da-am\u00e9rica',
      region: 'AM',
      descriptor: 'liga americana com padrao de gols mais aberto.',
      image: '/images/brasil-turbo.png',
      accent: '#59c2ff',
      teams: [],
    },
    {
      id: 3,
      key: 'copa',
      provider: 'BETANO',
      name: 'Copa',
      sub: 'copa',
      champParam: 'copa',
      region: 'GL',
      descriptor: 'grade de copa com alternancia rapida nas colunas e leitura objetiva.',
      image: '/images/mundo-cup.png',
      accent: '#ffb648',
      teams: [],
    },
    {
      id: 4,
      key: 'euro',
      provider: 'BETANO',
      name: 'Euro',
      sub: 'euro',
      champParam: 'euro',
      region: 'EU',
      descriptor: 'mercado europeu com comportamento mais controlado.',
      image: '/images/history-tunnel.png',
      accent: '#ad8cff',
      teams: [],
    },
    {
      id: 5,
      key: 'america',
      provider: 'BETANO',
      name: 'Copa America',
      sub: 'copa-america',
      subAliases: ['america', 'copa america', 'copa-america'],
      champParam: 'copa-america',
      region: 'AM',
      descriptor: 'faixa americana da Betano com volume alto e gols mais distribuidos.',
      image: '/images/analysis-room.png',
      accent: '#57e0b3',
      teams: [],
    },
    {
      id: 6,
      key: 'british',
      provider: 'BETANO',
      name: 'British Derbies',
      sub: 'british-derbies',
      champParam: 'british-derbies',
      region: 'UK',
      descriptor: 'volume real da Betano com janelas de 3 em 3 minutos.',
      image: '/images/inglaterra-elite.png',
      accent: '#3bd671',
      teams: [],
    },
    {
      id: 7,
      key: 'espanhola',
      provider: 'BETANO',
      name: 'Liga Espanhola',
      sub: 'liga-espanhola',
      champParam: 'liga-espanhola',
      region: 'ES',
      descriptor: 'faixas espanholas da Betano com leitura direta por odd e placar.',
      image: '/images/espanha-pro.png',
      accent: '#59c2ff',
      teams: [],
    },
    {
      id: 8,
      key: 'scudetto',
      provider: 'BETANO',
      name: 'Scudetto Italiano',
      sub: 'scudetto-italiano',
      champParam: 'scudetto-italiano',
      region: 'IT',
      descriptor: 'liga italiana com ritmo curto e historico denso.',
      image: '/images/italia-flash.png',
      accent: '#ffb648',
      teams: [],
    },
    {
      id: 9,
      key: 'italiano',
      provider: 'BETANO',
      name: 'Campeonato Italiano',
      sub: 'campeonato-italiano',
      champParam: 'campeonato-italiano',
      region: 'IT',
      descriptor: 'grade italiana da Betano com bastante recorrencia de FT.',
      image: '/images/italia-flash.png',
      accent: '#ff6a78',
      teams: [],
    },
    {
      id: 11,
      key: 'estrelas',
      provider: 'BETANO',
      name: 'Copa das Estrelas',
      sub: 'copa-das-estrelas',
      champParam: 'copa-das-estrelas',
      region: 'GL',
      descriptor: 'liga mista com leitura forte para BTTS e over.',
      image: '/images/mundo-cup.png',
      accent: '#ad8cff',
      teams: [],
    },
    {
      id: 12,
      key: 'campeoes',
      provider: 'BETANO',
      name: 'Campeoes',
      sub: 'campe\u00f5es',
      subAliases: ['campeoes', 'campe\u00f5es', 'campeÃµes'],
      champParam: 'campe\u00f5es',
      region: 'EU',
      descriptor: 'grade premium da Betano com distribuicao agressiva.',
      image: '/images/control-grid.png',
      accent: '#57e0b3',
      teams: [],
    },
  ],
  // Bet365 / Express 365: IDs pendentes de reconferencia ao vivo quando a fonte voltar.
  Bet365: [
    {
      id: 2,
      key: 'copa',
      provider: 'BET365',
      name: 'Copa do Mundo',
      sub: 'copa_do_mundo',
      champParam: 'copa do mundo',
      region: 'GL',
      descriptor: 'liga global da Bet365 com grade cheia e ritmo continuo.',
      image: '/images/mundo-cup.png',
      accent: '#3bd671',
      teams: [],
    },
    {
      id: 1,
      key: 'euro',
      provider: 'BET365',
      name: 'Euro Cup',
      sub: 'euro cup',
      champParam: 'euro cup',
      region: 'EU',
      descriptor: 'janela europeia da Bet365 com leitura rapida por coluna.',
      image: '/images/alemanha-max.png',
      accent: '#59c2ff',
      teams: [],
    },
    {
      id: 4,
      key: 'super',
      provider: 'BET365',
      name: 'Super Liga Sul-Americana',
      sub: 'super_liga_sul-americana',
      champParam: 'super liga sul-americana',
      region: 'AM',
      descriptor: 'liga sul-americana da Bet365 com tendencia de jogos abertos.',
      image: '/images/brasil-turbo.png',
      accent: '#ff6a78',
      teams: [],
    },
    {
      id: 3,
      key: 'premier',
      provider: 'BET365',
      name: 'PremierShip',
      sub: 'premiership',
      champParam: 'premiership',
      region: 'UK',
      descriptor: 'grade inglesa com historico forte e rotacao constante.',
      image: '/images/inglaterra-elite.png',
      accent: '#ffb648',
      teams: [],
    },
  ],
  'Express 365': [
    {
      id: 0,
      key: 'express',
      provider: 'BET365',
      name: 'Express',
      sub: 'express',
      subAliases: ['express'],
      champParam: 'express',
      region: 'GL',
      descriptor: 'grade express da Bet365 com rodada de 1 em 1 minuto.',
      image: '/images/control-grid.png',
      accent: '#57e0b3',
      teams: [],
    },
  ],
  PlayPix: [
    {
      id: 1,
      key: 'ita',
      provider: 'PLAYPIX',
      name: 'ITA',
      sub: 'ita',
      subAliases: ['italia', 'italy'],
      champParam: 'ita',
      region: 'IT',
      descriptor: 'grade italiana da Kiron com giro de 2 em 2 minutos.',
      image: '/images/italia-flash.png',
      accent: '#59c2ff',
      teams: [],
    },
    {
      id: 2,
      key: 'eng',
      provider: 'PLAYPIX',
      name: 'ENG',
      sub: 'eng',
      subAliases: ['inglaterra', 'england'],
      champParam: 'eng',
      region: 'UK',
      descriptor: 'liga inglesa da Kiron com colunas pares e bastante volume.',
      image: '/images/inglaterra-elite.png',
      accent: '#ff6a78',
      teams: [],
    },
    {
      id: 3,
      key: 'spa',
      provider: 'PLAYPIX',
      name: 'SPA',
      sub: 'spa',
      subAliases: ['espanha', 'spain'],
      champParam: 'spa',
      region: 'ES',
      descriptor: 'janela espanhola da Kiron com leitura rapida em linha curta.',
      image: '/images/espanha-pro.png',
      accent: '#ffb648',
      teams: [],
    },
    {
      id: 4,
      key: 'bra',
      provider: 'PLAYPIX',
      name: 'BRA',
      sub: 'bra',
      subAliases: ['brasil', 'brazil'],
      champParam: 'bra',
      region: 'BR',
      descriptor: 'grade brasileira da Kiron em ciclos de 3 minutos.',
      image: '/images/brasil-turbo.png',
      accent: '#57e0b3',
      teams: [],
    },
    {
      id: 5,
      key: 'lat',
      provider: 'PLAYPIX',
      name: 'LAT',
      sub: 'lat',
      subAliases: ['latam', 'latino', 'latin'],
      champParam: 'lat',
      region: 'AM',
      descriptor: 'faixa latina da Kiron com rodada curta e leitura direta por odd.',
      image: '/images/mundo-cup.png',
      accent: '#ad8cff',
      teams: [],
    },
  ],
}

const applyBbtipsLeagueIdOverrides = (
  catalog: Record<Platform, BbtipsLeagueCatalogEntry[]>,
): Record<Platform, BbtipsLeagueCatalogEntry[]> =>
  Object.fromEntries(
    (Object.entries(catalog) as Array<[Platform, BbtipsLeagueCatalogEntry[]]>).map(([platform, leagues]) => {
      const overrides = bbtipsLeagueIdOverridesByPlatform[platform] ?? {}

      return [
        platform,
        leagues.map((league) => {
          const override = overrides[league.key]
          return override
            ? {
                ...league,
                id: override.id,
              }
            : league
        }),
      ]
    }),
  ) as Record<Platform, BbtipsLeagueCatalogEntry[]>

const resolveExpectedProviderForPlatform = (platform: Platform): BbtipsProvider =>
  platform === 'Betano'
    ? 'BETANO'
    : platform === 'PlayPix'
      ? 'PLAYPIX'
      : 'BET365'

const assertBbtipsLeagueCatalogIntegrity = (
  baseCatalog: Record<Platform, BbtipsLeagueCatalogEntry[]>,
  resolvedCatalog: Record<Platform, BbtipsLeagueCatalogEntry[]>,
) => {
  ;(Object.entries(baseCatalog) as Array<[Platform, BbtipsLeagueCatalogEntry[]]>).forEach(([platform, baseLeagues]) => {
    const baseKeys = new Set(baseLeagues.map((league) => league.key))
    const overrides = bbtipsLeagueIdOverridesByPlatform[platform] ?? {}

    Object.keys(overrides).forEach((overrideKey) => {
      if (!baseKeys.has(overrideKey)) {
        throw new Error(`[bbtips-catalog] Override desconhecido em ${platform}: ${overrideKey}`)
      }
    })

    const seenKeys = new Set<string>()
    const seenIds = new Map<number, string>()
    const expectedProvider = resolveExpectedProviderForPlatform(platform)

    resolvedCatalog[platform].forEach((league) => {
      if (seenKeys.has(league.key)) {
        throw new Error(`[bbtips-catalog] Chave de liga duplicada em ${platform}: ${league.key}`)
      }
      seenKeys.add(league.key)

      const previousKey = seenIds.get(league.id)
      if (previousKey) {
        throw new Error(
          `[bbtips-catalog] ID de liga duplicado em ${platform}: ${league.id} (${previousKey}, ${league.key})`,
        )
      }
      seenIds.set(league.id, league.key)

      if (league.provider !== expectedProvider) {
        throw new Error(
          `[bbtips-catalog] Provider invalido em ${platform}/${league.key}: ${league.provider} (esperado ${expectedProvider})`,
        )
      }
    })
  })
}

const resolvedBbtipsLeagueCatalogByPlatform = applyBbtipsLeagueIdOverrides(baseBbtipsLeagueCatalogByPlatform)

assertBbtipsLeagueCatalogIntegrity(baseBbtipsLeagueCatalogByPlatform, resolvedBbtipsLeagueCatalogByPlatform)

export const bbtipsLeagueCatalogByPlatform = resolvedBbtipsLeagueCatalogByPlatform

export const bbtipsLeagueCatalog = Object.values(bbtipsLeagueCatalogByPlatform).flat()

export const getBbtipsLeagueOptionsForPlatform = (platform: Platform) =>
  bbtipsLeagueCatalogByPlatform[platform].map((league) => league.name)
