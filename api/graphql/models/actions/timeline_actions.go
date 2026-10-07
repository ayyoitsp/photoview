package actions

import (
	"time"

	"github.com/photoview/photoview/api/database/drivers"
	"github.com/photoview/photoview/api/graphql/models"
	"gorm.io/gorm"
)

// timelineScope restricts a media query to the albums the given user can see.
func timelineScope(db *gorm.DB, user *models.User) *gorm.DB {
	return db.
		Joins("JOIN albums ON media.album_id = albums.id").
		Where("albums.id IN (?)", db.Table("user_albums").Select("user_albums.album_id").Where("user_id = ?", user.ID))
}

// onlyFavoritesScope restricts a media query to the user's favorites, when requested.
func onlyFavoritesScope(db *gorm.DB, query *gorm.DB, user *models.User, onlyFavorites *bool) *gorm.DB {
	if onlyFavorites == nil || !*onlyFavorites {
		return query
	}

	return query.Where("media.id IN (?)", db.Table("user_media_data").
		Select("user_media_data.media_id").
		Where("user_media_data.user_id = ?", user.ID).
		Where("user_media_data.favorite"))
}

// timelineDayKey is the day a media belongs to, as the integer YYYYMMDD.
//
// This is the timeline's primary sort key, and MyTimelineIndex returns exactly
// it. Deriving the index from the same expression that orders the timeline is
// what guarantees the index never rises - computing the day separately, in Go,
// let the two disagree around timezone boundaries and produced an index that
// could not be searched.
func timelineDayKey(db *gorm.DB) string {
	switch drivers.GetDatabaseDriverType(db) {
	case drivers.POSTGRES:
		return "CAST(TO_CHAR(media.date_shot, 'YYYYMMDD') AS INTEGER)"
	case drivers.SQLITE:
		return "CAST(strftime('%Y%m%d', media.date_shot) AS INTEGER)"
	default:
		return "CAST(DATE_FORMAT(media.date_shot, '%Y%m%d') AS UNSIGNED)"
	}
}

// timelineOrder applies the timeline's sort: by day, then album, then time
// within the day. MyTimeline and MyTimelineIndex both use it, because an index
// ordered differently from the timeline it indexes would point at the wrong
// media.
func timelineOrder(db *gorm.DB, query *gorm.DB) *gorm.DB {
	const albumsTitleASC = "albums.title ASC"

	timeDESC := "TIME(media.date_shot) DESC"
	if drivers.GetDatabaseDriverType(db) == drivers.POSTGRES {
		timeDESC = "media.date_shot DESC"
	}

	return query.
		Order(timelineDayKey(db) + " DESC").
		Order(albumsTitleASC).
		Order(timeDESC)
}

func MyTimeline(db *gorm.DB, user *models.User, paginate *models.Pagination, onlyFavorites *bool,
	fromDate *time.Time) ([]*models.Media, error) {

	query := timelineOrder(db, timelineScope(db, user))

	if fromDate != nil {
		query = query.Where("media.date_shot < ?", fromDate)
	}

	query = onlyFavoritesScope(db, query, user, onlyFavorites)

	query = models.FormatSQL(query, nil, paginate)

	var media []*models.Media
	if err := query.Find(&media).Error; err != nil {
		return nil, err
	}

	return media, nil
}

// MyTimelineHistogram returns the number of media per calendar month, newest
// month first. It reads only aggregate counts, so it stays cheap even on very
// large libraries, letting a client size a date scrubber without fetching media.
func MyTimelineHistogram(db *gorm.DB, user *models.User,
	onlyFavorites *bool) ([]*models.TimelineHistogramBucket, error) {

	var yearExpr, monthExpr string
	switch drivers.GetDatabaseDriverType(db) {
	case drivers.POSTGRES:
		yearExpr = "EXTRACT(YEAR FROM media.date_shot)"
		monthExpr = "EXTRACT(MONTH FROM media.date_shot)"
	case drivers.SQLITE:
		yearExpr = "CAST(strftime('%Y', media.date_shot) AS INTEGER)"
		monthExpr = "CAST(strftime('%m', media.date_shot) AS INTEGER)"
	default:
		yearExpr = "YEAR(media.date_shot)"
		monthExpr = "MONTH(media.date_shot)"
	}

	query := timelineScope(db, user).
		Model(&models.Media{}).
		Select(yearExpr + " AS year, " + monthExpr + " AS month, COUNT(*) AS count").
		Where("media.date_shot IS NOT NULL")

	query = onlyFavoritesScope(db, query, user, onlyFavorites)

	query = query.
		Group(yearExpr).
		Group(monthExpr).
		Order("year DESC").
		Order("month DESC")

	buckets := []*models.TimelineHistogramBucket{}
	if err := query.Scan(&buckets).Error; err != nil {
		return nil, err
	}

	return buckets, nil
}

// MyTimelineIndex returns the day each media in the timeline was shot, in
// timeline order, as the integer YYYYMMDD.
//
// The index of a day in the result is that media's offset into the timeline, so
// a client holding this can turn any date into an exact page offset and knows
// how long the timeline is, instead of inferring either from what it happens to
// have paged in.
//
// It is the day rather than the timestamp because the day is the timeline's
// actual sort key: within one day media is ordered by album and not by time, so
// raw timestamps rise and fall and cannot be searched. Days only ever descend,
// and because the value here is the very expression the ordering uses, that
// holds by construction rather than by agreement between SQL and Go.
//
// Ordering must match MyTimeline exactly or the offsets point at the wrong
// media, so both derive it from timelineOrder.
func MyTimelineIndex(db *gorm.DB, user *models.User,
	onlyFavorites *bool) ([]int, error) {

	dayKey := timelineDayKey(db)

	query := timelineScope(db, user).
		Model(&models.Media{}).
		Select(dayKey + " AS day")

	query = onlyFavoritesScope(db, query, user, onlyFavorites)
	query = timelineOrder(db, query)

	days := []int{}
	if err := query.Pluck("day", &days).Error; err != nil {
		return nil, err
	}

	return days, nil
}
