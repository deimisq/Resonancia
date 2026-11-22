# Contribuir a Resonancia

¡Gracias por el interés! Para colaborar:

1. Haz un fork y crea una rama desde `main` (`feat/...` o `fix/...`).
2. Instala y verifica localmente:
   ```bash
   npm install
   npm run lint   # tsc --noEmit
   npm test       # tests del servidor (node:test vía tsx)
   npm run build
   ```
3. Mantén los cambios pequeños y enfocados; si tocas lógica del servidor (`server/`), añade o ajusta un test en `server/server.test.ts`.
4. Abre un Pull Request describiendo qué cambia y por qué. Si es un cambio visible, añade una captura.

Para vulnerabilidades, consulta [SECURITY.md](SECURITY.md). Al contribuir aceptas que tu aporte se publique bajo la licencia [MIT](LICENSE) del proyecto.
