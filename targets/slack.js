const { WebClient } = require('@slack/web-api')

const { SLACK_TOKEN, SLACK_CHANNEL } = process.env

const web = new WebClient(SLACK_TOKEN)

module.exports.uploadMD = ({ channels = SLACK_CHANNEL } = {}) => ({ title, content }) => web.files.upload({
  channels,
  file: Buffer.from(content, 'utf-8'),
  title,
  filetype: 'post',
})
