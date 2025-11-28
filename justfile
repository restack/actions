# List available recipes
default:
  @just --list

# Install system dependencies
deps:
  uv tool install pre-commit

# Install dependencies
install:
  pnpm install

# Build all packages
build:
  pnpm build

# Run tests
test:
  pnpm test

# Lint code
lint:
  pnpm lint

# Typecheck code
typecheck:
  pnpm typecheck

# Clean build artifacts
clean:
  rm -rf node_modules
  rm -rf dist
  rm -rf packages/*/node_modules
  rm -rf packages/*/dist
  rm -rf actions/*/node_modules
  rm -rf actions/*/dist

# Update dependencies
update:
  pnpm update -r

# Run pre-commit checks on all files
check-hooks:
  pre-commit run --all-files

# Install pre-commit hooks
install-hooks:
  pre-commit install

# Setup GitHub App secrets
gh-secrets private-key-path="github-app.pem":
  gh secret set APP_ID --repo restack/actions
  gh secret set APP_PRIVATE_KEY --repo restack/actions < {{private-key-path}}
  gh secret set APP_INSTALLATION_ID --repo restack/actions
