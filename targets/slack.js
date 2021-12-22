const { WebClient } = require('@slack/web-api')

const { SLACK_TOKEN, SLACK_CHANNEL } = process.env

const web = new WebClient(SLACK_TOKEN)

module.exports.uploadMD = ({ title, content, channels = SLACK_CHANNEL }) => web.files.upload({
  channels,
  file: Buffer.from(content, 'utf-8'),
  title,
  filetype: 'post',
})
