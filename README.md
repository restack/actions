# @restack/actions

Yet Another Delicious GitHub Actions monorepo for Restack.

## Actions

### [k8s-manifest-updater](./actions/k8s-manifest-updater)
Updates Kubernetes manifests with new container images. Supports direct commits and Pull Requests.

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
