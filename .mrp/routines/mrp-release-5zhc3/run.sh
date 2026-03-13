#!/usr/bin/env bash
set -euo pipefail

# MRP Release Routine
# Goal: Build, test, version bump, publish to npm + GitHub Packages, and create GitHub Release

BUMP_TYPE="${1:-patch}"  # patch, minor, major (default: patch)

echo "=== MRP Release ($BUMP_TYPE) ==="

# 1. Ensure clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Working tree is not clean. Commit or stash changes first."
  exit 1
fi

# 2. Run tests
echo "→ Running tests..."
bun test
echo "✅ Tests passed"

# 3. Run typecheck
echo "→ Running typecheck..."
bunx tsc --noEmit
echo "✅ Typecheck passed"

# 4. Version bump
echo "→ Bumping version ($BUMP_TYPE)..."
NEW_VERSION=$(npm version "$BUMP_TYPE" --no-git-tag-version | tr -d 'v')
echo "✅ Version bumped to $NEW_VERSION"

# 5. Build
echo "→ Building..."
bun run build
echo "✅ Build complete"

# 6. Commit and push
echo "→ Committing and pushing..."
git add -A
git commit -m "release: v${NEW_VERSION}"
git push origin main

# 7. Tag and push tag
echo "→ Tagging v${NEW_VERSION}..."
git tag -a "v${NEW_VERSION}" -m "v${NEW_VERSION}"
git push origin "v${NEW_VERSION}"

# 8. Publish to npm
echo "→ Publishing to npm..."
npm publish --access public
echo "✅ Published to npm"

# 9. Publish to GitHub Packages
echo "→ Publishing to GitHub Packages..."
NODE_AUTH_TOKEN="$(gh auth token)" npm publish --registry=https://npm.pkg.github.com --access public
echo "✅ Published to GitHub Packages"

# 10. Create GitHub Release
echo "→ Creating GitHub Release..."
gh release create "v${NEW_VERSION}" --title "v${NEW_VERSION}" --generate-notes
echo "✅ GitHub Release created"

echo ""
echo "=== Release v${NEW_VERSION} complete! ==="
echo "  npm: https://www.npmjs.com/package/@paulp-o/mrp/v/${NEW_VERSION}"
echo "  GitHub: https://github.com/paulp-o/modelroutineprotocol/releases/tag/v${NEW_VERSION}"
