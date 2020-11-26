const { Octokit } = require('@octokit/core')

const { GITHUB_TOKEN, GITHUB_ORG = 'EQWorks' } = process.env
const client = new Octokit({ auth: GITHUB_TOKEN })

const searchByRange = ({ endpoint, qualifier = 'updated', options = {} }) => async ({ start, end, per_page = 100 }) => {
  const range = `${qualifier}:${start}..${end}`
  let r = []
  let page = 1
  let pages = 0

  while (!pages || (pages > page)) {
    const { data: { total_count, incomplete_results, items } } = await client.request(endpoint, {
      q: `org:${GITHUB_ORG} ${range}`,
      per_page,
      page,
      ...options,
    })
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
  options: {
    mediaType: {
      previews: ['cloak']
    },
  },
})

const getIssuesComments = ({
  issues,
  start: since,
  end,
}) => Promise.all(issues.filter((v) => v.comments).map((v) => client.request({
  url: v.comments_url,
  method: 'GET',
  since, // matching issue search start, plus the below hack to emulate "before"
}).then(({ data }) => data.filter((v) => +(new Date(v.updated_at) <= +(new Date(end))))))).then((data) => data.flat())

const isPR = (v) => Object.keys(v).includes('pull_request')

module.exports.enrichIssues = async ({ issues, start, end }) => {
  // enrich all (issues and PRs) with issue-level comments
  const comments = await getIssuesComments({ issues, start, end })
  const commentEnriched = issues.map((issue) => ({
    ...issue,
    enriched_comments: comments.filter((v) => v.issue_url === issue.url),
  }))
  // split out pure issues and PRs
  const prs = commentEnriched.filter(isPR)
  // enrich PRs with review comments
  // enrich PRs with commit updates
  return {
    issues: commentEnriched.filter((v) => !isPR(v)),
    prs,
  }
}
