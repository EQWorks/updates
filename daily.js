const { DateTime } = require('luxon')

const {
  sources: { github: { issuesByRange, enrichIssues, ignoreProjects, ignoreBotUsers, formatPreviously } },
  targets: { slack: { uploadMD } },
} = require('.')

const { ORG_TZ = 'America/Toronto' } = process.env
const stripMS = (dt) => `${dt.toISO().split('.')[0]}Z`


const dailyPreviously = () => {
  // last work day in ISO string - ms portion
  const today = DateTime.utc().startOf('day').setZone(ORG_TZ, { keepLocalTime: true })
  const lastYst = today.minus({ days: today.weekday === 1 ? 3 : 1 })
  const yst = today.minus({ day: 1 })
  const start = stripMS(lastYst.startOf('day').toUTC())
  const end = stripMS(yst.endOf('day').toUTC())

  issuesByRange({ start, end })
    .then((issues) => issues.filter(ignoreProjects))
    .then((issues) => issues.filter(ignoreBotUsers))
    .then((issues) => enrichIssues({ issues, start, end }))
    .then(formatPreviously)
    .then(uploadMD())
    .then(console.log)
    .catch(console.error)
}

if (require.main === module) {
  dailyPreviously()
}
