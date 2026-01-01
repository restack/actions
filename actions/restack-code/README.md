# restack-code

A GitHub Action that interacts with a local LLM endpoint to analyze repository files and optionally apply suggested changes. Designed for flexible integration with various LLM backends (OpenAI-compatible, local models, etc.).

## Features

- **Multiple Response Formats**: Supports JSON-based file actions or unified diff (git patch)
- **Commit & PR Automation**: Automatically commit changes and create Pull Requests
- **GitHub App Authentication**: Use GitHub App credentials for enhanced permissions
- **Issue/PR Context Injection**: Automatically include issue/PR context in prompts
- **PR Review Comment Support**: Respond to code review comments and push fixes directly to PR branches
- **Comment Posting**: Post analysis results as comments on issues/PRs

## Quick Start

```yaml
- uses: restack/actions/actions/restack-code@v1
  with:
    llm_url: 'http://localhost:8080/v1/chat/completions'
    model: 'local-model'
    prompt: 'Analyze the code and suggest improvements'
    commit: 'true'
    create_pr: 'true'
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

### LLM Configuration

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `llm_url` | Yes | - | Full URL of the LLM endpoint (e.g., `http://localhost:8080/v1/chat/completions`) |
| `api_key` | No | - | API key for the LLM (if required) |
| `model` | No | `default` | Model name to request from the LLM |
| `format` | No | `auto` | Message format: `auto`, `chat` (OpenAI), or `raw` |
| `max_tokens` | No | - | Maximum tokens for LLM response |
| `timeout_ms` | No | `300000` | Timeout in milliseconds (default: 5 minutes) |
| `temperature` | No | `0.1` | Temperature for LLM sampling |

### Prompt Configuration

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `prompt` | No | - | Prompt text to send to the LLM |
| `prompt_file` | No | - | Path to a file to use as the prompt |

### File Context

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `files` | No | - | Glob or comma-separated list of files to include |
| `include_patch` | No | `false` | Include git diff of changed files |

### Issue/PR Context

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `issue_number` | No | - | Issue number to include in context |
| `issue_title` | No | - | Issue title to include in context |
| `issue_body` | No | - | Issue body to include in context |
| `pr_number` | No | - | PR number to include in context |
| `pr_title_context` | No | - | PR title to include in context |
| `pr_body_context` | No | - | PR body to include in context |
| `comment_body` | No | - | Comment text to include in context |

### Event Context (PR Review Comments)

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `event_name` | No | Auto-detected | GitHub event name (e.g., `pull_request_review_comment`) |
| `review_comment_path` | No | - | File path of the review comment |
| `review_comment_line` | No | - | Line number of the review comment |
| `pr_head_ref` | No | - | PR head branch ref (for pushing to existing PR) |
| `pr_base_ref` | No | - | PR base branch ref |

### Commit/PR Options

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `commit` | No | `false` | Apply changes and commit |
| `commit_message` | No | `Apply changes...` | Commit message |
| `create_pr` | No | `false` | Create a Pull Request |
| `pr_title` | No | `chore: Apply...` | PR title |
| `pr_body` | No | - | PR body |
| `branch` | No | `restack/llm-suggestions` | Branch name for commits |
| `base_branch` | No | `main` | Base branch for PR creation |
| `bot_name` | No | `restack-code` | Name used for git commits |
| `post_comment` | No | `false` | Post a comment on the issue with results |

### Authentication

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github_token` | No | `GITHUB_TOKEN` | GitHub token for API calls |
| `app_id` | No | - | GitHub App ID (alternative to token) |
| `private_key` | No | - | GitHub App private key |
| `installation_id` | No | - | GitHub App installation ID |

## Outputs

| Output | Description |
|--------|-------------|
| `llm_response` | Raw LLM response text |
| `summary` | Short summary of the action result |
| `commit_sha` | Commit SHA if a commit was created |
| `pr_url` | PR URL if a PR was created |

## LLM Response Formats

### JSON Actions (Recommended)

The LLM can return a JSON object with file actions:

```json
{
  "analysis": "Brief analysis of the changes",
  "actions": [
    {"type": "create", "path": "src/new-file.ts", "content": "..."},
    {"type": "modify", "path": "src/existing.ts", "content": "..."},
    {"type": "delete", "path": "src/old-file.ts"}
  ],
  "commit_message": "feat: add new feature",
  "pr_title": "Add new feature",
  "pr_body": "This PR adds..."
}
```

### Unified Diff

The LLM can also return a unified diff (git patch):

```diff
diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,3 @@
-old line
+new line
```

## Example Workflows

### Issue Handler with Local LLM

```yaml
name: Issue Handler

on:
  issues:
    types: [labeled]

jobs:
  handle:
    if: contains(github.event.issue.labels.*.name, 'ai-fix')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: restack/actions/actions/restack-code@v1
        with:
          llm_url: 'http://llm.example.com/v1/chat/completions'
          model: 'qwen3-coder'
          issue_number: ${{ github.event.issue.number }}
          issue_title: ${{ github.event.issue.title }}
          issue_body: ${{ github.event.issue.body }}
          commit: 'true'
          create_pr: 'true'
          post_comment: 'true'
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

### PR Review Comment Handler

```yaml
name: PR Review Handler

on:
  pull_request_review_comment:
    types: [created]

jobs:
  handle:
    if: contains(github.event.comment.body, '@ai-bot')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.ref }}
      - uses: restack/actions/actions/restack-code@v1
        with:
          llm_url: 'http://llm.example.com/v1/chat/completions'
          model: 'qwen3-coder'
          comment_body: ${{ github.event.comment.body }}
          event_name: ${{ github.event_name }}
          review_comment_path: ${{ github.event.comment.path }}
          review_comment_line: ${{ github.event.comment.line }}
          pr_head_ref: ${{ github.event.pull_request.head.ref }}
          pr_base_ref: ${{ github.event.pull_request.base.ref }}
          commit: 'true'
          post_comment: 'true'
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Development

### Build

```bash
cd actions/restack-code
pnpm install
pnpm build
```

### Test

```bash
pnpm test
```

### Files

- [action.yml](./action.yml) - Action metadata and inputs
- [src/index.ts](./src/index.ts) - Main action entry point
- [src/llm-client.ts](./src/llm-client.ts) - LLM HTTP client
- [src/utils.ts](./src/utils.ts) - Utility functions

## Notes

- **Local LLM Access**: Ensure the runner has network access to your LLM endpoint
- **Security**: Be cautious with LLM-driven commits; consider requiring PR reviews
- **Testing**: Run with `commit=false` first to inspect LLM responses

## License

See the monorepo root for license information.
