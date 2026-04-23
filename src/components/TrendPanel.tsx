import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { MatchRecord } from '../types'

interface TrendPanelProps {
  records: MatchRecord[]
}

interface TrendPoint {
  timeLabel: string
  value: number
}

interface TrendSeries {
  color: string
  key: string
  label: string
  points: TrendPoint[]
}

interface ChartPoint {
  x: number
  y: number
}

const trendMarkets = [
  { color: '#35d46f', key: 'Ambas Marcam Sim', label: 'Ambas Marcam' },
  { color: '#ff5458', key: 'Ambas Marcam Não', label: 'Ambas Não Marcam' },
  { color: '#4b8dff', key: 'Over 1.5', label: 'Over 1.5' },
  { color: '#a05cff', key: 'Over 2.5', label: 'Over 2.5' },
  { color: '#ff8a1a', key: 'Under 1.5', label: 'Under 1.5' },
  { color: '#22c7c7', key: 'Under 2.5', label: 'Under 2.5' },
] as const

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const round1 = (value: number) => Math.round(value * 10) / 10
const formatTrendValue = (value: number) => `${round1(value).toFixed(1)}%`
const pointGapPx = 10
const trailingWindowSize = 20
const visiblePointCount = 30

const parseScorePair = (score: string) => {
  const [home, away] = String(score ?? '').split(/[x-]/i).map(Number)
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null
  return { home, away }
}

const buildTicks = (minValue: number, maxValue: number, total = 4) =>
  Array.from({ length: total + 1 }, (_, index) => round1(minValue + ((maxValue - minValue) / total) * index))

const coordinateMap = (
  values: number[],
  width: number,
  height: number,
  minValue: number,
  maxValue: number,
) => {
  const span = Math.max(maxValue - minValue, 1)

  return values.map((value, index) => ({
    x: values.length === 1 ? width / 2 : (index / Math.max(values.length - 1, 1)) * width,
    y: height - ((value - minValue) / span) * height,
  }))
}

const polylinePoints = (points: ChartPoint[]) =>
  points.map((point) => `${round1(point.x)},${round1(point.y)}`).join(' ')

const buildTooltipTransform = (xPercent: number, yPercent: number) => {
  const horizontal = xPercent > 72 ? 'translateX(calc(-100% - 14px))' : 'translateX(14px)'
  const vertical = yPercent < 24 ? 'translateY(16px)' : yPercent > 76 ? 'translateY(calc(-100% - 14px))' : 'translateY(-50%)'
  return `${horizontal} ${vertical}`
}

const formatTimeLabel = (record: MatchRecord) =>
  `${String(record.hour).padStart(2, '0')}:${String(record.minuteSlot).padStart(2, '0')}`

const readMarketResult = (record: MatchRecord, marketKey: string) => {
  const marketResults = record.marketResults as Record<string, boolean>
  return Boolean(marketResults[marketKey])
}

const buildTrendSeries = (records: MatchRecord[]) => {
  const ordered = [...records]
    .filter((record) => Boolean(parseScorePair(record.scoreFT)))
    .sort((left, right) => left.timestamp - right.timestamp)

  if (ordered.length < 2) return [] as TrendSeries[]

  const computedSeries = trendMarkets.map((market) => ({
    color: market.color,
    key: market.key,
    label: market.label,
    points: ordered.map((record, index) => {
      const windowStart = Math.max(0, index - trailingWindowSize + 1)
      const window = ordered.slice(windowStart, index + 1)
      const hits = window.filter((item) => readMarketResult(item, market.key)).length

      return {
        timeLabel: formatTimeLabel(record),
        value: round1((hits / Math.max(window.length, 1)) * 100),
      }
    }),
  }))

  return computedSeries.map((entry) => ({
    ...entry,
    points: entry.points.slice(-visiblePointCount),
  }))
}

const buildLabelPositions = (
  entries: Array<{ color: string; currentValue: number }>,
  chartTop: number,
  chartBottom: number,
  mapY: (value: number) => number,
) => {
  const minGap = 11
  const sorted = [...entries]
    .sort((left, right) => right.currentValue - left.currentValue)
    .map((entry) => ({
      color: entry.color,
      currentValue: entry.currentValue,
      y: mapY(entry.currentValue),
    }))

  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].y < sorted[index - 1].y + minGap) {
      sorted[index].y = sorted[index - 1].y + minGap
    }
  }

  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    if (sorted[index].y > sorted[index + 1].y - minGap) {
      sorted[index].y = sorted[index + 1].y - minGap
    }
  }

  return sorted.map((entry) => ({
    color: entry.color,
    label: `Equil. ${Math.round(entry.currentValue)}%`,
    y: clamp(entry.y, chartTop + 12, chartBottom - 8),
  }))
}

