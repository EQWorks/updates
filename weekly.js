const { DateTime } = require('luxon')

const {
  sources: { github: { issuesByRange, enrichIssues, ignoreProjects, ignoreBotUsers, formatDigest } },
  targets: { slack: { uploadMD } },
} = require('.')

const { ORG_TZ = 'America/Toronto' } = process.env
const stripMS = (dt) => `${dt.toISO().split('.')[0]}Z`


const weeklyDigest = () => {
  const team = process.argv[2]
  // weekly range in ISO string but drops ms portion
  const yst = DateTime.utc().minus({ day: 1 }).setZone(ORG_TZ, { keepLocalTime: true })
  const lastYst = yst.minus({ week: 1 }).plus({ day: 1 })
  const start = stripMS(lastYst.startOf('day').toUTC())
  const end = stripMS(yst.endOf('day').toUTC())

  issuesByRange({ start, end })
    .then((issues) => issues.filter(ignoreProjects))
    .then((issues) => issues.filter(ignoreBotUsers))
    .then((issues) => enrichIssues({ issues, start, end, team }))
    .then(formatDigest)
    .then(uploadMD())
    .then(console.log)
    .catch(console.error)
}

if (require.main === module) {
  weeklyDigest()
}
