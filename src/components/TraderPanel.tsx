import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { CustomSelect } from './CustomSelect'
import { marketLabelMap, oddMatchesBand } from '../lib/ui'
import type { Market, MatchRecord, OddBand, Platform } from '../types'

interface TraderPanelProps {
  currentMarket: Market
  oddBand: OddBand
  platform: Platform
  records: MatchRecord[]
}

type TraderChartSize = 'small' | 'medium' | 'large'
type TraderReferenceKind = 'market' | 'goalsExact' | 'goalsMin'

interface TraderReferenceOption {
  id: string
  kind: TraderReferenceKind
  label: string
  market?: Market
  minGoals?: number
  totalGoals?: number
}

interface TraderParams {
  chartSize: TraderChartSize
  congestionZones: number
  maPeriodFast: number
  maPeriodSlow: number
  macdFast: number
  macdSignalPeriod: number
  macdSlow: number
  rsiPeriod: number
  showCongestion: boolean
  showEquilibrium: boolean
  showMA: boolean
  showMACD: boolean
  showNumbers: boolean
  showRSI: boolean
  showTopBottom: boolean
}

interface TraderPoint {
  dateLabel: string
  isHit: boolean
  macd: number
  macdHist: number
  macdSignal: number
  maFast: number
  maSlow: number
  record: MatchRecord
  rsi: number
  value: number
  windowHits: number
  windowSpan: number
}

interface CongestionBand {
  endIndex: number
  startIndex: number
}

interface ChartPoint {
  x: number
  y: number
}

const defaultWindowSizeByPlatform: Record<Platform, number> = {
  Betano: 20,
  Bet365: 60,
  'Express 365': 60,
  PlayPix: 30,
}
const traderWindowChoices = [20, 30, 50, 60, 80, 100, 120]
const traderChartHeights: Record<TraderChartSize, number> = { small: 240, medium: 300, large: 360 }
const traderMacdHeights: Record<TraderChartSize, number> = { small: 102, medium: 118, large: 136 }
const traderRsiHeights: Record<TraderChartSize, number> = { small: 96, medium: 110, large: 126 }

const baseReferences: TraderReferenceOption[] = [
  { id: 'market:Ambas Marcam Sim', kind: 'market', label: 'Ambas Marcam', market: 'Ambas Marcam Sim' },
  { id: 'market:Ambas Marcam Nao', kind: 'market', label: 'Ambas Nao Marcam', market: 'Ambas Marcam Não' },
  { id: 'market:Over 1.5', kind: 'market', label: 'Over 1.5', market: 'Over 1.5' },
  { id: 'market:Over 2.5', kind: 'market', label: 'Over 2.5', market: 'Over 2.5' },
  { id: 'market:Over 3.5', kind: 'market', label: 'Over 3.5', market: 'Over 3.5' },
  { id: 'market:Over 4.5', kind: 'market', label: 'Over 4.5', market: 'Over 4.5' },
  { id: 'market:Under 1.5', kind: 'market', label: 'Under 1.5', market: 'Under 1.5' },
  { id: 'market:Under 2.5', kind: 'market', label: 'Under 2.5', market: 'Under 2.5' },
  { id: 'market:Under 3.5', kind: 'market', label: 'Under 3.5', market: 'Under 3.5' },
  { id: 'goals:0', kind: 'goalsExact', label: '0 Gols', totalGoals: 0 },
  { id: 'goals:1', kind: 'goalsExact', label: '1 Gol', totalGoals: 1 },
  { id: 'goals:2', kind: 'goalsExact', label: '2 Gols', totalGoals: 2 },
  { id: 'goals:3', kind: 'goalsExact', label: '3 Gols', totalGoals: 3 },
  { id: 'goals:4plus', kind: 'goalsMin', label: '4+ Gols', minGoals: 4 },
]

const initialParams: TraderParams = {
  chartSize: 'large',
  congestionZones: 2,
  maPeriodFast: 9,
  maPeriodSlow: 21,
  macdFast: 12,
  macdSignalPeriod: 9,
  macdSlow: 26,
  rsiPeriod: 14,
  showCongestion: true,
  showEquilibrium: true,
  showMA: true,
  showMACD: true,
  showNumbers: true,
  showRSI: false,
  showTopBottom: true,
}

const normalize = (value: string) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const round2 = (value: number) => Math.round(value * 100) / 100
const roundPercent = (value: number) => Math.round(value)
const formatPercentLabel = (value: number, digits = 0) =>
  digits === 0 ? `${roundPercent(value)}%` : `${round2(value).toFixed(digits)}%`

const parseScorePair = (score: string) => {
  const [home, away] = String(score ?? '').split(/[x-]/i).map(Number)
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null
  return { home, away }
}

const totalGoalsForRecord = (record: MatchRecord) => {
  const parsed = parseScorePair(record.scoreFT)
  return parsed ? parsed.home + parsed.away : null
}

const buildEma = (values: number[], period: number) => {
  if (values.length === 0) return []
  const alpha = 2 / (period + 1)
  const result: number[] = []
  let current = values[0] ?? 50

  values.forEach((value) => {
    current = value * alpha + current * (1 - alpha)
    result.push(round2(current))
  })

  return result
}

