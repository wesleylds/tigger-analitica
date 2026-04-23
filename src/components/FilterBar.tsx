import { CustomSelect } from './CustomSelect'
import {
  oddDisplayGroups,
  oddDisplayLabelMap,
  marketGroups,
  marketOptions,
  oddBandOptions,
  oddGroups,
  periodOptions,
  virtualPlatformOptions,
  resultFtMarkets,
  resultHtMarkets,
  timeModeOptions,
} from '../data/staticData'
import { defaultCellGreenColor, defaultCellRedColor, marketLabelMap, periodLabelMap } from '../lib/ui'
import { getPlatformLabel } from '../lib/platformLabel'
import type { FiltersState, Market, OddBand, OddDisplayOption, Period, Platform, TimeMode } from '../types'

const compactMarketGroupLabelMap: Record<string, string> = {
  Ambas: 'Ambas',
  Extras: 'Extras',
  'Gols FT': 'Gols FT',
  Over: 'Over',
  'Resultado Correto': 'Correto',
  'Resultado FT': 'Res. FT',
  'Resultado HT': 'Res. HT',
  Under: 'Under',
}

const exactScoreMarketPattern = /^\d+x\d+$/
const resultFtMarketSet = new Set<Market>(resultFtMarkets)
const resultHtMarketSet = new Set<Market>(resultHtMarkets)
const compactHtMarketValueMap: Record<string, Market> = {
  'Casa vence': 'Casa vence HT',
  Empate: 'Empate HT',
  'Fora vence': 'Fora vence HT',
  'Resultado final': 'Casa vence HT',
}
const compactFtMarketValueMap: Record<string, Market> = {
  'Casa vence HT': 'Casa vence',
  'Empate HT': 'Empate',
  'Fora vence HT': 'Fora vence',
  'Resultado HT': 'Resultado final',
}

const getCompactMarketLabel = (market: Market) => {
  if (market === 'Casa vence HT') return 'Casa vence'
  if (market === 'Empate HT') return 'Empate'
  if (market === 'Fora vence HT') return 'Fora vence'
  return marketLabelMap[market] ?? market
}

const resolveConstrainedTimeMode = (market: Market, fallback: TimeMode) => {
  if (resultHtMarketSet.has(market)) return 'HT'
  if (resultFtMarketSet.has(market) || exactScoreMarketPattern.test(market)) return 'FT'
  return fallback
}

const getReadableTextColor = (hexColor: string) => {
  const hex = hexColor.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#ffffff'

  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000

  return luminance > 150 ? '#10151c' : '#ffffff'
}

const previewCardColor = (
  input: HTMLInputElement,
  color: string,
  colorVariable: string,
  foregroundVariable: string,
) => {
  const surface = input.closest<HTMLElement>('.analysis-surface')
  surface?.style.setProperty(colorVariable, color)
  surface?.style.setProperty(foregroundVariable, getReadableTextColor(color))
}

