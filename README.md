# Updates

Tool to retrieve work updates from multiple sources.

Gathered updates save time from recollecting daily tasks, and provide organized and concise summaries of work status across teams.

## Usage

```shell
% node cli.js --help
# Or after global installation
% updates --help
updates <command>

Commands:
  updates daily   daily updates
  updates weekly  weekly digest
  updates range   custom range of updates (daily, weekly, monthly, or yearly) of
                  GitHub stats only

Options:
  --version  Show version number                                       [boolean]
  --help     Show help                                                 [boolean]
```

Individual commands can be examined using `--help` too, such as `updates daily --help` for more usage details.
