import React, { useRef, useState, useEffect, useLayoutEffect, useReducer, useCallback } from 'react'
import { useQuery, gql } from '@apollo/client'
import TimelineGroupDate from './TimelineGroupDate'
import PresentView from '../photoGallery/presentView/PresentView'
import useURLParameters from '../../hooks/useURLParameters'
import useScrollPagination from '../../hooks/useScrollPagination'
import PaginateLoader from '../PaginateLoader'
import { useTranslation } from 'react-i18next'
import {
  myTimeline,
  myTimelineVariables,
  myTimeline_myTimeline,
} from './__generated__/myTimeline'
import {
  getActiveTimelineImage as getActiveTimelineMedia,
  timelineGalleryReducer,
} from './timelineGalleryReducer'
import { urlPresentModeSetupHook } from '../photoGallery/mediaGalleryReducer'
import TimelineFilters from './TimelineFilters'
import DateScrubber from './DateScrubber'
import client from '../../apolloClient'

/**
 * Turn the `date` URL parameter into the exclusive upper bound the timeline
 * query wants. This is the dropdown's filter only - the scrubber navigates by
 * offset instead, so that seeking never removes anything from the timeline.
 *
 * `YYYY` means "that year and earlier"; `YYYY-MM` narrows to a month.
 */
export const fromDateParam = (filterDate: string | null): string | undefined => {
  if (!filterDate) return undefined

  const month = filterDate.match(/^(\d{4})-(\d{2})$/)
  if (month) {
    const year = parseInt(month[1])
    const monthIndex = parseInt(month[2])
    // Exclusive bound, so step to the first instant of the following month.
    const nextYear = monthIndex === 12 ? year + 1 : year
    const nextMonth = monthIndex === 12 ? 1 : monthIndex + 1
    return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00Z`
  }

  return `${parseInt(filterDate) + 1}-01-01T00:00:00Z`
}

export const MY_TIMELINE_QUERY = gql`
  query myTimeline(
    $onlyFavorites: Boolean
    $limit: Int
    $offset: Int
    $fromDate: Time
  ) {
    myTimeline(
      onlyFavorites: $onlyFavorites
      fromDate: $fromDate
      paginate: { limit: $limit, offset: $offset }
    ) {
      id
      title
      type
      blurhash
      thumbnail {
        url
        width
        height
      }
      highRes {
        url
        width
        height
      }
      videoWeb {
        url
      }
      favorite
      album {
        id
        title
      }
      date
    }
  }
`

/**
 * Media fetched per request. Larger than it needs to be for one screen so that
 * scrolling has a buffer ahead of it: the loader only fires once the end of the
 * loaded set reaches the viewport, and a small page means that happens often
 * enough to be felt as a stall.
 */
const PAGE_SIZE = 500

/**
 * How close to the top of the loaded window counts as wanting the page above
 * it. Generous so the fetch starts before the top is actually reached.
 */
const UPWARD_LOAD_TRIGGER_PX = 1200

export type TimelineGroup = {
  date: string
  albums: TimelineGroupAlbum[]
}

export type TimelineGroupAlbum = {
  id: string
  title: string
  media: myTimeline_myTimeline[]
}

const TimelineGallery = () => {
  const { t } = useTranslation()

  const { getParam, setParam } = useURLParameters()

  const onlyFavorites = getParam('favorites') == '1' ? true : false
  const setOnlyFavorites = (favorites: boolean) =>
    setParam('favorites', favorites ? '1' : null)

  const filterDate = getParam('date')
  const setFilterDate = (x: string) => setParam('date', x)

  // Where the scrubber has jumped to, as an offset into the timeline. This is
  // deliberately not the date filter: seeking is navigation, so everything
  // newer than the target has to stay in the timeline and stay scrollable.
  const seekOffset = parseInt(getParam('offset') ?? '0') || 0
  const setSeekOffset = (offset: number) =>
    setParam('offset', offset > 0 ? String(offset) : null)

  // Start a page earlier than the target so the months just newer than it are
  // already loaded. Landing exactly on the boundary would put the target at the
  // very top with nothing above it, and scrolling up would show nothing.
  const startOffset = Math.max(0, seekOffset - PAGE_SIZE)

  const favoritesNeedsRefresh = useRef(false)

  const [mediaState, dispatchMedia] = useReducer(timelineGalleryReducer, {
    presenting: false,
    timelineGroups: [],
    activeIndex: {
      date: -1,
      album: -1,
      media: -1,
    },
  })

  const { data, error, loading, refetch, fetchMore } = useQuery<
    myTimeline,
    myTimelineVariables
  >(MY_TIMELINE_QUERY, {
    variables: {
      onlyFavorites,
      fromDate: fromDateParam(filterDate),
      offset: startOffset,
      limit: PAGE_SIZE,
    },
  })

  const { containerElem, finished: finishedLoadingMore } =
    useScrollPagination<myTimeline>({
      loading,
      fetchMore,
      data,
      getItems: data => data.myTimeline,
    })

  // The lowest offset currently held. After a seek this is the start of the
  // loaded window rather than 0, and everything before it is unfetched.
  //
  // It has to follow a seek in both directions. Only ever lowering it meant
  // that once the timeline had been scrolled to the top, loadedStart stayed 0
  // forever, and a later seek into the middle looked to the upward loader like
  // it was already at the newest end - so it never fetched anything above.
  const loadedStart = useRef(startOffset)

  useEffect(() => {
    loadedStart.current = startOffset
    setHasEarlier(startOffset > 0)
  }, [startOffset])

  const loadingEarlier = useRef(false)

  // Where the page stood just before media was prepended above it.
  const anchor = useRef<{ scrollHeight: number; scrollY: number } | null>(null)

  // The loaded window in order, read by the scroll handler to work out which
  // date is on screen without re-deriving it from the grouped tree.
  const loadedMedia = useRef<myTimeline_myTimeline[]>([])

  // Whether anything newer than the loaded window is still unfetched, which is
  // what decides if the button above the timeline is worth showing.
  const [hasEarlier, setHasEarlier] = useState(startOffset > 0)

  // The date of whatever is at the top of the viewport, so the scrubber can
  // show where you are and not only where you are going.
  const [currentDate, setCurrentDate] = useState<string | null>(null)

  // Mirrors the loadingEarlier ref. The ref guards re-entry and must not cause
  // renders; this drives the button, so it must.
  const [loadingEarlierState, setLoadingEarlierState] = useState(false)

  // Scrolling down is handled by useScrollPagination, but it has no counterpart
  // for scrolling up, so after seeking into the middle of the timeline the
  // months above the window could not be reached at all.
  //
  // This is driven by the scroll position rather than an IntersectionObserver.
  // An observer only reports *changes* in intersection: once a page had loaded
  // and the scroll was restored, a sentinel that stayed on screen never fired
  // again and upward paging wedged. Scroll events keep arriving, and the load
  // re-checks itself when it finishes, so it can chain instead of stalling.
  const loadEarlier = useCallback(async (force = false) => {
    if (loadingEarlier.current) return
    if (loadedStart.current <= 0) return
    if (!force && window.scrollY > UPWARD_LOAD_TRIGGER_PX) return

    loadingEarlier.current = true
    setLoadingEarlierState(true)
    const previous = Math.max(0, loadedStart.current - PAGE_SIZE)

    // Note where the page stands now. The correction cannot happen here: React
    // has not committed the new media yet, so the document has not grown and
    // there is nothing to measure.
    anchor.current = {
      scrollHeight: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
    }

    try {
      await fetchMore({ variables: { offset: previous, limit: PAGE_SIZE } })
      loadedStart.current = previous
      setHasEarlier(previous > 0)
    } finally {
      loadingEarlier.current = false
      setLoadingEarlierState(false)
    }
  }, [fetchMore])

  useEffect(() => {
    const onScroll = () => {
      void loadEarlier()

      // Estimate which media is at the top of the viewport from how far down
      // the loaded window the page has scrolled. Approximate - rows vary in
      // height - but enough to put the marker on the right month.
      const media = loadedMedia.current
      if (media.length === 0) return

      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight
      const fraction = scrollable > 0 ? window.scrollY / scrollable : 0
      const index = Math.min(
        media.length - 1,
        Math.max(0, Math.round(fraction * (media.length - 1)))
      )
      setCurrentDate(media[index]?.date ?? null)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [loadEarlier])

  useEffect(() => {
    // The cache indexes media by their absolute offset, so a timeline fetched
    // from the middle is a sparse array: every slot before the fetched window is
    // a hole. Grouping iterates the array directly and reads `.album` off each
    // entry, so a hole throws and nothing renders at all. Drop them and show the
    // window that is actually loaded.
    const loaded = (data?.myTimeline ?? []).filter(Boolean)
    loadedMedia.current = loaded

    dispatchMedia({
      type: 'replaceTimelineGroups',
      timeline: loaded,
    })
  }, [data])

  // Media added above the viewport pushes everything down by its height, which
  // reads as the page snapping away from whatever was being looked at. Put it
  // back by however much the document grew.
  //
  // This runs in a layout effect because that is the first moment the new media
  // is in the DOM, and it is still before the browser paints, so the shift is
  // never seen.
  useLayoutEffect(() => {
    const pending = anchor.current
    if (!pending) return
    anchor.current = null

    const grew = document.documentElement.scrollHeight - pending.scrollHeight
    if (grew > 0) window.scrollTo({ top: pending.scrollY + grew })

    // Still near the top, so the page above this one is wanted as well. Without
    // this the chain stops whenever the restore leaves the viewport in place.
    void loadEarlier()
  }, [mediaState.timelineGroups, loadEarlier])

  useEffect(() => {
    ; (async () => {
      await client.resetStore()
      await refetch({
        onlyFavorites,
        fromDate: fromDateParam(filterDate),
        offset: startOffset,
        limit: PAGE_SIZE,
      })
      // A seek lands mid-timeline, so start the view at the top of what was
      // just loaded rather than wherever the previous scroll position was.
      window.scrollTo({ top: 0 })
    })()
  }, [filterDate, startOffset])

  urlPresentModeSetupHook({
    dispatchMedia,
    openPresentMode: (_event) => {
      dispatchMedia({
        type: 'openPresentMode',
        activeIndex: mediaState.activeIndex,
      })
    },
  })

  useEffect(() => {
    favoritesNeedsRefresh.current = false
    refetch({
      onlyFavorites: onlyFavorites,
    })
  }, [onlyFavorites])

  if (error) {
    return <div>{error.message}</div>
  }

  const timelineGroups = mediaState.timelineGroups.map((_, i) => (
    <TimelineGroupDate
      key={i}
      groupIndex={i}
      mediaState={mediaState}
      dispatchMedia={dispatchMedia}
    />
  ))

  return (
    <div className="overflow-x-hidden">
      <TimelineFilters
        onlyFavorites={onlyFavorites}
        setOnlyFavorites={setOnlyFavorites}
        filterDate={filterDate}
        setFilterDate={setFilterDate}
      />
      <DateScrubber
        onlyFavorites={onlyFavorites}
        onSeek={offset => setSeekOffset(offset)}
        currentDate={currentDate}
      />
      {hasEarlier && (
        <div className="flex justify-center my-3">
          <button
            type="button"
            onClick={() => void loadEarlier(true)}
            disabled={loadingEarlierState}
            className="px-4 py-2 rounded border bg-white dark:bg-dark-bg2 dark:border-dark-border2 text-sm hover:bg-gray-50 dark:hover:bg-dark-bg disabled:opacity-60 flex items-center gap-2"
          >
            {loadingEarlierState && (
              <span
                className="inline-block w-4 h-4 rounded-full animate-spin"
                // Border colours inline: this project builds against Tailwind 2,
                // which has no border-t-transparent, and a spinner with a solid
                // ring does not read as spinning.
                style={{
                  borderWidth: 2,
                  borderStyle: 'solid',
                  borderColor: 'currentColor',
                  borderTopColor: 'transparent',
                }}
                aria-hidden="true"
              />
            )}
            {loadingEarlierState
              ? t('timeline.load_newer_loading', 'Loading newer photos')
              : t('timeline.load_newer', 'Load newer photos')}
          </button>
        </div>
      )}
      <div className="-mx-3 flex flex-wrap" ref={containerElem}>
        {timelineGroups}
      </div>
      <PaginateLoader
        active={!finishedLoadingMore && !loading}
        text={t('general.loading.paginate.media', 'Loading more media')}
      />
      {mediaState.presenting && (
        <PresentView
          activeMedia={getActiveTimelineMedia({ mediaState })!}
          dispatchMedia={dispatchMedia}
        />
      )}
    </div>
  )
}

export default TimelineGallery
