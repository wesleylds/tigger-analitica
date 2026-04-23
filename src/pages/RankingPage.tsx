import type { CSSProperties } from 'react'
import { bbtipsLeagueCatalogByPlatform } from '../data/bbtipsCatalog'
import { virtualPlatformOptions } from '../data/staticData'
import { getPlatformLabel } from '../lib/platformLabel'
import type { Platform } from '../types'

interface RankingPageProps {
  currentPlatform: Platform
  onOpenCurrentAnalysis: () => void
  onSelectPlatform: (platform: Platform) => void
}

const platformNarratives: Record<
  Platform,
  {
    focus: string
    label: string
  }
> = {
  Betano: {
    focus: 'Boa para quem gosta de olhar a matriz e entender rapido o que a liga esta entregando.',
    label: 'Na Betano, a ideia e deixar a leitura leve, clara e gostosa de acompanhar.',
  },
  Bet365: {
    focus: 'Aqui faz mais sentido para quem gosta de historico, proximos jogos e leitura por horario.',
    label: 'Na Bet365, o foco e entregar profundidade sem transformar a tela em bagunca.',
  },
  'Express 365': {
    focus: 'Faz sentido para quem quer uma leitura curta, rapida e sem muita volta.',
    label: 'A Express 365 entra como uma frente mais agil, feita para resposta imediata.',
  },
  PlayPix: {
    focus: 'Aqui a proposta e juntar leitura visual, video e ligas curtas dentro do mesmo fluxo.',
    label: 'A Kiron entrou no site do jeito certo, sem parecer uma area solta ou fora do padrao.',
  },
}

const siteInfoCards = [
  {
    id: '01',
    title: 'Matriz em foco',
    copy:
      'A matriz continua sendo o centro de tudo. E nela que a leitura acontece de verdade, sem precisar ficar pulando de tela o tempo todo.',
    chips: ['FT', 'HT', 'FT + HT', 'Matriz'],
  },
  {
    id: '02',
    title: 'Filtros organizados',
    copy:
      'Os filtros foram pensados para ajudar a leitura, nao para atrapalhar. Mercado, odds, horas e sequencias ficam num lugar que faz sentido.',
    chips: ['Mercado', 'Odds', 'Horas', 'Sequencia'],
  },
  {
    id: '03',
    title: 'Apoios da analise',
    copy:
      'Video, radar, trader, ranking, alertas e proximos jogos entram para somar na leitura, sem tirar o foco da pagina principal.',
    chips: ['Video', 'Radar', 'Trader', 'Alertas'],
  },
  {
    id: '04',
    title: 'Navegacao por plataformas',
    copy:
      'Trocar de plataforma nao precisa dar aquela sensacao de ter entrado em outro sistema. A ideia foi manter tudo conversando da forma certa.',
    chips: ['Betano', 'Bet365', 'Express 365', 'Kiron'],
  },
]

const updateCards = [
  {
    badge: 'Filtros',
    title: 'Selecoes preservadas no futebol virtual',
    copy:
      'Agora o site segura melhor as escolhas feitas no futebol virtual. Nao e mais aquela sensacao de configurar tudo e perder sem motivo.',
  },
  {
    badge: 'Matriz',
    title: 'Ajustes para reduzir celulas furadas',
    copy:
      'A matriz recebeu ajustes para evitar aquelas linhas quebradas e o excesso de celulas vazias que so deixavam a leitura confusa.',
  },
  {
    badge: 'Videos',
    title: 'Integracao com BBTips e Kiron',
    copy:
      'Os videos foram reorganizados para buscar das fontes certas, principalmente nos cenarios ligados a BBTips e Kiron quando houver suporte.',
  },
  {
    badge: 'Proximos',
    title: 'Recortes de proximos jogos mais controlados',
    copy:
      'Os proximos jogos ficaram mais controlados, com janelas mais previsiveis e sem exagero onde isso so deixava a tela pesada.',
  },
]

const heroHighlights = [
  {
    title: 'Central de informacoes',
    copy:
      'Um lugar para mostrar o site com mais calma, contar o que mudou e deixar tudo mais claro para quem entra.',
  },
  {
    title: 'Atualizacoes visiveis',
    copy:
      'As melhorias do sistema podem aparecer aqui sem baguncar a pagina principal de analise.',
  },
  {
    title: 'Entrada elegante para o produto',
    copy:
      'A dashboard recebe o usuario, apresenta o produto e depois leva para a analise sem quebrar a cara do site.',
  },
]

