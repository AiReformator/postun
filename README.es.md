# Postun — servidor MCP de Telegram de código abierto: conecta tu propio Telegram a ChatGPT, Claude y Claude Code, solo lectura

[English](README.md) · [Русский](README.ru.md) · **Español** · [Português](README.pt.md) · [Deutsch](README.de.md)

*El README en inglés ([README.md](README.md)) es la versión canónica; las traducciones lo siguen y pueden ir con retraso.*

**Postun Beta** es un servidor [MCP](https://modelcontextprotocol.io) (Model Context Protocol) de código abierto para Telegram, de solo lectura. Conecta tu propia cuenta de Telegram con ChatGPT, Claude, Claude Code y otros clientes MCP, para que un asistente de IA pueda leer tus chats, buscar mensajes y consultar canales públicos. Tú decides qué cuentas y qué permisos de lectura recibe cada cliente de IA, y puedes revocar el acceso en cualquier momento. La búsqueda de mensajes, los canales públicos y los archivos están implementados, pero aún no verificados en producción (ver [estado de la beta](#estado-de-la-beta)).

- Sitio: https://postun.org (English, Русский, Español, Português, Deutsch)
- Panel: https://app.postun.org
- Endpoint MCP: `https://mcp.postun.org/mcp`
- Repositorio: https://github.com/AiReformator/postun
- Estado: **beta gratuita**, experimental. No se ha realizado una auditoría de seguridad independiente.

## Qué es y para quién es

Postun es un conector entre una **cuenta de usuario** de Telegram (no un bot) y un cliente de IA que habla MCP. Tras vincular tu cuenta, el cliente de IA puede llamar a un conjunto reducido de herramientas de solo lectura: listar tus diálogos, leer el historial de mensajes, buscar mensajes, consultar canales públicos y obtener metadatos o archivos.

Es para quien quiere usar IA con sus propios datos de Telegram:

- resumir un chat de grupo o una conversación larga que te perdiste;
- encontrar algo en el historial de tus chats por significado, no solo por palabra clave;
- revisar y analizar canales públicos que sigues;
- llevar contexto de Telegram a una sesión de ChatGPT, Claude o Claude Code.

Lo que **no** es:

- No es un bot de Telegram ni un «bot de IA dentro de Telegram». No se añade nada a tus chats y nadie escribe en tu nombre.
- No sirve para enviar mensajes, borrar ni cambiar nada en Telegram. No existe ningún permiso de escritura.
- No es de conocimiento cero (zero-knowledge). Consulta [Modelo de seguridad y privacidad](#modelo-de-seguridad-y-privacidad).

## Cómo funciona

```text
Inicio de sesión ──> Vinculación ──> Autorización ──> Herramientas MCP
con Telegram         por QR          OAuth            (llamadas de solo lectura
(OIDC, panel)        (MTProto,       (eliges cuentas   desde ChatGPT / Claude /
                     contraseña 2FA  y permisos de     Claude Code)
                     opcional)       lectura)
```

1. **Inicia sesión** en el panel https://app.postun.org con Telegram.
2. **Vincula tu cuenta** escaneando un código QR en la app de Telegram (inicio de sesión MTProto). Si usas contraseña en la nube (2FA), la introduces en el panel durante la vinculación.
3. **Conecta un cliente de IA.** El cliente abre un flujo OAuth (con PKCE) en el servidor de autorización de Postun. En la pantalla de consentimiento eliges qué cuentas vinculadas y qué permisos (cuentas, diálogos, historial y búsqueda, canales públicos, archivos) puede usar ese cliente.
4. **El cliente de IA llama a las herramientas MCP** en `https://mcp.postun.org/mcp` con su token de acceso. Cada llamada se comprueba contra la autorización concedida, se lee Telegram y el resultado se devuelve al cliente.

Puedes revocar la autorización de un cliente o desvincular una cuenta en el panel en cualquier momento.

## Inicio rápido (para usuarios)

1. Abre https://postun.org y entra en el panel https://app.postun.org. Inicia sesión con Telegram.
2. Vincula tu cuenta de Telegram con el código QR.
3. Conecta tu cliente de IA con la URL MCP:

```text
https://mcp.postun.org/mcp
```

**ChatGPT** (conector personalizado, modo desarrollador): activa el modo desarrollador en los ajustes de ChatGPT, añade un conector MCP personalizado, pega la URL de arriba y completa la pantalla de consentimiento OAuth. Los nombres de los menús dependen de tu plan y de la versión de ChatGPT.

**Claude Code:**

```bash
claude mcp add --scope user --transport http postun https://mcp.postun.org/mcp
```

Después ejecuta `/mcp` dentro de Claude Code y autentica `postun`. Nota: el flujo con Claude Code **aún no se ha verificado** en producción (consulta la [tabla de estado](#estado-de-la-beta)).

**Otros clientes MCP** que admitan servidores MCP HTTP remotos con OAuth pueden usar la misma URL.

Consejo para la beta: pruébalo primero con una cuenta de prueba o chats no sensibles.

## Herramientas MCP

Todas las herramientas son de **solo lectura**. No hay ninguna herramienta que envíe, edite o borre nada, ni permiso de escritura. El servidor aplica el permiso de cada herramienta con independencia de lo que sugiera el cliente.

| Herramienta | Qué hace | Permiso |
|---|---|---|
| `list_accounts` | Lista las cuentas de Telegram que este cliente puede usar | `accounts:read` |
| `list_dialogs` | Lista chats, grupos y canales (diálogos) | `dialogs:read` |
| `get_history` | Lee el historial de mensajes de un diálogo | `messages:read` |
| `search_messages` | Busca mensajes | `messages:read` |
| `search_channels` | Busca canales públicos | `channels:read` |
| `get_channel_posts` | Lee publicaciones de un canal público | `channels:read` |
| `get_media_info` | Devuelve metadatos de un archivo o medio | `media:read` |
| `get_media` | Entrega un archivo o medio al cliente de IA | `media:read` |

## Modelo de seguridad y privacidad

- **Cifrado en reposo.** Las sesiones de Telegram se cifran con AES-256-GCM. Cada cuenta tiene su propia clave, envuelta por una clave de cifrado de claves (KEK) guardada como secreto de Cloudflare.
- **Sin registros de tus conversaciones ni peticiones.** Los logs de Cloudflare están desactivados y el código solo puede registrar cadenas constantes. Se comprueba en CI (`npm run check:logging` y la verificación de la configuración de logs de Cloudflare).
- **Sin archivo.** El contenido de mensajes y archivos solo existe en memoria mientras se entrega a tu cliente de IA. Postun guarda sesiones de Telegram cifradas, autorizaciones (permisos), contadores diarios y metadatos de servicio limitados.
- **Solo lectura por construcción.** Solo existen permisos de lectura: `accounts:read`, `dialogs:read`, `messages:read`, `channels:read`, `media:read`.
- **Revocable.** Revoca un cliente o desvincula una cuenta en el panel cuando quieras.
- **Código abierto.** El código de cifrado, de comprobación de acceso y de la regla sin logs es público (ver la sección siguiente).

**Lo que esto no es.** Postun **no es de conocimiento cero**. El operador y la infraestructura (Cloudflare Workers y Durable Objects) forman parte del modelo de confianza: para hablar con Telegram el servicio descifra tu sesión, y un operador malintencionado o comprometido que controle el despliegue y sus secretos podría, técnicamente, acceder a tus datos. El proveedor de IA que conectes (OpenAI, Anthropic, etc.) recibe lo que devuelven las herramientas y lo conserva según sus propias reglas. Usa primero una cuenta de prueba y decide qué te parece aceptable compartir.

Detalles: [docs/03_SECURITY_PRIVACY.md](docs/03_SECURITY_PRIVACY.md).

## Filosofía: abierto por diseño (principio de Kerckhoffs)

El código es totalmente abierto para que cualquiera pueda comprobar cómo funcionan realmente el cifrado, las comprobaciones de acceso y la regla de no guardar logs. Según el [principio de Kerckhoffs](https://es.wikipedia.org/wiki/Principio_de_Kerckhoffs), la seguridad debe depender solo del secreto de las claves, no de ocultar el diseño del sistema. Las claves reales viven en secretos de Cloudflare y nunca en este repositorio; solo permanecen cerrados las claves, los tokens, los datos de usuarios, la configuración de acceso de nuestro despliegue, el material interno de trabajo del operador (incluidas las instrucciones para modelos de IA) y el material de incidentes de seguridad cerrados. Si no quieres confiar en nuestro despliegue, lee el código y ejecuta el tuyo (ver Autoalojamiento).

## Estado de la beta

El estado procede de [apps/web/status.json](apps/web/status.json) (actualizado el 2026-11-05). Solo se marcan como verificadas las funciones con una prueba de aceptación registrada en producción. La misma tabla está en https://postun.org/#features; la disponibilidad del servicio, en https://postun.org/es/status/.

| Función | Estado |
|---|---|
| Sitio público | Verificado |
| Inicio de sesión con Telegram (OIDC) | Verificado |
| Vincular una cuenta por QR | Verificado |
| Vincular una cuenta con contraseña en la nube (2FA) | Verificado |
| ChatGPT: conexión MCP (OAuth) | Verificado |
| Lectura de diálogos e historial de mensajes (vía ChatGPT) | Verificado |
| Claude Code: MCP HTTP remoto | Aún no verificado |
| Búsqueda de mensajes | Aún no verificado |
| Canales públicos | Aún no verificado |
| Descarga de archivos | Verificado |
| Archivo como adjunto para la IA | Verificado en ChatGPT para imágenes (PDF aún no) |

«Aún no verificado» significa que el código existe pero no ha pasado una prueba de aceptación en producción. No confíes todavía en esas funciones.

**Límite de la beta gratuita:** 10 000 operaciones correctas por día UTC y por propietario.

## Autoalojamiento

Ejecutar Postun en tu propia cuenta de Cloudflare, con tus propias claves, está **planificado** y descrito en [docs/04_DEPLOYMENT.md](docs/04_DEPLOYMENT.md) y [docs/DEPLOY_RUNBOOK.md](docs/DEPLOY_RUNBOOK.md). Todavía no es una vía de instalación pulida ni con soporte. El objetivo es que el servicio no dependa de que postun.org esté en línea.

## Desarrollo

Postun funciona sobre Cloudflare Workers, Durable Objects (con SQLite), D1 y Workers KV, y está escrito en TypeScript. Node.js 26 (`.nvmrc`), npm workspaces, un único lockfile.

```bash
source ~/.nvm/nvm.sh && nvm use   # Node 26
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run check:secrets
npm run check:logging
```

`npm run ci` ejecuta toda la cadena. Las pruebas usan datos sintéticos y un runtime local de Workers (Miniflare/workerd); en CI no se usan recursos reales de Telegram, el proveedor OIDC de administradores ni Cloudflare. Los secretos reales se definen solo con `wrangler secret put` en tu propia cuenta de Cloudflare; hay ejemplos de variables en `apps/*/.dev.vars.example` y `templates/.env.example`.

Estructura del repositorio:

```text
apps/web/            Cloudflare Workers (assets estáticos): landing beta, docs, panel (estático)
apps/auth/           postun-auth: Telegram OIDC, sesión web, MCP OAuth (authorization server), API del panel
apps/mcp/            postun-mcp: MCP resource server, SessionAndQuotaDO, adaptador de Telegram (mtcute)
apps/admin/          postun-admin: BFF OIDC de administradores, agregados, suspend/resume
packages/contracts/  esquemas comunes, scopes, cifrado envelope, cursores, contratos RPC
migrations/control/  D1 postun-control (solo auth)
migrations/admin/    D1 postun-admin-meta (solo admin)
```

Guía para colaboradores: [CONTRIBUTING.md](CONTRIBUTING.md). Usa datos sintéticos en pruebas e issues; nunca adjuntes credenciales reales, códigos de acceso, chats privados ni archivos.

## Documentación

| Documento | Propósito |
|---|---|
| [docs/01_PRODUCT_SPEC.md](docs/01_PRODUCT_SPEC.md) | Funciones, escenarios de la beta, límites y cuotas |
| [docs/02_ARCHITECTURE.md](docs/02_ARCHITECTURE.md) | Componentes, datos y separación de responsabilidades |
| [docs/03_SECURITY_PRIVACY.md](docs/03_SECURITY_PRIVACY.md) | Cifrado, qué es abierto y qué es cerrado |
| [docs/04_DEPLOYMENT.md](docs/04_DEPLOYMENT.md) | GitHub, Cloudflare, secretos y actualizaciones |
| [docs/05_ACCEPTANCE.md](docs/05_ACCEPTANCE.md) | Criterios verificables de lanzamiento |
| [docs/06_ADMIN_OIDC.md](docs/06_ADMIN_OIDC.md) | Acceso de administradores y matriz de roles |
| [docs/07_SOURCES.md](docs/07_SOURCES.md) | Fuentes oficiales consultadas |
| [docs/08_DESIGN_NOTES.md](docs/08_DESIGN_NOTES.md) | Decisiones de diseño y contradicciones resueltas |
| [docs/DEPLOY_RUNBOOK.md](docs/DEPLOY_RUNBOOK.md) | Guía de despliegue |
| [docs/PUBLICATION_POLICY.md](docs/PUBLICATION_POLICY.md) | Qué se publica y dónde: el código en GitHub, los documentos legales en el sitio, el material de marketing nunca |

La documentación detallada está escrita sobre todo en ruso.

## Notificar vulnerabilidades

Notifica las vulnerabilidades de forma privada mediante el private vulnerability reporting de GitHub de este repositorio; consulta [SECURITY.md](SECURITY.md). No publiques en issues abiertos detalles de exploits, sesiones de Telegram, conversaciones privadas, códigos de acceso ni tokens.

## Licencia

[Apache-2.0](LICENSE).

## Preguntas frecuentes

**¿Qué es un servidor MCP de Telegram?**
MCP (Model Context Protocol) es un estándar abierto que permite a clientes de IA como ChatGPT, Claude y Claude Code llamar a herramientas externas. Un servidor MCP de Telegram expone datos de Telegram como esas herramientas. Postun es uno alojado y de solo lectura que funciona con tu propia cuenta de Telegram.

**¿Postun es un bot de Telegram?**
No. Un bot vive dentro de Telegram y conversas con él. Postun no añade nada a Telegram: usa el inicio de sesión de tu cuenta de usuario y ofrece a tu cliente de IA herramientas de solo lectura. Si buscas «bots de ChatGPT en Telegram», es otra cosa.

**¿Cómo conecto Telegram a ChatGPT o Claude?**
Inicia sesión en https://app.postun.org, vincula tu cuenta con el código QR y luego añade `https://mcp.postun.org/mcp` como conector MCP personalizado en ChatGPT (modo desarrollador), o ejecuta `claude mcp add --scope user --transport http postun https://mcp.postun.org/mcp` para Claude Code. Consulta el [Inicio rápido](#inicio-rápido-para-usuarios).

**¿Es seguro?**
Está diseñado con cuidado: permisos de solo lectura, sesiones cifradas, sin logs de conversaciones, acceso revocable y código abierto. Pero es una beta sin auditoría independiente y no es de conocimiento cero: el operador y la infraestructura de Cloudflare forman parte del modelo de confianza, y tu proveedor de IA conserva datos según sus propias reglas. Pruébalo primero con datos no sensibles.

**¿Es gratis?**
Sí, la beta es gratuita, con un límite de 10 000 operaciones correctas por día UTC y por propietario. No hay pagos en la beta y el límite puede cambiar.

**¿Puede la IA enviar mensajes o cambiar algo en mi Telegram?**
No. Solo existen herramientas de lectura y el servidor aplica los permisos de lectura.
