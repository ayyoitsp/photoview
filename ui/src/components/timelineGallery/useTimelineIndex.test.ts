import { describe, expect, test } from 'vitest'
import { offsetForDay, offsetForMonth, dayKey } from './useTimelineIndex'

// Newest first, the order the timeline itself uses, as YYYYMMDD.
const index = [20260310, 20260301, 20260220, 20251231, 20251201]

describe('offsetForDay', () => {
  test('finds the first media on or before the target day', () => {
    expect(offsetForDay(index, 20260310)).toBe(0)
    expect(offsetForDay(index, 20260305)).toBe(1)
    expect(offsetForDay(index, 20260220)).toBe(2)
    expect(offsetForDay(index, 20260101)).toBe(3)
  })

  test('clamps past either end rather than returning nothing', () => {
    expect(offsetForDay(index, 20300101)).toBe(0)
    expect(offsetForDay(index, 19900101)).toBe(index.length)
  })

  test('is empty-safe', () => {
    expect(offsetForDay([], 20260101)).toBe(0)
  })
})

describe('offsetForMonth', () => {
  test('lands on the newest media of the month', () => {
    expect(offsetForMonth(index, 2026, 3)).toBe(0)
    expect(offsetForMonth(index, 2026, 2)).toBe(2)
    expect(offsetForMonth(index, 2025, 12)).toBe(3)
  })

  test('a month holding nothing falls where it belongs', () => {
    // Nothing in Jan 2026; it sits between Feb 2026 and Dec 2025.
    expect(offsetForMonth(index, 2026, 1)).toBe(3)
  })

  test('works for short months, where day 31 does not exist', () => {
    // February never has 31 days, but asking for it must still land on Feb.
    expect(offsetForMonth([20260228, 20260215], 2026, 2)).toBe(0)
  })
})

describe('dayKey', () => {
  test('packs a date into the index form', () => {
    expect(dayKey(2015, 8, 5)).toBe(20150805)
  })
})
