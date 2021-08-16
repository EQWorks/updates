# Slack Scrape Bot

Slack bot to scrape legion update posts in #dev-updates- channel.

To run, activate the virtual environment and run app.py. Raw scraped files are stored in scraped_raw/. Notebook to clean raw files is extract_prs.ipynb. Cleaned files with PRs extracted are stored in scraped_prs, and quarantine/ is home to any failures from cleaning attempt.
