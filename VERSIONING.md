# Historial de Versiones — Resonancia

## [1.4.0] - Endurecimiento, despliegue en Linux, logo y documentación
- **Seguridad**: cuerpos JSON leídos tras autenticar, guard global anti-SSRF (DNS verificado en cada conexión, incluido `@gradio/client`), límite de cuota que cuenta los fragmentos de diálogo, CSP en modo `Report-Only`.
- **Audio**: el PCM crudo de Gemini se envuelve en WAV; admite URLs firmadas largas de Hugging Face (límite 4096).
- **Código**: helpers del servidor movidos a `server/` con tests (`npm test`); modelos de Gemini configurables por variable de entorno; carga diferida de componentes pesados.
- **Despliegue**: `deploy/install.sh` + servicio systemd para Ubuntu/Debian (LXC/VM), variable `HOST`.
- **Firebase**: `firebase.json`, índice compuesto de `takes` y guía de configuración en el README.
- **Marca y documentación**: logo (favicon, manifest, imagen social), licencia MIT, `SECURITY.md`, `CONTRIBUTING.md` y README ampliado.

## [1.3.1] - Corrección de presets y diagnóstico de tokens/cuotas en Hugging Face
- **Presets verificados**: Se reemplazó el preset inactivo `SWivid/F5-TTS` (que devolvía HTTP 401 desde la API de Hugging Face) por el mirror oficial activo `ResembleAI/Chatterbox-Multilingual-TTS-V3`, manteniendo `ResembleAI/Chatterbox-Multilingual-TTS` y `mrfakename/E2-F5-TTS`. Se añadió migración automática desde `localStorage`.
- **Verificación real de HF Token (`whoami-v2`)**: Si el usuario ingresa un token `hf_...`, el backend valida formato y estado real en Hugging Face y muestra si el token es inválido, si faltó el prefijo `hf_`, si se agotó la cuota de ZeroGPU o si un Space es privado/inexistente, evitando mensajes falsos de rechazo de autenticación.
- **Descarga directa de audio firmado en `.hf.space` y sincronización del modal**: Se evita reenviar cabeceras `Authorization` sobre URLs firmadas con `?__sign=` en `.hf.space`, se corrige el fallback REST cuando falla un host Gradio y se sincroniza el estado interno de `OpenSourceConfigModal` cada vez que se abre.

## [1.3.0] - Motores Open-Source sin hardware propio (Hugging Face Spaces + Google Colab / Endpoint HTTPS)
- **Integración dual de clonación de voz gratuita (`@gradio/client` + REST)**:
  - Nuevo selector de motor con soporte para **Hugging Face Spaces (`opensource-hf`)** (incluyendo presets de `Chatterbox Multilingual`, `F5-TTS` y `E2-F5-TTS`, más token opcional `hf_...` de sesión) y **Endpoints HTTPS externos / Google Colab (`opensource-endpoint`)** con soporte automático para túneles Gradio (`*.gradio.live`) y webhooks REST JSON/binario.
  - Nuevo modal `OpenSourceConfigModal` con prueba de conectividad en vivo (`POST /api/opensource/test`) y plantilla Python lista para copiar y ejecutar en **Google Colab T4 gratuito**.
- **Muestra de voz propia gratuita (sin Tier de pago ni consentimiento)**:
  - Actualización de `PersonalVoiceRecorderModal` para grabar desde el micrófono o subir un archivo de audio local (`.wav`, `.mp3`, `.m4a`, etc.) convirtiéndolo en el navegador a WAV 24 kHz mono (`osvoice_...`) guardado localmente por `ownerId` en IndexedDB (`audioDb.ts`), con transcripción de referencia editable para modelos F5-TTS.
- **Seguridad y reglas actualizadas**:
  - Tokens de Hugging Face y Bearer del endpoint guardados únicamente en `sessionStorage` por `uid` (`X-HF-Token`, `X-OpenSource-Token`), nunca en Firestore ni en logs.
  - Validación estricta de URLs externas públicas (`HTTPS`, resolución DNS contra redes privadas/locales y validación de redirecciones) en `server.ts`.
  - Actualización de `firebase-blueprint.json` y `firestore.rules` desplegadas para admitir `opensource-hf` y `opensource-endpoint` en `preferredEngine`.

## [1.2.0] - Persistencia completa de parámetros y clonación de voz propia
- **Persistencia predeterminada completa**: La selección de voz, registro emocional, dirección actoral, intensidad, cadencia y motor se conserva automáticamente entre recargas y sesiones por usuario (sincronizada entre `localStorage` y `/users/{uid}` en Firestore, incluyendo reglas endurecidas actualizadas en `firestore.rules` y `firebase-blueprint.json`), así como la configuración del reparto en diálogos.
- **Clonación de voz propia (`Voices API v1beta`)**:
  - Nuevo modal `PersonalVoiceRecorderModal` con grabación de audio desde el navegador para el consentimiento obligatorio (`es-ES` / `en-US`) y la muestra vocal leyendo un guion propuesto por la app.
  - Conversión automática en el navegador (`wavEncoder.ts`) a **WAV 24 kHz mono PCM 16-bit**, formato requerido por Gemini Voices API.
  - Nuevas rutas `POST /api/voices/replicate`, `GET /api/voices` y `DELETE /api/voices/:voiceId` en `server.ts`, soporte de tokens `voice_...` y `voicekey_...` en locución individual y diálogos, y almacenamiento aislado por `ownerId` en IndexedDB (`audioDb.ts` v3).
  - Actualización de `Permissions-Policy` (`microphone=(self)`) y `metadata.json` (`requestFramePermissions: ["microphone"]`).

## [1.1.0] - Preparación pública, Firebase Auth/Firestore, BYOK y aislamiento multiusuario
- **Autenticación con Google (`Firebase Auth`)**: Inicio de sesión obligatorio con validación de `email_verified` tanto en frontend (`onAuthStateChanged`) como en backend (`verifyIdToken` mediante `firebase-admin/auth`).
- **Aislamiento de datos por usuario**:
  - Reglas endurecidas en `firestore.rules` para `/users/{userId}`, `/users/{userId}/private/info` y `/users/{userId}/takes/{takeId}` validadas con `@firebase/eslint-plugin-security-rules`.
  - Sincronización en la nube de preferencias de voz/motor y metadatos de tomas junto con caché local en IndexedDB filtrada estrictamente por `ownerId`.
- **Modelo BYOK (Bring Your Own Key)**:
  - Nuevo modal `ApiKeyModal` y endpoint `POST /api/keys/validate` para verificar la clave personal de Gemini directamente desde la sesión del usuario.
  - La clave permanece aislada en `sessionStorage` por `uid`, se limpia al cerrar sesión y nunca se persiste en Firestore ni en logs del servidor.
  - Modo servidor estricto por defecto (`ALLOW_SERVER_FALLBACK_KEY=false`).
- **Endurecimiento del backend (`server.ts`)**: Rate limiting por usuario, validación de longitudes y cabeceras de seguridad (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `x-powered-by` deshabilitado).
- **Documentación para GitHub**: Actualización de `.env.example` y creación de `README.md`.

## [1.0.0] - Estudio base de síntesis emotiva
- Estudio individual con voces `Kore`, `Zephyr`, `Puck`, `Charon` y `Fenrir`, presets emocionales, mejora prosódica (`/api/tts/enhance`) y reproductor con forma de onda.
- Modo diálogo multi-locutor (hasta 8 personas) con agrupación inteligente de fragmentos y concatenación WAV.
- Modo lote por frases con detección automática/IA (`/api/tts/split-phrases`), recuperación ante `429` y exportación ZIP numerada.
