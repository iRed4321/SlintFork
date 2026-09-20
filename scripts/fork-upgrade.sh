#!/bin/sh
# Rebases the fork's patch series onto a newer upstream Slint release.
#
#   scripts/fork-upgrade.sh v1.18.0 v1.19.0
#
# creates `patched/1.19.0` from `patched/1.18.0`, replaying every commit that sits on top of the
# old upstream tag onto the new one. Stops at the first conflict like any rebase: resolve it,
# `git add`, `git rebase --continue`. See FORK.md for what to check afterwards.
#
# Nothing is pushed anywhere, and `upstream` (GitHub) is fetch-only.
set -eu

fatal() {
  printf '%s\n' "$1" >&2
  exit 1
}

[ "$#" -eq 2 ] || fatal "Usage: $0 <old-upstream-tag> <new-upstream-tag>   (e.g. v1.18.0 v1.19.0)"
old="$1"
new="$2"
old_branch="patched/${old#v}"
new_branch="patched/${new#v}"

cd "$(git rev-parse --show-toplevel)"
[ -z "$(git status --porcelain --untracked-files=no)" ] || fatal "The working tree has uncommitted changes."

# the upstream remote exists to read from and must never be pushed to
if ! git remote get-url upstream >/dev/null 2>&1; then
  git remote add upstream https://github.com/slint-ui/slint.git
fi
git remote set-url --push upstream DISABLED-fetch-only

git fetch upstream --tags
git rev-parse -q --verify "refs/tags/$old^{commit}" >/dev/null || fatal "No upstream tag $old."
git rev-parse -q --verify "refs/tags/$new^{commit}" >/dev/null || fatal "No upstream tag $new (not released yet?)."
git rev-parse -q --verify "refs/heads/$old_branch" >/dev/null || fatal "No branch $old_branch to take the patches from."
if git rev-parse -q --verify "refs/heads/$new_branch" >/dev/null; then
  fatal "Branch $new_branch already exists."
fi

# the patches are the commits between the old tag and the old branch
git merge-base --is-ancestor "$old" "$old_branch" || fatal "$old_branch is not based on $old."
echo "Patches to carry over:"
git log --oneline "$old..$old_branch"

# remember how conflicts were resolved, so the next upgrade can reuse it
git config rerere.enabled true

git switch -c "$new_branch" "$old_branch"
echo "Rebasing onto $new..."
git rebase --onto "$new" "$old"
echo "Done: $new_branch. Now build and run the checks listed in FORK.md."
