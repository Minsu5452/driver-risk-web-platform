#!/usr/bin/env bash
# =================================================================
#  DriverRisk Platform - Build deployment zip (runs on Mac/Linux)
#
#  Strategy: take the previous verified bundle (python/jre/nginx/wheels)
#  as a template, then overlay freshly built frontend/backend/ai-engine
#  and updated scripts. This minimizes risk of regressions in the
#  Windows runtime (which we cannot easily re-build on Mac anyway).
#
#  Usage:
#    deploy/build-package.sh <TEMPLATE_ZIP> [OUTPUT_ZIP]
#
#  TEMPLATE_ZIP: 검증된 이전 런타임 번들 zip (python/jre/nginx/wheels 포함)
#  OUTPUT_ZIP 기본값: <project>/dist/DriverRisk-Platform-AutoStart-v<VERSION>.zip
# =================================================================

set -euo pipefail

# ---- Paths ----
SCRIPT_DIR="$( cd "$(dirname "${BASH_SOURCE[0]}")" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

TEMPLATE_ZIP="${1:?Usage: deploy/build-package.sh <TEMPLATE_ZIP> [OUTPUT_ZIP]}"

PKG_NAME="DriverRisk-Platform-AutoStart"

# ---- Version (from VERSION file at project root) ----
VERSION_FILE="$PROJECT_ROOT/VERSION"
[[ -f "$VERSION_FILE" ]] || { printf '\033[1;31m[error]\033[0m VERSION file missing at %s\n' "$VERSION_FILE" >&2; exit 1; }
VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
[[ -n "$VERSION" ]] || { printf '\033[1;31m[error]\033[0m VERSION file is empty\n' >&2; exit 1; }

OUTPUT_ZIP="${2:-$PROJECT_ROOT/dist/${PKG_NAME}-v${VERSION}.zip}"

