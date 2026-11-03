#!/usr/bin/env bash
# One-off setup: creates a free (Spark) Firebase project for Rally Point and deploys it.
# Safe to run again: it reuses the project in .firebaserc if one is already set.
set -euo pipefail
cd "$(dirname "$0")/.."
FB="npx --yes firebase-tools@15"

echo "== Checking which Google account the Firebase CLI uses"
if ! $FB login:list 2>/dev/null | grep "@" >/dev/null; then
  $FB login
fi
$FB login:list
read -r -p "Create and deploy the Rally Point project under this account? [y/N] " ok
[[ "$ok" =~ ^[Yy]$ ]] || { echo "Stopped. Switch account with: npx firebase-tools login:add"; exit 1; }

if [ -f .firebaserc ]; then
  PROJECT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.firebaserc','utf8')).projects.default)")
  echo "== Using existing project $PROJECT"
else
  PROJECT="rally-point-$(node -e "console.log(require('crypto').randomBytes(4).toString('hex').slice(0,5))")"
  echo "== Creating project $PROJECT (free Spark plan, no billing account attached)"
  $FB projects:create "$PROJECT" --display-name "Rally Point"
  printf '{\n  "projects": {\n    "default": "%s"\n  }\n}\n' "$PROJECT" > .firebaserc
fi

# A brand-new project takes a few minutes before every Google API answers, so retry.
retry() {
  local n=1
  until "$@"; do
    if [ $n -ge 5 ]; then return 1; fi
    echo "   ...not ready yet (attempt $n of 5). Waiting 45 seconds and trying again."
    n=$((n + 1)); sleep 45
  done
}

echo "== Creating the Firestore database in London (europe-west2)"
if $FB firestore:databases:list --project "$PROJECT" 2>/dev/null | grep "(default)" >/dev/null; then
  echo "   Firestore database already exists."
else
  retry $FB firestore:databases:create "(default)" --location=europe-west2 --project "$PROJECT"
fi

echo "== Deploying site, Firestore rules and anonymous sign-in"
retry $FB deploy --project "$PROJECT"

echo
echo "Done. Rally Point is live at: https://$PROJECT.web.app"