const buildRsi = (values: number[], period: number) => {
  if (values.length === 0) return []

  const gains: number[] = [0]
  const losses: number[] = [0]

  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1]
    gains.push(delta > 0 ? delta : 0)
    losses.push(delta < 0 ? Math.abs(delta) : 0)
  }

  let averageGain = gains.slice(1, period + 1).reduce((sum, value) => sum + value, 0) / Math.max(period, 1)
  let averageLoss = losses.slice(1, period + 1).reduce((sum, value) => sum + value, 0) / Math.max(period, 1)

  return values.map((_, index) => {
    if (index === 0) return 50
    if (index < period) {
      const partialGain = gains.slice(1, index + 1).reduce((sum, value) => sum + value, 0) / index
      const partialLoss = losses.slice(1, index + 1).reduce((sum, value) => sum + value, 0) / index
      if (partialLoss === 0) return 100
      const partialRs = partialGain / partialLoss
      return round2(100 - 100 / (1 + partialRs))
    }

    if (index > period) {
      averageGain = ((averageGain * (period - 1)) + gains[index]) / period
      averageLoss = ((averageLoss * (period - 1)) + losses[index]) / period
    }

    if (averageLoss === 0) return 100
    const rs = averageGain / averageLoss
    return round2(100 - 100 / (1 + rs))
  })
}

const buildReferences = (currentMarket: Market) => {
  const exists = baseReferences.some(
    (option) => option.kind === 'market' && normalize(option.market ?? '') === normalize(currentMarket),
  )

  return exists
    ? baseReferences
    : [
        {
          id: `market:${currentMarket}`,
          kind: 'market' as const,
          label: marketLabelMap[currentMarket] ?? currentMarket,
          market: currentMarket,
        },
        ...baseReferences,
      ]
}

const defaultReferenceId = (currentMarket: Market, options: TraderReferenceOption[]) =>
  options.find(
    (option) => option.kind === 'market' && normalize(option.market ?? '') === normalize(currentMarket),
  )?.id ?? options[0]?.id ?? ''

const isReferenceHit = (record: MatchRecord, option: TraderReferenceOption) => {
  if (option.kind === 'market') return Boolean(record.marketResults[option.market ?? ''])
  const totalGoals = totalGoalsForRecord(record)
  if (totalGoals === null) return false
  return option.kind === 'goalsExact' ? totalGoals === option.totalGoals : totalGoals >= (option.minGoals ?? 0)
}

const isEligibleRecord = (record: MatchRecord, option: TraderReferenceOption, oddBand: OddBand) =>
  option.kind !== 'market' || oddMatchesBand(record.odds[option.market ?? ''], oddBand)

const buildSeries = (
  records: MatchRecord[],
  option: TraderReferenceOption,
  oddBand: OddBand,
  windowSize: number,
  params: TraderParams,
) => {
  const ordered = [...records]
    .filter((record) => Boolean(parseScorePair(record.scoreFT)))
    .filter((record) => isEligibleRecord(record, option, oddBand))
    .sort((left, right) => left.timestamp - right.timestamp)

  if (ordered.length === 0) return [] as TraderPoint[]

  const hits: boolean[] = []
  const values: number[] = []
  let rollingHits = 0

  ordered.forEach((record, index) => {
    const hit = isReferenceHit(record, option)
    hits.push(hit)
    if (hit) rollingHits += 1
    if (index >= windowSize && hits[index - windowSize]) rollingHits -= 1
    const windowSpan = Math.min(index + 1, windowSize)
    values.push(roundPercent((rollingHits / windowSpan) * 100))
  })

  const maFast = buildEma(values, params.maPeriodFast)
  const maSlow = buildEma(values, params.maPeriodSlow)
  const rsi = buildRsi(values, params.rsiPeriod)
  const macdFast = buildEma(values, params.macdFast)
  const macdSlow = buildEma(values, params.macdSlow)
  const macd = macdFast.map((value, index) => round2(value - (macdSlow[index] ?? 0)))
  const macdSignal = buildEma(macd, params.macdSignalPeriod)
  const macdHist = macd.map((value, index) => round2(value - (macdSignal[index] ?? 0)))
  const sliceStart = Math.max(0, ordered.length - windowSize * 2)

  return ordered.slice(sliceStart).map((record, visibleIndex) => {
    const absoluteIndex = sliceStart + visibleIndex
    const pointDate = new Date(record.timestamp)
    const windowStart = Math.max(0, absoluteIndex - windowSize + 1)
    let windowHits = 0

    for (let cursor = windowStart; cursor <= absoluteIndex; cursor += 1) {
      if (hits[cursor]) windowHits += 1
    }

    return {
      dateLabel: `${String(pointDate.getUTCHours()).padStart(2, '0')}:${String(pointDate.getUTCMinutes()).padStart(2, '0')}`,
      isHit: hits[absoluteIndex] ?? false,
      macd: macd[absoluteIndex] ?? 0,
      macdHist: macdHist[absoluteIndex] ?? 0,
      macdSignal: macdSignal[absoluteIndex] ?? 0,
      maFast: maFast[absoluteIndex] ?? values[absoluteIndex] ?? 0,
      maSlow: maSlow[absoluteIndex] ?? values[absoluteIndex] ?? 0,
      record,
      rsi: rsi[absoluteIndex] ?? 50,
      value: values[absoluteIndex] ?? 0,
      windowHits,
      windowSpan: Math.min(absoluteIndex + 1, windowSize),
    }
  })
}

