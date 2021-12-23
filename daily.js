const { DateTime } = require('luxon')

const { issuesByRange, reposByRange, enrichIssues, enrichRepos, ignoreProjects, ignoreBotUsers, formatPreviously, formatReleases } = require('./sources/github')
const { getReleases } = require('./sources/github/api')
const { getVacays, formatVacays } = require('./sources/asana')
const { getJournals, formatJournals } = require('./sources/notion')
const { uploadMD } = require('./targets/slack')

const { ORG_TZ = 'America/Toronto' } = process.env
const stripMS = (dt) => `${dt.toISO().split('.')[0]}Z`


const dailyPreviously = async () => {
  // last work day in ISO string - ms portion
  const today = DateTime.utc().startOf('day').setZone(ORG_TZ, { keepLocalTime: true })
  const lastYst = today.minus({ days: today.weekday === 1 ? 3 : 1 })
  const yst = today.minus({ day: 1 })
  const start = stripMS(lastYst.startOf('day').toUTC())
  const end = stripMS(yst.endOf('day').toUTC())

  const [issues, repos, vacays, journals] = await Promise.all([
    issuesByRange({ start, end })
      .then((issues) => issues.filter(ignoreProjects))
      .then((issues) => issues.filter(ignoreBotUsers))
      .then((issues) => enrichIssues({ issues, start, end, skipEnrichPRs: false, skipEnrichComments: false })),
    reposByRange({ start, end })
      .then((issues) => issues.filter(ignoreProjects))
      .then((repos) => enrichRepos({ repos })),
    getVacays({ after: today.toISODate(), before: today.endOf('week').toISODate() }),
    getJournals({ start, end, isDaily: true }),
  ])
  const post = formatPreviously({ repos, ...issues })
  const releases = await getReleases({ repos, start, end })
  formatReleases({ post, releases, pre: true }) // mutates post.content with releases
  formatVacays({ post, vacays, pre: true }) // mutates post.content with vacations
  formatJournals({ post, journals }) // mutates post.content with journals
  return uploadMD(post)
}

if (require.main === module) {
  dailyPreviously().then(console.log).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
