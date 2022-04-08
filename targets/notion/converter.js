const { parseAnnotations } = require('./annotations')


const notionTextBlocks = (type, value) => {
  const text = parseAnnotations(value.trim())
  return { object: 'block', type, [type]: { rich_text: text } }
}

const notionParagraph = (lines) => lines.filter((l) => l).map((line) => (
  notionTextBlocks('paragraph', line)
))

const notionListBlocks = ({ bulletedLines, numberedLines }) => {
  const notionList = bulletedLines || numberedLines
  const parentListType = bulletedLines ? 'bulleted_list_item' : 'numbered_list_item'
  if (notionList) {
    const { lines, children } = notionList
  
    if (children) {
      const childrenList = children.list.map((c) => (
        notionTextBlocks(children.isBulleted ? 'bulleted_list_item' : 'numbered_list_item', c)
      ))
      return lines.map((l, i) => ({
        [parentListType]: {
          rich_text: parseAnnotations(l),
          ...(i+1 === lines.length ? { children: childrenList } : {}),
        },
      }))
    }
  
    return lines.map((b) => notionTextBlocks(parentListType, b))
  }
  return []
}

const appendLists = (content, lists) => {
  const c = [...content, ...notionListBlocks(lists)]
  return { content: c, lists: {} }
}
const appendParagraphs = (content, prevLines) => {
  const c = [...content, ...notionParagraph(prevLines)]
  return { content: c, prevLines: [] }
}
const appendHeadings = ({ content, prevLines, lists, headingType, value }) => {
  const c = [
    ...content,
    ...(prevLines.length ? notionParagraph(prevLines) : []),
    ...(Object.keys(lists).length ? notionListBlocks(lists) : []),
    notionTextBlocks(headingType, value),
    ...(headingType === 'heading_1' ? [ { divider: {} } ] : []),
  ]
  return { content: c, prevLines: [], lists: {} }
}

module.exports.mdNotionConverter = (md) => {
  const mdByLines = md.split('\n')
  let prevLines = []
  let content = []
  let lists = {}

  for (const line of mdByLines) {
    if (!line) {
      if (Object.keys(lists).length) {
        const l = appendLists(content, lists)
        content = l.content
        lists = l.lists
      }
      if (prevLines.length) {
        const p = appendParagraphs(content, prevLines)
        content = p.content
        prevLines = p.prevLines
      }
    } else if (line.match(/^#\s/)) {
      // heading 1
      const heading1 = line.split('# ')
      const h1 = appendHeadings({ content, prevLines, lists, headingType: 'heading_1', value: heading1[1] })

      content = h1.content
      prevLines = h1.prevLines
      lists = h1.lists
    } else if (line.match(/^##\s/)) {
      // heading 2
      const heading2 = line.split('## ')
      const h2 = appendHeadings({ content, prevLines, lists, headingType: 'heading_2', value: heading2[1] })

      content = h2.content
      prevLines = h2.prevLines
      lists = h2.lists
    } else if (line.match(/^###+\s/)) {
      // heading 3
      const heading3 = line.split('### ')
      const h3 = appendHeadings({ content, prevLines, lists, headingType: 'heading_3', value: heading3[1] })
  
      content = h3.content
      prevLines = h3.prevLines
      lists = h3.lists
    } else if (line.trim().match(/^-\s|^\*\s|^[\d]+\./)) {
      // bulleted & numbered list
      const bulleted = line.match(/^(-\s)(.*)/) || line.match(/^(\*\s)(.*)/)
      const indentBulleted = line.match(/^([ ]{2,}-\s)(.*)/) || line.match(/^([ ]{2,}\*\s)(.*)/)
      const numbered = line.match(/^([\d]+\.)(.*)/)
      const indentNumbered = line.match(/^([ ]{2,}[\d]+\.)(.*)/)

      if (bulleted && !lists?.bulletedLines?.children?.list?.length) {
        lists = { ...lists, bulletedLines: {
          ...(lists.bulletedLines || {}),
          lines: [...(lists?.bulletedLines?.lines || []), bulleted[2]],
        } }
      }
      if (indentBulleted) {
        lists = { ...lists, bulletedLines: {
          ...(lists.bulletedLines || {}),
          children: { list: [...(lists?.bulletedLines?.children?.list || []), indentBulleted[2]], isBulleted: true },
        } }
      }
      if (numbered && !lists?.numberedLines?.children?.list?.length) {
        lists = { ...lists, numberedLines: {
          ...(lists.numberedLines || {}),
          lines: [...(lists?.numberedLines?.lines || []), numbered[2]],
        } }
      }
      if (indentNumbered) {
        lists = { ...lists, numberedLines: {
          ...(lists.numberedLines || {}),
          children: { list: [...(lists?.numberedLines?.children?.list || []), indentNumbered[2]], isBulleted: false },
        } }
      }

      if (prevLines.length) {
        const p = appendParagraphs(content, prevLines)
        content = p.content
        prevLines = p.prevLines
      }
      if (bulleted && lists?.bulletedLines?.children?.list?.length) {
        const l = appendLists(content, lists)
        content = l.content
        lists = { ...l.lists, bulletedLines: { lines: [bulleted[2]] } }
      }
      if (numbered && lists?.numberedLines?.children?.list?.length) {
        const l = appendLists(content, lists)
        content = l.content
        lists = { ...l.lists, numberedLines: { lines: [numbered[2]] } }
      }
    } else {
      // paragraphs placeholder
      if (Object.keys(lists).length) {
        const l = appendLists(content, lists)
        content = l.content
        lists = l.lists
      }
      prevLines.push(line)
    }

  }

  // trailing paragraphs
  if (prevLines.length) {
    content = [...content, ...notionParagraph(prevLines)]
  }

  // trailing lists
  if (Object.keys(lists)) {
    content = [...content, ...notionListBlocks(lists)]
  }

  return content
}
