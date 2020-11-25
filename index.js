const { startOfYesterday, endOfYesterday } = require('date-fns')

const { issuesByRange, commitsByRange } = require('./sources/github')

if (require.main === module) {
  // daily
  const [start] = startOfYesterday().toISOString().split('.')
  const [end] = endOfYesterday().toISOString().split('.')

  issuesByRange({ start, end }).then(JSON.stringify).then(console.log).catch(console.error)
}
