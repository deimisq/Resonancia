<p align="center"><img src="public/logo.svg" width="96" alt="Resonancia"></p>

<h1 align="center">Resonancia</h1>

<p align="center">
  Estudio web de síntesis de voz emotiva con IA: locuciones expresivas, diálogos multi-personaje y lotes de frases descargables.
</p>

<p align="center">
  <a href="https://resonancia.sentrait.com.uy"><b>▶ Usar Resonancia ahora: resonancia.sentrait.com.uy</b></a>
</p>

<p align="center">
  <a href="https://github.com/sponsors/deimisq"><img alt="Apoyar en GitHub Sponsors" src="https://img.shields.io/badge/%E2%99%A5-Apoyar%20el%20proyecto-ea4aaa.svg"></a>
  <a href="LICENSE"><img alt="Licencia MIT" src="https://img.shields.io/badge/licencia-MIT-blue.svg"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-22%2B-339933.svg">
  <img alt="Versión" src="https://img.shields.io/badge/versi%C3%B3n-1.5.0-4f46e5.svg">
</p>

---

## ¿Qué es?

Resonancia es una aplicación **full-stack** (React 19 + TypeScript + Express + Firebase + Gemini TTS) pensada para publicarse en internet con **cuentas separadas por usuario** y arquitectura **BYOK** (*Bring Your Own Key*): cada persona entra con Google y usa **su propia clave de Gemini**, de modo que el servidor no asume costes ni guarda credenciales.

## Úsala sin instalar nada

Hay una instancia pública en **<https://resonancia.sentrait.com.uy>**:

