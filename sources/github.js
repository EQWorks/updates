const { DateTime } = require('luxon')
const { Octokit } = require('@octokit/core')

const { GITHUB_TOKEN, GITHUB_ORG = 'EQWorks', ORG_TZ = 'America/Toronto' } = process.env
const client = new Octokit({ auth: GITHUB_TOKEN })

const REGEX_PROJ = new RegExp(`https://github.com/${GITHUB_ORG}/(.*)/.*/.*`)
const REGEX_TITLE = /(\[(g2m|wip)\])?(?<trimmed>.*)/i
const REGEX_LINKED_ISSUES = /(fix|fixed|fixes|close|closes|closed)\s+#(?<issue>\d+)/ig
const pick = (...ps) => (o) => Object.assign({}, ...ps.map((p) => ({ [p]: o[p] })))
const isClosed = ({ state }) => state === 'closed'
const isWIP = ({ draft, title }) => draft || title.toLowerCase().includes('[wip]')

const ISSUE_FIELDS = ['html_url', 'title', 'user', 'state', 'assignees', 'comments', 'created_at', 'updated_at', 'closed_at', 'body', 'project', 'category', 'enriched_comments']
const PR_FIELDS = [...ISSUE_FIELDS, 'linked_issues', 'draft', 'requested_reviewers', 'enriched_reviews', 'enriched_commits']

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
  options: { mediaType: { previews: ['cloak'] } },
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

module.exports.ignoreBotUsers = ({ user: { login } = {} }) => !login.startsWith('dependabot')

const getRepoTopics = (issues) => Promise.all(
  issues.reduce((acc, { repository_url }) => {
    if (acc.indexOf(repository_url) < 0) {
      acc.push(repository_url)
    }
    return acc
  }, []).map((v) => client.request({
    url: `${v}/topics`,
    method: 'GET',
    mediaType: { previews: ['mercy'] },
  }).then(({ data: { names } = {} }) => ({ v, topics: names.filter((n) => n.startsWith('meta-')) })))
).then((data) => data.flat().filter((v) => v.topics.length > 0).reduce((acc, { v, topics }) => {
  acc[v] = [...(acc[v] || []), ...topics]
  return acc
}, {}))

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
      || isClosed(pr) && (closed >= updated) // PR closed and not updated after closing
  }).map((r) => ({ ...r, pull_request_url: pr.pull_request_url })))
)).then((data) => data.flat())

const isPR = (v) => Object.keys(v).includes('pull_request')

