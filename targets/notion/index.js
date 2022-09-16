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
  let children = []
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
    children.push(post.content.journals)
  }
  children = markdownToBlocks(children.join('\n'))

  if (children.length <= 100) {
    return notion.pages.create({ ...page, children })
  }
  // batch children and append to the same page
  const size = 100 // Notion max allowed per batch of children
  let batch = 1
  let p = {}
  for (let i = 0; i < children.length; i += size) {
    const chunk = children.slice(i, i + size)
    console.log(`Notion page children block batch ${batch}, size ${chunk.length}`)
    if (i === 0) { // first batch to create the page
      p = await notion.pages.create({ ...page, children: chunk })
    } else {
      const { id: block_id } = p // page is a type of block too
      await notion.blocks.children.append({
        block_id,
        children: chunk,
      })
    }
    batch += 1
  }
  return p
}
