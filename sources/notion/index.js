const { notion } = require('./api')


const { BASE_URL = 'https://www.notion.so/eqproduct' } = process.env

const databases = [
  {
    name: 'Dev Journal',
    id: 'f232e15f-f9cf-4740-9ef0-5f6f44de6555',
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

const formatTodoDoing = (rich_text) => rich_text.map((t) => {
  if (t.type === 'mention') {
    return (`[${t.plain_text}](${t.href})`)
  }
  if (t.text) {
    const { content, link } = t.text
    if (link) return (`[${content}](${link.url})`)
    return content
  }
}).filter((r) => r).join('')

const _getJournals = async ({ database_id, filters: { start, end }, isDaily }) => {
  const { results = [] } = await notion.databases.query({
    database_id,
    filter: { property: 'Date', date: { on_or_after: isDaily ? end : start } },
  })
  return Promise.all(results
    .filter(({ properties: { Name, Assignee } }) => (Assignee.people.length && Name.title.length))
    .map(async ({ id, properties }) => {
      let _Name = properties.Name
      if (properties.Assignee.people.length && !(properties.Name.title.length)) {
        _Name = { ...properties.Name, title: [{ text: {}, plain_text: (properties.Assignee.people[0].name).split(' ')[0] }] }
      }

      const _lwd = properties['Last Workday'].rich_text
      let doing = null

      if (properties.Date.date.start === end.split('T')[0]) {
        const _doing = await getJournalTasks({ block_id: id })

        doing = await Promise.all(_doing
          .filter(({ type }) => ['to_do', 'synced_block'].includes(type))
          .map(async ({ id, to_do, has_children, synced_block }) => {
            if (to_do) {
              const { rich_text } = to_do
              return formatTodoDoing(rich_text)
            }
            if (synced_block) {
              if (!has_children) {
                return
              }
              const task = await notion.blocks.children.list({ block_id: id })
              return task.results.map(({ to_do }) => formatTodoDoing(to_do.rich_text)).flat()
            }
          })
          .filter((r) => r)
          .flat())
      }

      return ({
        id,
        date: properties.Date.date.start,
        name: _Name.title[0].plain_text.split(' ')[0],
        LWD: _lwd ? _lwd.map(({ plain_text, href }) => {
          if (href) {
            // match * symbol followed by whitespace
            // (format by split('* ') below cause incorrect url link in post)
            const match = plain_text.match(/(^\*) (?<body>.*)/)
            const text = match ? match.groups.body : plain_text

            return `[${text}](${href})`
          }
          return plain_text
        }).join('').split('* ').map((t) => t.split('\n')[0]) : '',
        doing,
      })
    }))
}

module.exports.getJournals = async ({ start, end, isDaily }) => {
  const journals = await Promise.all(databases.map(async ({ id: database_id }) => (
    _getJournals({ database_id, filters: { start: start.split('T')[0], end: end.split('T')[0] }, isDaily })
  )))
  return groupBy(journals.flat(), 'name')
}

module.exports.formatJournals = ({ post, journals }) => {
  const summary = []
  let lwdJournals = `## ${Object.keys(journals).length} Journal Updates\n`

  Object.entries(journals).map(([name, journals]) => {
    return ({ [name]: {
      url: `${BASE_URL}/${(journals.map(({ id }) => id.split('-').join('')))[0]}`,
      did: journals.map(({ LWD }) => LWD).flat().filter((r) => r),
      doing: journals.map(({ doing }) => doing).flat().filter((r) => r),
    } })
  }).map((j) => Object.entries(j).forEach(([name, { url, did, doing }]) => {
    let _did = '\nDid:'
    let _doing = '\nDoing:'

    did.length ? _did += `\n* ${did.join('\n* ')}` : _did = ''
    doing.length ? _doing += `\n* ${doing.join('\n* ')}` : _doing = ''

    if (_did || _doing) {
      lwdJournals += `\n### **[${name}](${url})**${_did}${_doing}\n`
      summary.push(`${name}: ${[
        ...(did.length ? [`${did.length} done`] : []),
        ...(doing.length ? [`${doing.length} ongoing`] : []),
      ].join(', ')}`)
    }
  }))
  post.content = post.content || {}
  post.content.journals = lwdJournals
  const s = `${Object.keys(journals).length} journal updates\n${summary.join('\n')}`
  post.summary.push(s)
  post.summaries = post.summaries || {} // v2 object-based summaries
  post.summaries.journals = s
  return post
}
