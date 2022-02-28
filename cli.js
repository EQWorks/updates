#!/usr/bin/env node
const { DateTime } = require('luxon')

const gh = require('./sources/github')
const asana = require('./sources/asana')
const notion = require('./sources/notion')
const slack = require('./targets/slack')

const { ORG_TZ = 'America/Toronto' } = process.env
const stripMS = (dt) => `${dt.toISO().split('.')[0]}Z`

// TODO: a lot of getX functions are similar, refactor
const getDaily = async ({ date, team, raw = false, dryRun = false, timeZone = ORG_TZ }) => {
  // last work day in ISO string - ms portion
  const day = DateTime.fromISO(date).startOf('day').setZone(timeZone, { keepLocalTime: true })
  const lastYst = day.minus({ days: day.weekday === 1 ? 3 : 1 })
  const yst = day.minus({ day: 1 })
  const start = stripMS(lastYst.startOf('day').toUTC())
  const end = stripMS(yst.endOf('day').toUTC())

  const [issues, repos, vacays, journals] = await Promise.all([
    gh.issuesByRange({ start, end })
      .then((issues) => issues.filter(gh.ignoreProjects))
      .then((issues) => issues.filter(gh.ignoreBotUsers))
      .then((issues) => gh.enrichIssues({ issues, start, end, team, skipEnrichPRs: false, skipEnrichComments: false })),
    gh.reposByRange({ start, end })
      .then((issues) => issues.filter(gh.ignoreProjects))
      .then((repos) => gh.enrichRepos({ repos, team })),
    asana.getVacays({ after: day.toISODate(), before: day.endOf('week').toISODate() }),
    notion.getJournals({ start, end, isDaily: true }),
  ])
  const releases = await gh.api.getReleases({ repos, start, end })
  if (raw) {
    return JSON.stringify({ vacays, repos, releases, issues, journals })
  }
  const post = gh.formatPreviously({ repos, ...issues })
  gh.formatReleases({ post, releases, pre: true }) // mutates post.content with releases
  asana.formatVacays({ post, vacays, pre: true }) // mutates post.content with vacations
  notion.formatJournals({ post, journals }) // mutates post.content with journals
  if (dryRun) {
    return post
  }
  return slack.uploadMD(post)
}
const getWeekly = async ({ date, team, raw = false, dryRun = false, timeZone = ORG_TZ }) => {
  // weekly range in ISO string but drops ms portion
  const day = DateTime.fromISO(date).startOf('day').setZone(timeZone, { keepLocalTime: true })
  const yst = DateTime.utc().minus({ day: 1 }).setZone(ORG_TZ, { keepLocalTime: true })
  const lastYst = yst.minus({ week: 1 }).plus({ day: 1 })
  const start = stripMS(lastYst.startOf('day').toUTC())
  const end = stripMS(yst.endOf('day').toUTC())

  const [issues, repos, vacays, journals] = await Promise.all([
    gh.issuesByRange({ start, end })
      .then((issues) => issues.filter(gh.ignoreProjects))
      .then((issues) => issues.filter(gh.ignoreBotUsers))
      .then((issues) => gh.enrichIssues({ issues, start, end, team })),
    gh.reposByRange({ start, end })
      .then((repos) => repos.filter(gh.ignoreProjects))
      .then((repos) => gh.enrichRepos({ repos, team })),
    asana.getVacays({ after: lastYst.toISODate(), before: day.endOf('week').toISODate() }),
    notion.getJournals({ start, end }),
  ])
  const [enriched, releases] = await Promise.all([
    gh.enrichNLP({ repos, ...issues, vacays, journals }),
    gh.api.getReleases({ repos, start, end }),
  ])
  if (raw) {
    return JSON.stringify({ ...enriched, releases })
  }
  const post = gh.formatDigest(enriched)
  gh.formatReleases({ post, releases, pre: true }) // mutates post.content with releases
  asana.formatVacays({ post, vacays, pre: true }) // mutates post.content with vacations
  notion.formatJournals({ post, journals }) // mutates post.content with journals
  if (dryRun) {
    return post
  }
  return slack.uploadMD(post)
}
const getRange = async ({ date, scope, team, raw = false, dryRun = false, timeZone = ORG_TZ, labels = [] }) => {
  // range in ISO string but drops ms portion
  const day = DateTime.fromISO(date).setZone(timeZone, { keepLocalTime: true })
  const start = stripMS(day.startOf(scope).toUTC())
  const end = stripMS(day.endOf(scope).toUTC())

  const [issues, repos] = await Promise.all([
    gh.issuesByRange({ start, end })
      .then((issues) => issues.filter(gh.ignoreProjects))
      .then((issues) => issues.filter(gh.ignoreBotUsers))
      .then((issues) => gh.enrichIssues({ issues, start, end, team })),
    gh.reposByRange({ start, end })
      .then((repos) => repos.filter(gh.ignoreProjects))
      .then((repos) => gh.enrichRepos({ repos })),
  ])
  const [enriched, releases] = await Promise.all([
    gh.enrichNLP({ repos, ...issues }),
    gh.api.getReleases({ repos, start, end }),
  ])
  // filter issues and PRs by first labels
  if (labels.length) {
    const norm = labels.map((label) => label.toLowerCase()) // normalize labels to all lowercase
    enriched.issues = enriched.issues.filter(({ labels }) => norm.includes(labels[0].toLowerCase()))
    enriched.prs = enriched.prs.filter(({ labels }) => norm.includes(labels[0].toLowerCase()))
  }
  if (raw) {
    return JSON.stringify({ ...enriched, releases })
  }
  enriched.onlyClosed = ['year', 'quarter', 'month'].includes(scope)
  const post = gh.formatDigest(enriched)
  gh.formatReleases({ post, releases, pre: true }) // mutates post.content with releases
  if (dryRun) {
    return post
  }
  return slack.uploadMD(post)
}

