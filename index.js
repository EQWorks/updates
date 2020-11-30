const { DateTime } = require('luxon')

const { issuesByRange, enrichIssues } = require('./sources/github')

const { ORG_TZ = 'America/Toronto' } = process.env
const stripMS = (dt) => `${dt.toISO().split('.')[0]}Z`


if (require.main === module) {
  // daily range in ISO string but drops ms portion
  const yst = DateTime.utc().minus({ day: 1 })
  const lastYst = yst.minus({ week: 1 })
  const start = stripMS(lastYst.startOf('day').setZone(ORG_TZ, { keepLocalTime: true }).toUTC())
  const end = stripMS(yst.endOf('day').setZone(ORG_TZ, { keepLocalTime: true }).toUTC())

  issuesByRange({ start, end })
    .then((issues) => enrichIssues({ issues, start, end }))
    .then(JSON.stringify)
    .then(console.log)
    .then(console.error)
}
