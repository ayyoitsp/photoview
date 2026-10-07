import { useMemo } from 'react'
import { useQuery, gql } from '@apollo/client'

export const MY_TIMELINE_INDEX_QUERY = gql`
  query myTimelineIndex($onlyFavorites: Boolean) {
    myTimelineIndex(onlyFavorites: $onlyFavorites)
  }
`

type TimelineIndexData = {
  /** The day of each media in timeline order, as the integer YYYYMMDD. */
  myTimelineIndex: number[]
}

/** The day a date falls on, in the same YYYYMMDD form the index uses. */
export const dayKey = (year: number, month: number, day: number): number =>
  year * 10000 + month * 100 + day

/**
 * The offset of the first media on or before `day`.
 *
 * The index descends - newest first - so the search looks for the first
 * position that has fallen to or below the target day.
 */
export const offsetForDay = (index: number[], day: number): number => {
  let low = 0
  let high = index.length

  while (low < high) {
    const mid = (low + high) >> 1
    if (index[mid] > day) low = mid + 1
    else high = mid
  }

  return low
}

/** The offset where a calendar month begins, or the end if it holds nothing. */
export const offsetForMonth = (
  index: number[],
  year: number,
  month: number
): number =>
  // The month begins at its newest day, because the timeline runs backwards.
  // 31 stands in for the last day: no real day exceeds it, so this lands on the
  // newest entry of the month whatever its length.
  offsetForDay(index, dayKey(year, month, 31))

export type TimelineIndex = {
  /** Days in timeline order as YYYYMMDD; a day's position is its page offset. */
  days: number[]
  /** How many media the timeline holds in total. */
  total: number
  loading: boolean
  /** Offset of the first media on or before a given YYYYMMDD day. */
  offsetForDay(day: number): number
  /** Offset where a calendar month begins. */
  offsetForMonth(year: number, month: number): number
  /** The day at an offset, or null past the end. */
  dayAtOffset(offset: number): { year: number; month: number; day: number } | null
}

/**
 * Loads the shot date of every media in the timeline, once.
 *
 * This is what lets the timeline be navigated rather than explored: with the
 * whole index in hand, a date maps to an exact offset and the total length is
 * known, so paging never has to be inferred from what happens to be loaded.
 *
 * Days repeat heavily, so it compresses hard: a library of 85000 media is about
 * 13KB on the wire. Apollo holds it for the session.
 */
const useTimelineIndex = (onlyFavorites: boolean): TimelineIndex => {
  const { data, loading } = useQuery<TimelineIndexData>(
    MY_TIMELINE_INDEX_QUERY,
    {
      variables: { onlyFavorites },
      // The index only changes when the library is rescanned, so re-reading it
      // on every mount would be a large request for an answer that has not
      // moved.
      fetchPolicy: 'cache-first',
    }
  )

  const days = data?.myTimelineIndex ?? []

  return useMemo(
    () => ({
      days,
      total: days.length,
      loading,
      offsetForDay: (day: number) => offsetForDay(days, day),
      offsetForMonth: (year: number, month: number) =>
        offsetForMonth(days, year, month),
      dayAtOffset: (offset: number) => {
        if (offset < 0 || offset >= days.length) return null
        const key = days[offset]
        return {
          year: Math.floor(key / 10000),
          month: Math.floor(key / 100) % 100,
          day: key % 100,
        }
      },
    }),
    [days, loading]
  )
}

export default useTimelineIndex
