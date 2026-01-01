# @restack/actions

Yet Another Delicious GitHub Actions monorepo for Restack.

## Actions

### [k8s-manifest-updater](./actions/k8s-manifest-updater)
Updates Kubernetes manifests with new container images. Supports direct commits and Pull Requests.

### [restack-code](./actions/restack-code)
Interact with a local LLM to analyze or modify repository files. Supports JSON-based file actions or unified diff patches, with options to commit changes directly or create Pull Requests. Features include:
- GitHub App authentication
- Issue/PR context injection
- **PR review comment support** - respond to code review comments and push fixes to PR branches
- Automatic comment posting

## Development

This project uses `pnpm` for dependency management and `just` for running tasks.

### Prerequisites
- Node.js (v20+)
- pnpm
- just

### Commands

```bash
# Install dependencies
just install

# Build all packages
just build

# Run tests
just test

# Lint code
just lint

# Run pre-commit checks manually
just check-hooks
```

## Project Structure

- `actions/`: GitHub Actions source code.
- `packages/`: Shared libraries and utilities.