function CellColorField({
  fallback,
  foregroundVariable,
  label,
  onCommit,
  value,
  variable,
}: {
  fallback: string
  foregroundVariable: string
  label: string
  onCommit: (value: string) => void
  value: string
  variable: string
}) {
  const currentValue = value || fallback

  const commit = (nextValue: string) => {
    if (nextValue !== currentValue) {
      onCommit(nextValue)
    }
  }

  return (
    <label className="color-filter-field">
      <span>{label}</span>
      <input
        key={currentValue}
        aria-label={label}
        className="cell-color-picker"
        defaultValue={currentValue}
        type="color"
        onBlur={(event) => commit(event.currentTarget.value)}
        onChange={(event) =>
          previewCardColor(event.currentTarget, event.currentTarget.value, variable, foregroundVariable)
        }
        onInput={(event) =>
          previewCardColor(event.currentTarget, event.currentTarget.value, variable, foregroundVariable)
        }
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit(event.currentTarget.value)
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

interface FilterBarProps {
  compact?: boolean
  filters: FiltersState
  leagueOptions: string[]
  onChange: (next: FiltersState) => void
  onReset?: () => void
  oddsMode?: 'range' | 'display'
  showColorControls?: boolean
  showLeague?: boolean
}

export function FilterBar({
  compact = false,
  filters,
  leagueOptions,
  onChange,
  onReset,
  oddsMode = 'range',
  showColorControls = false,
  showLeague = true,
}: FilterBarProps) {
  const leagueLabel = compact ? 'Ligas' : 'Liga'
  const periodLabel = compact ? 'Horas' : 'Período'
  const platformChoices = virtualPlatformOptions.map((option) => ({ label: getPlatformLabel(option), value: option }))
  const leagueChoices = leagueOptions.map((option) => ({ label: option, value: option }))
  const activeMarketGroup =
    marketGroups.find((group) => group.options.includes(filters.market)) ?? marketGroups[0]
  const resolvedTimeMode = resolveConstrainedTimeMode(filters.market, filters.timeMode)
  const timeChoicesSource: TimeMode[] =
    resultHtMarketSet.has(filters.market)
      ? ['HT']
      : resultFtMarketSet.has(filters.market) || exactScoreMarketPattern.test(filters.market)
        ? ['FT']
        : timeModeOptions
  const timeChoices = timeChoicesSource.map((option) => ({ label: option, value: option }))
  const compactMarketOptions =
    compact && activeMarketGroup.label === 'Resultado HT'
      ? activeMarketGroup.options.filter((option) => option !== 'Resultado HT')
      : activeMarketGroup.options
  const marketChoices = (compact ? compactMarketOptions : marketOptions).map((option) => ({
    group: compact ? undefined : marketGroups.find((group) => group.options.includes(option))?.label,
    label: compact ? getCompactMarketLabel(option) : marketLabelMap[option] ?? option,
    value: option,
  }))
  const oddChoices = oddBandOptions.map((option) => ({
    group: oddGroups.find((group) => group.options.includes(option))?.label,
    label: option,
    value: option,
  }))
  const oddDisplayChoices = oddDisplayGroups.flatMap((group) =>
    group.options.map((option) => ({
      group: group.label || undefined,
      label: oddDisplayLabelMap[option] ?? option,
      value: option,
    })),
  )
  const periodChoices = periodOptions.map((option) => ({
    label: periodLabelMap[option],
    value: option,
  }))

  return (
    <section className={`filter-bar ${compact ? 'compact' : ''} ${showColorControls ? 'has-color-controls' : ''}`}>
      {compact && (
        <div className="filter-bar-market-groups" aria-label="Tipos de mercado">
          {marketGroups.map((group) => {
            const isActive = group.label === activeMarketGroup.label

            return (
              <button
                key={group.label}
                type="button"
                className={`filter-bar-market-chip ${isActive ? 'is-active' : ''}`}
                aria-pressed={isActive}
                onClick={() => {
                  const nextMarket =
                    group.label === 'Resultado HT'
                      ? compactHtMarketValueMap[filters.market] ?? (group.options.find((option) => option !== 'Resultado HT') ?? group.options[0])
                      : group.label === 'Resultado FT'
                        ? compactFtMarketValueMap[filters.market] ?? filters.market
                        : group.options.includes(filters.market)
                          ? filters.market
                          : group.options[0]
                  onChange({
                    ...filters,
                    market: nextMarket,
                    timeMode: resolveConstrainedTimeMode(nextMarket, filters.timeMode),
                  })
                }}
              >
                <span>{compactMarketGroupLabelMap[group.label] ?? group.label}</span>
              </button>
            )
          })}
        </div>
      )}
      {!compact && (
        <label>
          <span>Plataforma</span>
          <CustomSelect
            menuTheme="dark"
            value={filters.platform}
            options={platformChoices}
            onChange={(value) =>
              onChange({
                ...filters,
                platform: value as Platform,
              })
            }
          />
        </label>
      )}
      {showLeague && (
        <label>
          <span>{leagueLabel}</span>
          <CustomSelect
            menuTheme="dark"
            value={filters.league}
            options={leagueChoices}
            onChange={(value) =>
              onChange({
                ...filters,
                league: value,
              })
            }
          />
        </label>
      )}
      <label>
        <span>Tempo</span>
        <CustomSelect
          menuTheme="dark"
          value={resolvedTimeMode}
          options={timeChoices}
          onChange={(value) =>
            onChange({
              ...filters,
              timeMode: resolveConstrainedTimeMode(filters.market, value as TimeMode),
            })
          }
        />
      </label>
      <label>
        <span>Mercado</span>
        <CustomSelect
          menuTheme="dark"
          searchable={!compact}
          searchPlaceholder={!compact ? 'Buscar mercado...' : undefined}
          value={filters.market}
          options={marketChoices}
          onChange={(value) =>
            onChange({
              ...filters,
              market: value as Market,
              timeMode: resolveConstrainedTimeMode(value as Market, filters.timeMode),
            })
          }
        />
      </label>
      <label>
        <span>Odds</span>
        <CustomSelect
          menuTheme="dark"
          searchable={oddsMode === 'display'}
          searchPlaceholder={oddsMode === 'display' ? 'Buscar odd...' : undefined}
          value={oddsMode === 'display' ? filters.oddsView : filters.oddBand}
          options={oddsMode === 'display' ? oddDisplayChoices : oddChoices}
          onChange={(value) =>
            oddsMode === 'display'
              ? onChange({
                  ...filters,
                  oddSequence: value === 'Selecione as Odds' ? filters.oddSequence : [],
                  oddsView: value as OddDisplayOption,
                })
              : onChange({
                  ...filters,
                  oddBand: value as OddBand,
                })
          }
        />
      </label>
      <label>
        <span>{periodLabel}</span>
        <CustomSelect
          menuTheme="dark"
          value={filters.period}
          options={periodChoices}
          onChange={(value) =>
            onChange({
              ...filters,
              period: value as Period,
            })
          }
        />
      </label>
      {showColorControls && (
        <>
          <CellColorField
            fallback={defaultCellGreenColor}
            foregroundVariable="--analysis-cell-green-fg"
            label="Cor Green"
            value={filters.greenColor}
            variable="--analysis-cell-green"
            onCommit={(greenColor) =>
              onChange({
                ...filters,
                greenColor,
              })
            }
          />
          <CellColorField
            fallback={defaultCellRedColor}
            foregroundVariable="--analysis-cell-red-fg"
            label="Cor Red"
            value={filters.redColor}
            variable="--analysis-cell-red"
            onCommit={(redColor) =>
              onChange({
                ...filters,
                redColor,
              })
            }
          />
        </>
      )}
      {onReset && (
        <div className="filter-bar-reset-row">
          <button
            type="button"
            className="filter-bar-reset-button"
            onClick={onReset}
          >
            Resetar tudo
          </button>
        </div>
      )}
    </section>
  )
}
