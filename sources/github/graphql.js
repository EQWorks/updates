const { Octokit } = require('@octokit/core')

const { GITHUB_TOKEN, GITHUB_ORG = 'EQWorks' } = process.env
const octokit = new Octokit({ auth: GITHUB_TOKEN })


const updatedByRange = ({ query, parameters = {} }) => async ({ start, end, per_page = 100 }) => {
  let data = []
  let hasNextPage = true
  let endCursor = null
  // iteratively fetch all pages
  const q = `org:${GITHUB_ORG} updated:${start}..${end} -author:app/dependabot`
  while (hasNextPage) {
    // query based on https://docs.github.com/en/search-github
    const { search: { nodes = [], pageInfo = {} } = {} } = await octokit.graphql(
      query,
      {
        ...parameters,
        q,
        first: per_page,
        after: endCursor,
      },
    )
    data = data.concat(nodes)
    hasNextPage = pageInfo.hasNextPage
    endCursor = pageInfo.endCursor
  }
  return data
}

const issueNode = `
  id
  author {
    ... on User {
      login
      name
    }
  }
  assignees(first: 100) {
    nodes {
      login
      name
      id
    }
  }
  updatedAt
  url
  title
  state
  repository {
    name
    url
    repositoryTopics(first: 100) {
      nodes {
        topic {
          name
        }
      }
    }
  }
  body
  closed
  closedAt
  createdAt
  publishedAt
  updatedAt
  comments(orderBy: {field: UPDATED_AT, direction: DESC}, first: 100) {
    totalCount
    nodes {
      author {
        ... on User {
          login
          name
        }
      }
      url
      updatedAt
      createdAt
    }
  }
  projectsV2(first: 100) {
    nodes {
      number
      url
      title
    }
    totalCount
  }
`

module.exports.updatedIssuesByRange = updatedByRange({
  query: `
    query IssuesQuery($q: String!, $first: Int!, $after: String) {
      search(
        query: $q
        type: ISSUE
        first: $first # max 100
        after: $after
      ) {
        issueCount # for debugging
        nodes {
          __typename
          ... on Issue {${issueNode}}
          ... on PullRequest {
            id
            author {
              ... on User {
                login
                name
              }
            }
            assignees(first: 100) {
              nodes {
                login
                name
              }
            }
            updatedAt
            url
            title
            state
            reviews(first: 100) {
              totalCount
              nodes {
                author {
                  ... on User {
                    name
                    login
                  }
                }
                url
                state
                updatedAt
                createdAt
              }
            }
            repository {
              name
              url
              repositoryTopics(first: 100) {
                nodes {
                  topic {
                    name
                  }
                }
              }
            }
            body
            isDraft
            closed
            closedAt
            createdAt
            publishedAt
            updatedAt
            comments(orderBy: {field: UPDATED_AT, direction: DESC}, first: 100) {
              totalCount
              nodes {
                author {
                  ... on User {
                    login
                    name
                  }
                }
                url
                updatedAt
                createdAt
              }
            }
            closingIssuesReferences(
              first: 10
              orderBy: {field: UPDATED_AT, direction: DESC}
            ) {
              totalCount
              nodes {${issueNode}}
            }
            projectsV2(first: 100) {
              nodes {
                number
                url
                title
              }
              totalCount
            }
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  `,
})

const searchByRange = ({
  type = 'ISSUE',
  qualifier = 'updated',
  query,
  parameters = {},
  searchQuery,
}) => async ({
  start,
  end,
  per_page = 100,
}) => {
  let data = []
  let hasNextPage = true
  let endCursor = null
  // iteratively fetch all pages
  const q = `org:${GITHUB_ORG} ${qualifier}:${start}..${end} ${searchQuery || ''}`
  while (hasNextPage) {
    // query based on https://docs.github.com/en/search-github
    const { search: { nodes = [], pageInfo = {} } = {} } = await octokit.graphql(
      query,
      {
        ...parameters,
        q,
        type,
        first: per_page,
        after: endCursor,
      },
    )
    data = data.concat(nodes)
    hasNextPage = pageInfo.hasNextPage
    endCursor = pageInfo.endCursor
  }
  return data
}

module.exports.reposByRange = searchByRange({
  type: 'REPOSITORY',
  qualifier: 'pushed',
  query: `
    query ReposByRange($q: String!, $type: SearchType!, $first: Int!, $after: String) {
      search(query: $q, type: $type, first: $first, after: $after) {
        nodes {
          ... on Repository {
            name
            url
            owner {
              ... on RepositoryOwner {
                login
                url
              }
            }
            repositoryTopics(first: 100) {
              nodes {
                topic {
                  ... on Topic {
                    name
                  }
                }
              }
            }
            releases(first: 100, orderBy: { field: CREATED_AT, direction: DESC }) {
              nodes {
                name
                tag {
                  ... on Ref {
                    name
                  }
                }
                url
                publishedAt
                isPrerelease
                author {
                  ... on User {
                    name
                    login
                    url
                  }
                }
              }
            }
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  `,
})