const buildCongestionBands = (points: TraderPoint[], zoneCount: number) => {
  if (points.length < 3) return [] as CongestionBand[]

  const differences = points
    .map((point) => Math.abs(point.maFast - point.maSlow))
    .sort((left, right) => left - right)

  const threshold = Math.max(
    1.2,
    differences[Math.max(0, Math.floor(differences.length * 0.35) - 1)] ?? 1.2,
  )

  const bands: CongestionBand[] = []
  let startIndex = -1

  points.forEach((point, index) => {
    const congested = Math.abs(point.maFast - point.maSlow) <= threshold
    if (congested && startIndex === -1) startIndex = index
    if (!congested && startIndex !== -1) {
      if (index - startIndex >= 2) bands.push({ startIndex, endIndex: index - 1 })
      startIndex = -1
    }
  })

  if (startIndex !== -1 && points.length - startIndex >= 2) {
    bands.push({ startIndex, endIndex: points.length - 1 })
  }

  return bands
    .sort((left, right) => right.endIndex - right.startIndex - (left.endIndex - left.startIndex))
    .slice(0, zoneCount)
    .sort((left, right) => left.startIndex - right.startIndex)
}

const buildTicks = (minValue: number, maxValue: number, total = 6) =>
  Array.from({ length: total + 1 }, (_, index) => round2(minValue + ((maxValue - minValue) / total) * index))

const polylinePoints = (points: ChartPoint[]) =>
  points.map((point) => `${round2(point.x)},${round2(point.y)}`).join(' ')

