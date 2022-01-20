const dfd = require('danfojs-node')

const { searchByRange } = require('./api')

const {
  GITHUB_ORG = 'EQWorks',
  IGNORE_PROJ_PREFIXES = 'eqworks.github.io,cs-,swarm-,swarm2-',
} = process.env

module.exports.ignoreProjects = ({ html_url }) => !IGNORE_PROJ_PREFIXES
  .split(',')
  .map(v => v.trim())
  .filter(v => v)
  .some(v => html_url.startsWith(`https://github.com/${GITHUB_ORG}/${v}`))

module.exports.ignoreBotUsers = ({ user: { login } = {} }) => !login.startsWith('dependabot')

const issuesByRange = searchByRange({ endpoint: 'GET /search/issues', qualifier: 'updated' })

module.exports.getIssues = async ({ start, end, ignoreFns = [this.ignoreProjects, this.ignoreBotUsers] }) => {
  let issues = await issuesByRange({ start, end })
  // TODO: adapt as danfo/dataframe filter function
  for (const fn of ignoreFns) {
    issues = issues.filter(fn)
  }
  let df = new dfd.DataFrame(issues)
  // filter rows based on ignore functions
  // TODO: all other enrichments
  return df
}
