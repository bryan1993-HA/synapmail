#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/release.sh — Publier une nouvelle version de Synapmail
#
# Usage :
#   ./scripts/release.sh 1.2.3          → release patch/minor/major
#   ./scripts/release.sh 1.2.3-beta.1   → pre-release (détecté automatiquement)
#
# Ce script :
#   1. Vérifie que le dépôt est propre (rien à committer)
#   2. Met à jour package.json avec la nouvelle version
#   3. Committe "chore: release vX.Y.Z"
#   4. Crée le tag Git annoté vX.Y.Z
#   5. Pousse le commit + le tag vers origin/main
#   → GitHub Actions prend le relais et crée la release automatiquement
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Couleurs ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

log_info()    { echo -e "${BLUE}ℹ${RESET}  $*"; }
log_success() { echo -e "${GREEN}✓${RESET}  $*"; }
log_warn()    { echo -e "${YELLOW}⚠${RESET}  $*"; }
log_error()   { echo -e "${RED}✗${RESET}  $*" >&2; }

# ── Validation de la version ──────────────────────────────────────────────────
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  log_error "Version manquante."
  echo ""
  echo "  Usage: ./scripts/release.sh <version>"
  echo "  Exemples:"
  echo "    ./scripts/release.sh 1.0.0"
  echo "    ./scripts/release.sh 1.1.0"
  echo "    ./scripts/release.sh 2.0.0-beta.1"
  exit 1
fi

# Vérification du format semver
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
  log_error "Format de version invalide : '$VERSION'"
  log_error "Attendu : X.Y.Z ou X.Y.Z-prerelease (ex: 1.2.3, 2.0.0-beta.1)"
  exit 1
fi

TAG="v${VERSION}"

# ── Vérifications préalables ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Git doit être propre
if ! git diff --quiet || ! git diff --staged --quiet; then
  log_error "Le dépôt a des modifications non commitées."
  log_error "Committez ou stashez vos changements avant de lancer la release."
  git status --short
  exit 1
fi

# Le tag ne doit pas déjà exister
if git tag --list | grep -q "^${TAG}$"; then
  log_error "Le tag '$TAG' existe déjà."
  exit 1
fi

# Récupérer la version actuelle
CURRENT_VERSION=$(node -p "require('./package.json').version")

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  Release Synapmail${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
log_info "Version actuelle : ${CURRENT_VERSION}"
log_info "Nouvelle version : ${VERSION}"
log_info "Tag Git          : ${TAG}"
echo ""

# Confirmation
read -rp "$(echo -e "${YELLOW}Continuer ? [y/N]${RESET} ")" confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  log_warn "Release annulée."
  exit 0
fi

echo ""

# ── 1. Mettre à jour package.json ─────────────────────────────────────────────
log_info "Mise à jour de package.json..."
# Utiliser node pour modifier proprement sans toucher au formatage
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '${VERSION}';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
log_success "package.json → ${VERSION}"

# ── 2. Commit ─────────────────────────────────────────────────────────────────
log_info "Création du commit de release..."
git add package.json
git commit -m "chore: release ${TAG}"
log_success "Commit créé"

# ── 3. Tag annoté ─────────────────────────────────────────────────────────────
log_info "Création du tag ${TAG}..."
git tag -a "$TAG" -m "Release ${TAG}"
log_success "Tag ${TAG} créé"

# ── 4. Push ───────────────────────────────────────────────────────────────────
log_info "Push vers origin..."
git push origin HEAD
git push origin "$TAG"
log_success "Poussé vers GitHub"

# ── Résumé ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}${BOLD}  Release ${TAG} lancée avec succès !${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  GitHub Actions est en train de créer la release."
echo -e "  Suivi : ${BLUE}https://github.com/bryan1993-HA/synapmail/actions${RESET}"
echo -e "  Release : ${BLUE}https://github.com/bryan1993-HA/synapmail/releases/tag/${TAG}${RESET}"
echo ""
