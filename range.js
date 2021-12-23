const { DateTime } = require('luxon')

const { issuesByRange, reposByRange, enrichIssues, enrichRepos, ignoreProjects, ignoreBotUsers, enrichNLP, formatDigest, formatReleases } = require('./sources/github')
const { getReleases } = require('./sources/github/api')
const { uploadMD } = require('./targets/slack')

const { ORG_TZ = 'America/Toronto' } = process.env
const stripMS = (dt) => `${dt.toISO().split('.')[0]}Z`


const range = async () => {
  const date = process.argv[2] || new Date().toISOString()
  const scope = process.argv[3] || 'month'
  // range in ISO string but drops ms portion
  const raw = DateTime.fromISO(date).setZone(ORG_TZ, { keepLocalTime: true })
  const start = stripMS(raw.startOf(scope).toUTC())
  const end = stripMS(raw.endOf(scope).toUTC())

  const [issues, repos] = await Promise.all([
    issuesByRange({ start, end })
      .then((issues) => issues.filter(ignoreProjects))
      .then((issues) => issues.filter(ignoreBotUsers))
      .then((issues) => enrichIssues({ issues, start, end })),
    reposByRange({ start, end })
      .then((repos) => repos.filter(ignoreProjects))
      .then((repos) => enrichRepos({ repos })),
  ])
  const [enriched, releases] = await Promise.all([
    enrichNLP({ repos, ...issues }),
    getReleases({ repos, start, end }),
  ])
  const post = formatDigest(enriched)
  formatReleases({ post, releases, pre: true }) // mutates post.content with releases
  return uploadMD(post)
}

if (require.main === module) {
  range().then(console.log).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
