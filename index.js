const github = require('./sources/github')
const asana = require('./sources/asana')
const slack = require('./targets/slack')
const notion = require('./targets/notion')

module.exports = {
  sources: { github, asana },
  targets: { slack, notion },
}
