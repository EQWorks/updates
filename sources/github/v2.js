const { DateTime } = require('luxon')

const { isTeamTopic, trimTitle } = require('./util')


// issues contain both issues and PRs, through __typename
module.exports.splitIssuesPRs = (data) => {
  // separate out PRs
  const prs = data.filter(pr => pr.__typename === 'PullRequest')
  // separate out issues without PR links
  const linkedIssueIDs = prs.map(pr => pr.closingIssuesReferences.nodes.map(node => node.id)).flat()
  const issues = data.filter(issue => issue.__typename === 'Issue' && !linkedIssueIDs.includes(issue.id))
  return { issues, prs }
}

const isWIP = (issue) => !issue.closed && (issue.isDraft || issue.title.toLowerCase().includes('[wip]'))

const formatAggIssuesStates = (issues) => {
  let r = ''
  const closed = issues.filter((i) => i.closed).length
  if (issues.length === closed) {
    return ' (all done ✔️)'
  }
  if (closed) {
    r += `\n* ✔️ Done: ${closed}`
  }
  const wip = issues.filter(isWIP).length
  if (wip) {
    r += `\n* ⚠️ WIP: ${wip}`
  }
  const rest = issues.length - closed - wip
  if (rest > 0) {
    r += `\n* 👀 Needs review: ${rest}`
  }
  return r
}

const getProjectsV2 = (issue) => {
  let projects = [
    // seek from direct projectsV2 association
    ...issue?.projectsV2?.nodes,
    // seek from closingIssuesReferences...projectsV2 association
    ...(issue?.closingIssuesReferences?.nodes?.map(({ projectsV2 }) => (projectsV2?.nodes || [])) || []).flat(),
  ]
  // dedupe projects by project url
  projects = projects.filter((p, i) => projects.findIndex(({ url }) => url === p.url) === i)
  return projects
}

const getProjectTopics = (repositoryTopics) => {
  const topics = repositoryTopics.nodes.map(({ topic }) => topic?.name)
  let pts = topics.filter((t) => !isTeamTopic(t))
  // dedupe pts by name
  pts = pts.filter((p, i) => pts.findIndex((name) => name.toLowerCase() === p.toLowerCase()) === i)
  // conform to the format of projectsV2, signify legacy with the meta- prefix
  return pts.map((title) => ({ title }))
}

const stateIcon = (issue) => {
  if (issue.closed) {
    return '✔️'
  }
  if (isWIP(issue)) {
    return '⚠️'
  }
  return '👀'
}

const formatIssueType = ({ __typename }) => {
  if (__typename === 'PullRequest') {
    return 'PR'
  }
  return __typename || 'Issue'
}

const formatParticipants = (issue) => {
  let i = issue.author.login // initiator (author)
  let p = i // participants (initially the initiator)
  if (issue.assignees?.nodes?.length) {
    const a = issue.assignees.nodes.map(({ login }) => login).filter(n => n !== i).join(', ')
    if (a) {
      p = `Assigned: ${a}, Initiated: ${i}`
    }
  }
  return p
}

const formatIssueItem = (issue) => {
  // state icon
  const prefix = stateIcon(issue)
  // type with number and URL
  const type = `[${formatIssueType(issue)} #${issue.number}](${issue.url})`
  // title with URL
  const title = trimTitle(issue)
  // participants
  const participants = formatParticipants(issue)
  return `${prefix} ${type} ${title} (${participants})`
}

// format previously (daily) updates
module.exports.formatPreviously = ({
  issues, prs,
  // start, end, // TODO: include start/end loigc
}) => {
  // TODO: format lone repos
  let summary = ''
  let content = ''
  // format summary stats for PRs and issues
  summary += `${issues.length + prs.length} updates (${prs.length} PRs, ${issues.length} issues)`
  summary += formatAggIssuesStates([...prs, ...issues])
  // group by repository, maintain natural order of PRs before issues
  const byRepo = [...prs, ...issues].reduce((acc, issue) => {
    const repo = issue.repository.name
    acc[repo] = {
      ...issue.repository,
      issues: [...(acc[repo]?.issues || []), issue],
    }
    return acc
  }, {})
  // format content for each repo
  Object.values(byRepo).forEach((repo) => {
    // console.log(repo)
    content += `\n## [${repo.name}](${repo.url})\n`
    // format each PR and issue
    repo.issues.forEach((i) => {
      content += `\n${formatIssueItem(i)}\n`
      // format projects association
      let projects = getProjectsV2(i)
      if (!projects.length) {
        projects = getProjectTopics(i?.repository?.repositoryTopics)
      }
      if (projects.length) {
        content += `* Projects: ${projects.map((p) => {
          if (p.url) {
            return `[${trimTitle(p)}](${p.url})`
          }
          return trimTitle(p)
        }).join(', ')}\n`
      }
      // format closing issues association
      if (i.closingIssuesReferences?.nodes?.length) {
        content += `* Reference issues: ${i.closingIssuesReferences.nodes.map(formatIssueItem).join(', ')}\n`
      }
    })
  })

  return { summary, content }
}

const getTeamTopicsCategory = (repositoryTopics) => {
  const topics = repositoryTopics.nodes.map(({ topic }) => topic?.name)
  const teamTopics = topics.filter(isTeamTopic)
  const team = [0, 2].includes(teamTopics.length) ? undefined : teamTopics[0].substring(5)
  const category = topics.filter((t) => !isTeamTopic(t))[0]

  return { topics, team, category }
}

module.exports.filterReleasesTeams = ({ team, repos, start, end }) => {
  const _start = DateTime.fromISO(start, { zone: 'UTC' }).startOf('day')
  const _end = DateTime.fromISO(end, { zone: 'UTC' }).startOf('day')

  return repos.map(({ releases, repositoryTopics, ...rest }) => {
    const ttc = getTeamTopicsCategory(repositoryTopics)

    return ({
      ...rest,
      ...ttc,
      releases: releases.nodes
        .filter(({ publishedAt }) => {
          const published = DateTime.fromISO(publishedAt, { zone: 'UTC' }).startOf('day')
          return ((published >= _start) && (published <= _end))
        })
        .map(({ tag, ...r }) => ({ ...r, tag: tag.name })),
    })
  }).filter(({ team: t }) => !team || !t || (t.toLowerCase() === team.toLowerCase()))
}
