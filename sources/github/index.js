const { parseRaw } = require('@eqworks/release')

const { searchByRange, getIssuesComments, getPRsReviews, getTopics, getPRsCommits } = require('./api')
const { pick, trimTitle, isPR, isTeamTopic, groupByCatProj, groupByCat, groupByProj, formatAggStates, getID, formatUsers, formatItem, formatSub, formatAggComments, formatAggCommits, formatAggReviews, isClosed } = require('./util')
const { formatDates } = require('../util')
const { parseHTMLUrl } = require('./util')

const { GITHUB_ORG = 'EQWorks' } = process.env

const REGEX_LINKED_ISSUES = /(fix|fixed|fixes|close|closes|closed)\s+#(?<issue>\d+)/ig
const ISSUE_FIELDS = ['html_url', 'title', 'user', 'state', 'assignees', 'comments', 'created_at', 'updated_at', 'closed_at', 'body', 'project', 'team', 'category', 'enriched_comments']
const PR_FIELDS = [...ISSUE_FIELDS, 'pull_request', 'linked_issues', 'draft', 'requested_reviewers', 'enriched_reviews', 'enriched_commits', 'commit_label']

const getIssueTopics = getTopics('repository_url')
const getRepoTopics = getTopics('url')

module.exports.issuesByRange = searchByRange({ endpoint: 'GET /search/issues', qualifier: 'updated' })
module.exports.reposByRange = searchByRange({ endpoint: 'GET /search/repositories', qualifier: 'pushed' })

module.exports.ignoreProjects = ({ html_url }) =>
  !html_url.startsWith(`https://github.com/${GITHUB_ORG}/eqworks.github.io`) // EQ website repo
  && !html_url.startsWith(`https://github.com/${GITHUB_ORG}/cs-`) // CS repos
  && !html_url.startsWith(`https://github.com/${GITHUB_ORG}/swarm-`) // swarm repos
  && !html_url.startsWith(`https://github.com/${GITHUB_ORG}/swarm2-`) // swarm repos

module.exports.ignoreBotUsers = ({ user: { login } = {} }) => !login.startsWith('dependabot')

const enrichPRs = async ({ prs, start, end }) => {
  // enrich PRs with commits and review comments
  const [reviews, commits] = await Promise.all([
    getPRsReviews({ issues: prs, start, end }),
    getPRsCommits({ prs, start, end }),
  ])
  return prs.map((pr) => ({
    ...pr,
    enriched_reviews: reviews.filter((v) => v.pull_request_url === pr.pull_request_url),
    enriched_commits: commits.filter((v) => v.pull_request_url === pr.pull_request_url),
  }))
}

module.exports.enrichIssues = async ({ issues: _issues, start, end, team, skipEnrichComments = true, skipEnrichPRs = true }) => {
  // filter stale PRs likely being deleted after being closed for a while
  // TODO: resort to a more reliable way to detect stale PRs
  const issues = _issues.filter((v) => !v.closed_at || v.closed_at.split('T')[0] >= v.updated_at.split('T')[0])
  // enrich topics per issue's repo
  const topics = await getIssueTopics(issues)
  // optionally enrich all (issues and PRs) with issue-level comments
  const comments = skipEnrichComments ? [] : await getIssuesComments({ issues, start, end })
  const enrichedIssues = issues.map((issue) => {
    // parse team and category from repo topics
    const repoTopics = (topics[issue.repository_url] || [])
    const teamTopics = repoTopics.filter(isTeamTopic)
    const team = [0, 2].includes(teamTopics.length) ? undefined : teamTopics[0].substring(5)
    const category = repoTopics.filter((t) => !isTeamTopic(t))[0]
    return {
      ...issue,
      ...parseHTMLUrl(issue),
      team,
      category,
      enriched_comments: comments.filter((v) => v.issue_url === issue.url),
    }
  }).filter(({ team: t }) => !team || !t || (t.toLowerCase() === team.toLowerCase()))
  // split out pure issues and PRs
  const prs = enrichedIssues.filter(isPR).map((pr) => ({
    ...pr,
    linked_issues: Array.from((pr.body || '').matchAll(REGEX_LINKED_ISSUES)).map((v) => v.groups.issue),
    pull_request_url: pr.url.replace('/issues/', '/pulls/'),
    commits_url: `${pr.url.replace('/issues/', '/pulls/')}/commits`,
    review_comments_url: pr.comments_url.replace('/issues/', '/pulls/'),
  }))
  // optionally enrich PRs
  const enrichedPRs = skipEnrichPRs ? prs : await enrichPRs({ prs, start, end })
  return {
    issues: enrichedIssues.filter((v) => !isPR(v)).map(pick(...PR_FIELDS)),
    prs: enrichedPRs.map(pick(...PR_FIELDS)),
    start,
    end,
    team,
  }
}

module.exports.enrichRepos = async ({ repos, team }) => {
  const topics = await getRepoTopics(repos)
  return repos.map((repo) => {
    // parse team and category from repo topics
    const repoTopics = (topics[repo.url] || [])
    const teamTopics = repoTopics.filter(isTeamTopic)
    const team = [0, 2].includes(teamTopics.length) ? undefined : teamTopics[0].substring(5)
    const category = repoTopics.filter((t) => !isTeamTopic(t))[0]
    return {
      ...repo,
      team,
      category,
    }
  }).filter(({ team: t }) => !team || !t || (t.toLowerCase() === team.toLowerCase()))
}