export function RankingPage({
  currentPlatform,
  onOpenCurrentAnalysis,
  onSelectPlatform,
}: RankingPageProps) {
  const platformCards = virtualPlatformOptions.map((platform) => {
    const leagues = bbtipsLeagueCatalogByPlatform[platform]
    const leadLeague = leagues[0]

    return {
      accent: leadLeague?.accent ?? '#f6d04c',
      descriptor: platformNarratives[platform],
      image: leadLeague?.image ?? '/images/analysis-room.png',
      isActive: platform === currentPlatform,
      platform,
      sampleLeagues: leagues.slice(0, 4).map((league) => league.name),
    }
  })

  return (
    <section className="page-grid dashboard-page">
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="eyebrow">central do site</span>
          <h1>Um lugar para mostrar o que o Tigger ja entrega hoje e o que vem melhorando no site.</h1>
          <p>
            A ideia desta dashboard e ser simples e util. Em vez de virar mais uma tela de analise,
            ela pode apresentar o Tigger, explicar melhor a proposta da plataforma e mostrar o que
            ja foi sendo ajustado no site.
          </p>
          <p>
            Aqui entram informacoes sobre o produto, atualizacoes reais do que foi feito e uma
            visao mais clara das plataformas que o site cobre hoje, sem aquele texto duro e sem
            cara de pagina automatica.
          </p>

          <div className="dashboard-context-pills">
            {['Atualizacoes', 'Informacoes', 'Plataformas', 'Produto'].map((label) => (
              <span key={label} className="dashboard-context-pill">
                {label}
              </span>
            ))}
          </div>

          <div className="dashboard-hero-actions">
            <button type="button" className="solid-button" onClick={onOpenCurrentAnalysis}>
              Entrar na analise
            </button>
          </div>
        </div>

        <aside className="dashboard-hero-side">
          {heroHighlights.map((item) => (
            <article key={item.title} className="dashboard-hero-card dashboard-hero-card-feature">
              <span className="eyebrow">destaque</span>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </aside>
      </section>

      <section className="dashboard-panel">
        <div className="dashboard-section-intro">
          <div>
            <span className="eyebrow">plataformas do site</span>
            <h2>As plataformas que hoje fazem parte do Tigger.</h2>
            <p>
              Essa parte ajuda a pessoa a entender onde o site atua hoje e como cada casa foi
              entrando no mesmo ecossistema visual.
            </p>
          </div>
        </div>

        <div className="dashboard-platform-grid">
          {platformCards.map((platformCard) => (
            <button
              key={platformCard.platform}
              type="button"
              className={`platform-overview-card ${platformCard.isActive ? 'is-active' : ''}`}
              style={{ '--platform-accent': platformCard.accent } as CSSProperties}
              onClick={() => onSelectPlatform(platformCard.platform)}
            >
              <div className="platform-overview-media">
                <img src={platformCard.image} alt={getPlatformLabel(platformCard.platform)} />
              </div>

              <div className="platform-overview-content">
                <div className="platform-overview-head">
                  <span className="platform-overview-kicker">plataforma</span>
                  {platformCard.isActive && <span className="platform-overview-badge">selecionada</span>}
                </div>

                <h3>{getPlatformLabel(platformCard.platform)}</h3>
                <p>{platformCard.descriptor.label}</p>
                <p className="platform-overview-focus">{platformCard.descriptor.focus}</p>

                <div className="platform-overview-chip-row">
                  {platformCard.sampleLeagues.map((leagueName) => (
                    <span key={leagueName} className="platform-overview-chip">
                      {leagueName}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="dashboard-panel">
        <div className="dashboard-section-intro">
          <div>
            <span className="eyebrow">o que o usuario encontra</span>
            <h2>O que a pessoa encontra quando entra no site.</h2>
            <p>
              Aqui a ideia e mostrar, de um jeito mais leve, como o produto foi sendo montado e
              como cada parte conversa com a analise principal.
            </p>
          </div>
        </div>

        <div className="dashboard-pillar-grid">
          {siteInfoCards.map((card) => (
            <article key={card.id} className="dashboard-pillar-card">
              <div className="dashboard-pillar-icon">{card.id}</div>
              <div className="dashboard-pillar-copy">
                <h3>{card.title}</h3>
                <p>{card.copy}</p>
                <div className="dashboard-pillar-chip-row">
                  {card.chips.map((chip) => (
                    <span key={chip} className="dashboard-pillar-chip">
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="dashboard-panel">
        <div className="dashboard-section-intro">
          <div>
            <span className="eyebrow">atualizacoes e avisos</span>
            <h2>Algumas melhorias que ja foram entrando no site.</h2>
            <p>
              Em vez de texto solto ou generico, esse espaco pode mostrar o que realmente foi
              ajustado no produto e o que melhorou na experiencia.
            </p>
          </div>
        </div>

        <div className="dashboard-flow-grid">
          {updateCards.map((card) => (
            <article key={card.title} className="dashboard-flow-step">
              <span className="dashboard-flow-step-id">{card.badge}</span>
              <h3>{card.title}</h3>
              <p>{card.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="dashboard-cta">
        <div className="dashboard-cta-copy">
          <span className="eyebrow">entrada para o produto</span>
          <h2>Uma pagina mais leve para apresentar o site antes de entrar na analise.</h2>
          <p>
            Depois dessa visao geral, a pessoa pode ir para a analise ou trocar de plataforma sem
            sentir que saiu do mesmo produto.
          </p>
        </div>

        <div className="dashboard-platform-switches">
          {virtualPlatformOptions.map((platform) => (
            <button
              key={platform}
              type="button"
              className={`dashboard-platform-switch ${platform === currentPlatform ? 'active' : ''}`}
              onClick={() => onSelectPlatform(platform)}
            >
              {getPlatformLabel(platform)}
            </button>
          ))}
        </div>

        <button type="button" className="solid-button" onClick={onOpenCurrentAnalysis}>
          Abrir pagina de analise
        </button>
      </section>
    </section>
  )
}
