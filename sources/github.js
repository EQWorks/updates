const { DateTime } = require('luxon')
const { Octokit } = require('@octokit/core')

const { GITHUB_TOKEN, GITHUB_ORG = 'EQWorks' } = process.env
const client = new Octokit({ auth: GITHUB_TOKEN })

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

const ignoreProjects = ({ html_url }) => !html_url.startsWith('https://github.com/EQWorks/eqworks.github.io')
  && !html_url.startsWith('https://github.com/EQWorks/cs-')

const getPRsCommits = ({ prs, start, end }) => Promise.all(prs.filter(ignoreProjects).map(
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
    issues: enrichedIssues.filter((v) => !isPR(v)),
    prs: enrichedPRs,
  }
}
