import { describe, expect, test } from 'vitest'
import { placeBuckets, bucketAtPosition, offsetForBucket } from './DateScrubber'
import { fromDateParam } from './TimelineGallery'

const buckets = [
  { year: 2026, month: 3, count: 10 },
  { year: 2026, month: 2, count: 70 },
  { year: 2025, month: 12, count: 20 },
]

describe('placeBuckets', () => {
  test('weights offsets by media count, not by bucket', () => {
    const placed = placeBuckets(buckets)

    // 10 / 70 / 20 of 100, laid end to end starting at the newest.
    expect(placed.map(b => b.offset)).toEqual([0, 0.1, 0.8])
    expect(placed.map(b => b.fraction)).toEqual([0.1, 0.7, 0.2])
  })

  test('returns nothing when the timeline is empty', () => {
    expect(placeBuckets([])).toEqual([])
    expect(placeBuckets([{ year: 2026, month: 1, count: 0 }])).toEqual([])
  })
})

describe('bucketAtPosition', () => {
  const placed = placeBuckets(buckets)

  test('maps a position to the bucket covering it', () => {
    expect(bucketAtPosition(placed, 0)).toMatchObject({ year: 2026, month: 3 })
    expect(bucketAtPosition(placed, 0.05)).toMatchObject({ year: 2026, month: 3 })
    // The big month covers most of the track, which is the point.
    expect(bucketAtPosition(placed, 0.5)).toMatchObject({ year: 2026, month: 2 })
    expect(bucketAtPosition(placed, 0.85)).toMatchObject({ year: 2025, month: 12 })
  })

  test('clamps out-of-range positions instead of returning nothing', () => {
    expect(bucketAtPosition(placed, -1)).toMatchObject({ year: 2026, month: 3 })
    expect(bucketAtPosition(placed, 2)).toMatchObject({ year: 2025, month: 12 })
  })

  test('is undefined with no buckets', () => {
    expect(bucketAtPosition([], 0.5)).toBeUndefined()
  })
})

describe('fromDateParam', () => {
  test('keeps the year filter meaning "that year and earlier"', () => {
    expect(fromDateParam('2015')).toBe('2016-01-01T00:00:00Z')
  })

  test('turns a scrubber month into an exclusive upper bound', () => {
    expect(fromDateParam('2015-05')).toBe('2015-06-01T00:00:00Z')
  })

  test('rolls December over to the next year', () => {
    expect(fromDateParam('2015-12')).toBe('2016-01-01T00:00:00Z')
  })

  test('is undefined when no date is set', () => {
    expect(fromDateParam(null)).toBeUndefined()
  })
})

describe('offsetForBucket', () => {
  const placed = placeBuckets(buckets)

  test('counts the media newer than a bucket, which is its page offset', () => {
    // Newest bucket starts the timeline.
    expect(offsetForBucket(placed, placed[0])).toBe(0)
    // 10 newer than the second.
    expect(offsetForBucket(placed, placed[1])).toBe(10)
    // 10 + 70 newer than the third.
    expect(offsetForBucket(placed, placed[2])).toBe(80)
  })
})
