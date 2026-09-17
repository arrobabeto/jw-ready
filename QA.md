# Verificación del MVP — 17 de septiembre de 2026

## Resultado final

- Compilación TypeScript: correcta.
- 37 pruebas automatizadas: 37 aprobadas, 0 fallidas y 0 omitidas, incluyendo PostgreSQL aislado.
- Prueba real con OpenAI: inicio, respuesta, verificación y cierre de descubrimiento, profundización, aplicación, comentarios y repaso; cinco memorias extraídas.
- Ingestión real de ambos tipos de reunión: correcta.
- Transcripción real de un WAV sintético: correcta («La obediencia es importante para mi estudio»).
- Telegram: getMe correcto y sendMessage confirmado por la API al propietario existente. Se envió una única notificación técnica identificada como prueba.
- Imagen Docker reconstruida y servicios actualizados; PostgreSQL saludable y un propietario conservado. Puerto de base de datos restringido a localhost.

### Mejora conversacional

- Sesión normal: 5 pasos; rápida: 3; profundización: 6.
- Progreso visible, reconocimiento de la respuesta anterior y una pregunta por turno.
- El modelo no puede cerrar antes de tiempo; el cierre se controla en la aplicación.
- Cierre con síntesis y botones para seguir, profundizar, aplicar, preparar comentario o guardar.
- `/ayuda`, `/estado` con progreso y menú de comandos de Telegram.
- Verificación posterior: 39/39 pruebas automatizadas; los cinco nodos conversacionales con OpenAI real; recorrido real de tres pasos con progreso y cierre controlado.

## Fallos encontrados y corregidos

| Fallo | Corrección | Evidencia automatizada |
|---|---|---|
| ID de Telegram recuperado como string, bloqueando al propietario tras reiniciar | Normalización numérica al leer PostgreSQL | pg.test.ts |
| Sesiones nunca cerradas en PostgreSQL | Escritura explícita del estado y fecha de cierre | pg.test.ts, study.test.ts |
| Semana e identidad perdidas al recuperar sesiones | Mapeo completo SQL → dominio | pg.test.ts |
| Mensajes duplicados en MemoryStore | Copias independientes y persistencia única | study.test.ts |
| Cambios de nodos afectaban sesiones iniciadas | Snapshot persistente de nodos, fuentes y duración | study.test.ts, pg.test.ts |
| Verificador aceptaba JSON incompleto o sin aprobación | Esquemas estrictos y aprobación explícita | study.test.ts, llm.test.ts |
| Fuentes y mensajes introducidos como instrucciones | Datos en input separado; reglas protegidas en instrucciones | llm.test.ts |
| Modelo ignoraba el esfuerzo configurado | Envío de reasoning.effort por nodo | llm.test.ts |
| Feedback sin contexto y con nombre de nodo incorrecto | Traza por respuesta y referencia persistente al nodo y versión | bot.test.ts |
| Dudas confirmadas sin guardarse | Escritura real en memoria | bot.test.ts |
| Exportación truncada | Documento JSON completo | bot.test.ts |
| Horario fijo y problemas de zona horaria/cambio de año | Plan por reuniones, calendario local e ISO week-year | schedule.test.ts, planner.test.ts |
| Recordatorios duplicados después de reiniciar | Registro persistente por día | bot.test.ts |
| Audio sin límites y errores expuestos al usuario | Límites, timeout y mensaje de error sin credenciales | bot.test.ts |
| Promoción sin ejecutar candidatos | Reproducción de casos, verificación y comparación de salidas | improvement.test.ts |
| Candidato podía debilitar reglas protegidas | Validación completa antes de promover | improvement.test.ts |
| Falta de rollback | Backup y reemplazo atómico del YAML | improvement.test.ts |
| CLI podía acceder a rutas arbitrarias y mantener conexiones abiertas | Validación de ID y cierre del pool | cli.test.ts |
| Retención dejaba snapshots de sesiones antiguas | Purga de sesiones, trazas y material expirado | pg.test.ts |
| Redirecciones podían salir de dominios oficiales | Validación de cada salto HTTPS | planner.test.ts |
| Ruta npm start incorrecta | dist/src/index.js | Compilación y arranque Docker |
| Rechazo de una respuesta del modelo bloqueaba el turno sin intentar corregirla | Una reformulación acotada, seguida de la misma verificación; nunca se publica una respuesta rechazada | study.test.ts y smoke real |
| Recuerdos truncados a 100 afectaban exportación y búsqueda de feedback | Recuperación completa, contexto del modelo acotado por separado | pg.test.ts con más de 100 recuerdos |
| Un paquete oficial podía contener extractos con URLs externas o IDs duplicados | Validación individual de extractos | sources.test.ts |
| Evaluación de candidato omitía la pregunta final y procedencia del usuario | Validación del contenido completo y de IDs de mensajes | improvement.test.ts y validación compartida de contratos |

## Cómo reproducir

- `npm run build`
- `npm test`: pruebas unitarias y flujo Telegram con transporte y LLM simulados.
- `TEST_DATABASE_URL=postgres://jwready:jwready@localhost:5432/jwready_test npm test`: añade persistencia real. Usar exclusivamente una base de prueba con el esquema de db/init.sql.
- `npx tsx scripts/smoke.ts`: ingestión oficial, cinco tipos de sesión con OpenAI real y autenticación Telegram. Tiene coste de API; no envía mensajes ni modifica el historial del propietario.

La prueba PostgreSQL elimina datos solo en la base de prueba configurada. Nunca apuntar TEST_DATABASE_URL a la base personal.

## Alcance de la evidencia

Las pruebas cubren comandos, aislamiento, sesiones, guardado, feedback, fuentes, memoria, configuración, scheduler, cliente LLM, CLI y promoción/rollback. El flujo entrante de Telegram y sus comandos se simulan; la autenticación y entrega saliente se probaron con la API real. El audio tiene prueba de transporte simulado y una transcripción real independiente. No se simuló la interacción humana dentro de la aplicación de Telegram.

El optimizador y promoción/rollback se probaron con modelos simulados y archivos temporales: no se promovió ninguna regla usando tu historial. La memoria contextual usa recuerdos recientes, no búsqueda vectorial histórica. No se incluye todavía dashboard web ni un servicio remoto que mantenga el Mac despierto. La revisión de significado por LLM puede rechazar respuestas legítimas y no demuestra exactitud doctrinal absoluta.

No se declara un porcentaje de cobertura de líneas ni ausencia universal de errores. La mejora automática sigue requiriendo aprobación explícita de cada candidato.
