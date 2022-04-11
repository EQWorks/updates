// Module adapted from http://github.com/EQWorks/efforts
const asana = require('asana')

const { formatLocalDates } = require('../util')

const {
  ASANA_TOKEN,
  ASANA_WORKSPACE = '30686770106337', // eqworks
  ASANA_PROJECT = '1152701043959235', // dev avail
  ORG_TZ: zone = 'America/Toronto',
} = process.env

const VACAY_SECTIONS = '1152701043959236'
const client = asana.Client.create().useAccessToken(ASANA_TOKEN)

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// https://developers.asana.com/docs/search-tasks-in-a-workspace
const searchTasks = (params) => client.tasks.searchInWorkspace(ASANA_WORKSPACE, {
  completed: false,
  is_subtask: false,
  sort_by: 'created_at',
  sort_ascending: true,
  opt_fields: 'assignee.email,start_on,due_on,due_at,created_at',
  limit: 100,
  ...params,
}).then(({ data }) => data)

module.exports.getVacays = async ({
  after,
  before,
  projects = ASANA_PROJECT,
  sections = VACAY_SECTIONS,
}) => {
  const common = { 'due_on.after': after }
  if (projects) {
    common['projects.all'] = projects
  }
  if (sections) {
    common['sections.any'] = sections
  }
  // get tasks
  let data = []
  let created_at
  let gid
  let it = 0
  let more = true
  while (more) {
    const params = { ...common }
    if (created_at) {
      params['created_at.after'] = created_at
    }
    // TODO: add 429 error handling to also sleep 60 seconds
    const tasks = await searchTasks(params) || []
    const last = tasks[tasks.length - 1]
    if (!last || (tasks.length === 1 && gid === last.gid)) {
      more = false
      continue
    }
    created_at = last.created_at
    gid = last.gid
    data = data.concat(tasks)
    // comply to 60 reqs/min ASANA search API constraint
    it += 1
    if (it >= 59) {
      await sleep(60 * 1000)
    }
  }
  return data.reduce((acc, { gid, assignee, start_on: start, due_on, due_at }) => {
    if (!acc.some((t) => t.gid === gid) && assignee && assignee.email && (start || due_on) <= before) {
      acc.push({ email: assignee.email.toLowerCase(), start: start || due_at || due_on, end: due_at || due_on })
    }
    return acc
  }, []).reduce((acc, { email, start, end }) => {
    acc[email] = [...(acc[email] || []), { start, end }]
    return acc
  }, {})
}

module.exports.formatVacays = ({ post, vacays, pre = true }) => {
  if (!Object.keys(vacays).length) {
    return post
  }
  const summary = []
  let s = 'Vacations\n'
  Object.entries(vacays).forEach(([email, ranges]) => {
    const fr = ranges.map(formatLocalDates(zone)).map(({ message, status }) => {
      let m = `${message} (${status})`
      if (status === 'ongoing') {
        m = `*${m}*`
      }
      return m
    }).join(', ')
    s += `\n* ${email} - ${fr}`
    summary.push(`${email.split(/[@.]/)[0]}: ${fr.split(',').slice(1).join(',')}`)
  })
  if (pre) {
    post.content = `${s}\n${post.content}`
  } else {
    post.content += `\n${s}`
  }
  post.summary.push(`${Object.keys(vacays).length} vacation status\n${summary.join('\n')}`)
  return post
}

if (require.main === module) {
  this.getVacays({ after: '2021-02-08', before: '2021-02-12' }).then(JSON.stringify).then(console.log)
}
