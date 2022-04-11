// match code annotations
const matchCode = (line) => {
  const match = line.match(/(?<pre>.*)`(?<code>.*)`(?<post>.*)/)
  if (match) {
    const { groups: { pre, code, post } } = match
    return {
      pre,
      code: [{ type: 'text', text: { content: code, link: null }, annotations: { code: true } }],
      post,
    }
  }
  return null
}

// match bold annotations
const matchBold = (line) => {
  const match = line.match(/(?<pre>.*)\*\*(?<bold>.*)\*\*(?<post>.*)/)
    || line.match(/(?<pre>.*)__(?<bold>.*)__(?<post>.*)/)
  if (match) {
    const { groups: { pre, bold, post } } = match
    return {
      pre,
      bold: [{ type: 'text', text: { content: bold, linke: null }, annotations: { bold: true } }],
      post,
    }
  }
  return null
}

// match italic annotations
const matchItalic = (line) => {
  const match = line.match(/(?<pre>.*)\*(?<italic>.*)\*(?<post>.*)/)
    || line.match(/(?<pre>.*)_(?<italic>.*)_(?<post>.*)/)
  if (match) {
    const { groups: { pre, italic, post } } = match
    return {
      pre,
      italic: [{ type: 'text', text: { content: italic, link: null }, annotations: { italic: true } }],
      post,
    }
  }
  return null
}

// match bold & italic annotations:
const matchBoldItalic = (line) => {
  const match = line.match(/(?<pre>.*)\*\*\*(?<bi>.*)\*\*\*(?<post>.*)/)
    || line.match(/(?<pre>.*)__\*(?<bi>.*)\*__(?<post>.*)/)
    || line.match(/(?<pre>.*)\*\*_(?<bi>.*)_\*\*(?<post>.*)/)
    || line.match(/(?<pre>.*)___(?<bi>.*)___(?<post>.*)/)
  if (match) {
    const { groups: { pre, bi, post } } = match
    return {
      pre,
      boldItalic: [{
        type: 'text',
        text: { content: bi, link: null },
        annotations: { bold: true, italic: true },
      }],
      post,
    }
  }
  return null
}

// match links
const matchLinks = (line) => {
  const match = line.match(/(?<pre>.*)\[(?<text>.*)\]\((?<url>[^(]+)\)(?<post>.*)/)
  if (match) {
    const { groups: { pre, text, url, post } } = match
    let content = {
      type: 'text',
      text: { content: text, link: { url } },
    }

    const bold = matchBold(text)
    const italic = matchItalic(text)
    const boldItalic = matchBoldItalic(text)
    const code = matchCode(text)

    if (boldItalic) {
      content.text.content = boldItalic.boldItalic[0].text.content
      content.annotations = boldItalic.boldItalic[0].annotations
    } else if (bold) {
      content.text.content = bold.bold[0].text.content
      content.annotations = bold.bold[0].annotations
    } else if (italic) {
      content.text.content = italic.italic[0].text.content
      content.annotations = italic.italic[0].annotations
    } else if (code) {
      content.text.content = code.code[0].text.content
      content.annotations = code.code[0].annotations
    }

    return { pre, link: [content], post }
  }
}

const parseAnnotationsHelper = (type, name) => {
  const pre = parseAnnotations(type.pre) || []
  const text = type[name] || []
  const post = parseAnnotations(type.post) || []

  return [...pre, ...text, ...post]
}

const parseAnnotations = (line) => {
  if (line) {
    const link = matchLinks(line)
    const code = matchCode(line)
    const bold = matchBold(line)
    const italic = matchItalic(line)
    const boldItalic = matchBoldItalic(line)
  
    if (link) {
      return parseAnnotationsHelper(link, 'link')
    }
    if (code) {
      return parseAnnotationsHelper(code, 'code')
    }
    if (boldItalic) {
      return parseAnnotationsHelper(boldItalic, 'boldItalic')
    }
    if (bold) {
      return parseAnnotationsHelper(bold, 'bold')
    }
    if (italic) {
      return parseAnnotationsHelper(italic, 'italic')
    }
    return [{ type: 'text', text: { content: line, link: null } }]
  }
}

module.exports = { parseAnnotations }
