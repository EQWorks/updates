const { DateTime } = require('luxon')

const { ORG_TZ = 'America/Toronto' } = process.env

const _formatDates = (zone = 'UTC') => ({ start, end }) => {
  const _start = DateTime.fromISO(start, { zone }).setZone(ORG_TZ)
  const _end = DateTime.fromISO(end, { zone }).setZone(ORG_TZ)
  if (_start.startOf('day').toMillis() === _end.startOf('day').toMillis()) {
    return `on ${_start.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)}`
  }
  if (_start.startOf('year').toMillis() === _end.startOf('year').toMillis()) {
    return `${_start.toFormat('ccc, MMM dd')} to ${_end.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)}`
  }
  return `${_start.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)} to ${_end.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)}`
}

module.exports.formatDates = _formatDates() // format UTC dates

module.exports.formatLocalDates = _formatDates
