const { startOfDay } = require('date-fns')
const { Octokit } = require('@octokit/core')

const { GITHUB_TOKEN, GITHUB_ORG = 'EQWorks' } = process.env
const client = new Octokit({ auth: GITHUB_TOKEN })

const searchByRange = ({ endpoint, qualifier = 'updated', options = {} }) => async ({ start, end, per_page = 100 }) => {
  const range = `${qualifier}:${start}..${end}`
  let r = []
  let page = 1
  let pages = 0

  while (!pages || (pages > page)) {
    const { data: { total_count, incomplete_results, items } } = await client.request(endpoint, {
      q: `org:${GITHUB_ORG} ${range}`,
      per_page,
      page,
      ...options,
    })
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

const updatedWithin = ({ start, end }) => (v) => (Number(new Date(v.created_at)) >= Number(new Date(start))) && (Number(new Date(v.updated_at)) <= Number(new Date(end)))

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
  }).then(({ data }) => data.filter(updatedWithin({ start, end })))
)).then((data) => data.flat())

const getIssuesComments = getIssueEnrichment('comments_url')

const getPRsReviews = getIssueEnrichment('review_comments_url')

const getPRsCommits = (prs) => Promise.all(prs.filter((pr) => pr.comments).map(
  (pr) => client.request({
    url: pr.commits_url,
    method: 'GET',
    per_page: 100, // let this be max
  }).then(({ data }) => data.filter((r) => {
    // PR times
    const updated = startOfDay(new Date(pr.updated_at))
    const created = startOfDay(new Date(pr.created_at))
    // commit time
    const committed = startOfDay(new Date(r.commit.committer.date))
    // if not closed
    if (pr.state !== 'closed') {
      return [created, committed].map(Number).includes(Number(updated))
    }
    const closed = startOfDay(new Date(pr.closed_at))
    return Number(committed) === Number(closed) && Number(closed) >= Number(updated)
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
  const reviews = await getPRsReviews({ issues: prs, start, end })
  const commits = await getPRsCommits(prs)
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
