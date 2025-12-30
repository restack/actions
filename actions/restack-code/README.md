# restack-code

A lightweight GitHub Action that talks to a local LLM endpoint to analyze repository files and optionally apply suggested changes. The action is designed to be flexible with different local LLMs (HTTP JSON endpoints) and to follow a simple contract:

- Send a prompt and an optional set of files (or a git patch) to the LLM.
- Receive a response; if the response is a unified diff (git patch), optionally apply it, commit, push, and open a PR.

Files of interest:
- [`actions/restack-code/action.yml`](actions/restack-code/action.yml:1)
- [`actions/restack-code/src/index.ts`](actions/restack-code/src/index.ts:1)
- [`actions/restack-code/src/llm-client.ts`](actions/restack-code/src/llm-client.ts:1)
- [`actions/restack-code/package.json`](actions/restack-code/package.json:1)
- [`actions/restack-code/tsconfig.json`](actions/restack-code/tsconfig.json:1)

Quick concepts
- llm_url: full URL where the action will POST a JSON payload. The payload contains { model, prompt, files, max_tokens }.
- files: a glob or comma-separated globs of repository files to include in the payload.
- include_patch: when true the action will include a git diff (HEAD vs working tree) in the payload as `__git_diff__`.
- Commit flow: the LLM should return a unified diff (git patch). If commit=true, the action will apply the patch, commit, push and (optionally) create a PR.

Build
1. From the repository root:
   - Install dependencies: `just install` (monorepo) or `pnpm install`
2. Build this action:
   - cd into the action folder and run the build script:
     - `cd actions/restack-code && pnpm build`
   The build uses `@vercel/ncc` and generates `dist/index.js` referenced by the action metadata: see [`actions/restack-code/action.yml`](actions/restack-code/action.yml:1).

Inputs (see full list in action metadata)
- `llm_url` (required): Full URL to send prompt requests to (e.g. `http://localhost:8080/v1/generate`).
- `api_key` (optional): Bearer token for the LLM.
- `model` (optional): Model identifier (if the LLM supports it).
- `prompt` / `prompt_file` (optional): Prompt text or a path to a file in the repo used as the prompt.
- `files` (optional): Glob or comma-separated globs of files to include in the payload (e.g. `src/**/*.ts,package.json`).
- `include_patch` (optional; default `false`): If `true`, the current git diff for the selected files will be added as `__git_diff__`.
- `commit` (optional; default `false`): If `true`, the action will attempt to apply a returned patch and commit it.
- `create_pr` (optional; default `false`): If `true` and `commit` is true, create a PR from the branch.
- `github_token` (optional): Token used to push and create PRs (falls back to GITHUB_TOKEN).

Expected LLM response shapes
- The action is tolerant and will attempt to parse common response formats, but for automated application you should return a unified diff (git patch) like produced by `git diff`:
  - Example patch snippet:
    diff --git a/src/foo.ts b/src/foo.ts
    index 123..456 100644
    --- a/src/foo.ts
    +++ b/src/foo.ts
    @@ -1,6 +1,6 @@
    -old line
    +new line

- If the LLM returns natural language suggestions instead of a patch, the action will set outputs with the raw LLM response and skip applying changes (unless `commit` is requested and a patch-like string is present).

Example workflow
- A simple GitHub workflow that runs the action on push or PR and asks a local LLM for suggestions:

```yaml
name: LLM Suggestions

on:
  pull_request:
    types: [opened, synchronize, reopened]
  push:
    branches: [main]

jobs:
  suggest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run local LLM action
        uses: ./actions/restack-code
        with:
          llm_url: 'http://localhost:8080/v1/generate'
          model: 'local-model'
          prompt_file: '.github/llm/prompts/suggest_changes.txt'
          files: 'src/**/*.ts,package.json'
          include_patch: 'true'
          commit: 'true'
          create_pr: 'true'
          github_token: '${{ secrets.GITHUB_TOKEN }}'
```

Notes and best practices
- Local LLM endpoint: this action assumes your LLM is reachable from the runner. For self-hosted or local-only LLMs running on the same network, ensure the runner has network access (or use self-hosted runners).
- Security: be cautious when allowing arbitrary LLM-driven commits; restrict who can trigger the action or require PR reviews.
- Testing: before enabling `commit=true` on important branches, run with `commit=false` to inspect the raw LLM responses via action output (`llm_response`).
- Extensibility: the LLM client (`src/llm-client.ts`) is intentionally minimal; adapt it for specific LLM APIs (Anthropic, OpenAI, or other local endpoints) as needed.

Troubleshooting
- If the action fails to apply a patch, inspect the `llm_response` output to verify it is a valid unified diff.
- The action uses `git apply --index` to stage changes. Conflicts or malformed patches will cause the apply step to fail.

License and contribution
- This project follows the restack mono-repo conventions. Please open PRs for improvements. See the monorepo root README for contribution workflow.
