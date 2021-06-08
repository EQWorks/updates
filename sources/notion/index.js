const { Client } = require('@notionhq/client')


const { NOTION_TOKEN } = process.env
const notion = new Client({ auth: NOTION_TOKEN })

const databases = [
  {
    name: 'Dev Journal',
    id: 'f232e15f-f9cf-4740-9ef0-5f6f44de6555',
  },
  {
    name: 'Design Journal',
    id: 'd4a935fbb66c46b584061956b17e9335',
  },
]

const groupBy = (arr, key) => {
  return arr.reduce((acc, obj) => {
    (acc[obj[key]] = acc[obj[key]] || []).push(obj)
    return acc
  }, {})
}

const _getJournals = async ({ database_id, filters: { start } }) => {
  const { results = [] } = await notion.databases.query({
    database_id,
    filter: { property: 'Date', date: { on_or_after: start } },
  })
  return results.map(({ properties }) => {
    const _lwd = properties['Last Workday'].rich_text[0]
    return ({
      date: properties.Date.date.start,
      name: properties.Name.title[0].plain_text.split(' ')[0],
      LWD: _lwd ? _lwd.plain_text.split('\n').map((t) => {
        const match = t.match(/(?<=\* )(.*)/)
        if (match) return match[0]
        return t
      }) : '',
    })
  })
}

module.exports.getJournals = async ({ start, end }) => {
  const journals = await Promise.all(databases.map(async ({ id: database_id }) => (
    _getJournals({ database_id, filters: { start, end } })
  )))
  return groupBy(journals.flat(), 'name')
}

module.exports.formatJournals = async ({ post, journals }) => {
  let lwdJournals = '*JOURNALS*\n'

  Object.entries(journals).map(([name, journals]) => {
    return ({ [name]: journals.map(({ LWD }) => LWD).flat().filter((r) => r) })
  }).map((j) => Object.entries(j).forEach(([name, tasks]) => {
    if (tasks.length) {
      lwdJournals += `\n${name}:\n* ${tasks.join('\n* ')}`
    }
  }))

  const _post = await post
  _post.content += `\n\n${lwdJournals}`
  return _post
}