module.exports.enrichIssues = async ({ issues, start, end }) => {
  // enrich all (issues and PRs) with issue-level comments
  const [topics, comments] = await Promise.all([
    getRepoTopics(issues),
    getIssuesComments({ issues, start, end }),
  ])
  const enrichedIssues = issues.map((issue) => ({
    ...issue,
    project: issue.html_url.match(REGEX_PROJ)[1],
    category: (topics[issue.repository_url] || [])[0], // strip out "meta-""
    enriched_comments: comments.filter((v) => v.issue_url === issue.url),
  }))
  // split out pure issues and PRs
  const prs = enrichedIssues.filter(isPR).map((pr) => ({
    ...pr,
    linked_issues: Array.from(pr.body.matchAll(REGEX_LINKED_ISSUES)).map((v) => v.groups.issue),
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

const formatDates = ({ start, end }) => {
  const _start = DateTime.fromISO(start, { zone: 'UTC' }).setZone(ORG_TZ)
  const _end = DateTime.fromISO(end, { zone: 'UTC' }).setZone(ORG_TZ)
  if (_start.startOf('day').toMillis() === _end.startOf('day').toMillis()) {
    return `on ${_start.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)}`
  }
  if (_start.startOf('year').toMillis() === _end.startOf('year').toMillis()) {
    return `from ${_start.toFormat('ccc, MMM dd')} to ${_end.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)}`
  }
  return `from ${_start.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)} to ${_end.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)}`
}

const groupByCatProj = (acc, curr) => {
  const { category = 'meta-uncategorized', project } = curr
  const cat = category.substring(5).toUpperCase()
  acc[cat] = acc[cat] || {}
  acc[cat][project] = acc[cat][project] || []
  acc[cat][project].push(curr)
  return acc
}

const stateIcon = ({ state, draft, title }) => {
  if (isClosed({ state })) {
    return '✔️' // done
  }
  if (isWIP({ draft, title })) {
    return '⚠️' // wip
  }
  return '👀' // looking for review/comment
}

const formatAggStates = (i) => {
  let r = ''
  const closed = i.filter(isClosed).length
  if (i.length === closed.length) {
    return ' (all done ✔️)'
  }
  if (closed) {
    r += `\n✔️ Done: ${closed}`
  }
  const wip = i.filter(isWIP).length
  if (wip) {
    r += `\n⚠️ WIP: ${wip}`
  }
  const rest = i.length - closed - wip
  if (rest > 0) {
    r += `\n👀 Needs review: ${rest}`
  }
  return r
}

const formatUser = (issue) => {
  const { user: { login: creator } } = issue
  const assignees = issue.assignees.map((i) => i.login).filter((a) => a !== creator)
  if (!assignees.length) {
    return `(${creator})`
  }
  return `(c: ${creator}, a: ${issue.assignees.map((i) => i.login).join(', ')})`
}

const trimTitle = ({ title }) => ((title.match(REGEX_TITLE).groups || {}).trimmed || title).trim()

const getID = ({ html_url }) => html_url.split(/\/issues\/|\/pull\//)[1]

const composeItem = (item) => [stateIcon(item), `[#${getID(item)}](${item.html_url})`, trimTitle(item), formatUser(item)]
const formatItem = (item) => composeItem(item).join(' ')
const formatSub = (sub) => composeItem(sub).slice(1, 3).join(' ')

module.exports.formatDigest = ({ issues, prs, start, end }) => {
  const allLinked = prs.map((pr) => pr.linked_issues).flat()
  const all = [
    ...issues.filter((issue) => !allLinked.includes(getID(issue))),
    ...prs,
  ]
  let content = ''

  if (all.length) {
    content += `${all.length} updates${formatAggStates(all)}`
    const grouped = all.reduce(groupByCatProj, {})
    Object.entries(grouped).forEach(([category, byProjects]) => {
      content += `\n\n# ${category}\n`
      Object.entries(byProjects).forEach(([project, items]) => {
        content += `\n## ${project}`
        items.forEach((item) => {
          content += `\n* ${formatItem(item)}`
          ;(item.linked_issues || []).forEach((id) => {
            const sub = issues.find((i) => getID(i) === id)
            if (sub) {
              content += `\n    * ${formatSub(sub)}`
            }
          })
        })
      })
    })
  }

  return { content, title: `Dev Digest - ${formatDates({ start, end })}` }
}

const formatAggComments = ({ enriched_comments: items }) => {
  const type = items.length === 1 ? 'comment' : 'comments'
  const users = Array.from(new Set(items.map(({ user }) => user.login).filter((v) => v)))
  const links = items.map(({ html_url }) => `[${html_url.split('#issuecomment-')[1]}](${html_url})`)
  return `${items.length} ${type}${users.size ? ` by ${users.join(', ')}` : ''} (${links.join(', ')})`
}
const formatAggCommits = ({ enriched_commits: items }) => {
  const type = items.length === 1 ? 'commit' : 'commits'
  const users = Array.from(new Set(items.map(({ author }) => author?.login).filter((v) => v)))
  const links = items.map(({ html_url, sha }) => `[${sha.slice(0, 7)}](${html_url})`)
  return `${items.length} ${type}${users.size ? ` by ${users.join(', ')}` : ''} (${links.join(', ')})`
}
const formatAggReviews = ({ enriched_reviews: items }) => {
  const type = items.length === 1 ? 'review' : 'reviews'
  const users = Array.from(new Set(items.map(({ user }) => user.login).filter((v) => v)))
  const links = items.map(({ html_url }) => `[${html_url.split('#discussion_')[1]}](${html_url})`)
  return `${items.length} ${type}${users.size ? ` by ${users.join(', ')}` : ''} (${links.join(', ')})`
}

module.exports.formatPreviously = ({ issues, prs, start, end }) => {
  const allLinked = prs.map((pr) => pr.linked_issues).flat()
  const all = [
    ...issues.filter((issue) => !allLinked.includes(getID(issue))),
    ...prs,
  ]
  let content = ''

  if (all.length) {
    content += `${all.length} updates${formatAggStates(all)}`
    const grouped = all.reduce(groupByCatProj, {})
    Object.entries(grouped).forEach(([category, byProjects]) => {
      content += `\n\n# ${category}\n`
      Object.entries(byProjects).forEach(([project, items]) => {
        content += `\n## ${project}`
        items.forEach((item) => {
          content += `\n* ${formatItem(item)}`
          ;(item.linked_issues || []).forEach((id) => {
            const sub = issues.find((i) => getID(i) === id)
            if (sub) {
              content += `\n    * ${formatSub(sub)}`
              if (sub.enriched_comments.length) {
                content += `\n        * ${formatAggComments(sub)}`
              }
            }
          })
          if (item.enriched_comments.length) {
            content += `\n    * ${formatAggComments(item)}`
          }
          if (item.enriched_reviews.length) {
            content += `\n    * ${formatAggReviews(item)}`
          }
          if (item.enriched_commits.length) {
            content += `\n    * ${formatAggCommits(item)}`
          }
        })
      })
    })
  }

  return { content, title: `Previously ${formatDates({ start, end })}` }
}