const sharedOptions = {
  date: {
    alias: 'd',
    type: 'string',
    default: new Date().toISOString(),
    description: 'Which date to retrieve the daily updates in ISO string format. Default now/today',
  },
  team: {
    alias: 't',
    type: 'string',
    description: 'Optional team topic filter, based on `meta-<team>` topic label by GitHub repo',
  },
  raw: {
    type: 'boolean',
    default: false,
    description: 'If true, output raw data as JSON without formatting as Slack post markdown',
  },
  'dry-run': {
    type: 'boolean',
    default: false,
    description: 'If true, output Slack Post markdown to stdout instead of posting to a designated Slack channel',
  },
  'time-zone': {
    type: 'string',
    default: ORG_TZ,
  },
}

require('yargs')
  .command(
    'daily',
    'daily updates',
    sharedOptions, // builder options
    (args) => {
      getDaily(args).then(console.log).catch((e) => {
        console.error(e)
        process.exit(1)
      })
    },
  )
  .command(
    'weekly',
    'weekly digest',
    sharedOptions, // builder options
    (args) => {
      getWeekly(args).then(console.log).catch((e) => {
        console.error(e)
        process.exit(1)
      })
    },
  )
  .command(
    'range', // TODO: add --start and --end options
    'custom range of updates (daily, weekly, monthly, or yearly) of GitHub stats only',
    { // builder options
      ...sharedOptions,
      scope: {
        type: 'string',
        default: 'month',
        description: 'Which scope to retrieve the updates, can be day, week, month, and year. Default month',
      },
      labels: {
        type: 'array',
        default: [],
        description: 'Optional labels to filter issues and PRs by',
      },
    },
    (args) => {
      getRange(args).then(console.log).catch((e) => {
        console.error(e)
        process.exit(1)
      })
    },
  )
  .demandCommand()
  .help()
  .argv
