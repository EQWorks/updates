const { WebClient } = require('@slack/web-api')

const { SLACK_TOKEN, SLACK_CHANNEL } = process.env

const web = new WebClient(SLACK_TOKEN)

module.exports.uploadMD = ({ title, content, channels = SLACK_CHANNEL }) => web.files.upload({
  channels,
  file: Buffer.from(content, 'utf-8'),
  title,
  filetype: 'post',
})


module.exports.postSummary = ({ url, title, summary }) => {
  const fields = summary.map((s) => ({
    type: 'mrkdwn',
    text: s.split('\n').map((text, i) => {
      if (i) {
        return text
      }
      return `*${text}*`
    }).join('\n'),
  }))
  const subFields = Array.from(
    new Array(Math.ceil(fields.length/2)),
    (_, i) => fields.slice(i*2, i*2+2))

  return web.chat.postMessage({
    channel: SLACK_CHANNEL,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: title } },
      ...subFields.map((fields) => ({ type: 'section', fields })),
      { type: 'section', text: { type: 'mrkdwn', text: `<${url}|Visit Notion for more details.>` } },
    ],
  })
}
