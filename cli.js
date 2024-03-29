#!/usr/bin/env node
const { DateTime } = require('luxon')

// TODO: re-org back to gh after GraphQL + v2 refactor
const ghGraphQL = require('./sources/github/graphql')
const ghV2 = require('./sources/github/v2')
const asana = require('./sources/asana')
const notion = require('./sources/notion')
const notionTarget = require('./targets/notion')
const slack = require('./targets/slack')

const { ORG_TZ = 'America/Toronto' } = process.env
const stripMS = (dt) => `${dt.toISO().split('.')[0]}Z`

// TODO: a lot of getX functions are similar, refactor
const getDaily = async ({ date, team, raw = false, dryRun = false, timeZone = ORG_TZ, sred = false }) => {
  // last work day in ISO string - ms portion
  const day = DateTime.fromISO(date).startOf('day').setZone(timeZone, { keepLocalTime: true })
  const lastYst = day.minus({ days: day.weekday === 1 ? 3 : 1 })
  const yst = day.minus({ day: 1 })
  const start = stripMS(lastYst.startOf('day').toUTC())
  const end = stripMS(yst.endOf('day').toUTC())

  const [issues, repos, vacays, journals] = await Promise.all([
    ghGraphQL.issuesByRange({ start, end })
      .then(ghV2.splitIssuesPRs)
      .then((data) => ({ ...data, start, end })),
    ghGraphQL.reposByRange({ start, end })
      .then((repos) => repos.filter(ghV2.ignoreProjects))
      .then((repos) => ghV2.filterReleasesTeams({ team, repos, start, end })),
    asana.getVacays({ after: day.toISODate(), before: day.endOf('week').toISODate() }),
    notion.getJournals({ start, end, isDaily: true }),
  ])
  if (raw) {
    return JSON.stringify({ vacays, repos, issues, journals })
  }
  const post = ghV2.formatPreviously({ repos, ...issues, sred })
  if (!sred) {
    ghV2.formatReleases({ post, repos }) // mutates post.content with releases
    asana.formatVacays({ post, vacays }) // mutates post.content with vacations
    notion.formatJournals({ post, journals }) // mutates post.content with journals
  }
  if (dryRun) {
    return Object.values(post.content).join('\n')
  }
  const page = await notionTarget.uploadMD(post, 'daily')
  return slack.postSummary({ url: page.url, title: post.title, summary: post.summary })
}
const getWeekly = async ({ date, team, raw = false, dryRun = false, timeZone = ORG_TZ, sred = false }) => {
  // weekly range in ISO string but drops ms portion
  const day = DateTime.fromISO(date).startOf('day').setZone(timeZone, { keepLocalTime: true })
  const yst = DateTime.utc().minus({ day: 1 }).setZone(ORG_TZ, { keepLocalTime: true })
  const lastYst = yst.minus({ week: 1 }).plus({ day: 1 })
  const start = stripMS(lastYst.startOf('day').toUTC())
  const end = stripMS(yst.endOf('day').toUTC())

  const [issues, repos, vacays, journals] = await Promise.all([
    ghGraphQL.issuesByRange({ start, end })
      .then(ghV2.splitIssuesPRs)
      .then((data) => ({ ...data, start, end })),
    ghGraphQL.reposByRange({ start, end })
      .then((repos) => repos.filter(ghV2.ignoreProjects))
      .then((repos) => ghV2.filterReleasesTeams({ team, repos, start, end })),
    asana.getVacays({ after: lastYst.toISODate(), before: day.endOf('week').toISODate() }),
    notion.getJournals({ start, end }),
  ])
  if (raw) {
    return JSON.stringify({ vacays, repos, issues, journals })
  }
  let prefix = 'Digest'
  if (team) {
    prefix = `${team.toUpperCase()} Digest`
  }
  const post = ghV2.formatPreviously({ repos, ...issues, prefix, sred })
  if (!sred) {
    ghV2.formatReleases({ post, repos }) // mutates post.content with releases
    asana.formatVacays({ post, vacays }) // mutates post.content with vacations
    notion.formatJournals({ post, journals }) // mutates post.content with journals
  }
  if (dryRun) {
    return Object.values(post.content).join('\n')
  }
  let tag = 'weekly'
  if (team) {
    tag += `-${team}`
  }
  const page = await notionTarget.uploadMD(post, tag)
  return slack.postSummary({ url: page.url, title: post.title, summary: post.summary })
}
const getRange = async ({ date, scope, raw = false, dryRun = false, timeZone = ORG_TZ, sred = false }) => {
  // range in ISO string but drops ms portion
  const day = DateTime.fromISO(date).setZone(timeZone, { keepLocalTime: true })
  const start = stripMS(day.startOf(scope).toUTC())
  const end = stripMS(day.endOf(scope).toUTC())

  const [issues, repos] = await Promise.all([
    ghGraphQL.issuesByRange({ start, end })
      .then(ghV2.splitIssuesPRs)
      .then((data) => ({ ...data, start, end })),
    ghGraphQL.reposByRange({ start, end })
      .then((repos) => repos.filter(ghV2.ignoreProjects))
      .then((repos) => ghV2.filterReleasesTeams({ repos, start, end })),
  ])
  if (raw) {
    return JSON.stringify({ repos, issues })
  }
  const post = ghV2.formatPreviously({ repos, ...issues, prefix: `${scope.toUpperCase()} Digest`, sred })
  if (!sred) {
    ghV2.formatReleases({ post, repos }) // mutates post.content with releases
  }
  if (dryRun) {
    return Object.values(post.content).join('\n')
  }
  const page = await notionTarget.uploadMD(post, 'range')
  return slack.postSummary({ url: page.url, title: post.title, summary: post.summary })
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
  sred: {
    type: 'boolean',
    default: false,
    description: 'SR&ED mode, output only Done items from GitHub and include descriptions in formatting',
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
