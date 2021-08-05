import os
import re
import pprint
import logging
import requests
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

client = WebClient(token=os.environ.get("SLACK_BOT_TOKEN"))
logger = logging.getLogger(__name__)

channel_name = "dev-updates-"
conversation_id = None

# Retrieve and download files
try:
    files = client.files_list(channel="G01G0BPP536", count=500)
except SlackApiError as e:
    logger.error("Error listing files: {}".format(e))

print('Found {} files.'.format(len(files["files"])))

# Download files
regexp = re.compile(r'Digest')
for file, i in zip(files["files"], range(len(files["files"]))):
    if regexp.search(file["title"], re.IGNORECASE):
        # Download file
        print(file["url_private"])
        r = requests.get(file["url_private"], headers={'Authorization': 'Bearer %s' % os.environ.get("SLACK_BOT_TOKEN")})
        r.raise_for_status()
        file_data = r.content
        # Save file to disk
        with open(file["title"], 'w+b') as f:
            f.write(file_data)