# ---- Helpers ----
log()  { printf '\033[1;36m[build]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn ]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# ---- Pre-checks ----
[[ -f "$TEMPLATE_ZIP" ]] || die "Template zip not found: $TEMPLATE_ZIP"
command -v unzip   >/dev/null || die "unzip not installed"
command -v zip     >/dev/null || die "zip not installed"
command -v npm     >/dev/null || die "npm not installed"
command -v mvn     >/dev/null || die "mvn not installed (required for backend jar)"
command -v rsync   >/dev/null || die "rsync not installed"
command -v python3 >/dev/null || die "python3 not installed"

log "Version:  v$VERSION"
log "Template: $TEMPLATE_ZIP"
log "Output:   $OUTPUT_ZIP"
log "Project:  $PROJECT_ROOT"

# ---- Clean prior builds from dist/ (keep only the new zip) ----
mkdir -p "$(dirname "$OUTPUT_ZIP")"
PRIOR="$(ls -1 "$(dirname "$OUTPUT_ZIP")/${PKG_NAME}"*.zip 2>/dev/null || true)"
if [[ -n "$PRIOR" ]]; then
    log "Removing prior build(s):"
    echo "$PRIOR" | sed 's|^|   |'
    rm -f "$(dirname "$OUTPUT_ZIP")/${PKG_NAME}"*.zip
fi

# ---- Working directory ----
WORK_DIR="$(mktemp -d -t platform-build-XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT
log "Work dir: $WORK_DIR"

# ---- 1. Extract template ----
log "[1/8] Extracting template bundle..."
unzip -q "$TEMPLATE_ZIP" -d "$WORK_DIR"
PKG_DIR="$WORK_DIR/$PKG_NAME"
[[ -d "$PKG_DIR" ]] || die "Unexpected template structure (no $PKG_NAME)"

# ---- 2. Build frontend ----
log "[2/8] Building frontend (npm run build)..."
(
    cd "$PROJECT_ROOT/frontend"
    [[ -d node_modules ]] || npm ci
    rm -rf dist   # ensure a fully fresh dist (vite emptyOutDir + explicit belt-and-suspenders)
    npm run build
)
FRONTEND_DIST="$PROJECT_ROOT/frontend/dist"
[[ -d "$FRONTEND_DIST" ]]              || die "Frontend build produced no dist/"
[[ -f "$FRONTEND_DIST/index.html" ]]   || die "Frontend dist/index.html missing"

rm -rf "$PKG_DIR/frontend"
mkdir -p "$PKG_DIR/frontend"
cp -R "$FRONTEND_DIST" "$PKG_DIR/frontend/dist"
log "       Frontend overlay done."

# ---- 3. Build backend ----
log "[3/8] Building backend (mvn clean package)..."
(
    cd "$PROJECT_ROOT/backend"
    mvn -B -q -DskipTests clean package
)
BACKEND_JAR="$(ls -1 "$PROJECT_ROOT/backend/target/"*.jar 2>/dev/null | grep -v 'original' | head -n 1 || true)"
[[ -n "$BACKEND_JAR" && -f "$BACKEND_JAR" ]] || die "Backend jar not found under target/"

rm -rf "$PKG_DIR/backend"
mkdir -p "$PKG_DIR/backend"
cp "$BACKEND_JAR" "$PKG_DIR/backend/driverrisk-platform.jar"
log "       Backend overlay done: $(basename "$BACKEND_JAR") -> driverrisk-platform.jar"

# ---- 4. AI Engine source (strict exclusion of dev/test leftovers) ----
log "[4/8] Overlaying ai-engine source (excluding pycache/env/db/logs)..."

# Wipe the template's ai-engine completely so no stale files from previous
# packages can leak through.
rm -rf "$PKG_DIR/ai-engine"
mkdir -p "$PKG_DIR/ai-engine/src"

rsync -a \
    --exclude='__pycache__/' \
    --exclude='*.pyc' \
    --exclude='*.pyo' \
    --exclude='*.pyd' \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='*.log' \
    --exclude='*.db' \
    --exclude='*.db-wal' \
    --exclude='*.db-shm' \
    --exclude='*.sqlite' \
    --exclude='*.sqlite3' \
    --exclude='.venv/' \
    --exclude='.pytest_cache/' \
    --exclude='.ipynb_checkpoints/' \
    --exclude='*.parquet' \
    --exclude='*.csv' \
    --exclude='*.xlsx' \
    "$PROJECT_ROOT/ai-engine/src/" "$PKG_DIR/ai-engine/src/"

# Regenerate requirements.txt from pyproject.toml dependencies.
# The wheels in the template were built against these exact versions.
python3 - "$PROJECT_ROOT/ai-engine/pyproject.toml" "$PKG_DIR/ai-engine/requirements.txt" <<'PYEOF'
import sys, re
src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8").read()
m = re.search(r"dependencies\s*=\s*\[(.*?)\]", text, re.DOTALL)
if not m:
    raise SystemExit("dependencies block not found in pyproject.toml")
lines = []
for raw in m.group(1).splitlines():
    raw = raw.strip().rstrip(",")
    if raw.startswith('"') and raw.endswith('"'):
        lines.append(raw[1:-1])
open(dst, "w", encoding="utf-8").write("\n".join(lines) + "\n")
PYEOF
log "       AI Engine overlay done. requirements.txt regenerated."

# ---- 5. Scripts (install/start/stop + autostart task XML) ----
log "[5/8] Overlaying scripts..."
cp "$SCRIPT_DIR/scripts/install.bat"        "$PKG_DIR/install.bat"
cp "$SCRIPT_DIR/scripts/start.bat"          "$PKG_DIR/start.bat"
cp "$SCRIPT_DIR/scripts/stop.bat"           "$PKG_DIR/stop.bat"
cp "$SCRIPT_DIR/scripts/autostart-task.xml" "$PKG_DIR/autostart-task.xml"

# Strip any BOM so Windows cmd parses cleanly.
for f in install.bat start.bat stop.bat; do
    p="$PKG_DIR/$f"
    # Remove UTF-8 BOM if present (0xEF 0xBB 0xBF)
    if head -c 3 "$p" | od -An -tx1 | tr -d ' \n' | grep -q '^efbbbf$'; then
        tail -c +4 "$p" > "$p.tmp" && mv "$p.tmp" "$p"
        log "       Stripped BOM from $f"
    fi
done

# Convert LF -> CRLF so Notepad-based inspection stays sane.
for f in install.bat start.bat stop.bat; do
    p="$PKG_DIR/$f"
    awk 'BEGIN{ORS="\r\n"} {sub(/\r$/,""); print}' "$p" > "$p.tmp" && mv "$p.tmp" "$p"
done
log "       Scripts overlay done (CRLF, no BOM)."

# ---- 6. nginx.conf + README + VERSION ----
log "[6/8] Overlaying nginx.conf, README, VERSION..."
cp "$SCRIPT_DIR/nginx/nginx.conf" "$PKG_DIR/nginx/conf/nginx.conf"

# Operator-facing README (installation + operations guide)
cp "$SCRIPT_DIR/INSTALL.md" "$PKG_DIR/README.md"

# VERSION marker — useful on the operator PC (C:\DriverRisk-Platform\VERSION)
printf 'v%s\nbuild: %s\n' "$VERSION" "$(date +%Y-%m-%d)" > "$PKG_DIR/VERSION"

# ---- 7. Repackage ----
log "[7/8] Creating output zip..."
mkdir -p "$(dirname "$OUTPUT_ZIP")"
rm -f "$OUTPUT_ZIP"
(
    cd "$WORK_DIR"
    zip -qr "$OUTPUT_ZIP" "$PKG_NAME"
)

# ---- 8. Final verification (defence against dev/test leftovers) ----
log "[8/8] Verifying output zip contents..."
SUSPICIOUS_PATTERN='(__pycache__|\.pyc$|\.pyo$|\.venv/|\.pytest_cache|\.ipynb_checkpoints|admin\.db|\.db$|\.db-wal$|\.db-shm$|\.sqlite3?$|\.env$|artifacts/versions/|data/train/|data/uploads/|data/test_real_data/|first_data/|real_data/|node_modules/|backend/target/|backend/log/|backend/files/|\.DS_Store$|\.idea/|\.vscode/)'
TAINTED="$(unzip -l "$OUTPUT_ZIP" | awk '{print $NF}' | grep -Ei "$SUSPICIOUS_PATTERN" | head -50 || true)"
if [[ -n "$TAINTED" ]]; then
    warn "SUSPICIOUS paths found in output zip:"
    echo "$TAINTED" | sed 's/^/   /'
    die "Aborting — please inspect and exclude these before re-running."
fi

OUT_SIZE="$(du -h "$OUTPUT_ZIP" | awk '{print $1}')"
OUT_FILES="$(unzip -l "$OUTPUT_ZIP" | tail -1 | awk '{print $2}')"
log "Clean. No dev/test artifacts detected."
log "Done: $OUTPUT_ZIP ($OUT_SIZE, $OUT_FILES files)"
