const { DateTime } = require('luxon')
const { Octokit } = require('@octokit/core')

const { GITHUB_TOKEN, GITHUB_ORG = 'EQWorks', ORG_TZ = 'America/Toronto' } = process.env
const client = new Octokit({ auth: GITHUB_TOKEN })

const REGEX_PROJ = new RegExp(`https:\/\/github\.com\/${GITHUB_ORG}\/(.*)\/.*/.*`)
const pick = (...ps) => (o) => Object.assign({}, ...ps.map((p) => ({ [p]: o[p] })))

const ISSUE_FIELDS = ['html_url', 'title', 'user', 'state', 'assignees', 'comments', 'created_at', 'updated_at', 'closed_at', 'body', 'project', 'enriched_comments']
const PR_FIELDS = [...ISSUE_FIELDS, 'draft', 'requested_reviewers', 'enriched_reviews', 'enriched_commits']

const searchByRange = ({ endpoint, qualifier = 'updated', options = {} }) => async ({ start, end, per_page = 100 }) => {
  let r = []
  let page = 1
  let pages = -1
  const q = `org:${GITHUB_ORG} ${qualifier}:${start}..${end}`

  while (pages === -1 || (pages > page)) {
    const { data: { total_count = 0, incomplete_results, items = [] } = {} } = await client.request(endpoint, {
      q,
      per_page,
      page,
      ...options,
    }).catch(() => ({}))
    // TODO: do something about incomplete_results
    if (!incomplete_results) {
      //
    }
    pages = Math.ceil(total_count / per_page)
    page += 1
    r = r.concat(items)
  }

  return r
}

module.exports.issuesByRange = searchByRange({ endpoint: 'GET /search/issues', qualifier: 'updated' })

module.exports.commitsByRange = searchByRange({
  endpoint: 'GET /search/commits',
  qualifier: 'committer-date',
  options: {
    mediaType: {
      previews: ['cloak']
    },
  },
})

const before = (end) => (v) => Number(new Date(v.updated_at)) <= Number(new Date(end))

const getIssueEnrichment = (field) => ({
  issues,
  start,
  end,
}) => Promise.all(issues.filter((v) => v.comments).map(
  (v) => client.request({
    url: v[field],
    method: 'GET',
    per_page: 100, // let this be max
    since: start, // matching issue search start, plus the below hack to emulate "in range"
  }).then(({ data }) => data.filter(before(end)))
)).then((data) => data.flat())

const getIssuesComments = getIssueEnrichment('comments_url')

const getPRsReviews = getIssueEnrichment('review_comments_url')

module.exports.ignoreProjects = ({ html_url }) => !html_url.startsWith(`https://github.com/${GITHUB_ORG}/eqworks.github.io`)
  && !html_url.startsWith(`https://github.com/${GITHUB_ORG}/cs-`)

const getPRsCommits = ({ prs, start, end }) => Promise.all(prs.map(
  (pr) => client.request({
    url: pr.commits_url,
    method: 'GET',
    per_page: 100, // let this be max
  }).then(({ data }) => data.filter((r) => {
    // search times
    const _start = DateTime.fromISO(start, { zone: 'UTC' }).startOf('day')
    const _end = DateTime.fromISO(end, { zone: 'UTC' }).startOf('day')
    // PR times
    const updated = DateTime.fromISO(pr.updated_at, { zone: 'UTC' }).startOf('day')
    const created = DateTime.fromISO(pr.created_at, { zone: 'UTC' }).startOf('day')
    const closed = DateTime.fromISO(pr.closed_at, { zone: 'UTC' }).startOf('day')
    // commit time
    const committed = DateTime.fromISO(r.commit.committer.date, { zone: 'UTC' }).startOf('day')
    return ((committed >= _start) && (committed <= _end)) // committed within range
      || [created, committed].map((o) => o.toMillis()).includes(updated.toMillis()) // updated == (created | committed)
      || (pr.state === 'closed') && (closed >= updated) // PR closed and not updated after closing
  }).map((r) => ({ ...r, pull_request_url: pr.pull_request_url })))
)).then((data) => data.flat())

const isPR = (v) => Object.keys(v).includes('pull_request')

