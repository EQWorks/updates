const { startOfYesterday, endOfYesterday } = require('date-fns')

const { issuesByRange, enrichIssues } = require('./sources/github')

if (require.main === module) {
  // daily range in ISO string but drops ms portion
  const start = `${startOfYesterday().toISOString().split('.')[0]}Z`
  const end = `${endOfYesterday().toISOString().split('.')[0]}Z`

  issuesByRange({ start, end })
    .then((issues) => enrichIssues({ issues, start, end }))
    .then(JSON.stringify)
    .then(console.log)
    .then(console.error)
}
