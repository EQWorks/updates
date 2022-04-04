const { DateTime } = require('luxon')

const { ORG_TZ = 'America/Toronto' } = process.env

const _formatDates = (zone = 'UTC') => ({ start, end }) => {
  const _start = DateTime.fromISO(start, { zone }).setZone(ORG_TZ)
  const _end = DateTime.fromISO(end, { zone }).setZone(ORG_TZ)
  const now = DateTime.now()
  // determine status
  let status = 'ongoing'
  if (_end < now) {
    status = 'past'
  } else if (_start > now) {
    status = 'upcoming'
  }
  // determine formatted message
  let message = `${_start.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)} to ${_end.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)}`
  if (_start.startOf('day').toMillis() === _end.startOf('day').toMillis()) {
    message = `on ${_start.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)}`
  } else if (_start.startOf('year').toMillis() === _end.startOf('year').toMillis()) {
    message = `${_start.toFormat('ccc, MMM dd')} to ${_end.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)}`
  }
  return { message, status }
}

module.exports.formatDates = _formatDates() // format UTC dates

module.exports.formatLocalDates = _formatDates