module.exports.enrichIssues = async ({ issues, start, end }) => {
  // enrich all (issues and PRs) with issue-level comments
  const comments = await getIssuesComments({ issues, start, end })
  const enrichedIssues = issues.map((issue) => ({
    ...issue,
    project: issue.html_url.match(REGEX_PROJ)[1],
    enriched_comments: comments.filter((v) => v.issue_url === issue.url),
  }))
  // split out pure issues and PRs
  const prs = enrichedIssues.filter(isPR).map((pr) => ({
    ...pr,
    pull_request_url: pr.url.replace('/issues/', '/pulls/'),
    commits_url: `${pr.url.replace('/issues/', '/pulls/')}/commits`,
    review_comments_url: pr.comments_url.replace('/issues/', '/pulls/'),
  }))
  // enrich PRs with commits and review comments
  const [reviews, commits] = await Promise.all([
    getPRsReviews({ issues: prs, start, end }),
    getPRsCommits({ prs, start, end }),
  ])
  const enrichedPRs = prs.map((pr) => ({
    ...pr,
    enriched_reviews: reviews.filter((v) => v.pull_request_url === pr.pull_request_url),
    enriched_commits: commits.filter((v) => v.pull_request_url === pr.pull_request_url),
  }))
  return {
    issues: enrichedIssues.filter((v) => !isPR(v)).map(pick(...PR_FIELDS)),
    prs: enrichedPRs.map(pick(...PR_FIELDS)),
    start,
    end,
  }
}

const isClosed = (i) => i.state === 'closed'

const formatClosed = (i) => {
  const closed = i.filter(isClosed).length
  if (closed) {
    return ` (${closed === i.length ? 'all ' : ''}${closed} ✔️)`
  }
  return ''
}

const formatDates = ({ start, end }) => {
  const _start = DateTime.fromISO(start, { zone: 'UTC' }).setZone(ORG_TZ)
  const _end = DateTime.fromISO(end, { zone: 'UTC' }).setZone(ORG_TZ)
  if (_start.toMillis() === _end.toMillis()) {
    return _start.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)
  }
  if (_start.startOf('year').toMillis() === _end.startOf('year').toMillis()) {
    return `from ${_start.toFormat('ccc, MMM dd')} to ${_end.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)}`
  }
  return `from ${_start.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)} to ${_end.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)}`
}

// format as markdown
module.exports.formatDigest = ({ issues, prs, start, end }) => {
  let content = ''
  if (issues.length) {
    content += `# ${issues.length} Issues updated${formatClosed(issues)}`
    const grouped = {}
    issues.forEach((issue) => {
      grouped[issue.project] = grouped[issue.project] || []
      grouped[issue.project].push(issue)
    })
    Object.entries(grouped).forEach(([project, issues]) => {
      content += `\n\n## ${project}${formatClosed(issues)}\n`
      issues.forEach((issue) => {
        const urlParts = issue.html_url.split('/')
        const number = urlParts[urlParts.length - 1]
        content += `\n* [#${number}](${issue.html_url}) ${issue.title.trim()}`
        const user = issue.user.login
        if (issue.assignees.length) {
          content += ` (c: ${user}, a: ${issue.assignees.map((i) => i.login).join(', ')})`
        } else {
          content += ` (${user})`
        }
        if (issue.state === 'closed') {
          content += ` ✔️`
        }
      })
    })
    content += '\n\n'
  }

  if (prs.length) {
    content += `# ${prs.length} PRs updated${formatClosed(prs)}`
    const grouped = {}
    prs.forEach((pr) => {
      grouped[pr.project] = grouped[pr.project] || []
      grouped[pr.project].push(pr)
    })
    Object.entries(grouped).forEach(([project, prs]) => {
      content += `\n\n## ${project}${formatClosed(prs)}\n`
      prs.forEach((pr) => {
        const urlParts = pr.html_url.split('/')
        const number = urlParts[urlParts.length - 1]
        content += `\n* [#${number}](${pr.html_url}) ${pr.title.trim()}`
        const user = pr.user.login
        if (pr.assignees.length) {
          content += ` (c: ${user}, a: ${pr.assignees.map((i) => i.login).join(', ')})`
        } else {
          content += ` (${user})`
        }
        if (pr.state === 'closed') {
          content += ` ✔️`
        } else if (pr.draft || pr.title.toLowerCase().includes('[wip]')) {
          content += ` ⚠️`
        }
      })
    })
  }

  return { content, title: `Dev Digest - ${formatDates({ start, end })}` }
}
