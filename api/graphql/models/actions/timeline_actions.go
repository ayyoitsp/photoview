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

func MyTimeline(db *gorm.DB, user *models.User, paginate *models.Pagination, onlyFavorites *bool,
	fromDate *time.Time) ([]*models.Media, error) {

	const albumsTitleASC = "albums.title ASC"

	query := timelineScope(db, user)

	switch drivers.GetDatabaseDriverType(db) {
	case drivers.POSTGRES:
		query = query.
			Order("DATE_TRUNC('year', date_shot) DESC").
			Order("DATE_TRUNC('month', date_shot) DESC").
			Order("DATE_TRUNC('day', date_shot) DESC").
			Order(albumsTitleASC).
			Order("media.date_shot DESC")
	case drivers.SQLITE:
		query = query.
			Order("strftime('%Y-%m-%d', media.date_shot) DESC"). // convert to YYYY-MM-DD
			Order(albumsTitleASC).
			Order("TIME(media.date_shot) DESC")
	default:
		query = query.
			Order("YEAR(media.date_shot) DESC").
			Order("MONTH(media.date_shot) DESC").
			Order("DAY(media.date_shot) DESC").
			Order(albumsTitleASC).
			Order("TIME(media.date_shot) DESC")
	}

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
