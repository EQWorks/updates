const { notion } = require('../../sources/notion/api')
const { markdownToBlocks } = require('@tryfabric/martian')


const { DATABASE_ID = 'adf0c7124e1e44ff851e254dbe36015c' } = process.env
const today = `${new Date().toISOString().split('T')[0]}`

module.exports.uploadMD = async (post, tag) => {
  const page = {
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
  }
  const children = []
  if (post.content.vacays) {
    children.push(post.content.vacays)
  }
  if (post.content.releases) {
    children.push(post.content.releases)
  }
  if (post.content.previously) {
    children.push(post.content.previously)
  }

  if (post.content.journals) {
    // first attemp to use normal content assembly
    page.children = markdownToBlocks([...children, post.content.journals].join('\n\n'))
    try {
      const r = await notion.pages.create(page)
      return r
    } catch(e) {
      // falls back to using journal summary for shorter body length
      page.children = markdownToBlocks([...children, post.summaries.journals].join('\n\n'))
    }
  } else {
    page.children = markdownToBlocks(children.join('\n\n'))
  }

  return notion.pages.create(page)
}
