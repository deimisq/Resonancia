#!/usr/bin/env bash
# Instala o actualiza Resonancia en un LXC Debian/Ubuntu. Ejecutar como root (idempotente).
#   bash install.sh            -> primera instalación o actualización
# Variables opcionales: REPO, BRANCH
set -euo pipefail

REPO="${REPO:-https://github.com/deimisq/Resonancia.git}"
BRANCH="${BRANCH:-main}"
APP=/opt/resonancia
ENVFILE=/etc/resonancia.env

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root"; exit 1; }

# 1. Paquetes y Node 22
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends curl ca-certificates git gnupg openssl
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# 2. Usuario y código
id resonancia >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin resonancia
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch origin "$BRANCH"
  git -C "$APP" checkout -q "$BRANCH"
  git -C "$APP" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" "$APP"
fi

# 3. Dependencias y build (vite es devDependency, por eso npm ci completo)
cd "$APP"
npm ci --no-audit --no-fund
npm run build
chown -R resonancia:resonancia "$APP"

# 4. Configuración (no se sobrescribe si ya existe)
if [ ! -f "$ENVFILE" ]; then
  cat > "$ENVFILE" <<EOF
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
ALLOW_SERVER_FALLBACK_KEY=false
FIREBASE_PROJECT_ID=$(node -p "require('./firebase-applet-config.json').projectId")
EOF
  chmod 640 "$ENVFILE"; chown root:resonancia "$ENVFILE"
  echo "Creado $ENVFILE (revísalo)."
fi

# 4b. Almacenamiento en la nube de usuarios (audios y ajustes cifrados). Idempotente.
# IMPORTANTE: respalda VAULT_SECRET y /var/lib/resonancia; sin el secreto, los ajustes guardados no se pueden descifrar.
grep -q '^VAULT_SECRET=' "$ENVFILE" || echo "VAULT_SECRET=$(openssl rand -hex 32)" >> "$ENVFILE"
grep -q '^DATA_DIR=' "$ENVFILE" || echo "DATA_DIR=/var/lib/resonancia" >> "$ENVFILE"
install -d -o resonancia -g resonancia -m 700 /var/lib/resonancia

# 5. Servicio
install -m 644 deploy/resonancia.service /etc/systemd/system/resonancia.service
systemctl daemon-reload
systemctl enable resonancia >/dev/null
systemctl restart resonancia
for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:3000/api/health && echo " <- OK" && break; sleep 1; done
systemctl --no-pager --lines=5 status resonancia || true
