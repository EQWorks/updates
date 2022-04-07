const { WebClient } = require('@slack/web-api')

const { SLACK_TOKEN, SLACK_CHANNEL } = process.env

const web = new WebClient(SLACK_TOKEN)

module.exports.uploadMD = ({ title, content, channels = SLACK_CHANNEL }) => web.files.upload({
  channels,
  title,
  filename: `${title}.md`,
  // TODO: Slack Post seems to be malfunctioning
  // file: Buffer.from(content, 'utf-8'),
  // filetype: 'post',
  // TODO: temp workaround as raw markdown upload
  content,
  filetype: 'markdown',
})
