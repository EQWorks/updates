// issues contain both issues and PRs, through __typename
module.exports.splitIssuesPRs = (data) => {
  // separate out PRs
  const prs = data.filter(pr => pr.__typename === 'PullRequest')
  // separate out issues without PR links
  const linkedIssueIDs = prs.map(pr => pr.closingIssuesReferences.nodes.map(node => node.id)).flat()
  const issues = data.filter(issue => issue.__typename === 'Issue' && !linkedIssueIDs.includes(issue.id))

  return { prs, issues }
}
