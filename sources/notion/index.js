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

const getJournalTasks = async ({ block_id }) => {
  const { results = [] } = await notion.blocks.children.list({ block_id })
  return results
}

const _getJournals = async ({ database_id, filters: { start, end } }) => {
  const { results = [] } = await notion.databases.query({
    database_id,
    filter: { property: 'Date', date: { on_or_after: start } },
  })

  return Promise.all(results.map(async ({ id, properties }) => {
    const _lwd = properties['Last Workday'].rich_text[0]
    let doing = null

    if (properties.Date.date.start === end.split('T')[0]) {
      const _doing = await getJournalTasks({ block_id: id })
      doing = _doing.map(({ to_do: { text } }) => text.map(({ plain_text }) => plain_text).join('')).flat()
    }
  
    return ({
      id,
      date: properties.Date.date.start,
      name: properties.Name.title[0].plain_text.split(' ')[0],
      LWD: _lwd ? _lwd.plain_text.split('\n').map((t) => {
        const match = t.match(/(?<=\* )(.*)/)
        if (match) return match[0]
        return t
      }) : '',
      doing,
    })
  }))
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
    return ({ [name]: {
      did: journals.map(({ LWD }) => LWD).flat().filter((r) => r),
      doing: journals.map(({ doing }) => doing).flat().filter((r) => r),
    } })
  }).map((j) => Object.entries(j).forEach(([name, { did, doing }]) => {
    let _did = '\nDid:'
    let _doing = '\nDoing:'

    did.length ? _did += `\n* ${did.join('\n* ')}` : _did = ''
    doing.length ? _doing += `\n* ${doing.join('\n* ')}` : _doing = ''

    lwdJournals += `\n*${name}*${_did}${_doing}\n`
  }))

  const _post = await post
  _post.content += `\n\n${lwdJournals}`
  return _post
}
