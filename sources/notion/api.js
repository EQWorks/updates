const { Client } = require('@notionhq/client')


const { NOTION_TOKEN } = process.env

module.exports.notion = new Client({ auth: NOTION_TOKEN })