const buildSmoothPath = (points: ChartPoint[]) => {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${round2(points[0].x)} ${round2(points[0].y)}`

  let path = `M ${round2(points[0].x)} ${round2(points[0].y)}`

  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    const midpointX = (current.x + next.x) / 2
    const midpointY = (current.y + next.y) / 2
    path += ` Q ${round2(current.x)} ${round2(current.y)}, ${round2(midpointX)} ${round2(midpointY)}`
  }

  const penultimate = points[points.length - 2]
  const last = points[points.length - 1]
  path += ` Q ${round2(penultimate.x)} ${round2(penultimate.y)}, ${round2(last.x)} ${round2(last.y)}`

  return path
}

const buildSmoothAreaPath = (points: ChartPoint[], baselineY: number) => {
  if (points.length === 0) return ''
  const last = points[points.length - 1]
  const first = points[0]
  return `${buildSmoothPath(points)} L ${round2(last.x)} ${round2(baselineY)} L ${round2(first.x)} ${round2(baselineY)} Z`
}

const coordinateMap = (
  values: number[],
  width: number,
  height: number,
  minValue: number,
  maxValue: number,
) => {
  const span = Math.max(maxValue - minValue, 1)

  return values.map((value, index) => ({
    x: values.length === 1 ? width / 2 : (index / (values.length - 1)) * width,
    y: height - ((value - minValue) / span) * height,
  }))
}

const mainDomain = (points: TraderPoint[]) => {
  const values = points.flatMap((point) => [point.value, point.maFast, point.maSlow])
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const domainMin = clamp(Math.floor((minValue - 5) / 5) * 5, 0, 100)
  const domainMax = clamp(Math.ceil((maxValue + 5) / 5) * 5, 0, 100)

  return domainMax - domainMin >= 20
    ? { min: domainMin, max: domainMax }
    : { min: clamp(domainMin - 10, 0, 100), max: clamp(domainMax + 10, 0, 100) }
}

const macdDomain = (points: TraderPoint[]) => {
  const amplitudes = points.flatMap((point) => [
    Math.abs(point.macd),
    Math.abs(point.macdSignal),
    Math.abs(point.macdHist),
  ])
  const maxAmplitude = Math.max(...amplitudes, 1)
  const limit = Math.ceil((maxAmplitude + 1) * 2) / 2
  return { min: -limit, max: limit }
}

const trendInfo = (point: TraderPoint | undefined) => {
  if (!point) return { label: 'LATERAL', tone: 'is-sideways' }
  const gap = point.maFast - point.maSlow
  if (gap > 1) return { label: 'ALTA', tone: 'is-bullish' }
  if (gap < -1) return { label: 'BAIXA', tone: 'is-bearish' }
  return { label: 'LATERAL', tone: 'is-sideways' }
}

const deltaTone = (value: number) => {
  if (value > 0.25) return 'is-up'
  if (value < -0.25) return 'is-down'
  return 'is-flat'
}

const signedDelta = (value: number) => `${value > 0 ? '+' : ''}${roundPercent(value)}%`

const buildTooltipTransform = (xPercent: number, yPercent: number) => {
  const horizontal = xPercent > 62 ? 'translateX(calc(-100% - 18px))' : 'translateX(18px)'
  const vertical = yPercent < 22 ? 'translateY(18px)' : yPercent > 74 ? 'translateY(calc(-100% - 18px))' : 'translateY(-50%)'
  return `${horizontal} ${vertical}`
}

export function TraderPanel({ currentMarket, oddBand, platform, records }: TraderPanelProps) {
  const references = useMemo(() => buildReferences(currentMarket), [currentMarket])
  const baseWindowSize = defaultWindowSizeByPlatform[platform] ?? 30
  const [windowSize, setWindowSize] = useState(baseWindowSize)
  const [referenceId, setReferenceId] = useState(defaultReferenceId(currentMarket, references))
  const [fixedReference, setFixedReference] = useState(false)
  const [showLegend, setShowLegend] = useState(true)
  const [showParameters, setShowParameters] = useState(false)
  const chartShellRef = useRef<HTMLDivElement | null>(null)
  const [visiblePoints, setVisiblePoints] = useState(baseWindowSize * 2)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [params, setParams] = useState(initialParams)

  useEffect(() => {
    setWindowSize(baseWindowSize)
  }, [baseWindowSize])

  useEffect(() => {
    if (!fixedReference) {
      setReferenceId(defaultReferenceId(currentMarket, references))
    }
  }, [currentMarket, fixedReference, references])

  const reference = references.find((option) => option.id === referenceId) ?? references[0]
  const series = useMemo(
    () => buildSeries(records, reference, oddBand, windowSize, params),
    [oddBand, params, records, reference, windowSize],
  )

  useEffect(() => {
    setVisiblePoints(Math.min(series.length, Math.max(windowSize, windowSize * 2)))
    setHoveredIndex(null)
  }, [series.length, windowSize])

  const plotted = useMemo(
    () => series.slice(-Math.min(series.length, Math.max(visiblePoints, windowSize))),
    [series, visiblePoints, windowSize],
  )

  useEffect(() => {
    setHoveredIndex((current) => {
      if (current === null) return null
      return plotted.length ? Math.min(current, plotted.length - 1) : null
    })
  }, [plotted.length])


  const zoomMin = windowSize
  const zoomMax = Math.max(series.length, windowSize)

  useEffect(() => {
    const chartShell = chartShellRef.current
    if (!chartShell) return undefined

    const handleNativeWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (zoomMax <= zoomMin) return
      const wheelStep = event.shiftKey ? 3 : 1
      setVisiblePoints((current) => clamp((current || zoomMin) + (event.deltaY < 0 ? -wheelStep : wheelStep), zoomMin, zoomMax))
    }

    chartShell.addEventListener('wheel', handleNativeWheel, { passive: false })

    return () => {
      chartShell.removeEventListener('wheel', handleNativeWheel)
    }
  }, [zoomMax, zoomMin])

  if (plotted.length < 2) {
    return (
      <section className="trader-panel is-empty">
        <div className="trader-empty-state">
          <strong>Modo Trader</strong>
          <p>Os dados finalizados dessa liga ainda nao sao suficientes para montar o grafico trader.</p>
        </div>
      </section>
    )
  }

  const currentPoint = plotted[plotted.length - 1]
  const previousPoint = plotted[plotted.length - 2] ?? currentPoint
  const currentTrend = trendInfo(currentPoint)
  const currentDelta = currentPoint.value - previousPoint.value
  const activeIndex = hoveredIndex === null ? plotted.length - 1 : clamp(hoveredIndex, 0, plotted.length - 1)
  const activePoint = plotted[activeIndex] ?? currentPoint
  const activePreviousPoint = plotted[Math.max(0, activeIndex - 1)] ?? activePoint
  const activeDelta = activePoint.value - activePreviousPoint.value
  const top = Math.max(...plotted.map((point) => point.value))
  const bottom = Math.min(...plotted.map((point) => point.value))
  const equilibrium = roundPercent(plotted.reduce((sum, point) => sum + point.value, 0) / plotted.length)
  const chartWidth = 1040
  const chartHeight = traderChartHeights[params.chartSize]
  const chartMargin = { top: 18, right: 72, bottom: 34, left: 18 }
  const plotWidth = chartWidth - chartMargin.left - chartMargin.right
  const plotHeight = chartHeight - chartMargin.top - chartMargin.bottom
  const plotBottomY = chartMargin.top + plotHeight
  const main = mainDomain(plotted)
  const ticks = buildTicks(main.min, main.max)
  const values = coordinateMap(plotted.map((point) => point.value), plotWidth, plotHeight, main.min, main.max)
  const maFast = coordinateMap(plotted.map((point) => point.maFast), plotWidth, plotHeight, main.min, main.max)
  const maSlow = coordinateMap(plotted.map((point) => point.maSlow), plotWidth, plotHeight, main.min, main.max)
  const chartValuePoints = values.map((point) => ({ x: point.x + chartMargin.left, y: point.y + chartMargin.top }))
  const chartFastPoints = maFast.map((point) => ({ x: point.x + chartMargin.left, y: point.y + chartMargin.top }))
  const chartSlowPoints = maSlow.map((point) => ({ x: point.x + chartMargin.left, y: point.y + chartMargin.top }))
  const topY = chartMargin.top + ((main.max - top) / Math.max(main.max - main.min, 1)) * plotHeight
  const bottomY = chartMargin.top + ((main.max - bottom) / Math.max(main.max - main.min, 1)) * plotHeight
  const equilibriumY = chartMargin.top + ((main.max - equilibrium) / Math.max(main.max - main.min, 1)) * plotHeight
  const bands = params.showCongestion ? buildCongestionBands(plotted, params.congestionZones) : []
  const macd = macdDomain(plotted)
  const macdHeight = traderMacdHeights[params.chartSize]
  const macdTop = 10
  const macdPlotHeight = macdHeight - 30
  const macdLine = coordinateMap(plotted.map((point) => point.macd), plotWidth, macdPlotHeight, macd.min, macd.max)
  const macdSignal = coordinateMap(
    plotted.map((point) => point.macdSignal),
    plotWidth,
    macdPlotHeight,
    macd.min,
    macd.max,
  )
  const macdPoints = macdLine.map((point) => ({ x: point.x + chartMargin.left, y: point.y + macdTop }))
  const macdSignalPoints = macdSignal.map((point) => ({ x: point.x + chartMargin.left, y: point.y + macdTop }))
  const macdZero = macdTop + ((macd.max - 0) / Math.max(macd.max - macd.min, 1)) * macdPlotHeight
  const rsiHeight = traderRsiHeights[params.chartSize]
  const rsiTop = 10
  const rsiPlotHeight = rsiHeight - 30
  const rsiTicks = [0, 30, 50, 70, 100]
  const rsiLine = coordinateMap(plotted.map((point) => point.rsi), plotWidth, rsiPlotHeight, 0, 100)
  const rsiPoints = rsiLine.map((point) => ({ x: point.x + chartMargin.left, y: point.y + rsiTop }))
  const rsi30Y = rsiTop + ((100 - 30) / 100) * rsiPlotHeight
  const rsi50Y = rsiTop + ((100 - 50) / 100) * rsiPlotHeight
  const rsi70Y = rsiTop + ((100 - 70) / 100) * rsiPlotHeight
  const activeValuePoint = chartValuePoints[activeIndex] ?? chartValuePoints[chartValuePoints.length - 1]
  const activeFastPoint = chartFastPoints[activeIndex] ?? chartFastPoints[chartFastPoints.length - 1]
  const activeSlowPoint = chartSlowPoints[activeIndex] ?? chartSlowPoints[chartSlowPoints.length - 1]
  const activeRsiPoint = rsiPoints[activeIndex] ?? rsiPoints[rsiPoints.length - 1]
  const labelStride = Math.max(1, Math.ceil(plotted.length / 9))
  const canShowPointLabels = params.showNumbers && plotted.length <= 26
  const tooltipStyle = {
    left: `${clamp((activeValuePoint.x / chartWidth) * 100, 8, 92)}%`,
    top: `${clamp((activeValuePoint.y / chartHeight) * 100, 16, 84)}%`,
    transform: buildTooltipTransform((activeValuePoint.x / chartWidth) * 100, (activeValuePoint.y / chartHeight) * 100),
  } as CSSProperties
  const zoomCount = Math.min(series.length, visiblePoints)
  const matchLabel = `${activePoint.record.homeTeam} x ${activePoint.record.awayTeam}`
  const scoreLabel = activePoint.record.scoreFT || '--'
  const adjustZoom = (delta: number) => {
    setVisiblePoints((current) => clamp((current || zoomMin) + delta, zoomMin, zoomMax))
  }
  const zoomBy = (mode: 'in' | 'out') => {
    adjustZoom(mode === 'in' ? -1 : 1)
  }
  const resetZoom = () => {
    setVisiblePoints(Math.min(series.length, Math.max(windowSize, windowSize * 2)))
  }


  const windowSizeOptions = traderWindowChoices.map((choice) => ({
    label: String(choice),
    value: String(choice),
  }))
  const referenceOptions = references.map((option) => ({
    label: option.label,
    value: option.id,
  }))
  const chartSizeOptions = [
    { label: 'Pequeno', value: 'small' },
    { label: 'Medio', value: 'medium' },
    { label: 'Grande', value: 'large' },
  ]

  return (
    <section className="trader-panel">
      <div className="trader-toolbar">
        <label className="trader-inline-field">
          <span>Qtd. Jogos:</span>
          <CustomSelect
            menuTheme="dark"
            value={String(windowSize)}
            options={windowSizeOptions}
            onChange={(value) => setWindowSize(Number(value))}
          />
        </label>
        <label className="trader-inline-field is-wide">
          <span>Referencia:</span>
          <CustomSelect
            menuTheme="dark"
            value={referenceId}
            options={referenceOptions}
            onChange={(value) => setReferenceId(value)}
          />
        </label>
        <label className="trader-check-field">
          <input type="checkbox" checked={fixedReference} onChange={(event) => setFixedReference(event.target.checked)} />
          <span>Fixa</span>
        </label>
        <button
          type="button"
          className={`trader-mini-button is-legend ${showLegend ? 'is-on' : 'is-off'}`}
          onClick={() => setShowLegend((current) => !current)}
        >
          <span>Legenda:</span>
          <strong>{showLegend ? 'Sim' : 'Nao'}</strong>
        </button>
        <div className="trader-zoom-controls" title="Scroll no grafico ajusta o zoom e duplo clique reseta">
          <button type="button" className="trader-icon-button" onClick={() => zoomBy('in')}>
            -
          </button>
          <span className="trader-zoom-readout">{zoomCount}</span>
          <button type="button" className="trader-icon-button" onClick={() => zoomBy('out')}>
            +
          </button>
        </div>
        <button
          type="button"
          className={`trader-mini-button is-toolbar-action ${showParameters ? 'active' : ''}`}
          onClick={() => setShowParameters((current) => !current)}
        >
          Parametros
        </button>
      </div>

      {showParameters && (
        <div className="trader-params-panel">
          <div className="trader-param-grid">
            <label>
              <input type="checkbox" checked={params.showMA} onChange={(event) => setParams((current) => ({ ...current, showMA: event.target.checked }))} />
              Medias Moveis
            </label>
            <label>
              <input type="checkbox" checked={params.showTopBottom} onChange={(event) => setParams((current) => ({ ...current, showTopBottom: event.target.checked }))} />
              Topo / Fundo
            </label>
            <label>
              <input type="checkbox" checked={params.showEquilibrium} onChange={(event) => setParams((current) => ({ ...current, showEquilibrium: event.target.checked }))} />
              Equilibrio
            </label>
            <label>
              <input type="checkbox" checked={params.showCongestion} onChange={(event) => setParams((current) => ({ ...current, showCongestion: event.target.checked }))} />
              Congestao
            </label>
            <label>
              <input type="checkbox" checked={params.showNumbers} onChange={(event) => setParams((current) => ({ ...current, showNumbers: event.target.checked }))} />
              Numeros
            </label>
            <label>
              <input type="checkbox" checked={params.showMACD} onChange={(event) => setParams((current) => ({ ...current, showMACD: event.target.checked }))} />
              MACD
            </label>
            <label>
              <input type="checkbox" checked={params.showRSI} onChange={(event) => setParams((current) => ({ ...current, showRSI: event.target.checked }))} />
              RSI
            </label>
          </div>
          <div className="trader-input-grid">
            <label>
              <span>MA Rapida</span>
              <input type="number" min={2} max={50} value={params.maPeriodFast} onChange={(event) => setParams((current) => ({ ...current, maPeriodFast: clamp(Number(event.target.value) || 2, 2, 50) }))} />
            </label>
            <label>
              <span>MA Lenta</span>
              <input type="number" min={3} max={80} value={params.maPeriodSlow} onChange={(event) => setParams((current) => ({ ...current, maPeriodSlow: clamp(Number(event.target.value) || 3, 3, 80) }))} />
            </label>
            <label>
              <span>MACD Rapido</span>
              <input type="number" min={2} max={40} value={params.macdFast} onChange={(event) => setParams((current) => ({ ...current, macdFast: clamp(Number(event.target.value) || 2, 2, 40) }))} />
            </label>
            <label>
              <span>MACD Lento</span>
              <input type="number" min={4} max={80} value={params.macdSlow} onChange={(event) => setParams((current) => ({ ...current, macdSlow: clamp(Number(event.target.value) || 4, 4, 80) }))} />
            </label>
            <label>
              <span>Sinal MACD</span>
              <input type="number" min={2} max={40} value={params.macdSignalPeriod} onChange={(event) => setParams((current) => ({ ...current, macdSignalPeriod: clamp(Number(event.target.value) || 2, 2, 40) }))} />
            </label>
            <label>
              <span>Periodo RSI</span>
              <input type="number" min={2} max={40} value={params.rsiPeriod} onChange={(event) => setParams((current) => ({ ...current, rsiPeriod: clamp(Number(event.target.value) || 2, 2, 40) }))} />
            </label>
            <label>
              <span>Zonas</span>
              <input type="number" min={1} max={6} value={params.congestionZones} onChange={(event) => setParams((current) => ({ ...current, congestionZones: clamp(Number(event.target.value) || 1, 1, 6) }))} />
            </label>
            <label>
              <span>Tamanho</span>
              <CustomSelect
                menuTheme="dark"
                value={params.chartSize}
                options={chartSizeOptions}
                onChange={(value) => setParams((current) => ({ ...current, chartSize: value as TraderChartSize }))}
              />
            </label>
          </div>
        </div>
      )}

      <div className="trader-summary-bar">
        <div className={`trader-summary-value ${currentPoint.value > 50 ? 'is-positive' : currentPoint.value < 50 ? 'is-negative' : 'is-neutral'}`}>
          <strong>{formatPercentLabel(currentPoint.value)}</strong>
          <small className={deltaTone(currentDelta)}>{signedDelta(currentDelta)}</small>
        </div>
        <div className={`trader-summary-chip ${currentTrend.tone}`}>{currentTrend.label}</div>
        <div className="trader-summary-stat">
          <span>Acertos</span>
          <strong>{currentPoint.windowHits}/{currentPoint.windowSpan}</strong>
        </div>
        <div className="trader-summary-stat">
          <span>Mercado</span>
          <strong>{reference.label}</strong>
        </div>
        <div className="trader-summary-stat">
          <span>Janela</span>
          <strong>{windowSize} jogos</strong>
        </div>
        {params.showRSI && (
          <div className="trader-summary-stat">
            <span>RSI</span>
            <strong>{formatPercentLabel(currentPoint.rsi, 1)}</strong>
          </div>
        )}
      </div>

      {showLegend && (
        <div className="trader-legend-row">
          <span className="trader-legend-item"><span className="trader-legend-swatch is-line" style={{ '--legend-color': '#ecf3ff' } as CSSProperties} />{reference.label}</span>
          {params.showMA && <span className="trader-legend-item"><span className="trader-legend-swatch is-line" style={{ '--legend-color': '#00c76a' } as CSSProperties} />MA Rapida</span>}
          {params.showMA && <span className="trader-legend-item"><span className="trader-legend-swatch is-line" style={{ '--legend-color': '#ff4d4f' } as CSSProperties} />MA Lenta</span>}
          <span className="trader-legend-item"><span className="trader-legend-swatch is-dot" style={{ '--legend-color': '#22c55e' } as CSSProperties} />Acertou</span>
          <span className="trader-legend-item"><span className="trader-legend-swatch is-dot" style={{ '--legend-color': '#ff5d67' } as CSSProperties} />Errou</span>
          {params.showTopBottom && <span className="trader-legend-item"><span className="trader-legend-swatch is-dashed" style={{ '--legend-color': '#f3d049' } as CSSProperties} />Topo</span>}
          {params.showTopBottom && <span className="trader-legend-item"><span className="trader-legend-swatch is-dashed" style={{ '--legend-color': '#ef4444' } as CSSProperties} />Fundo</span>}
          {params.showEquilibrium && <span className="trader-legend-item"><span className="trader-legend-swatch is-dotted" style={{ '--legend-color': '#16c6ff' } as CSSProperties} />Equilibrio</span>}
          {params.showCongestion && <span className="trader-legend-item"><span className="trader-legend-swatch is-area" style={{ '--legend-color': '#f3d049' } as CSSProperties} />Congestao</span>}
        </div>
      )}

      <div className="trader-visual-stack">
        <div
          ref={chartShellRef}
          className="trader-chart-shell is-interactive"
          onMouseLeave={() => setHoveredIndex(null)}
          onDoubleClick={resetZoom}
        >
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" className="trader-chart-svg">
            {ticks.map((tick) => {
              const y = chartMargin.top + ((main.max - tick) / Math.max(main.max - main.min, 1)) * plotHeight
              return (
                <g key={`tick-${tick}`}>
                  <line x1={chartMargin.left} x2={chartMargin.left + plotWidth} y1={y} y2={y} className="trader-grid-line" />
                  <text x={chartMargin.left + plotWidth + 12} y={y + 4} className="trader-axis-text">{formatPercentLabel(tick)}</text>
                </g>
              )
            })}
            {bands.map((band) => {
              const startX = chartMargin.left + (band.startIndex / Math.max(plotted.length - 1, 1)) * plotWidth
              const endX = chartMargin.left + (band.endIndex / Math.max(plotted.length - 1, 1)) * plotWidth
              return (
                <rect key={`${band.startIndex}-${band.endIndex}`} x={startX} y={chartMargin.top} width={Math.max(18, endX - startX)} height={plotHeight} className="trader-congestion-band" />
              )
            })}
            {params.showTopBottom && <><line x1={chartMargin.left} x2={chartMargin.left + plotWidth} y1={topY} y2={topY} className="trader-top-line" /><text x={chartMargin.left + plotWidth - 4} y={topY - 7} textAnchor="end" className="trader-line-label is-top">Topo {formatPercentLabel(top)}</text><line x1={chartMargin.left} x2={chartMargin.left + plotWidth} y1={bottomY} y2={bottomY} className="trader-bottom-line" /><text x={chartMargin.left + plotWidth - 4} y={bottomY + 14} textAnchor="end" className="trader-line-label is-bottom">Fundo {formatPercentLabel(bottom)}</text></>}
            {params.showEquilibrium && <><line x1={chartMargin.left} x2={chartMargin.left + plotWidth} y1={equilibriumY} y2={equilibriumY} className="trader-equilibrium-line" /><text x={chartMargin.left + plotWidth - 4} y={equilibriumY - 7} textAnchor="end" className="trader-line-label is-equilibrium">Equil. {formatPercentLabel(equilibrium)}</text></>}
            {params.showMA && <path d={buildSmoothAreaPath(chartFastPoints, plotBottomY)} className="trader-area is-ma-fast" />}
            {params.showMA && <path d={buildSmoothPath(chartSlowPoints)} className="trader-line is-ma-slow" />}
            {params.showMA && <path d={buildSmoothPath(chartFastPoints)} className="trader-line is-ma-fast" />}
            <polyline points={polylinePoints(chartValuePoints)} className="trader-line is-value" />
            <line x1={activeValuePoint.x} x2={activeValuePoint.x} y1={chartMargin.top} y2={plotBottomY} className="trader-guide-line" />
            {chartValuePoints.map((point, index) => {
              const previousX = index === 0 ? chartMargin.left : (chartValuePoints[index - 1].x + point.x) / 2
              const nextX = index === chartValuePoints.length - 1 ? chartMargin.left + plotWidth : (point.x + chartValuePoints[index + 1].x) / 2
              return <rect key={`${plotted[index].record.id}-hover`} x={previousX} y={chartMargin.top} width={Math.max(10, nextX - previousX)} height={plotHeight} className="trader-hover-zone" onMouseEnter={() => setHoveredIndex(index)} />
            })}
            {chartValuePoints.map((point, index) => {
              const plottedPoint = plotted[index]
              const isActive = index === activeIndex
              return (
                <g key={`${plottedPoint.record.id}-${plottedPoint.dateLabel}`}>
                  <circle cx={point.x} cy={point.y} r={isActive ? 5.2 : 4} className={plottedPoint.isHit ? 'trader-point is-hit' : 'trader-point is-miss'} />
                  {isActive && <circle cx={point.x} cy={point.y} r={8.5} className="trader-guide-ring is-value" />}
                  {canShowPointLabels && <text x={point.x} y={point.y - 11} textAnchor="middle" className="trader-point-label">{roundPercent(plottedPoint.value)}</text>}
                </g>
              )
            })}
            {params.showMA && <><circle cx={activeFastPoint.x} cy={activeFastPoint.y} r={5.5} className="trader-guide-ring is-ma-fast" /><circle cx={activeSlowPoint.x} cy={activeSlowPoint.y} r={5.5} className="trader-guide-ring is-ma-slow" /></>}
            {plotted.map((point, index) => {
              if (index % labelStride !== 0 && index !== plotted.length - 1) return null
              const x = chartMargin.left + (index / Math.max(plotted.length - 1, 1)) * plotWidth
              return <text key={`${point.record.id}-x`} x={x} y={chartHeight - 7} textAnchor="middle" className={`trader-x-label ${index === activeIndex ? 'is-active' : ''}`}>{point.dateLabel}</text>
            })}
          </svg>

          <div className={`trader-hover-card ${activePoint.isHit ? 'is-hit' : 'is-miss'}`} style={tooltipStyle}>
            <div className="trader-hover-head"><strong>{activePoint.dateLabel}</strong><span>{scoreLabel}</span></div>
            <div className="trader-hover-match">{matchLabel}</div>
            <div className="trader-hover-stats">
              <div className="trader-hover-row"><span>{reference.label}</span><strong>{formatPercentLabel(activePoint.value)}</strong></div>
              <div className="trader-hover-row"><span>MA Rapida</span><strong className="is-fast">{formatPercentLabel(activePoint.maFast, 1)}</strong></div>
              <div className="trader-hover-row"><span>MA Lenta</span><strong className="is-slow">{formatPercentLabel(activePoint.maSlow, 1)}</strong></div>
              <div className="trader-hover-row"><span>MACD</span><strong>{round2(activePoint.macd)}</strong></div>
              <div className="trader-hover-row"><span>RSI</span><strong className="is-rsi">{formatPercentLabel(activePoint.rsi, 1)}</strong></div>
              <div className="trader-hover-row"><span>Delta</span><strong className={deltaTone(activeDelta)}>{signedDelta(activeDelta)}</strong></div>
            </div>
            <div className="trader-hover-footer"><span>Resultado</span><strong className={`trader-hover-badge ${activePoint.isHit ? 'is-hit' : 'is-miss'}`}>{activePoint.isHit ? 'Acerto' : 'Erro'}</strong></div>
          </div>
        </div>

        {params.showMACD && (
          <div className="trader-subchart-shell">
            <div className="trader-subchart-title">MACD</div>
            <svg viewBox={`0 0 ${chartWidth} ${macdHeight}`} preserveAspectRatio="none" className="trader-subchart-svg">
              {buildTicks(macd.min, macd.max, 4).map((tick) => {
                const y = macdTop + ((macd.max - tick) / Math.max(macd.max - macd.min, 1)) * macdPlotHeight
                return (
                  <g key={`macd-${tick}`}>
                    <line x1={chartMargin.left} x2={chartMargin.left + plotWidth} y1={y} y2={y} className="trader-grid-line" />
                    <text x={chartMargin.left + plotWidth + 12} y={y + 4} className="trader-axis-text">{round2(tick)}</text>
                  </g>
                )
              })}
              <line x1={chartMargin.left} x2={chartMargin.left + plotWidth} y1={macdZero} y2={macdZero} className="trader-zero-line" />
              <line x1={activeValuePoint.x} x2={activeValuePoint.x} y1={macdTop} y2={macdTop + macdPlotHeight} className="trader-guide-line" />
              {plotted.map((point, index) => {
                const x = chartMargin.left + (index / Math.max(plotted.length - 1, 1)) * plotWidth
                const barWidth = Math.max(6, plotWidth / Math.max(plotted.length * 1.85, 12))
                const y = macdTop + ((macd.max - Math.max(point.macdHist, 0)) / Math.max(macd.max - macd.min, 1)) * macdPlotHeight
                const negativeY = macdTop + ((macd.max - point.macdHist) / Math.max(macd.max - macd.min, 1)) * macdPlotHeight
                return <rect key={`${point.record.id}-macd`} x={x - barWidth / 2} y={point.macdHist >= 0 ? y : macdZero} width={barWidth} height={Math.max(2, Math.abs((point.macdHist >= 0 ? y : negativeY) - macdZero))} className={point.macdHist >= 0 ? 'trader-macd-bar is-positive' : 'trader-macd-bar is-negative'} />
              })}
              <path d={buildSmoothPath(macdPoints)} className="trader-line is-macd" />
              <path d={buildSmoothPath(macdSignalPoints)} className="trader-line is-macd-signal" />
            </svg>
          </div>
        )}

        {params.showRSI && (
          <div className="trader-subchart-shell">
            <div className="trader-subchart-title">RSI</div>
            <svg viewBox={`0 0 ${chartWidth} ${rsiHeight}`} preserveAspectRatio="none" className="trader-subchart-svg">
              <rect x={chartMargin.left} y={rsi70Y} width={plotWidth} height={Math.max(8, rsi30Y - rsi70Y)} className="trader-rsi-band" />
              {rsiTicks.map((tick) => {
                const y = rsiTop + ((100 - tick) / 100) * rsiPlotHeight
                return (
                  <g key={`rsi-${tick}`}>
                    <line x1={chartMargin.left} x2={chartMargin.left + plotWidth} y1={y} y2={y} className="trader-grid-line" />
                    <text x={chartMargin.left + plotWidth + 12} y={y + 4} className="trader-axis-text">{tick}</text>
                  </g>
                )
              })}
              <line x1={chartMargin.left} x2={chartMargin.left + plotWidth} y1={rsi70Y} y2={rsi70Y} className="trader-rsi-line is-top" />
              <line x1={chartMargin.left} x2={chartMargin.left + plotWidth} y1={rsi50Y} y2={rsi50Y} className="trader-rsi-line is-mid" />
              <line x1={chartMargin.left} x2={chartMargin.left + plotWidth} y1={rsi30Y} y2={rsi30Y} className="trader-rsi-line is-bottom" />
              <line x1={activeValuePoint.x} x2={activeValuePoint.x} y1={rsiTop} y2={rsiTop + rsiPlotHeight} className="trader-guide-line" />
              <path d={buildSmoothPath(rsiPoints)} className="trader-line is-rsi" />
              <circle cx={activeRsiPoint.x} cy={activeRsiPoint.y} r={6} className="trader-guide-ring is-rsi" />
            </svg>
          </div>
        )}
      </div>
    </section>
  )
}




