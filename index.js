const github = require('./sources/github')
const asana = require('./sources/asana')
const slack = require('./targets/slack')

module.exports = {
  sources: { github, asana },
  targets: { slack },
}
