const { searchByRange, getIssuesComments, getPRsReviews, getTopics, getPRsCommits } = require('./api')
const { pick, isPR, isTeamTopic, groupByCatProj, groupByCat, formatDates, formatAggStates, getID, formatItem, formatSub, formatAggComments, formatAggCommits, formatAggReviews } = require('./util')

const { GITHUB_ORG = 'EQWorks' } = process.env

const REGEX_PROJ = new RegExp(`https://github.com/${GITHUB_ORG}/(.*)/.*/.*`)
const REGEX_LINKED_ISSUES = /(fix|fixed|fixes|close|closes|closed)\s+#(?<issue>\d+)/ig
const ISSUE_FIELDS = ['html_url', 'title', 'user', 'state', 'assignees', 'comments', 'created_at', 'updated_at', 'closed_at', 'body', 'project', 'team', 'category', 'enriched_comments']
const PR_FIELDS = [...ISSUE_FIELDS, 'linked_issues', 'draft', 'requested_reviewers', 'enriched_reviews', 'enriched_commits']

const getIssueTopics = getTopics('repository_url')
const getRepoTopics = getTopics('url')

module.exports.issuesByRange = searchByRange({ endpoint: 'GET /search/issues', qualifier: 'updated' })
module.exports.reposByRange = searchByRange({ endpoint: 'GET /search/repositories', qualifier: 'pushed' })

module.exports.ignoreProjects = ({ html_url }) =>
  !html_url.startsWith(`https://github.com/${GITHUB_ORG}/eqworks.github.io`) // EQ website repo
  && !html_url.startsWith(`https://github.com/${GITHUB_ORG}/cs-`) // CS repos

module.exports.ignoreBotUsers = ({ user: { login } = {} }) => !login.startsWith('dependabot')

module.exports.enrichIssues = async ({ issues, start, end, team }) => {
  // enrich all (issues and PRs) with issue-level comments
  const [topics, comments] = await Promise.all([
    getIssueTopics(issues),
    getIssuesComments({ issues, start, end }),
  ])
  const enrichedIssues = issues.map((issue) => {
    // parse team and category from repo topics
    const repoTopics = (topics[issue.repository_url] || [])
    const teamTopics = repoTopics.filter(isTeamTopic)
    const team = [0, 2].includes(teamTopics.length) ? undefined : teamTopics[0].substring(5)
    const category = repoTopics.filter((t) => !isTeamTopic(t))[0]
    return {
      ...issue,
      project: issue.html_url.match(REGEX_PROJ)[1],
      team,
      category,
      enriched_comments: comments.filter((v) => v.issue_url === issue.url),
    }
  }).filter(({ team: t }) => !team || !t || (t.toLowerCase() === team.toLowerCase()))
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
  if (loneRepos.length) {
    const grouped = loneRepos.reduce(groupByCat, {})
    content += `${loneRepos.length} Lone Repo updates`
    Object.entries(grouped).forEach(([category, items]) => {
      content += `\n* ${category} - ${items.map(({ name, html_url }) => `[${name}](${html_url})`).join(', ')}`
    })
    content += '\n'
  }
  return content
}

module.exports.formatDigest = ({ repos, issues, prs, start, end, team }) => {
  const allLinked = prs.map((pr) => pr.linked_issues).flat()
  const all = [
    ...issues.filter((issue) => !allLinked.includes(getID(issue))),
    ...prs,
  ]
  let content = formatLoneRepos({ all, repos })

  if (all.length) {
    content += `${all.length} PR/issues updates${formatAggStates(all)}`
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

  return { content, title: `${team ? team.toUpperCase() : 'DEV'} Digest ${formatDates({ start, end })}` }
}

module.exports.formatPreviously = ({ repos, issues, prs, start, end }) => {
  const allLinked = prs.map((pr) => pr.linked_issues).flat()
  const all = [
    ...issues.filter((issue) => !allLinked.includes(getID(issue))),
    ...prs,
  ]
  let content = formatLoneRepos({ all, repos })

  if (all.length) {
    content += `${all.length} PR/issues updates${formatAggStates(all)}`
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

  return { content, title: `Previously ${formatDates({ start, end })}` }
}
