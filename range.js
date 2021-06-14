const { DateTime } = require('luxon')

const { issuesByRange, reposByRange, enrichIssues, enrichRepos, ignoreProjects, ignoreBotUsers, formatDigest } = require('./sources/github')
const { uploadMD } = require('./targets/slack')

const { ORG_TZ = 'America/Toronto' } = process.env
const stripMS = (dt) => `${dt.toISO().split('.')[0]}Z`


const range = () => {
  const date = process.argv[2] || new Date().toISOString()
  const scope = process.argv[3] || 'month'
  // range in ISO string but drops ms portion
  const raw = DateTime.fromISO(date).setZone(ORG_TZ, { keepLocalTime: true })
  const start = stripMS(raw.startOf(scope).toUTC())
  const end = stripMS(raw.endOf(scope).toUTC())

  Promise.all([
    issuesByRange({ start, end })
      .then((issues) => issues.filter(ignoreProjects))
      .then((issues) => issues.filter(ignoreBotUsers))
      .then((issues) => enrichIssues({ issues, start, end })),
    reposByRange({ start, end })
      .then((repos) => repos.filter(ignoreProjects))
      .then((repos) => enrichRepos({ repos })),
  ])
    .then(([issues, repos]) => ({ repos, ...issues }))
    .then(formatDigest)
    .then(uploadMD())
    .then(console.log)
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}

if (require.main === module) {
  range()
}
