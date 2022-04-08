const { Client } = require('@notionhq/client')

const slack = require('../../targets/slack')
const { mdNotionConverter } = require('./converter')


const { NOTION_TOKEN, DATABASE_ID = 'adf0c7124e1e44ff851e254dbe36015c' } = process.env
const notion = new Client({ auth: NOTION_TOKEN })

const today = `${new Date().toISOString().split('T')[0]}`

module.exports.uploadMD = async (post, tag) => {
  const page = await notion.pages.create({
    parent: { type: 'database_id', database_id: DATABASE_ID },
    properties: {
      Digest: {
        title: [{
          text: { content: post.title },
        }],
      },
      Date: { type: 'date', date: { start: today } },
      Tags: { multi_select: [{ name: tag }] },
    },
    children: mdNotionConverter(post.content),
  })
  slack.notionNotify({ url: page.url, title: post.title, summary: post.summary })
}
