const { Octokit } = require('@octokit/core')
const { startOfYesterday, endOfYesterday } = require('date-fns')

const { GITHUB_TOKEN } = process.env
const client = new Octokit({ auth: GITHUB_TOKEN })

module.exports.issuesByRange = async ({ start, end, per_page = 100 }) => {
  const range = `${start}..${end}`
  let issues = []
  let page = 1
  let pages = 0

  while (!pages || (pages > page)) {
    const { data: { total_count, incomplete_results, items } } = await client.request('GET /search/issues', {
      q: `org:EQWorks updated:${range}`,
      per_page,
      page,
    })
    // TODO: do something about incomplete_results
    if (!incomplete_results) {
      //
    }
    pages = Math.ceil(total_count / per_page)
    page += 1
    issues = issues.concat(items)
  }

  return issues
}

if (require.main === module) {
  // daily
  const [start] = startOfYesterday().toISOString().split('.')
  const [end] = endOfYesterday().toISOString().split('.')

  this.issuesByRange({ start, end }).then(JSON.stringify).then(console.log).catch(console.error)
}

// client.request('GET /search/commits', {
//   q: `org:EQWorks committer-date:${range}`,
//   per_page: 1,
//   // this is needed while commit search is still in preview
//   mediaType: {
//     previews: [
//       'cloak'
//     ]
//   },
// }).then(({ data: { items }}) => items).then(JSON.stringify).then(console.log).catch(console.error)