const formatLoneRepos = ({ all, repos }) => {
  let content = ''
  const issueProjects = new Set(all.map(({ project }) => project))
  const loneRepos = repos.filter(({ name }) => !issueProjects.has(name))
  const summary = []
  if (loneRepos.length) {
    const grouped = loneRepos.reduce(groupByCat, {})
    content += `${loneRepos.length} Lone Repo updates`
    Object.entries(grouped).forEach(([category, items]) => {
      content += `\n* ${category} - ${items.map(({ name, html_url }) => {
        summary.push(name)
        return `[${name}](${html_url})`
      }).join(', ')}`
    })
    content += '\n'
  }
  return { content, loneRepos, summary }
}

module.exports.enrichNLP = async (data) => {
  // enrich PRs and issues with release NLP labels (and T1/T2 categories for future uses)
  const { prs, issues } = data
  const parsedPRs = await parseRaw(prs.map(trimTitle))
  const enrichedPRs = prs.map((pr) => ({
    ...pr,
    ...parsedPRs.find((p) => pr.title.includes(p.message)),
  }))
  const parsedIssues = await parseRaw(issues.map(trimTitle)).then((p) => p.map((v) => ({ ...v, labels: ['ISSUE'] })))
  const enrichedIssues = issues.map((issue) => ({
    ...issue,
    ...parsedIssues.find((p) => issue.title.includes(p.message)),
  }))
  return { ...data, issues: enrichedIssues, prs: enrichedPRs }
}

module.exports.formatDigest = ({ repos, issues, prs, start, end, team, onlyClosed = false }) => {
  const allLinked = prs.map((pr) => pr.linked_issues).flat()
  const all = [
    ...issues.filter((issue) => !allLinked.includes(getID(issue)) && (!onlyClosed || isClosed(issue))),
    ...prs.filter((pr) => !onlyClosed || isClosed(pr)),
  ]
  let { content, loneRepos, summary } = formatLoneRepos({ all, repos })

  if (all.length) {
    content += `${all.length} PR/issues ${formatAggStates(all) }`
    const grouped = all.reduce(groupByCatProj, {})
    Object.entries(grouped).forEach(([category, byProjects]) => {
      content += `\n\n# ${category}\n`
      Object.entries(byProjects).forEach(([project, items]) => {
        content += `\n## ${project} - ${formatUsers(items)}`
        // group items by first NLP label
        const byLabels = items.reduce((acc, curr) => {
          const label = (curr.labels || [])[0] || 'OTHERS'
          acc[label] = acc[label] || []
          acc[label].push(curr)
          return acc
        }, {})
        Object.entries(byLabels).forEach(([label, items]) => {
          content += `\n\`${label}\``
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
    })
  }

  return {
    content,
    title: `${team ? team.toUpperCase() : 'DEV'} Digest - ${formatDates({ start, end }).message}`,
    summary: [
      ...(loneRepos.length
        ? [`${loneRepos.length} Lone Repo updates\n* ${summary.join('\n* ')}`]
        : []
      ),
      ...(all.length ? [`${all.length} PR/issues updates${formatAggStates(all)}`] : []),
    ],
  }
}

module.exports.formatPreviously = ({ repos, issues, prs, start, end }) => {
  const allLinked = prs.map((pr) => pr.linked_issues).flat()
  const all = [
    ...issues.filter((issue) => !allLinked.includes(getID(issue))),
    ...prs,
  ]
  let { content, loneRepos, summary } = formatLoneRepos({ all, repos })

  if (all.length) {
    content += `${all.length} PR/issues updates${formatAggStates(all)}`
    const grouped = all.reduce(groupByCatProj, {})
    Object.entries(grouped).forEach(([category, byProjects]) => {
      content += `\n\n# ${category}\n`
      Object.entries(byProjects).forEach(([project, items]) => {
        content += `\n## ${project} - ${formatUsers(items)}`
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
          if (item.enriched_comments?.length) {
            content += `\n    * ${formatAggComments(item)}`
          }
          if (item.enriched_reviews?.length) {
            content += `\n    * ${formatAggReviews(item)}`
          }
          if (item.enriched_commits?.length) {
            content += `\n    * ${formatAggCommits(item)}`
          }
        })
      })
    })
  }

  return {
    content,
    title: `Previously - ${formatDates({ start, end }).message}`,
    summary: [
      ...(loneRepos.length
        ? [`${loneRepos.length} Lone Repo updates\n* ${summary.join('\n* ')}`]
        : []
      ),
      ...(all.length ? [`${all.length} PR/issues updates${formatAggStates(all)}`] : []),
    ],
  }
}

module.exports.formatReleases = ({ post, releases, pre = true }) => {
  if (!releases || releases.length === 0) {
    return post
  }
  let content = `${releases.length} Releases\n`
  const byProjects = releases.reduce(groupByProj, {})
  const summary = []
  Object.entries(byProjects).forEach(([project, items]) => {
    if (items.length > 1) {
      content += `\n* ${items.length} *${project}* releases`
      summary.push(`${project}: ${items.length}`)
    } else {
      content += `\n* 1 *${project}* release`
      summary.push(`${project}: 1`)
    }
    content += ` - ${items.map(({ tag_name, html_url }) => `[${tag_name}](${html_url})`).join(', ')}`
  })
  if (pre) {
    post.content = `${content}\n${post.content}`
  } else {
    post.content = `${post.content}\n${content}`
  }
  post.summary.push(`${releases.length} release(s)\n${summary.join('\n')}`)
  return post
}

module.exports.api = require('./api')
