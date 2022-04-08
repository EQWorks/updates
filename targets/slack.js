const { WebClient } = require('@slack/web-api')

const { SLACK_TOKEN, SLACK_CHANNEL } = process.env

const web = new WebClient(SLACK_TOKEN)

module.exports.uploadMD = ({ title, content, channels = SLACK_CHANNEL }) => web.files.upload({
  channels,
  file: Buffer.from(content, 'utf-8'),
  title,
  filetype: 'post',
})

module.exports.notionNotify = ({ url, title, summary }) => web.chat.postMessage({
  channel: SLACK_CHANNEL,
  blocks: [
    { type: 'header', text: { type: 'plain_text', text: title } },
    ...(summary.map((s) => (
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: s.split('\n').map((text, i) => {
            if (i) {
              return text
            }
            return `*${text}*`
          }).join('\n\t '),
        },
      }
    ))),
    { type: 'section', text: { type: 'mrkdwn', text: `<${url}|Visit Notion for more details.>` } },
  ],
})
