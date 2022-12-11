const { DateTime } = require('luxon')

const {
  isTeamTopic,
  trimTitle,
  groupByCat, // TODO: this shouldn't be needed for v2 source
} = require('./util')
const { formatDates } = require('../util')


const { GITHUB_ORG = 'EQWorks' } = process.env

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

//
const getLabels = (issue) => ([
  ...new Set([
    // seek from direct labels association
    ...issue?.labels?.nodes?.map(({ name }) => name),
    // seek from closingIssuesReferences...labels association
    ...(issue?.closingIssuesReferences?.nodes?.map(({ labels }) => (labels?.nodes || [])) || [])
      .flat()
      .map(({ name }) => name),
  ]),
])

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
  if (issue.assignees?.totalCount) {
    const a = issue.assignees.nodes.map(({ login }) => login).filter(n => n !== i).join(', ')
    if (a) {
      p = `Assigned: ${a}, Initiated: ${i}`
    }
  }
  return p
}

const formatIssueLink = (issue) => `[${formatIssueType(issue)} #${issue.number}](${issue.url})`

const formatIssueItem = (issue) => {
  // type with number and URL
  let type = `[${formatIssueLink(issue)}`
  // format closing issues association
  if (issue.closingIssuesReferences?.totalCount) {
    const { nodes } = issue.closingIssuesReferences
    type += ` 🔗 ${nodes.map(formatIssueLink).join(', ')}]`
  } else {
    type += ']'
  }
  const title = trimTitle(issue)
  // participants
  const participants = formatParticipants(issue)
  return `${type} ${title} (${participants})`
}

// discussions is either reviews or comments
const formatAggDiscussionStats = ({ type, discussions, start, end }) => {
  const _start = DateTime.fromISO(start, { zone: 'UTC' }).startOf('day')
  const _end = DateTime.fromISO(end, { zone: 'UTC' }).endOf('day')
  const { totalCount, nodes } = discussions
  const inRange = nodes.filter(({ updatedAt, author }) => {
    const d = DateTime.fromISO(updatedAt, { zone: 'UTC' })
    return d >= _start && d <= _end && author.login
  })
  if (!inRange.length) {
    return ''
  }
  const commentors = [...new Set(inRange.map(({ author }) => author.login))]
  const lastComment = inRange[inRange.length - 1] // since sorted DESC
  let prefix = `${totalCount} ${type}${totalCount > 1 ? 's' : ''}`
  if (inRange.length < totalCount) {
    prefix = `${inRange.length} of ${totalCount} updated ${type}${inRange.length > 1 ? 's' : ''}`
  }
  return `* [${prefix}](${lastComment.url}) by ${commentors.join(', ')}\n`
}

const formatLoneRepos = (loneRepos) => {
  let content = ''
  if (loneRepos.length) {
    const grouped = loneRepos.reduce(groupByCat, {})
    content += `\n## ${loneRepos.length} Lone Repo updates`
    Object.entries(grouped).forEach(([category, items]) => {
      content += `\n* ${category} - ${items.map(({ name, url }) => {
        return `[${name}](${url})`
      }).join(', ')}`
    })
    content += '\n'
  }
  return content
}

// format previously (daily) updates
module.exports.formatPreviously = ({ repos, issues, prs, start, end, prefix = 'Previously', sred = false }) => {
  let summary = []
  let previously = ''
  // group by repository, maintain natural order of PRs before issues
  const byRepo = [...prs, ...issues].reduce((acc, issue) => {
    const repo = issue.repository.name
    acc[repo] = {
      ...issue.repository,
      issues: [...(acc[repo]?.issues || []), issue],
    }
    return acc
  }, {})
  if (!sred) {
    // format lone repos
    // filter out lone repos (no issues or PRs)
    const loneRepos = repos.filter(({ name }) => !Object.keys(byRepo).includes(name))
    if (loneRepos.length) {
      summary.push(`Lone repo updates:\n${loneRepos.map(({ name }) => `* ${name}`).join('\n')}`)
      previously += formatLoneRepos(loneRepos)
    }
  }
  // format summary stats for PRs and issues
  let issueSummary = `${issues.length + prs.length} updates (${prs.length} PRs, ${issues.length} issues)`
  issueSummary += formatAggIssuesStates([...prs, ...issues])
  summary.push(issueSummary)
  previously += `\n## ${issueSummary}`
  // format content for each repo
  Object.values(byRepo).forEach((repo) => {
    // temp disable this as it has way too many excessive updates
    if (['paymi-expo', 'ops-locus'].includes(repo.name.toLowerCase())) {
      return
    }
    previously += `\n## 🎯\t[${repo.name}](${repo.url})\n`
    // format each PR and issue
    repo.issues.forEach((i) => {
      if (sred && !i.closed) {
        return // skip non-closed issues/PRs in SRED mode
      }
      previously += `\n${stateIcon(i)}\t`
      // format projects association
      let projects = getProjectsV2(i)
      if (!projects.length) {
        projects = getProjectTopics(i?.repository?.repositoryTopics)
      }
      if (projects.length) {
        previously += `[${projects.map((p) => `[${trimTitle(p)}](${p.url || repo.url})`).join(', ')}]`
      }
      previously += ` ${formatIssueItem(i)}\n`
      // format aggregated comment stats
      if (i.comments?.totalCount) {
        previously += formatAggDiscussionStats({ type:'comment', discussions: i.comments, start, end })
      }
      // format aggregated review stats
      if (i.reviews?.totalCount) {
        previously += formatAggDiscussionStats({ type: 'review', discussions: i.reviews, start, end })
      }
      // format labels
      const labels = getLabels(i)
      if (labels.length) {
        previously += `* Label${labels.length > 1 ? 's' : ''}: ${labels.map((l) => `\`${l}\``).join(', ')}\n`
      }
      if (sred && i.body) {
        previously += `${i.body}\n`
      }
    })
  })
  let title = `${prefix} - ${formatDates({ start, end }).message}`
  if (sred) {
    title += ' (SR&ED mode)'
  }

  return { title, summary, content: { previously } }
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
  const _end = DateTime.fromISO(end, { zone: 'UTC' }).endOf('day')

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

module.exports.ignoreProjects = ({ url }) =>
  !url.startsWith(`https://github.com/${GITHUB_ORG}/eqworks.github.io`) // EQ website repo
  && !url.startsWith(`https://github.com/${GITHUB_ORG}/cs-`) // CS repos
  && !url.startsWith(`https://github.com/${GITHUB_ORG}/swarm-`) // swarm repos
  && !url.startsWith(`https://github.com/${GITHUB_ORG}/swarm2-`) // swarm repos

module.exports.formatReleases = ({ post, repos }) => {
  const hasReleases = repos.find(({ releases }) => releases.length)

  if (!hasReleases) {
    return post
  }

  const releasesCount = repos.reduce((acc, { releases }) => acc + releases.length, 0)
  const summary = []
  let content = `\n## ${releasesCount} Releases\n`

  repos
    .filter(({ releases }) => releases.length)
    .forEach(({ name, releases }) => {
      if (releases.length > 1) {
        content += `\n### ${releases.length} *${name}* releases`
        summary.push(`${name}: ${releases.length}`)
      } else {
        content += `\n### 1 *${name}* release`
        summary.push(`${name}: 1`)
      }
      content += `\n${releases.map(({ tag, url }) => `* [${tag}](${url})`).join('\n')}`
    })

  post.content = post.content || {}
  post.content.releases = content
  post.summary.push(`${releasesCount} release(s)\n${summary.join('\n')}`)
  return post
}
