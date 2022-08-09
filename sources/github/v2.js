const { DateTime } = require('luxon')

const { isTeamTopic } = require('./util')


// issues contain both issues and PRs, through __typename
module.exports.splitIssuesPRs = (data) => {
  // separate out PRs
  const prs = data.filter(pr => pr.__typename === 'PullRequest')
  // separate out issues without PR links
  const linkedIssueIDs = prs.map(pr => pr.closingIssuesReferences.nodes.map(node => node.id)).flat()
  const issues = data.filter(issue => issue.__typename === 'Issue' && !linkedIssueIDs.includes(issue.id))

  return { prs, issues }
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
