# Política de seguridad

## Reportar una vulnerabilidad

**No abras un issue público** para vulnerabilidades. Usa el botón **Security → Report a vulnerability** de este repositorio en GitHub (reporte privado). Intentaremos responder en pocos días.

## Qué cubre

- Autenticación y verificación de tokens (`server.ts`).
- Reglas de Firestore (`firestore.rules`).
- Protección contra SSRF en los motores Open-Source (`server/netSafety.ts`).
- Manejo de claves BYOK (Gemini / Hugging Face): viven en `sessionStorage` y cabeceras HTTPS; nunca van a Firestore. Si el usuario lo permite, se guardan **cifradas (AES-256-GCM)** en el disco del servidor para sincronizarlas entre dispositivos (`server/userData.ts`).
- Almacenamiento de audios por usuario (`DATA_DIR`), aislamiento por cuenta y cuotas.

## Buenas prácticas al desplegar

- Mantén `ALLOW_SERVER_FALLBACK_KEY=false` en despliegues públicos.
- Publica detrás de HTTPS (túnel o proxy) y deja `HOST=127.0.0.1` si el proxy está en la misma máquina.
- Despliega las reglas de `firestore.rules` y añade solo tus dominios en Firebase Authentication → Authorized domains.
- Nunca subas un archivo `.env` al repositorio.
- Genera un `VAULT_SECRET` propio, respáldalo junto con `DATA_DIR` y no lo compartas.
