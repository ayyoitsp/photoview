import React, { useMemo, useRef, useState } from 'react'
import { useQuery, gql } from '@apollo/client'

export const MY_TIMELINE_HISTOGRAM_QUERY = gql`
  query myTimelineHistogram($onlyFavorites: Boolean) {
    myTimelineHistogram(onlyFavorites: $onlyFavorites) {
      year
      month
      count
    }
  }
`

type HistogramBucket = {
  year: number
  month: number
  count: number
}

type HistogramData = {
  myTimelineHistogram: HistogramBucket[]
}

/**
 * A bucket placed along the scrubber track. `offset` is where the bucket starts
 * as a fraction of the whole timeline, weighted by how many media it holds, so
 * a month with 2000 photos takes more of the track than one with 3. That
 * matches how far you have to scroll to reach it.
 */
type PlacedBucket = HistogramBucket & {
  offset: number
  fraction: number
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export const placeBuckets = (buckets: HistogramBucket[]): PlacedBucket[] => {
  const total = buckets.reduce((sum, b) => sum + b.count, 0)
  if (total === 0) return []

  let running = 0
  return buckets.map(b => {
    const placed = {
      ...b,
      offset: running / total,
      fraction: b.count / total,
    }
    running += b.count
    return placed
  })
}

/** The bucket covering a position along the track, 0 at the newest end. */
export const bucketAtPosition = (
  placed: PlacedBucket[],
  position: number
): PlacedBucket | undefined => {
  if (placed.length === 0) return undefined

  const clamped = Math.min(Math.max(position, 0), 0.999999)
  // Buckets are contiguous and ordered newest first, so the match is the last
  // one that starts at or before the position.
  for (let i = placed.length - 1; i >= 0; i--) {
    if (placed[i].offset <= clamped) return placed[i]
  }
  return placed[0]
}

type DateScrubberProps = {
  onlyFavorites: boolean
  /** Called with a `YYYY-MM` string to jump the timeline to that month. */
  onSeek(yearMonth: string): void
}

/**
 * A vertical date scrubber for the timeline, in the spirit of Google Photos.
 *
 * It reads only the per-month histogram rather than the media themselves, so it
 * knows the shape of the whole timeline without paging through it. That is what
 * lets you jump straight to a month instead of scrolling until it loads.
 */
const DateScrubber = ({ onlyFavorites, onSeek }: DateScrubberProps) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ bucket: PlacedBucket; y: number } | null>(
    null
  )

  const { data } = useQuery<HistogramData>(MY_TIMELINE_HISTOGRAM_QUERY, {
    variables: { onlyFavorites },
  })

  const placed = useMemo(
    () => placeBuckets(data?.myTimelineHistogram ?? []),
    [data]
  )

  // One label per year, at the position where that year begins.
  const yearLabels = useMemo(() => {
    const seen = new Set<number>()
    return placed.filter(b => {
      if (seen.has(b.year)) return false
      seen.add(b.year)
      return true
    })
  }, [placed])

  if (placed.length === 0) return null

  const positionFromY = (clientY: number) => {
    const track = trackRef.current
    if (!track) return 0
    const rect = track.getBoundingClientRect()
    return (clientY - rect.top) / rect.height
  }

  const bucketFromY = (clientY: number) => bucketAtPosition(placed, positionFromY(clientY))

  const seekTo = (bucket: PlacedBucket) =>
    onSeek(`${bucket.year}-${String(bucket.month).padStart(2, '0')}`)

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const bucket = bucketFromY(event.clientY)
    if (bucket) setHover({ bucket, y: event.clientY })
  }

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const bucket = bucketFromY(event.clientY)
    if (bucket) seekTo(bucket)
  }

  // Touch drags the thumb and seeks on release, rather than seeking on every
  // move: refetching the timeline under a moving finger would make the scrubber
  // fight the drag.
  const handleTouch = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    if (!touch) return
    const bucket = bucketFromY(touch.clientY)
    if (bucket) setHover({ bucket, y: touch.clientY })
  }

  const handleTouchEnd = () => {
    if (hover) seekTo(hover.bucket)
    setHover(null)
  }

  return (
    <div
      className="fixed right-0 top-[120px] bottom-4 w-14 z-10 select-none"
      data-testid="date-scrubber"
    >
      <div
        ref={trackRef}
        className="relative h-full cursor-pointer"
        // Inline rather than a utility class: the project's Tailwind build may
        // not ship touch-action utilities, and without this a vertical drag
        // scrolls the page instead of moving the thumb.
        style={{ touchAction: 'none' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
        onClick={handleClick}
        onTouchStart={handleTouch}
        onTouchMove={handleTouch}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => setHover(null)}
        role="slider"
        aria-label="Jump to date"
        aria-valuemin={0}
        aria-valuemax={placed.length - 1}
        aria-valuenow={0}
        tabIndex={0}
      >
        {/* the track itself */}
        <div className="absolute right-5 top-0 bottom-0 w-px bg-gray-300 dark:bg-gray-600" />

        {yearLabels.map(bucket => (
          <div
            key={`${bucket.year}-${bucket.month}`}
            className="absolute right-3 flex items-center gap-1 -translate-y-1/2 pointer-events-none"
            style={{ top: `${bucket.offset * 100}%` }}
          >
            <span className="text-[11px] leading-none text-gray-500 dark:text-gray-400 tabular-nums">
              {bucket.year}
            </span>
            <span className="w-2 h-px bg-gray-400 dark:bg-gray-500" />
          </div>
        ))}

        {hover && (
          <div
            className="fixed right-16 -translate-y-1/2 px-2 py-1 rounded bg-gray-900 text-white text-xs whitespace-nowrap shadow-lg pointer-events-none"
            style={{ top: hover.y }}
          >
            {MONTH_NAMES[hover.bucket.month - 1]} {hover.bucket.year}
            <span className="ml-2 opacity-60 tabular-nums">
              {hover.bucket.count}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export default DateScrubber
