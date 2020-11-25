const { Octokit } = require('@octokit/core')

const { GITHUB_TOKEN, GITHUB_ORG = 'EQWorks' } = process.env
const client = new Octokit({ auth: GITHUB_TOKEN })

const byRange = ({ endpoint, qualifier = 'updated', options = {} }) => async ({ start, end, per_page = 100 }) => {
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

module.exports.issuesByRange = byRange({ endpoint: 'GET /search/issues', qualifier: 'updated' })

module.exports.commitsByRange = byRange({
  endpoint: 'GET /search/commits',
  qualifier: 'committer-date',
  options: {
    mediaType: {
      previews: ['cloak']
    },
  },
})
