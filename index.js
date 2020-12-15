const github = require('./sources/github')
const slack = require('./targets/slack')

module.exports = {
  sources: { github },
  targets: { slack },
}
