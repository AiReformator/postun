# Postun — Open-Source-Telegram-MCP-Server: Verbinde dein eigenes Telegram mit ChatGPT, Claude und Claude Code, nur lesend

[English](README.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt.md) · **Deutsch**

*Das englische README ([README.md](README.md)) ist maßgeblich; die Übersetzungen folgen ihm und können zeitlich hinterherhinken.*

**Postun Beta** ist ein quelloffener, nur lesender [MCP](https://modelcontextprotocol.io)-Server (Model Context Protocol) für Telegram. Er verbindet dein eigenes Telegram-Konto mit ChatGPT, Claude, Claude Code und anderen MCP-Clients, damit ein KI-Assistent deine Chats lesen, Nachrichten durchsuchen und öffentliche Kanäle ansehen kann. Du entscheidest, welche Konten und welche Leseberechtigungen jeder KI-Client erhält, und kannst den Zugriff jederzeit widerrufen. Nachrichtensuche, öffentliche Kanäle und Dateien sind implementiert, aber in der Produktion noch nicht verifiziert (siehe [Beta-Status](#beta-status)).

- Website: https://postun.org (English, Русский, Español, Português, Deutsch)
- Cabinet (Konto-Bereich): https://app.postun.org
- MCP-Endpunkt: `https://mcp.postun.org/mcp`
- Repository: https://github.com/AiReformator/postun
- Status: **kostenlose Beta**, experimentell. Es gab kein unabhängiges Sicherheitsaudit.

## Was es ist / Für wen es gedacht ist

Postun ist ein Konnektor zwischen einem **Benutzerkonto** bei Telegram (kein Bot) und einem KI-Client, der MCP spricht. Nach dem Verknüpfen deines Kontos kann der KI-Client eine kleine Menge nur lesender Tools aufrufen: deine Dialoge auflisten, den Nachrichtenverlauf lesen, Nachrichten durchsuchen, öffentliche Kanäle ansehen und Metadaten oder Dateien abrufen.

Gedacht ist es für alle, die KI mit ihren eigenen Telegram-Daten nutzen möchten:

- einen Gruppenchat oder eine lange, verpasste Unterhaltung zusammenfassen;
- etwas im Chatverlauf nach Bedeutung finden, nicht nur per Stichwort;
- öffentliche Kanäle, denen du folgst, durchsehen und analysieren;
- Telegram-Kontext in eine Sitzung mit ChatGPT, Claude oder Claude Code holen.

Was es **nicht** ist:

- Kein Telegram-Bot und kein „KI-Bot in Telegram“. Zu deinen Chats wird nichts hinzugefügt, und niemand schreibt in deinem Namen.
- Kein Weg, Nachrichten zu senden, etwas zu löschen oder in Telegram zu ändern. Es gibt keine Schreibberechtigung.
- Nicht Zero-Knowledge. Siehe [Sicherheits- und Datenschutzmodell](#sicherheits--und-datenschutzmodell).

## So funktioniert es

```text
Telegram-Login ──> QR-Verknüpfung ──> OAuth-Freigabe ──> MCP-Tools
(OIDC, Cabinet)    (MTProto,          (du wählst Konten   (nur lesende Aufrufe aus
                    optional           und Lese-           ChatGPT / Claude /
                    2FA-Passwort)      berechtigungen)     Claude Code)
```

1. **Melde dich** im Cabinet https://app.postun.org mit Telegram an.
2. **Verknüpfe dein Konto**, indem du in der Telegram-App einen QR-Code scannst (MTProto-Login). Nutzt du ein Cloud-Passwort (2FA), gibst du es bei der Verknüpfung im Cabinet ein.
3. **Verbinde einen KI-Client.** Der Client startet einen OAuth-Ablauf (mit PKCE) beim Autorisierungsserver von Postun. Auf der Zustimmungsseite wählst du, welche verknüpften Konten und welche Berechtigungen (Konten, Dialoge, Verlauf und Suche, öffentliche Kanäle, Dateien) dieser Client nutzen darf.
4. **Der KI-Client ruft MCP-Tools auf** unter `https://mcp.postun.org/mcp` mit seinem Zugriffstoken. Jeder Aufruf wird gegen die erteilte Freigabe geprüft, dann wird Telegram gelesen und das Ergebnis an den Client zurückgegeben.

Du kannst die Freigabe eines Clients widerrufen oder ein Konto jederzeit im Cabinet trennen.

## Schnellstart (für Nutzer)

1. Öffne https://postun.org und gehe ins Cabinet https://app.postun.org. Melde dich mit Telegram an.
2. Verknüpfe dein Telegram-Konto per QR-Code.
3. Verbinde deinen KI-Client mit der MCP-URL:

```text
https://mcp.postun.org/mcp
```

**ChatGPT** (benutzerdefinierter Konnektor, Entwicklermodus): Aktiviere in den ChatGPT-Einstellungen den Entwicklermodus, füge einen eigenen MCP-Konnektor hinzu, füge die obige URL ein und schließe die OAuth-Zustimmung ab. Die Menübezeichnungen hängen von deinem Tarif und der ChatGPT-Version ab.

**Claude Code:**

```bash
claude mcp add --scope user --transport http postun https://mcp.postun.org/mcp
```

Führe danach in Claude Code `/mcp` aus und authentifiziere `postun`. Hinweis: Der Ablauf mit Claude Code ist in Produktion **noch nicht verifiziert** (siehe [Statustabelle](#beta-status)).

**Andere MCP-Clients**, die entfernte HTTP-MCP-Server mit OAuth unterstützen, können dieselbe URL verwenden.

Tipp für die Beta: Probiere es zuerst mit einem Testkonto oder unkritischen Chats aus.

## MCP-Tools

Alle Tools sind **nur lesend**. Es gibt kein Tool, das etwas sendet, bearbeitet oder löscht, und keine Schreibberechtigung. Der Server erzwingt die Berechtigung jedes Tools unabhängig von Hinweisen des Clients.

| Tool | Was es tut | Berechtigung |
|---|---|---|
| `list_accounts` | Listet die Telegram-Konten, die dieser Client nutzen darf | `accounts:read` |
| `list_dialogs` | Listet Chats, Gruppen und Kanäle (Dialoge) | `dialogs:read` |
| `get_history` | Liest den Nachrichtenverlauf eines Dialogs | `messages:read` |
| `search_messages` | Durchsucht Nachrichten | `messages:read` |
| `search_channels` | Durchsucht öffentliche Kanäle | `channels:read` |
| `get_channel_posts` | Liest Beiträge eines öffentlichen Kanals | `channels:read` |
| `get_media_info` | Liefert Metadaten einer Datei oder eines Mediums | `media:read` |
| `get_media` | Übergibt eine Datei oder ein Medium an den KI-Client | `media:read` |

## Sicherheits- und Datenschutzmodell

- **Verschlüsselung im Ruhezustand.** Telegram-Sitzungen werden mit AES-256-GCM verschlüsselt. Jedes Konto hat einen eigenen Schlüssel, der von einem Key-Encryption-Key (KEK) umhüllt wird, der als Cloudflare-Secret gespeichert ist.
- **Keine Logs deiner Gespräche oder Anfragen.** Cloudflare-Logs sind deaktiviert, und der Code darf nur konstante Zeichenketten protokollieren. Das wird in der CI erzwungen (`npm run check:logging` und eine Prüfung der Cloudflare-Logging-Konfiguration).
- **Kein Archiv.** Nachrichten- und Dateiinhalte existieren nur im Arbeitsspeicher, während sie an deinen KI-Client ausgeliefert werden. Postun speichert verschlüsselte Telegram-Sitzungen, Freigaben (Berechtigungen), Tageszähler und begrenzte Dienstmetadaten.
- **Konstruktionsbedingt nur lesend.** Es gibt nur Leseberechtigungen: `accounts:read`, `dialogs:read`, `messages:read`, `channels:read`, `media:read`.
- **Widerrufbar.** Widerrufe einen Client oder trenne ein Konto im Cabinet, wann immer du willst.
- **Open Source.** Der Code für Verschlüsselung, Zugriffsprüfungen und die No-Logs-Regel ist öffentlich (siehe nächster Abschnitt).

**Was das nicht ist.** Postun ist **nicht Zero-Knowledge**. Betreiber und Infrastruktur (Cloudflare Workers und Durable Objects) sind Teil des Vertrauensmodells: Um mit Telegram zu sprechen, entschlüsselt der Dienst deine Sitzung, und ein böswilliger oder kompromittierter Betreiber, der das Deployment und seine Secrets kontrolliert, könnte technisch auf deine Daten zugreifen. Der KI-Anbieter, den du verbindest (OpenAI, Anthropic usw.), erhält, was die Tools zurückgeben, und speichert es nach eigenen Regeln. Nutze zuerst ein Testkonto und entscheide, was du teilen möchtest.

Details: [docs/03_SECURITY_PRIVACY.md](docs/03_SECURITY_PRIVACY.md).

## Philosophie: von Grund auf offen (Kerckhoffs' Prinzip)

Der Code ist vollständig offen, damit jeder prüfen kann, wie Verschlüsselung, Zugriffsprüfungen und die No-Logs-Regel tatsächlich funktionieren. Nach [Kerckhoffs' Prinzip](https://de.wikipedia.org/wiki/Kerckhoffs’_Prinzip) darf sich Sicherheit nur auf die Geheimhaltung der Schlüssel stützen, nicht auf die Geheimhaltung des Systemaufbaus. Echte Schlüssel liegen in Cloudflare-Secrets und niemals in diesem Repository; geschlossen bleiben nur Schlüssel, Tokens, Nutzerdaten, die Zugriffskonfiguration unseres Deployments, internes Arbeitsmaterial des Betreibers (einschließlich Anweisungen für KI-Modelle) und Material abgeschlossener Sicherheitsvorfälle. Wenn du unserem Deployment nicht vertrauen willst, lies den Code und betreibe deine eigene Instanz (siehe Self-Hosting).

## Beta-Status

Der Status stammt aus [apps/web/status.json](apps/web/status.json) (Stand 2026-11-05). Nur Funktionen mit einem dokumentierten Abnahmelauf in Produktion gelten als verifiziert. Dieselbe Tabelle steht unter https://postun.org/#features; die Verfügbarkeit des Dienstes unter https://postun.org/de/status/.

| Funktion | Status |
|---|---|
| Öffentliche Website | Verifiziert |
| Anmeldung mit Telegram (OIDC) | Verifiziert |
| Konto per QR verknüpfen | Verifiziert |
| Konto mit Cloud-Passwort (2FA) verknüpfen | Verifiziert |
| ChatGPT: MCP-Verbindung (OAuth) | Verifiziert |
| Dialoge und Nachrichtenverlauf lesen (über ChatGPT) | Verifiziert |
| Claude Code: Remote-HTTP-MCP | Noch nicht verifiziert |
| Nachrichtensuche | Noch nicht verifiziert |
| Öffentliche Kanäle | Noch nicht verifiziert |
| Datei-Download | Verifiziert |
| Datei als Anhang für die KI | In ChatGPT für Bilder verifiziert (PDF noch nicht) |

„Noch nicht verifiziert“ heißt: Der Code existiert, hat aber keinen Abnahmelauf in Produktion durchlaufen. Verlasse dich noch nicht auf diese Funktionen.

**Limit der kostenlosen Beta:** 10.000 erfolgreiche Operationen pro UTC-Tag und Eigentümer.

## Self-Hosting

Postun im eigenen Cloudflare-Konto mit eigenen Schlüsseln zu betreiben ist **geplant** und in [docs/04_DEPLOYMENT.md](docs/04_DEPLOYMENT.md) sowie [docs/DEPLOY_RUNBOOK.md](docs/DEPLOY_RUNBOOK.md) beschrieben. Es ist noch kein ausgereifter, unterstützter Installationsweg. Ziel ist, dass der Dienst nicht davon abhängt, dass postun.org erreichbar ist.

## Entwicklung

Postun läuft auf Cloudflare Workers, Durable Objects (SQLite-basiert), D1 und Workers KV und ist in TypeScript geschrieben. Node.js 26 (`.nvmrc`), npm workspaces, ein Lockfile.

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

`npm run ci` führt die gesamte Kette aus. Tests verwenden synthetische Daten und eine lokale Workers-Laufzeit (Miniflare/workerd); echte Telegram-, OIDC-Provider-(Administratoren-) und Cloudflare-Ressourcen werden in der CI nicht genutzt. Echte Secrets werden nur mit `wrangler secret put` im eigenen Cloudflare-Konto gesetzt; Beispiele für Variablen liegen in `apps/*/.dev.vars.example` und `templates/.env.example`.

Repository-Struktur:

```text
apps/web/            Cloudflare Workers (statische Dateien): Beta-Landingpage, Doku, Cabinet (statisch)
apps/auth/           postun-auth: Telegram OIDC, Web-Sitzung, MCP OAuth (Authorization Server), Cabinet-API
apps/mcp/            postun-mcp: MCP Resource Server, SessionAndQuotaDO, Telegram-Adapter (mtcute)
apps/admin/          postun-admin: OIDC-BFF für Administratoren, Aggregate, suspend/resume
packages/contracts/  gemeinsame Schemas, Scopes, Envelope-Verschlüsselung, Cursor, RPC-Verträge
migrations/control/  D1 postun-control (nur auth)
migrations/admin/    D1 postun-admin-meta (nur admin)
```

Hinweise für Mitwirkende: [CONTRIBUTING.md](CONTRIBUTING.md). Verwende in Tests und Issues synthetische Daten; hänge niemals echte Zugangsdaten, Login-Codes, private Chats oder Dateien an.

## Dokumentation

| Dokument | Zweck |
|---|---|
| [docs/01_PRODUCT_SPEC.md](docs/01_PRODUCT_SPEC.md) | Funktionen, Beta-Szenarien, Grenzen und Kontingente |
| [docs/02_ARCHITECTURE.md](docs/02_ARCHITECTURE.md) | Komponenten, Daten und Aufgabentrennung |
| [docs/03_SECURITY_PRIVACY.md](docs/03_SECURITY_PRIVACY.md) | Verschlüsselung, offener und geschlossener Teil |
| [docs/04_DEPLOYMENT.md](docs/04_DEPLOYMENT.md) | GitHub, Cloudflare, Secrets und Updates |
| [docs/05_ACCEPTANCE.md](docs/05_ACCEPTANCE.md) | Überprüfbare Startkriterien |
| [docs/06_ADMIN_OIDC.md](docs/06_ADMIN_OIDC.md) | Administrator-Anmeldung und Rollenmatrix |
| [docs/07_SOURCES.md](docs/07_SOURCES.md) | Geprüfte offizielle Quellen |
| [docs/08_DESIGN_NOTES.md](docs/08_DESIGN_NOTES.md) | Designentscheidungen und aufgelöste Widersprüche |
| [docs/DEPLOY_RUNBOOK.md](docs/DEPLOY_RUNBOOK.md) | Deployment-Runbook |
| [docs/PUBLICATION_POLICY.md](docs/PUBLICATION_POLICY.md) | Was wo veröffentlicht wird: Code auf GitHub, Rechtstexte auf der Website, Marketingmaterial nie |

Die ausführliche Dokumentation ist überwiegend auf Russisch verfasst.

## Sicherheitslücken melden

Melde Schwachstellen vertraulich über das GitHub Private Vulnerability Reporting dieses Repositorys; siehe [SECURITY.md](SECURITY.md). Veröffentliche keine Exploit-Details, Telegram-Sitzungen, privaten Gespräche, Login-Codes oder Tokens in öffentlichen Issues.

## Lizenz

[Apache-2.0](LICENSE).

## FAQ

**Was ist ein Telegram-MCP-Server?**
MCP (Model Context Protocol) ist ein offener Standard, mit dem KI-Clients wie ChatGPT, Claude und Claude Code externe Tools aufrufen können. Ein Telegram-MCP-Server stellt Telegram-Daten als solche Tools bereit. Postun ist ein gehosteter, nur lesender Server, der mit deinem eigenen Telegram-Konto arbeitet.

**Ist Postun ein Telegram-Bot?**
Nein. Ein Bot lebt innerhalb von Telegram, und du schreibst mit ihm. Postun fügt Telegram nichts hinzu: Es nutzt den Login deines Benutzerkontos und stellt deinem KI-Client nur lesende Tools bereit. Wer „ChatGPT-Bots in Telegram“ sucht, meint etwas anderes.

**Wie verbinde ich Telegram mit ChatGPT oder Claude?**
Melde dich unter https://app.postun.org an, verknüpfe dein Konto per QR-Code und füge dann `https://mcp.postun.org/mcp` als benutzerdefinierten MCP-Konnektor in ChatGPT hinzu (Entwicklermodus), oder führe für Claude Code `claude mcp add --scope user --transport http postun https://mcp.postun.org/mcp` aus. Siehe [Schnellstart](#schnellstart-für-nutzer).

**Ist es sicher?**
Es ist sorgfältig konzipiert: nur Leseberechtigungen, verschlüsselte Sitzungen, keine Logs von Gesprächen, widerrufbarer Zugriff, offener Code. Aber es ist eine Beta ohne unabhängiges Audit und nicht Zero-Knowledge: Betreiber und Cloudflare-Infrastruktur gehören zum Vertrauensmodell, und dein KI-Anbieter speichert Daten nach eigenen Regeln. Probiere es zuerst mit unkritischen Daten.

**Ist es kostenlos?**
Ja, die Beta ist kostenlos, mit einem Limit von 10.000 erfolgreichen Operationen pro UTC-Tag und Eigentümer. In der Beta gibt es keine Zahlungen, und das Limit kann sich ändern.

**Kann die KI Nachrichten senden oder etwas in meinem Telegram ändern?**
Nein. Es gibt nur lesende Tools, und der Server erzwingt die Leseberechtigungen.
