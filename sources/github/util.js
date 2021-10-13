const REGEX_TITLE = /(\[(g2m|wip)\])?(?<trimmed>.*)/i

const isWIP = ({ draft, title }) => draft || title.toLowerCase().includes('[wip]')

module.exports.pick = (...ps) => (o) => Object.assign({}, ...ps.map((p) => ({ [p]: o[p] })))

module.exports.before = (end) => (v) => Number(new Date(v.updated_at)) <= Number(new Date(end))

module.exports.isClosed = ({ state }) => state === 'closed'

module.exports.isPR = (v) => Boolean(v.pull_request)

module.exports.isTeamTopic = (t) => ['meta-data', 'meta-product', 'meta-design', 'meta-mobile'].includes(t)

module.exports.groupByCatProj = (acc, curr) => {
  const { category = 'meta-uncategorized', project } = curr
  const cat = category.substring(5).toUpperCase()
  acc[cat] = acc[cat] || {}
  acc[cat][project] = acc[cat][project] || []
  acc[cat][project].push(curr)
  return acc
}

module.exports.groupByCat = (acc, curr) => {
  const { category = 'meta-uncategorized' } = curr
  const cat = category.substring(5).toUpperCase()
  acc[cat] = acc[cat] || []
  acc[cat].push(curr)
  return acc
}

module.exports.formatAggStates = (i) => {
  let r = ''
  const closed = i.filter(this.isClosed).length
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

module.exports.getID = ({ html_url }) => html_url.split(/\/issues\/|\/pull\//)[1]

const stateIcon = ({ state, draft, title }) => {
  if (this.isClosed({ state })) {
    return '✔️' // done
  }
  if (isWIP({ draft, title })) {
    return '⚠️' // wip
  }
  return '👀' // looking for review/comment
}
const formatUser = (issue) => {
  const { user: { login: creator }, enriched_commits: commits = [] } = issue
  const committers = (commits || []).map(({ author, committer }) => (author || {}).login || (committer || {}).login).filter((c) => c && c !== creator).sort()
  const assignees = issue.assignees.map((i) => i.login).filter((a) => a !== creator).sort()
  const creators = [...new Set(committers), creator].sort()
  if (!assignees.length) {
    return `(${creators.join(', ')})`
  }
  return `(c: ${creators.join(', ')}, a: ${assignees.join(', ')})`
}
module.exports.trimTitle = ({ title }) => ((title.match(REGEX_TITLE).groups || {}).trimmed || title).trim()
const itemLink = (item) => `[${this.isPR(item) ? 'PR' : 'Issue'} #${this.getID(item)}](${item.html_url})`
const composeItem = (item) => [stateIcon(item), itemLink(item), this.trimTitle(item), formatUser(item)]
module.exports.formatItem = (item) => composeItem(item).join(' ')
module.exports.formatSub = (sub) => composeItem(sub).slice(1, 3).join(' ')

const _uniqueUsers = (key) => (items) => Array.from(new Set(items.map((v) => v[key]?.login).filter((v) => v)))
const uniqueUsers = _uniqueUsers('user')
const uniqueAuthors = _uniqueUsers('author')
module.exports.formatUsers = (items) => {
  const users = Array.from(new Set([...uniqueUsers(items), ...uniqueAuthors(items)]))
  return users.length ? ` (${users.join(', ')})` : ''
}

module.exports.formatAggComments = ({ enriched_comments: items }) => {
  const type = items.length === 1 ? 'comment' : 'comments'
  const link = items[0].html_url
  return `[${items.length} ${type}](${link}) -${this.formatUsers(items)}`
}
module.exports.formatAggCommits = ({ enriched_commits: items }) => {
  const type = items.length === 1 ? 'commit' : 'commits'
  const link = items[0].pr_html_url || items[0].html_url
  return `[${items.length} updated ${type}](${link})`
}
module.exports.formatAggReviews = ({ enriched_reviews: items }) => {
  const type = items.length === 1 ? 'review' : 'reviews'
  const link = items[0].html_url
  return `[${items.length} ${type}](${link}) -${this.formatUsers(items)}`
}
