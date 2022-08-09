const { DateTime } = require('luxon')


// issues contain both issues and PRs, through __typename
module.exports.splitIssuesPRs = (data) => {
  // separate out PRs
  const prs = data.filter(pr => pr.__typename === 'PullRequest')
  // separate out issues without PR links
  const linkedIssueIDs = prs.map(pr => pr.closingIssuesReferences.nodes.map(node => node.id)).flat()
  const issues = data.filter(issue => issue.__typename === 'Issue' && !linkedIssueIDs.includes(issue.id))

  return { prs, issues }
}

module.exports.filterRepoReleases = ({ repos, start, end }) => {
  const _start = DateTime.fromISO(start, { zone: 'UTC' }).startOf('day')
  const _end = DateTime.fromISO(end, { zone: 'UTC' }).startOf('day')

  return repos.map(({ releases, ...rest }) => ({
    ...rest,
    releases: releases.nodes
      .filter(({ publishedAt }) => {
        const published = DateTime.fromISO(publishedAt, { zone: 'UTC' }).startOf('day')
        return ((published >= _start) && (published <= _end))
      })
      .map(({ tag, ...r }) => ({ ...r, tag: tag.name })),
  }))
}
