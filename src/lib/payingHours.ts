interface PayingMatrixCell {
  averageOdd?: number | null
  greens: number
  minuteSlot: number
  total: number
}

interface PayingMatrixRow {
  cells: PayingMatrixCell[]
}

export interface PayingColumnSummary {
  averageOdd: number | null
  greens: number
  minuteSlot: number
  rate: number
  total: number
}

export const payingHourMinimumRate = 0.5

export const buildPayingColumnSummaries = (rows: PayingMatrixRow[]): PayingColumnSummary[] =>
  rows[0]?.cells.map((cell) => {
    const matchingCells = rows.map((row) =>
      row.cells.find((entry) => entry.minuteSlot === cell.minuteSlot),
    )
    const greens = matchingCells.reduce((sum, entry) => sum + (entry?.greens ?? 0), 0)
    const total = matchingCells.reduce((sum, entry) => sum + (entry?.total ?? 0), 0)
    const oddWeight = matchingCells.reduce((sum, entry) => sum + (entry?.total ?? 0), 0)
    const oddSum = matchingCells.reduce(
      (sum, entry) => sum + ((entry?.averageOdd ?? 0) * (entry?.total ?? 0)),
      0,
    )
    const averageOdd = oddWeight > 0 ? oddSum / oddWeight : cell.averageOdd ?? null

    return {
      averageOdd,
      greens,
      minuteSlot: cell.minuteSlot,
      rate: total ? greens / total : 0,
      total,
    }
  }) ?? []

export const isPayingHourColumn = (summary: PayingColumnSummary | undefined) =>
  Boolean(summary && summary.total > 0 && summary.rate >= payingHourMinimumRate)

export const buildPayingHourSlots = (summaries: PayingColumnSummary[], minimumRunLength = 3) => {
  const slots = new Set<number>()
  let currentRun: PayingColumnSummary[] = []

  const commitRun = () => {
    if (currentRun.length >= minimumRunLength) {
      currentRun.forEach((summary) => slots.add(summary.minuteSlot))
    }

    currentRun = []
  }

  summaries.forEach((summary) => {
    if (isPayingHourColumn(summary)) {
      currentRun.push(summary)
      return
    }

    commitRun()
  })

  commitRun()

  return slots
}

export const countPayingHourSlots = (summaries: PayingColumnSummary[]) =>
  buildPayingHourSlots(summaries).size