export function TrendPanel({ records }: TrendPanelProps) {
  const series = useMemo(() => buildTrendSeries(records), [records])
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])

  if (!series.length || series[0].points.length < 2) {
    return (
      <section className="trend-panel is-empty">
        <div className="trend-empty-state">
          <strong>Tendencia</strong>
          <p>Os dados finalizados dessa liga ainda nao sao suficientes para montar a leitura grafica.</p>
        </div>
      </section>
    )
  }

  const visibleSeries = selectedKeys.length > 0
    ? series.filter((entry) => selectedKeys.includes(entry.key))
    : series

  const chartWidth = 1240
  const chartHeight = 332
  const chartMargin = { top: 12, right: 94, bottom: 28, left: 22 }
  const plotWidth = chartWidth - chartMargin.left - chartMargin.right
  const plotHeight = chartHeight - chartMargin.top - chartMargin.bottom
  const allValues = visibleSeries.flatMap((entry) => entry.points.map((point) => point.value))
  const rawMin = Math.min(...allValues)
  const rawMax = Math.max(...allValues)
  let minValue = clamp(Math.floor((rawMin - 10) / 5) * 5, 0, 100)
  let maxValue = clamp(Math.ceil((rawMax + 10) / 5) * 5, 0, 100)

  if (maxValue - minValue < 40) {
    const missing = 40 - (maxValue - minValue)
    const spread = Math.ceil(missing / 10) * 5
    minValue = clamp(minValue - spread, 0, 100)
    maxValue = clamp(maxValue + spread, 0, 100)
  }

  if (maxValue - minValue < 30) {
    minValue = clamp(minValue - 10, 0, 100)
    maxValue = clamp(maxValue + 10, 0, 100)
  }

  const ticks = buildTicks(minValue, maxValue)
  const xLabels = series[0].points.map((point) => point.timeLabel)
  const activeIndex = hoveredIndex === null ? xLabels.length - 1 : clamp(hoveredIndex, 0, xLabels.length - 1)
  const labelStride = xLabels.length <= 32 ? 1 : 2
  const mapY = (value: number) => chartMargin.top + ((maxValue - value) / Math.max(maxValue - minValue, 1)) * plotHeight
  const activeValues = visibleSeries.map((entry) => entry.points[activeIndex]?.value ?? 0)
  const averageActiveValue = activeValues.reduce((sum, value) => sum + value, 0) / Math.max(activeValues.length, 1)
  const seriesCoordinates = visibleSeries.map((entry) => {
    const points = coordinateMap(
      entry.points.map((point) => point.value),
      plotWidth,
      plotHeight,
      minValue,
      maxValue,
    ).map((point) => ({ x: point.x + chartMargin.left, y: point.y + chartMargin.top }))

    return {
      ...entry,
      coordinates: points,
      currentValue: entry.points[entry.points.length - 1]?.value ?? 0,
    }
  })

  const activeGuideX = seriesCoordinates[0]?.coordinates[activeIndex]?.x ?? chartMargin.left
  const tooltipY = mapY(averageActiveValue)
  const tooltipStyle = {
    left: `${clamp((activeGuideX / chartWidth) * 100, 9, 92)}%`,
    top: `${clamp((tooltipY / chartHeight) * 100, 18, 82)}%`,
    transform: buildTooltipTransform((activeGuideX / chartWidth) * 100, (tooltipY / chartHeight) * 100),
  } as CSSProperties
  const labelPositions = buildLabelPositions(
    seriesCoordinates.map((entry) => ({ color: entry.color, currentValue: entry.currentValue })),
    chartMargin.top,
    chartMargin.top + plotHeight,
    mapY,
  )

  const toggleSeries = (key: string) => {
    setSelectedKeys((current) => {
      if (current.length === 0) {
        return [key]
      }

      if (current.includes(key)) {
        const next = current.filter((item) => item !== key)
        return next.length === 0 ? [] : next
      }

      return trendMarkets.map((market) => market.key).filter((marketKey) => current.includes(marketKey) || marketKey === key)
    })
  }

  return (
    <section className="trend-panel">
      <div className="trend-panel-header">
        <div className="trend-panel-title-row">
          <span className="trend-panel-icon" aria-hidden="true">~</span>
          <div className="trend-panel-title">
            <h3>Analise Grafica de Tendencia</h3>
            <p>Comparacao ao longo do dia</p>
          </div>
        </div>

        <div className="trend-market-chip-row">
          {series.map((entry) => {
            const active = selectedKeys.includes(entry.key)
            return (
              <button
                key={entry.key}
                type="button"
                className={`trend-market-chip ${active ? 'is-active' : ''}`}
                style={{ '--trend-color': entry.color } as CSSProperties}
                aria-pressed={active}
                onClick={() => toggleSeries(entry.key)}
              >
                <span className="trend-market-chip-dot" />
                {entry.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="trend-chart-shell" onMouseLeave={() => setHoveredIndex(null)}>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" className="trend-chart-svg">
          {ticks.map((tick) => {
            const y = mapY(tick)
            return (
              <g key={`tick-${tick}`}>
                <line x1={chartMargin.left} x2={chartMargin.left + plotWidth} y1={y} y2={y} className="trend-grid-line" />
                <text x={chartMargin.left - 4} y={y + 4} textAnchor="end" className="trend-axis-text">{Math.round(tick)}%</text>
              </g>
            )
          })}

          {seriesCoordinates.map((entry) => {
            const equilibriumY = mapY(entry.currentValue)
            return (
              <line
                key={`equilibrium-${entry.key}`}
                x1={chartMargin.left}
                x2={chartMargin.left + plotWidth}
                y1={equilibriumY}
                y2={equilibriumY}
                className="trend-equilibrium-line"
                style={{ '--trend-color': entry.color } as CSSProperties}
              />
            )
          })}

          <line x1={activeGuideX} x2={activeGuideX} y1={chartMargin.top} y2={chartMargin.top + plotHeight} className="trend-guide-line" />

          {seriesCoordinates.map((entry) => (
            <g key={entry.key}>
              <polyline
                points={polylinePoints(entry.coordinates)}
                className="trend-series-line"
                style={{ '--trend-color': entry.color } as CSSProperties}
              />
              {entry.coordinates.map((point, index) => (
                <circle
                  key={`${entry.key}-${xLabels[index]}`}
                  cx={point.x}
                  cy={point.y}
                  r={index === activeIndex ? 3.4 : 2.4}
                  className="trend-series-point"
                  style={{ '--trend-color': entry.color } as CSSProperties}
                />
              ))}
            </g>
          ))}

          {xLabels.map((label, index) => {
            const stepWidth = plotWidth / Math.max(xLabels.length - 1, 1)
            const x = chartMargin.left + index * stepWidth
            const isVisible = index % labelStride === 0 || index === xLabels.length - 1
            return (
              <g key={`${label}-${index}`}>
                <rect
                  x={index === 0 ? chartMargin.left : x - stepWidth / 2}
                  y={chartMargin.top}
                  width={Math.max(pointGapPx, stepWidth)}
                  height={plotHeight}
                  className="trend-hover-zone"
                  onMouseEnter={() => setHoveredIndex(index)}
                />
                {isVisible && (
                  <text x={x} y={chartMargin.top + plotHeight + 18} textAnchor="middle" className={`trend-axis-text ${index === activeIndex ? 'is-active' : ''}`}>
                    {label}
                  </text>
                )}
              </g>
            )
          })}

          {labelPositions.map((label) => (
            <text
              key={`${label.label}-${label.color}`}
              x={chartMargin.left + plotWidth + 10}
              y={label.y}
              className="trend-axis-text is-series"
              style={{ '--trend-color': label.color } as CSSProperties}
            >
              {label.label}
            </text>
          ))}
        </svg>

        <div className="trend-tooltip" style={tooltipStyle}>
          <strong>{xLabels[activeIndex]}</strong>
          <div className="trend-tooltip-list">
            {seriesCoordinates.map((entry) => (
              <div key={`${entry.key}-tooltip`} className="trend-tooltip-row">
                <span className="trend-tooltip-label">
                  <span className="trend-market-chip-dot" style={{ '--trend-color': entry.color } as CSSProperties} />
                  {entry.label}
                </span>
                <strong style={{ color: entry.color }}>{formatTrendValue(entry.points[activeIndex]?.value ?? 0)}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
