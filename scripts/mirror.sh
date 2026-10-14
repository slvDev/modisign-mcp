#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd -- "$script_dir/.."
if [[ "${1:-}" != "" && "${1:-}" != "--push" ]]; then
  echo "Usage: mirror.sh [--push]" >&2
  exit 1
fi

node scripts/mirror-source.mjs --check
mirror_dir="$(mktemp -d "${TMPDIR:-/tmp}/modisign-mirror.XXXXXX")"
trap 'rm -rf -- "$mirror_dir"' EXIT
node scripts/mirror-source.mjs --output "$mirror_dir"
(
  cd -- "$mirror_dir"
  npm ci
  npm run build
  npm test
)
node scripts/mirror-source.mjs --check
if [[ "${1:-}" != "--push" ]]; then
  echo "Isolated public mirror passed npm ci, build and tests. No push requested."
  exit 0
fi

repo_root="$(cd -- .. && pwd -P)"
if [[ "$(git -C "$repo_root" rev-parse --show-toplevel)" != "$repo_root" ]]; then
  echo "Push requires the source repository." >&2
  exit 1
fi
if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=all -- mcp web/src/lib server/src/studio-project.ts)" ]]; then
  echo "Refusing to push uncommitted MCP or shared-source changes." >&2
  exit 1
fi
expected_remote="git@github.com:slvDev/modisign-mcp.git"
fetch_remote="$(git -C "$repo_root" remote get-url --all mcp-public)"
push_remote="$(git -C "$repo_root" remote get-url --push --all mcp-public)"
if [[ "$fetch_remote" != "$expected_remote" || "$push_remote" != "$expected_remote" ]]; then
  echo "mcp-public must fetch and push only $expected_remote." >&2
  exit 1
fi

# Public history contains only generated snapshots, never private monorepo commits.
cd -- "$mirror_dir"
git init -q
git remote add origin "$expected_remote"
if git ls-remote --exit-code origin refs/heads/main >/dev/null; then
  git fetch --depth=1 origin main
  git reset --mixed FETCH_HEAD
fi
git add -- .
if ! git diff --cached --quiet; then
  git -c user.name="$(git -C "$repo_root" config user.name)" -c user.email="$(git -C "$repo_root" config user.email)" commit -m "chore: sync public MCP source"
  git -c remote.origin.mirror=false push --no-follow-tags --recurse-submodules=no origin HEAD:refs/heads/main
fi
