const { DateTime } = require('luxon')

const { issuesByRange, reposByRange, enrichIssues, enrichRepos, ignoreProjects, ignoreBotUsers, formatPreviously } = require('./sources/github')
const { getVacays, formatVacays } = require('./sources/asana')
const { getJournals, formatJournals } = require('./sources/notion')
const { uploadMD } = require('./targets/slack')

const { ORG_TZ = 'America/Toronto' } = process.env
const stripMS = (dt) => `${dt.toISO().split('.')[0]}Z`


const dailyPreviously = () => {
  // last work day in ISO string - ms portion
  const today = DateTime.utc().startOf('day').setZone(ORG_TZ, { keepLocalTime: true })
  const lastYst = today.minus({ days: today.weekday === 1 ? 3 : 1 })
  const yst = today.minus({ day: 1 })
  const start = stripMS(lastYst.startOf('day').toUTC())
  const end = stripMS(yst.endOf('day').toUTC())

  Promise.all([
    issuesByRange({ start, end })
      .then((issues) => issues.filter(ignoreProjects))
      .then((issues) => issues.filter(ignoreBotUsers))
      .then((issues) => enrichIssues({ issues, start, end, skipEnrichPRs: false, skipEnrichComments: false })),
    reposByRange({ start, end })
      .then((issues) => issues.filter(ignoreProjects))
      .then((repos) => enrichRepos({ repos })),
    getVacays({ after: today.toISODate(), before: today.endOf('week').toISODate() }),
    getJournals({ start }),
  ]).then(([issues, repos, vacays, journals]) => {
    const post = formatPreviously({ repos, ...issues })
    const vPost = formatVacays({ post, vacays })
    return formatJournals({ post: vPost, journals })
  }).then(uploadMD()).then(console.log).catch(console.error)
}

if (require.main === module) {
  dailyPreviously()
}
