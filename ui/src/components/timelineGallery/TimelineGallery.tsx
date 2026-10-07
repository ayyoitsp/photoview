import React, { useRef, useEffect, useReducer } from 'react'
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
  const loadedStart = useRef(startOffset)
  loadedStart.current = Math.min(loadedStart.current, startOffset)

  const topSentinel = useRef<HTMLDivElement>(null)
  const loadingEarlier = useRef(false)

  // Scrolling down is handled by useScrollPagination, but there is no mirror of
  // it for scrolling up, so after seeking into the middle of the timeline the
  // months above the window could never be reached. Fetch them when the top of
  // the list comes into view.
  useEffect(() => {
    const sentinel = topSentinel.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      async entries => {
        if (!entries.some(e => e.isIntersecting)) return
        if (loadingEarlier.current || loadedStart.current <= 0) return

        loadingEarlier.current = true
        const previous = Math.max(0, loadedStart.current - PAGE_SIZE)

        // Prepending shifts everything down, so pin the scroll to the content
        // that was already on screen instead of letting it jump.
        const heightBefore = document.documentElement.scrollHeight
        const scrollBefore = window.scrollY

        try {
          await fetchMore({ variables: { offset: previous, limit: PAGE_SIZE } })
          loadedStart.current = previous

          requestAnimationFrame(() => {
            const grew = document.documentElement.scrollHeight - heightBefore
            if (grew > 0) window.scrollTo({ top: scrollBefore + grew })
          })
        } finally {
          loadingEarlier.current = false
        }
      },
      { rootMargin: '200px 0px 0px 0px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [fetchMore, startOffset])

  useEffect(() => {
    // The cache indexes media by their absolute offset, so a timeline fetched
    // from the middle is a sparse array: every slot before the fetched window is
    // a hole. Grouping iterates the array directly and reads `.album` off each
    // entry, so a hole throws and nothing renders at all. Drop them and show the
    // window that is actually loaded.
    const loaded = (data?.myTimeline ?? []).filter(Boolean)

    dispatchMedia({
      type: 'replaceTimelineGroups',
      timeline: loaded,
    })
  }, [data])

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
      />
      {/* Watched to pull in the months above the loaded window after a seek. */}
      <div ref={topSentinel} aria-hidden="true" />
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