1. Entra con tu cuenta de Google (el correo debe estar verificado).
2. Pega tu propia clave gratuita de [Google AI Studio](https://aistudio.google.com/apikey), o configura un motor Open-Source gratuito (Hugging Face).
3. Genera audios. Tu biblioteca, tus ajustes y tus audios te siguen en cualquier dispositivo donde inicies sesión.

> La instancia pública es un servicio hecho por una persona, sin garantías de disponibilidad. Si te sirve, puedes [apoyar al creador](https://github.com/sponsors/deimisq). Si prefieres control total, instálala en tu propio servidor (más abajo).

## Características

- **Locución expresiva**: 5 voces (`Kore`, `Zephyr`, `Puck`, `Charon`, `Fenrir`), 8 registros emocionales, intensidad y cadencia, marcadores `<breath>`, `<laugh>`, `<gasp>` y mejora prosódica asistida por IA.
- **Diálogos**: hasta 8 personajes con dirección emocional independiente; el servidor agrupa y concatena los fragmentos en un único WAV.
- **Lotes por frases**: detección por numeración o con IA, reintentos ante límites de cuota y descarga en **ZIP** (`.wav`/`.mp3`).
- **Clonación de voz**
  - *Gratuita*: motores **Open-Source** vía Hugging Face Spaces (Chatterbox, F5-TTS) o tu propio endpoint (Google Colab / Gradio / REST) con una muestra de tu voz.
  - *Gemini Voices API*: con frase de consentimiento grabada (requiere clave Gemini de pago, Tier 1+).
- **Reproductor con forma de onda**, velocidad ajustable y descarga.
- **Sincronización entre dispositivos**: biblioteca (Firestore), **audios generados** y **ajustes de API** (claves y motores) disponibles en cualquier PC donde inicies sesión; con caché local en IndexedDB.

## Inicio rápido (local)

Requisitos: **Node.js 22+**, un proyecto de Firebase (ver abajo) y una [clave de Google AI Studio](https://aistudio.google.com/apikey).

```bash
git clone https://github.com/deimisq/Resonancia.git
cd Resonancia
npm install
cp .env.example .env     # en PowerShell: Copy-Item .env.example .env
npm run dev              # http://localhost:3000
```

Otros comandos: `npm run lint` (tipos), `npm test` (tests del servidor), `npm run build`, `npm start` (producción).

## Configurar Firebase

Este repo trae la configuración **pública** del proyecto de su autor en `firebase-applet-config.json`. Si haces un fork o tu propia instancia, crea el tuyo:

1. En la [consola de Firebase](https://console.firebase.google.com) crea un proyecto y registra una **app web** (`</>`); copia el bloque `firebaseConfig`.
2. **Authentication → Sign-in method**: habilita **Google**. En **Settings → Authorized domains** añade tu dominio público.
3. **Firestore Database**: crea la base `(default)` en modo producción.
4. **Reglas**: pega el contenido de [`firestore.rules`](firestore.rules) en la pestaña *Reglas* y publica.
5. **Índice compuesto**: en *Índices → Compuestos* crea `takes` · ámbito *Colección* · `ownerId` ascendente + `createdAt` descendente (equivale a [`firestore.indexes.json`](firestore.indexes.json)). Sin él, la biblioteca falla.
6. Pon tus valores en `firebase-applet-config.json` (o en las variables `VITE_FIREBASE_*` y `FIREBASE_PROJECT_ID`, que tienen prioridad).

> Las claves web de Firebase son públicas por diseño; la protección real son las reglas de Firestore y los dominios autorizados.

## Variables de entorno

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor |
| `HOST` | `0.0.0.0` | Interfaz de escucha (`127.0.0.1` si hay túnel/proxy local) |
| `FIREBASE_PROJECT_ID` | del `firebase-applet-config.json` | Proyecto con el que se verifican los tokens |
| `ALLOW_SERVER_FALLBACK_KEY` | `false` | Permite usar `GEMINI_API_KEY` del servidor si el usuario no trae la suya. **Déjalo en `false` en público** |
| `GEMINI_API_KEY` | — | Solo si el anterior es `true` |
| `GEMINI_TTS_MODEL`, `GEMINI_TTS_LITE_MODEL`, `GEMINI_TEXT_MODEL` | ver `server.ts` | Sobrescribe los modelos de Gemini si Google los renombra |
| `DATA_DIR` | `./data` | Carpeta de audios y ajustes cifrados de los usuarios (en el LXC: `/var/lib/resonancia`) |
| `VAULT_SECRET` | — | Secreto para cifrar los ajustes de los usuarios (`openssl rand -hex 32`). Sin él, solo se sincronizan los audios, no las claves |
| `USER_QUOTA_MB` | `300` | Espacio de audio máximo por usuario |
| `VITE_FIREBASE_*` | — | Sobrescriben la config web de Firebase (ver `.env.example`) |

## Despliegue en un servidor Linux (LXC / VM)

Probado en **Ubuntu 24.04** (LXC de 1 GB de RAM). Como root dentro del servidor:

```bash
apt-get update && apt-get install -y curl
curl -fsSL https://raw.githubusercontent.com/deimisq/Resonancia/main/deploy/install.sh | bash
```

[`deploy/install.sh`](deploy/install.sh) es idempotente: instala Node 22, crea el usuario `resonancia`, clona en `/opt/resonancia`, compila, crea `/etc/resonancia.env` (solo si no existe) y registra el servicio systemd [`resonancia`](deploy/resonancia.service). **Para actualizar, vuelve a ejecutarlo.**

```bash
systemctl status resonancia
journalctl -u resonancia -f
```

El instalador también genera `VAULT_SECRET` y crea `/var/lib/resonancia`. **Respalda ambos** (`/etc/resonancia.env` y esa carpeta): ahí viven los audios y los ajustes de los usuarios; sin el secreto, los ajustes guardados no se pueden recuperar.

El servicio escucha en `127.0.0.1:3000`. Para publicarlo, apunta un **túnel de Cloudflare** (o cualquier proxy inverso con HTTPS) a `http://localhost:3000` y añade el dominio en *Authorized domains* de Firebase.

## Arquitectura

```
Navegador (React + Vite)
  ├── Firebase Auth (Google, correo verificado obligatorio)
  ├── Cloud Firestore  users/{uid}, users/{uid}/private/info, users/{uid}/takes/{id}
  ├── IndexedDB (caché de audio y muestras, aislada por usuario)
  └── sessionStorage (claves BYOK de la sesión: Gemini / HF / Bearer)
        │  X-Firebase-Auth + X-Gemini-Key / X-HF-Token / X-OpenSource-Token
        ▼
Servidor Express (server.ts)
  ├── Verifica el ID token (firebase-admin) y limita 45 req/min por usuario
  ├── Proxy a Gemini TTS y a motores Open-Source (Gradio / REST)
  ├── Nube del usuario en disco (DATA_DIR): audios + ajustes cifrados con AES-256-GCM
  └── Sirve el frontend compilado (dist/) en producción
```

```
src/            Frontend (App.tsx, components/, lib/, types/)
server.ts       API Express y rutas
server/         Helpers del servidor: netSafety.ts (anti-SSRF), wav.ts, openSource.ts, userData.ts (nube/cifrado) + tests
deploy/         Instalador y unidad systemd
public/         Logo, iconos, manifest e imagen para compartir
firestore.rules Reglas de seguridad de Firestore
```

## Seguridad

- Las claves de los usuarios **nunca van a Firestore**. Para que te sigan entre dispositivos, se guardan **cifradas (AES-256-GCM, clave derivada por usuario de `VAULT_SECRET`)** en el disco del servidor y puedes desactivarlo con la casilla *Recordar en todos mis dispositivos* del modal de clave (al desmarcarla se borra la copia). El operador del servidor, que posee `VAULT_SECRET`, técnicamente podría descifrarlas: usa una instancia en la que confíes o instala la tuya.
- Los audios de cada usuario se guardan en el servidor, aislados por cuenta, con cuota por usuario (`USER_QUOTA_MB`).
- Reglas de Firestore por propietario con correo verificado, validación de esquema y de tamaños ([`security_spec.md`](security_spec.md)).
- Defensa contra **SSRF** en los endpoints externos: solo HTTPS, bloqueo de IPs privadas y comprobación de DNS en cada conexión, incluidas redirecciones.
- Los cuerpos JSON se leen **después** de autenticar; cabecera CSP en modo `Report-Only` (actívala cuando verifiques tu dominio).

Para reportar vulnerabilidades, consulta [SECURITY.md](SECURITY.md).

## Licencia y avisos de terceros

El código de Resonancia se publica bajo licencia **[MIT](LICENSE)** © 2026 Deimis Quintanilla. Las dependencias npm de producción usan licencias permisivas (MIT, Apache-2.0, ISC, BSD, 0BSD); no hay componentes copyleft que afecten a la distribución.

Servicios y modelos externos que **no** forman parte de este repositorio y tienen sus propias condiciones:

- **Google Gemini / Firebase**: sujetos a sus términos de uso y a la política de uso aceptable de la IA generativa.
- **Hugging Face Spaces** (Chatterbox, F5-TTS, etc.): cada Space y modelo tiene su propia licencia; algunos modelos (por ejemplo, pesos preentrenados de F5-TTS) pueden ser de **uso no comercial**. Revísalas antes de un uso comercial.
- **Tipografías** (Outfit, Plus Jakarta Sans, JetBrains Mono): SIL Open Font License, cargadas desde Google Fonts.

### Uso responsable de la clonación de voz

Clona **solo tu propia voz** o la de personas que hayan dado su consentimiento expreso. Suplantar la identidad de alguien o producir audio engañoso puede ser ilegal y va contra los términos de los proveedores. Quien opere una instancia es responsable del uso que se haga de ella.

## Apoyar el proyecto

Resonancia es gratuita y de código abierto. Si te resulta útil y quieres ayudar a mantenerla (servidor, tiempo de desarrollo), puedes apoyar al creador en **[GitHub Sponsors](https://github.com/sponsors/deimisq)**. ¡Gracias!

## Contribuir y versiones

Lee [CONTRIBUTING.md](CONTRIBUTING.md). El historial de cambios está en [VERSIONING.md](VERSIONING.md).
