# Postun — servidor MCP do Telegram de código aberto: conecte seu próprio Telegram ao ChatGPT, Claude e Claude Code, somente leitura

[English](README.md) · [Русский](README.ru.md) · [Español](README.es.md) · **Português** · [Deutsch](README.de.md)

*O README em inglês ([README.md](README.md)) é a versão canônica; as traduções o acompanham e podem ficar defasadas.*

**Postun Beta** é um servidor [MCP](https://modelcontextprotocol.io) (Model Context Protocol) de código aberto para o Telegram, somente leitura. Ele conecta a sua própria conta do Telegram ao ChatGPT, Claude, Claude Code e outros clientes MCP, para que um assistente de IA possa ler seus chats, buscar mensagens e consultar canais públicos. Você decide quais contas e quais permissões de leitura cada cliente de IA recebe, e pode revogar o acesso a qualquer momento. A busca de mensagens, os canais públicos e os arquivos estão implementados, mas ainda não foram verificados em produção (veja o [status do beta](#status-do-beta)).

- Site: https://postun.org (English, Русский, Español, Português, Deutsch)
- Painel: https://app.postun.org
- Endpoint MCP: `https://mcp.postun.org/mcp`
- Repositório: https://github.com/AiReformator/postun
- Status: **beta gratuito**, experimental. Nenhuma auditoria de segurança independente foi feita.

## O que é e para quem é

O Postun é um conector entre uma **conta de usuário** do Telegram (não um bot) e um cliente de IA que fala MCP. Depois de vincular a conta, o cliente de IA pode chamar um conjunto pequeno de ferramentas somente leitura: listar seus diálogos, ler o histórico de mensagens, buscar mensagens, consultar canais públicos e obter metadados ou arquivos.

É para quem quer usar IA com os próprios dados do Telegram:

- resumir um chat de grupo ou uma conversa longa que você perdeu;
- encontrar algo no histórico dos seus chats pelo sentido, não só por palavra-chave;
- revisar e analisar canais públicos que você segue;
- levar o contexto do Telegram para uma sessão do ChatGPT, Claude ou Claude Code.

O que ele **não** é:

- Não é um bot do Telegram nem um «bot de IA dentro do Telegram». Nada é adicionado aos seus chats e ninguém escreve em seu nome.
- Não serve para enviar mensagens, apagar ou alterar qualquer coisa no Telegram. Não existe permissão de escrita.
- Não é zero-knowledge (conhecimento zero). Veja [Modelo de segurança e privacidade](#modelo-de-segurança-e-privacidade).

## Como funciona

```text
Login com ──> Vínculo ──> Autorização ──> Ferramentas MCP
Telegram      por QR      OAuth           (chamadas somente leitura
(OIDC,        (MTProto,   (você escolhe    do ChatGPT / Claude /
painel)       senha 2FA   contas e         Claude Code)
              opcional)   permissões
                          de leitura)
```

1. **Entre** no painel https://app.postun.org com o Telegram.
2. **Vincule sua conta** escaneando um QR code no app do Telegram (login MTProto). Se você usa senha na nuvem (2FA), digite-a no painel durante o vínculo.
3. **Conecte um cliente de IA.** O cliente abre um fluxo OAuth (com PKCE) no servidor de autorização do Postun. Na tela de consentimento, você escolhe quais contas vinculadas e quais permissões (contas, diálogos, histórico e busca, canais públicos, arquivos) esse cliente pode usar.
4. **O cliente de IA chama as ferramentas MCP** em `https://mcp.postun.org/mcp` com seu token de acesso. Cada chamada é verificada contra a autorização concedida, o Telegram é lido e o resultado volta ao cliente.

Você pode revogar a autorização de um cliente ou desvincular uma conta no painel a qualquer momento.

## Início rápido (para usuários)

1. Abra https://postun.org e entre no painel https://app.postun.org. Faça login com o Telegram.
2. Vincule sua conta do Telegram com o QR code.
3. Conecte seu cliente de IA com a URL MCP:

```text
https://mcp.postun.org/mcp
```

**ChatGPT** (conector personalizado, modo desenvolvedor): ative o modo desenvolvedor nas configurações do ChatGPT, adicione um conector MCP personalizado, cole a URL acima e conclua a tela de consentimento OAuth. Os nomes dos menus dependem do seu plano e da versão do ChatGPT.

**Claude Code:**

```bash
claude mcp add --scope user --transport http postun https://mcp.postun.org/mcp
```

Depois execute `/mcp` dentro do Claude Code e autentique o `postun`. Observação: o fluxo com o Claude Code **ainda não foi verificado** em produção (veja a [tabela de status](#status-do-beta)).

**Outros clientes MCP** que suportem servidores MCP HTTP remotos com OAuth podem usar a mesma URL.

Dica para o beta: teste primeiro com uma conta de teste ou chats não sensíveis.

## Ferramentas MCP

Todas as ferramentas são **somente leitura**. Não existe ferramenta que envie, edite ou apague algo, nem permissão de escrita. O servidor aplica a permissão de cada ferramenta independentemente do que o cliente sugerir.

| Ferramenta | O que faz | Permissão |
|---|---|---|
| `list_accounts` | Lista as contas do Telegram que este cliente pode usar | `accounts:read` |
| `list_dialogs` | Lista chats, grupos e canais (diálogos) | `dialogs:read` |
| `get_history` | Lê o histórico de mensagens de um diálogo | `messages:read` |
| `search_messages` | Busca mensagens | `messages:read` |
| `search_channels` | Busca canais públicos | `channels:read` |
| `get_channel_posts` | Lê as publicações de um canal público | `channels:read` |
| `get_media_info` | Retorna metadados de um arquivo ou mídia | `media:read` |
| `get_media` | Entrega um arquivo ou mídia ao cliente de IA | `media:read` |

## Modelo de segurança e privacidade

- **Criptografia em repouso.** As sessões do Telegram são criptografadas com AES-256-GCM. Cada conta tem sua própria chave, envolvida por uma chave de criptografia de chaves (KEK) guardada como segredo do Cloudflare.
- **Sem logs das suas conversas ou requisições.** Os logs do Cloudflare estão desativados e o código só pode registrar strings constantes. Isso é verificado no CI (`npm run check:logging` e a verificação da configuração de logs do Cloudflare).
- **Sem arquivo morto.** O conteúdo de mensagens e arquivos existe apenas na memória enquanto é entregue ao seu cliente de IA. O Postun guarda sessões do Telegram criptografadas, autorizações (permissões), contadores diários e metadados de serviço limitados.
- **Somente leitura por construção.** Só existem permissões de leitura: `accounts:read`, `dialogs:read`, `messages:read`, `channels:read`, `media:read`.
- **Revogável.** Revogue um cliente ou desvincule uma conta no painel quando quiser.
- **Código aberto.** O código de criptografia, de verificação de acesso e da regra sem logs é público (veja a próxima seção).

**O que isto não é.** O Postun **não é zero-knowledge**. O operador e a infraestrutura (Cloudflare Workers e Durable Objects) fazem parte do modelo de confiança: para falar com o Telegram, o serviço descriptografa sua sessão, e um operador malicioso ou comprometido que controle a implantação e seus segredos poderia, tecnicamente, acessar seus dados. O provedor de IA que você conectar (OpenAI, Anthropic etc.) recebe o que as ferramentas retornam e o guarda conforme as próprias regras. Use primeiro uma conta de teste e decida o que você se sente à vontade para compartilhar.

Detalhes: [docs/03_SECURITY_PRIVACY.md](docs/03_SECURITY_PRIVACY.md).

## Filosofia: aberto por princípio (princípio de Kerckhoffs)

O código é totalmente aberto para que qualquer pessoa possa verificar como a criptografia, as verificações de acesso e a regra de não registrar logs realmente funcionam. Segundo o [princípio de Kerckhoffs](https://pt.wikipedia.org/wiki/Princ%C3%ADpio_de_Kerckhoffs), a segurança deve depender apenas do sigilo das chaves, não de esconder o projeto do sistema. As chaves reais ficam em segredos do Cloudflare e nunca neste repositório; permanecem fechados apenas chaves, tokens, dados de usuários, a configuração de acesso da nossa implantação, o material interno de trabalho do operador (incluindo instruções para modelos de IA) e o material de incidentes de segurança encerrados. Se você não quer confiar na nossa implantação, leia o código e rode a sua (veja Auto-hospedagem).

## Status do beta

O status vem de [apps/web/status.json](apps/web/status.json) (atualizado em 2026-11-05). Apenas funções com um teste de aceitação registrado em produção são marcadas como verificadas. A mesma tabela está em https://postun.org/#features; a disponibilidade do serviço, em https://postun.org/pt/status/.

| Função | Status |
|---|---|
| Site público | Verificado |
| Login com Telegram (OIDC) | Verificado |
| Vincular uma conta por QR | Verificado |
| Vincular uma conta com senha na nuvem (2FA) | Verificado |
| ChatGPT: conexão MCP (OAuth) | Verificado |
| Leitura de diálogos e histórico de mensagens (via ChatGPT) | Verificado |
| Claude Code: MCP HTTP remoto | Ainda não verificado |
| Busca de mensagens | Ainda não verificado |
| Canais públicos | Ainda não verificado |
| Download de arquivos | Ainda não verificado |
| Arquivo como anexo para a IA | Ainda não verificado |

«Ainda não verificado» significa que o código existe, mas não passou por um teste de aceitação em produção. Não confie ainda nessas funções.

**Limite do beta gratuito:** 10.000 operações bem-sucedidas por dia UTC por proprietário.

## Auto-hospedagem

Rodar o Postun na sua própria conta do Cloudflare, com suas próprias chaves, está **planejado** e descrito em [docs/04_DEPLOYMENT.md](docs/04_DEPLOYMENT.md) e [docs/DEPLOY_RUNBOOK.md](docs/DEPLOY_RUNBOOK.md). Ainda não é um caminho de instalação polido nem com suporte. O objetivo é que o serviço não dependa de o postun.org estar no ar.

## Desenvolvimento

O Postun roda em Cloudflare Workers, Durable Objects (com SQLite), D1 e Workers KV, e é escrito em TypeScript. Node.js 26 (`.nvmrc`), npm workspaces, um único lockfile.

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

`npm run ci` executa toda a cadeia. Os testes usam dados sintéticos e um runtime local do Workers (Miniflare/workerd); recursos reais do Telegram, o provedor OIDC de administradores e Cloudflare não são usados no CI. Segredos reais são definidos apenas com `wrangler secret put` na sua própria conta do Cloudflare; exemplos de variáveis estão em `apps/*/.dev.vars.example` e `templates/.env.example`.

Estrutura do repositório:

```text
apps/web/            Cloudflare Workers (arquivos estáticos): landing beta, docs, painel (estático)
apps/auth/           postun-auth: Telegram OIDC, sessão web, MCP OAuth (authorization server), API do painel
apps/mcp/            postun-mcp: MCP resource server, SessionAndQuotaDO, adaptador do Telegram (mtcute)
apps/admin/          postun-admin: BFF OIDC de administradores, agregados, suspend/resume
packages/contracts/  esquemas comuns, scopes, criptografia envelope, cursores, contratos RPC
migrations/control/  D1 postun-control (somente auth)
migrations/admin/    D1 postun-admin-meta (somente admin)
```

Orientações para colaboradores: [CONTRIBUTING.md](CONTRIBUTING.md). Use dados sintéticos em testes e issues; nunca anexe credenciais reais, códigos de login, chats privados ou arquivos.

## Documentação

| Documento | Finalidade |
|---|---|
| [docs/01_PRODUCT_SPEC.md](docs/01_PRODUCT_SPEC.md) | Funções, cenários do beta, limites e cotas |
| [docs/02_ARCHITECTURE.md](docs/02_ARCHITECTURE.md) | Componentes, dados e separação de responsabilidades |
| [docs/03_SECURITY_PRIVACY.md](docs/03_SECURITY_PRIVACY.md) | Criptografia, o que é aberto e o que é fechado |
| [docs/04_DEPLOYMENT.md](docs/04_DEPLOYMENT.md) | GitHub, Cloudflare, segredos e atualizações |
| [docs/05_ACCEPTANCE.md](docs/05_ACCEPTANCE.md) | Critérios verificáveis de lançamento |
| [docs/06_ADMIN_OIDC.md](docs/06_ADMIN_OIDC.md) | Login de administradores e matriz de papéis |
| [docs/07_SOURCES.md](docs/07_SOURCES.md) | Fontes oficiais verificadas |
| [docs/08_DESIGN_NOTES.md](docs/08_DESIGN_NOTES.md) | Decisões de projeto e contradições resolvidas |
| [docs/DEPLOY_RUNBOOK.md](docs/DEPLOY_RUNBOOK.md) | Guia de implantação |
| [docs/PUBLICATION_POLICY.md](docs/PUBLICATION_POLICY.md) | O que é publicado e onde: código no GitHub, documentos jurídicos no site, material de marketing nunca |

A documentação detalhada está escrita principalmente em russo.

## Relatar vulnerabilidades

Relate vulnerabilidades de forma privada pelo private vulnerability reporting do GitHub deste repositório; veja [SECURITY.md](SECURITY.md). Não publique em issues abertas detalhes de exploits, sessões do Telegram, conversas privadas, códigos de login ou tokens.

## Licença

[Apache-2.0](LICENSE).

## Perguntas frequentes

**O que é um servidor MCP do Telegram?**
MCP (Model Context Protocol) é um padrão aberto que permite a clientes de IA como ChatGPT, Claude e Claude Code chamar ferramentas externas. Um servidor MCP do Telegram expõe dados do Telegram como essas ferramentas. O Postun é um servidor hospedado e somente leitura que funciona com a sua própria conta do Telegram.

**O Postun é um bot do Telegram?**
Não. Um bot vive dentro do Telegram e você conversa com ele. O Postun não adiciona nada ao Telegram: usa o login da sua conta de usuário e oferece ao seu cliente de IA ferramentas somente leitura. Se você procura «bots de ChatGPT no Telegram», isso é outra coisa.

**Como conecto o Telegram ao ChatGPT ou ao Claude?**
Entre em https://app.postun.org, vincule sua conta com o QR code e depois adicione `https://mcp.postun.org/mcp` como conector MCP personalizado no ChatGPT (modo desenvolvedor), ou execute `claude mcp add --scope user --transport http postun https://mcp.postun.org/mcp` para o Claude Code. Veja o [Início rápido](#início-rápido-para-usuários).

**É seguro?**
Foi projetado com cuidado: permissões somente leitura, sessões criptografadas, sem logs de conversas, acesso revogável e código aberto. Mas é um beta sem auditoria independente e não é zero-knowledge: o operador e a infraestrutura do Cloudflare fazem parte do modelo de confiança, e seu provedor de IA guarda dados conforme as próprias regras. Teste primeiro com dados não sensíveis.

**É gratuito?**
Sim, o beta é gratuito, com limite de 10.000 operações bem-sucedidas por dia UTC por proprietário. Não há pagamentos no beta, e o limite pode mudar.

**A IA pode enviar mensagens ou alterar algo no meu Telegram?**
Não. Só existem ferramentas de leitura e o servidor aplica as permissões de leitura.
