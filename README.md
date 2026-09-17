# JW Ready

MVP local de un compañero de estudio bíblico conversacional por Telegram. El comportamiento está dividido en nodos YAML versionados para poder ajustar prompts, reglas y modelo por nodo sin tocar el código.

## Arranque local

1. Copia `.env.example` a `.env` y completa `TELEGRAM_BOT_TOKEN` y `OPENAI_API_KEY`. `TELEGRAM_ALLOWED_USER_ID` es opcional: si queda vacío, el primer usuario que envíe `/start` se registra como propietario.
2. Inicia PostgreSQL:

   ```bash
   docker compose up -d postgres
   ```

3. Instala y valida:

   ```bash
   npm install
   npm run build
   npm test
   npm run nodes:validate
   ```

4. Arranca el bot:

   ```bash
   npm run dev
   ```

El bot usa long polling, descubre automáticamente la semana actual desde WOL/JW.org y actualiza las fuentes cada seis horas. Si no hay credenciales, el proceso puede ejecutarse en `STORE_MODE=memory` para probar parser y configuración, pero no responderá sesiones reales.

Para ejecutar todo en Docker: `docker compose up -d --build`. No ejecutes a la vez `npm run dev`: solo debe haber un proceso haciendo polling. Docker debe permanecer abierto y el Mac despierto para recibir mensajes y ejecutar el horario.

## Uso diario

- `/configurar 19:00 3 6 America/Mexico_City`: hora, día de reunión entre semana, día de fin de semana y zona horaria (0 domingo…6 sábado).
- `/hoy`: sesión guiada de 5 pasos elegida según la reunión más próxima. Después del comando solo responde con texto o audio; no hay que escribir `/hoy` otra vez.
- `/rapido`: recorrido de 3 pasos. `/profundizar`: investigación de 6 pasos.
- `/perla`, `/aplicar`, `/preparar`, `/repaso`: modos especializados; `/terminar` cierra la sesión.
- `/guardar tu idea`, `/comentarios`, `/duda tu pregunta`, `/fuentes`: notas y referencias.
- Botones 👍/👎: feedback explícito para proponer mejoras; una valoración negativa permite añadir una corrección.
- `/exportar`: documento JSON de tus datos. `/olvidar`: borra recuerdos no guardados. `/borrar_todo CONFIRMAR`: elimina tus datos, sin recuperación desde la aplicación.

Cada turno muestra `Paso X de Y`. El modelo puede proponer un cierre, pero la aplicación no permite terminar antes del número previsto de respuestas. Al cerrar aparecen botones para seguir, profundizar, aplicar, preparar un comentario o guardar la idea. `/ayuda` muestra este recorrido dentro de Telegram y el menú de comandos se configura al arrancar.

## Ajustar nodos

Edita un archivo de `nodes/`, incrementa `version` y ejecuta `npm run nodes:validate`. Los cambios no afectan sesiones ya iniciadas. El optimizador solo propone YAML; nunca lo publica automáticamente.

La configuración válida se recarga cada cinco segundos. `model.name` y `model.reasoning_effort` se aplican por nodo LLM; los nodos deterministas no llaman al modelo.

```bash
npm run cli -- nodes list
npm run cli -- nodes show discovery_coach
npm run cli -- improve run discovery_coach
npm run cli -- improve review candidate_xxx
npm run cli -- improve accept candidate_xxx
npm run cli -- nodes rollback discovery_coach
```

Para que `improve run` vea el historial debes usar `STORE_MODE=postgres` y `DATABASE_URL`. Se requieren cinco casos de feedback explícito del nodo. Las propuestas se guardan en `node_candidates` y deben revisarse antes de promoverse; el archivo anterior se conserva como backup.

## Privacidad

Los datos operativos viven localmente en PostgreSQL. Las notas de voz se eliminan tras transcribirlas. El historial no guardado caduca a los 90 días; los elementos guardados y casos de evaluación se conservan hasta que se borren manualmente.

Las conversaciones, fuentes y recuerdos relevantes se envían a OpenAI para generar respuestas; el audio se envía para transcribirlo. Telegram transporta tus mensajes. Las claves nunca deben compartirse por chat.

## Verificación y alcance

Consulta [QA.md](QA.md) para resultados, errores corregidos, comandos reproducibles y límites de las pruebas. El MVP es local y conversacional: la web y la búsqueda vectorial histórica quedan fuera de esta versión.
