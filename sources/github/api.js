const { Octokit } = require('@octokit/core')
const { DateTime } = require('luxon')

const { before, isClosed, parseHTMLUrl } = require('./util')

const { GITHUB_TOKEN, GITHUB_ORG = 'EQWorks' } = process.env

const client = new Octokit({ auth: GITHUB_TOKEN })

module.exports.searchByRange = ({ endpoint, qualifier = 'updated', options = {} }) => async ({ start, end, per_page = 100 }) => {
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

module.exports.getIssueEnrichment = (field) => ({
  issues,
  start,
  end,
}) => Promise.all(issues.filter((v) => v.comments).map(
  (v) => client.request({
    url: v[field],
    method: 'GET',
    per_page: 100, // let this be max
    since: start, // matching issue search start, plus the below hack to emulate "in range"
  }).then(({ data }) => data.filter(before(end))),
)).then((data) => data.flat())

module.exports.getIssuesComments = this.getIssueEnrichment('comments_url')

module.exports.getPRsReviews = this.getIssueEnrichment('review_comments_url')

module.exports.getTopics = (key) => (collections) => Promise.all(
  collections.reduce((acc, curr) => {
    if (acc.indexOf(curr[key]) < 0) {
      acc.push(curr[key])
    }
    return acc
  }, []).map((v) => client.request({
    url: `${v}/topics`,
    method: 'GET',
    mediaType: { previews: ['mercy'] },
  }).then(({ data: { names } = {} }) => ({ v, topics: names.filter((n) => n.startsWith('meta-')) }))),
).then((data) => data.flat().filter((v) => v.topics.length > 0).reduce((acc, { v, topics }) => {
  acc[v] = [...(acc[v] || []), ...topics]
  return acc
}, {}))

module.exports.getPRsCommits = ({ prs, start, end }) => Promise.all(prs.map(
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
      || isClosed(pr) && (closed >= updated) // PR closed and not updated after closing
  }).map((r) => ({ ...r, pull_request_url: pr.pull_request_url, pr_html_url: `${pr.html_url}/commits/${r.sha}` }))),
)).then((data) => data.flat())

module.exports.getReleases = async ({ repos, start, end }) => {
  const urls = repos.reduce((acc, curr) => {
    if (acc.indexOf(curr.url) < 0) {
      acc.push(curr.url)
    }
    return acc
  }, [])
  const releases = await Promise.all(urls.map((v => client.request({ url: `${v}/releases` }))))
  const _start = DateTime.fromISO(start, { zone: 'UTC' }).startOf('day')
  const _end = DateTime.fromISO(end, { zone: 'UTC' }).startOf('day')
  return releases
    .map(({ data }) => data)
    .flat() // this would auto filter empty data arrays
    .filter(({ published_at }) => {
      const published = DateTime.fromISO(published_at, { zone: 'UTC' }).startOf('day')
      return ((published >= _start) && (published <= _end))
    }).map((item) => ({ ...item, ...parseHTMLUrl(item) }))
}
