<p align="center"><img src="public/logo.svg" width="96" alt="Resonancia"></p>

# Resonancia — Estudio de Síntesis de Voz Emotiva con IA

Aplicación web **full-stack** (React 19 + TypeScript + Express + Firebase Auth/Firestore + Gemini TTS) diseñada para crear locuciones expresivas, diálogos con múltiples voces y lotes de frases descargables en formato ZIP, preparada para despliegue público multiusuario con aislamiento por cuenta y arquitectura **BYOK (Bring Your Own Key)**.

---

## Características principales

- **Estudio de locución expresiva**: 5 perfiles de voz (`Kore`, `Zephyr`, `Puck`, `Charon`, `Fenrir`), 8 registros emocionales, control de intensidad y cadencia, marcadores respiratorios (`<breath>`, `<laugh>`, `<gasp>`) y mejora prosódica asistida (`POST /api/tts/enhance`).
- **Clonación de voz propia gratuita (Motores Open-Source sin hardware propio)**: Graba una muestra corta o sube un audio local (`WAV 24 kHz mono`) para generar audios con tu voz sin costo de Gemini Tier 1 usando **Hugging Face Spaces (ZeroGPU)** (Chatterbox Multilingual, F5-TTS) o tu propio servidor **Google Colab T4 / Endpoint HTTPS** (Gradio o REST). Incluye modal de configuración con script Python copiable y prueba de conexión (`POST /api/opensource/test`).
- **Clonación de voz propia (Gemini Voices API)**: Graba desde tu micrófono la frase de consentimiento obligatorio y un texto propuesto por la app; el navegador convierte automáticamente el audio a **WAV 24 kHz mono 16-bit** para crear tu modelo vocal (`voice_...` en tu proyecto Gemini o `voicekey_...` local temporal de 7 días). *(Nota: Google exige una clave Gemini API en Nivel de Pago Tier 1+ para replicación vocal).*
- **Persistencia completa de parámetros**: Tu voz activa, emoción, dirección actoral, intensidad, cadencia y motor se guardan automáticamente como valores predeterminados entre sesiones.
- **Diálogos multi-personaje**: Hasta 8 locutores configurables con dirección emocional independiente y síntesis dual nativa o agrupada automáticamente en fragmentos WAV concatenados.
- **Lotes por frases y exportación ZIP**: Detección automática por numeración o segmentación con IA (`POST /api/tts/split-phrases`), recuperación automática ante límites de cuota (`429`) y descarga empaquetada de pistas `.wav`/`.mp3` numeradas con `jszip`.
- **Reproductor maestro con forma de onda**: Visualización interactiva en `<canvas>`, controles de velocidad (`0.85x`–`1.3x`) y descarga del audio generado.
- **Acceso con Google + aislamiento por usuario**: Autenticación con Firebase (`GoogleAuthProvider`), verificación de correo electrónico en backend y sincronización de preferencias e historial de guiones en Cloud Firestore + caché local IndexedDB aislada por `ownerId`.
- **Claves y tokens de sesión (BYOK / Open-Source)**: Cada usuario ingresa su propia clave de Google AI Studio (`POST /api/keys/validate`) o sus tokens opcionales de Hugging Face (`hf_...`) / Endpoint Bearer. Las credenciales **no se almacenan en Firestore ni en servidores**; permanecen únicamente en `sessionStorage` asociado al `uid` activo y se envían por HTTPS (`X-Gemini-Key`, `X-HF-Token`, `X-OpenSource-Token`).

---

## Arquitectura y seguridad

```
Navegador (React + Vite)
  ├── Firebase Auth (Google Sign-In con emailVerified requerido)
  ├── Cloud Firestore (users/{uid}, users/{uid}/private/info, users/{uid}/takes/{takeId})
  ├── IndexedDB aislado por ownerId (caché local de WAV y muestras Open-Source)
  └── sessionStorage (`resonancia_byok_${uid}`, `resonancia_hf_${uid}`, `resonancia_os_tok_${uid}`)
          │
          │  X-Firebase-Auth: <Firebase ID Token> (o Authorization: Bearer)
          │  X-Gemini-Key / X-HF-Token / X-OpenSource-Token
          ▼
Servidor Express (server.ts, puerto 3000)
  ├── Verificación criptográfica de ID Token (firebase-admin/auth)
  ├── Rate limiter por usuario (45 req/min) + validación estricta de URLs públicas (HTTPS + DNS)
  ├── Cabeceras HTTP de endurecimiento (nosniff, Referrer-Policy, Permissions-Policy)
  └── Proxy hacia Gemini TTS (v1beta) y motores Open-Source (@gradio/client / REST HTTPS) sin registrar credenciales
```

### Reglas de Firestore (`firestore.rules`)

- Bloqueo global por defecto (`allow read, write: if false`).
- Acceso estricto por propietario autenticado y correo verificado (`request.auth.uid == userId && request.auth.token.email_verified == true`).
- Validación de esquema, tipos, longitudes máximas y sellos de tiempo inmutables (`createdAt == request.time`).
- `users/{uid}/private/info` guarda únicamente un indicador booleano (`hasConfiguredApiKey`), **nunca** la clave real.

---

## Puesta en marcha local

### 1. Requisitos previos

- Node.js 22+
- Un proyecto en [Firebase Console](https://console.firebase.google.com/) con **Authentication (Google)** y **Cloud Firestore** habilitados.
- Una clave personal de [Google AI Studio](https://aistudio.google.com/apikey) para probar la síntesis.

### 2. Instalación

```bash
npm install
cp .env.example .env
```

Configura `.env` (o actualiza `firebase-applet-config.json` con tu propio proyecto Firebase si haces un fork):

```env
PORT=3000
ALLOW_SERVER_FALLBACK_KEY=false
FIREBASE_PROJECT_ID=tu-proyecto-firebase
```

### 3. Reglas de Firestore

Valida y despliega las reglas incluidas antes de abrir el entorno público:

```bash
npx eslint firestore.rules
firebase deploy --only firestore:rules
```

### 4. Ejecución en desarrollo y producción

```bash
# Desarrollo (Express + Vite middleware en el puerto 3000)
npm run dev

# Verificación de tipos, tests y compilación
npm run lint
npm test
npm run build

# Producción
NODE_ENV=production npm start   # en Windows PowerShell: $env:NODE_ENV='production'; npm start

# Opcional: sobrescribir modelos si Google los renombra
# GEMINI_TTS_MODEL, GEMINI_TTS_LITE_MODEL, GEMINI_TEXT_MODEL
```

---

## Publicación en GitHub

Antes de hacer `git push`:

1. Verifica que `.env` esté excluido (incluido en `.gitignore` mediante `.env*` y `!.env.example`).
2. Mantén `ALLOW_SERVER_FALLBACK_KEY=false` en entornos públicos para evitar consumo accidental de una cuota centralizada.
3. Si cambias de proyecto Firebase, reemplaza `firebase-applet-config.json` o define las variables `VITE_FIREBASE_*` y `FIREBASE_PROJECT_ID`.
