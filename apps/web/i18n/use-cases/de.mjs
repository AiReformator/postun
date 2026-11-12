// Use-cases page (/use-cases/), German (Sie form). Keys match ./ru.mjs.
export default {
  navLabel: 'Beispiele',
  title: 'Telegram in ChatGPT, Claude und Gemini: 16 Beispiele – Postun',
  metaDescription: 'Telegram-Kanäle und Chats zusammenfassen, Nachrichten suchen, Kanäle analysieren – in ChatGPT, Claude und Gemini. 16 Beispiele. Nur lesend, kein Bot.',
  breadcrumbHome: 'Startseite',
  breadcrumbLabel: 'Brotkrümelnavigation',
  eyebrow: 'Anwendungsbeispiele',
  h1: 'Was Sie mit Telegram in ChatGPT, Claude und Gemini tun können',
  lead: 'Postun verbindet Ihr eigenes Telegram-Konto mit der KI, die Sie bereits nutzen. Sie schreiben der KI einfach, was Sie brauchen: Sie liest die passenden Chats und Kanäle über Postun und antwortet im Gespräch. Unten finden Sie 16 Szenarien mit fertigen Anfragen und ehrlichen Grenzen.',
  tocLabel: 'Abschnitte',
  howTitle: 'So fangen Sie an',
  how1: 'Melden Sie sich per Telegram im Postun-Dashboard an und verbinden Sie Ihr Konto per QR-Code.',
  how2: 'Fügen Sie Postun in ChatGPT, Claude, Claude Code, Gemini oder einem anderen MCP-Client über die MCP-Adresse hinzu: <a href="{home}#connect">Schritt-für-Schritt-Anleitung</a>.',
  how3: 'Schreiben Sie der KI eine der Anfragen unten in Ihren eigenen Worten und nennen Sie die gewünschten Chats oder Kanäle.',
  promptLabel: 'Beispielanfragen',
  limitLabel: 'Bitte beachten',
  toolsLabel: 'Postun-Tools',
  g1Title: 'Telegram-Kanäle mit KI analysieren',
  g1Intro: 'Die KI findet öffentliche Kanäle, liest deren Beiträge und wertet den Inhalt aus: Themen, Schwerpunkte, wiederkehrende Geschichten. Das ist eine Textanalyse, keine Statistik zu Abonnenten und Reichweite – die erhält Postun nicht.',
  g2Title: 'Zusammenfassungen, Digests und Artikelüberblicke',
  g2Intro: 'Sie müssen nicht durch Dutzende Kanäle und lange Chats scrollen: Die KI erstellt auf Ihre Bitte eine kurze Zusammenfassung für den gewählten Zeitraum.',
  g3Title: 'Arbeitschats und Kunden',
  g3Intro: 'Entscheidungen, Aufgaben und Absprachen aus der Arbeitskommunikation, ohne Hunderte Nachrichten noch einmal zu lesen.',
  g4Title: 'Communities und Inhalte',
  g4Intro: 'Worüber Ihre Community spricht und welche Fragen immer wiederkehren – als Themen, nicht als Zitate einzelner Personen.',
  g5Title: 'Telegram-Chats und Nachrichten durchsuchen',
  g5Intro: 'Die KI sucht nach den Wörtern und Wendungen, die Sie ihr nennen, probiert Varianten aus und liest bei Bedarf den Chatverlauf. Telegram sucht nach Wörtern, nicht nach Bedeutung: Geben Sie der KI also ein Wort, einen Namen oder einen Zeitraum. Statt eines Chat-Exports bekommen Sie den gewünschten Teil des Chatverlaufs zusammengefasst.',
  g6Title: 'Für Entwickler: Telegram-MCP in Claude Code',
  g6Intro: 'Claude Code und andere MCP-Clients lesen einen Entwicklungs- oder Support-Chat direkt während der Arbeit am Code.',
  u1: {
    title: 'Themenanalyse öffentlicher Kanäle',
    text: 'Die KI findet öffentliche Kanäle zu einem Thema, liest deren neueste Beiträge und arbeitet die Hauptthemen, wiederkehrende Geschichten und die Verschiebung der Schwerpunkte im Zeitraum heraus.',
    p1: 'Finden Sie öffentliche Kanäle mit „Elektroautos“ im Namen, lesen Sie die letzten 100 Beiträge der drei passendsten und nennen Sie die Hauptthemen mit Beispielen.',
    p2: 'Welche Themen kamen im Kanal @example in den letzten 200 Beiträgen am häufigsten vor? Erstellen Sie eine kurze Tabelle und sagen Sie mir, wie viele Beiträge Sie gelesen haben.',
    limit: 'Kanäle werden über Titel oder Benutzernamen gefunden, nicht über den Text der Beiträge. Das ist eine Inhaltsanalyse, keine Reichweitenstatistik.'
  },
  u2: {
    title: 'Konkurrenzkanäle auf Anfrage prüfen',
    text: 'Einmal pro Woche oder vor einem Termin: Lassen Sie die KI die neuesten Beiträge der Konkurrenz lesen – Produktstarts, Preise, Aktionen und wie sie ihre Vorteile darstellen.',
    p1: 'Lesen Sie die letzten 30 Beiträge der Kanäle @competitor1, @competitor2 und @competitor3 und berichten Sie mir von neuen Produkten, Preisänderungen und Aktionen. Nennen Sie die Daten.',
    p2: 'Wie formuliert jedes dieser Unternehmen in seinem Kanal seinen wichtigsten Vorteil? Vergleichen Sie das in einer Tabelle.',
    limit: 'Nur auf Ihre Anfrage: Postun beobachtet keine Kanäle und sendet keine Benachrichtigungen. Die KI findet jeden Kanal zuerst über den Benutzernamen (etwa eine Suche pro Sekunde) und liest ihn dann. Für Kanalbeiträge gibt es keinen Datumsfilter, daher blättert die KI zurück, bis sie das gewünschte Datum erreicht.'
  },
  u3: {
    title: 'Stimmung in einer Diskussion',
    text: 'Die KI liest eine Auswahl von Beiträgen und Nachrichten zu einem Produkt, einer Marke oder einem Ereignis und beschreibt den Ton: was gelobt wird, worüber man sich beschwert, welche Argumente sich wiederholen.',
    p1: 'Suchen Sie in meinen Chats und Kanälen nach Nachrichten mit dem Namen unseres Produkts und beschreiben Sie die allgemeine Stimmung. Nennen Sie ein paar kurze Zitate mit Datum.',
    p2: 'Welche Hauptkritikpunkte und welches Lob gibt es in diesen Kanälen zur neuen App-Version? Gruppieren Sie sie.',
    limit: 'Das ist eine qualitative Einschätzung der gelesenen Stichprobe, keine Umfrage und keine exakte Statistik. Nachrichten werden in den Chats Ihres Kontos gesucht, nicht in ganz Telegram.'
  },
  u4: {
    title: 'Digest der Kanäle, die Sie abonniert haben',
    text: 'Statt durch Dutzende Kanäle zu scrollen, bitten Sie um eine Zusammenfassung für einen gewählten Zeitraum: das Wichtigste nach Themen, ohne Wiederholungen und offensichtliche Werbung.',
    p1: 'Erstellen Sie einen Digest meiner Technik-Kanäle für die letzten drei Tage: die 10 wichtigsten Meldungen nach Themen, jeweils mit Kanal und Datum.',
    p2: 'Welche Meldungen dieser Woche kamen gleichzeitig in mehreren meiner Kanäle vor? In welchem Kanal erschienen sie zuerst?',
    limit: 'Der Digest entsteht auf Ihre Bitte und bleibt im Chat mit der KI. Postun kann ihn nicht in Telegram veröffentlichen – das tun Sie selbst.'
  },
  u5: {
    title: 'Überblick über Artikel und Links aus Gruppen',
    text: 'In Fachgruppen werden ständig Artikel geteilt. Die KI sammelt die Links eines Zeitraums, gruppiert sie nach Themen und beschreibt kurz, worum es in der Diskussion ging.',
    p1: 'Sammeln Sie die Artikel-Links, die im Oktober in der Gruppe „Produktmanager“ geteilt wurden, gruppieren Sie sie nach Themen und beschreiben Sie kurz die Diskussion zu jedem.',
    p2: 'Erstellen Sie einen Überblick: die 10 meistdiskutierten Beiträge dieser Gruppe im letzten Monat, je ein Satz dazu.',
    limit: 'Im Text ausgeschriebene Links sind sichtbar; hinter Wörtern versteckte Links werden unter Umständen nicht erfasst. Die Artikel selbst öffnet die KI nur, wenn sie ins Internet gehen kann.'
  },
  u6: {
    title: 'Langen Chat zusammenfassen',
    text: 'Eine hitzige Diskussion mit 500 Nachrichten verpasst? Die KI fasst kurz zusammen, was vereinbart wurde, welche Meinungen es gab und was offen blieb.',
    p1: 'Fassen Sie zusammen, was gestern Abend im Chat „Hausrenovierung“ besprochen wurde: Entscheidungen, offene Fragen, wer was übernimmt.',
    p2: 'Erstellen Sie eine kurze Zusammenfassung dieses Chats für die letzte Woche in fünf Punkten.',
    limit: 'Sprach- und Videonachrichten werden nicht transkribiert. Der Chatverlauf wird mit 100 Nachrichten pro Anfrage gelesen, lange Zeiträume dauern daher länger.'
  },
  u7: {
    title: 'Ergebnisse eines Arbeitschats: Entscheidungen und Aufgaben',
    text: 'Die KI liest einen Arbeitschat für einen Zeitraum und erstellt eine Liste der Entscheidungen, der Aufgaben mit Verantwortlichen und der vereinbarten Fristen.',
    p1: 'Lesen Sie den Projektchat „Website-Launch“ seit Montag und listen Sie die Entscheidungen, Aufgaben mit Verantwortlichen und Fristen auf.',
    p2: 'Welche Fragen in diesem Chat blieben in der letzten Woche unbeantwortet?',
    limit: 'Prüfen Sie die Ergebnisse am Original, bevor Sie handeln. Verbinden Sie keine Arbeitschats, wenn die Regeln Ihres Unternehmens das verbieten.'
  },
  u8: {
    title: '„Was habe ich verpasst?“',
    text: 'Nach dem Urlaub oder dem Wochenende geht die KI die gewünschten Chats durch und erzählt das Wichtigste: was entschieden wurde, was sich geändert hat und wo offenbar gerade auf Sie gewartet wird.',
    p1: 'Ich war vom 1. bis 10. November im Urlaub. Gehen Sie meine Arbeitschats durch und fassen Sie das Wichtigste zusammen: Entscheidungen, Planänderungen, Fragen an mich.',
    p2: 'In welchen Chats wurde ich in diesen Tagen namentlich angesprochen?',
    limit: 'Die KI sieht, wie viele ungelesene Nachrichten jeder Chat hat, aber nicht, welche Nachrichten ungelesen sind, und auch keine Erwähnungen als solche: Fragen an Sie erkennt sie nach dem Sinn.'
  },
  u9: {
    title: 'Vorbereitung auf ein Kundengespräch',
    text: 'Vor dem Termin stellt die KI den Chatverlauf mit dem Kunden zusammen: was vereinbart wurde, was zugesagt wurde und welche Fragen offen sind.',
    p1: 'Finden Sie meinen Chatverlauf mit der Firma Acme Inc. aus den letzten drei Monaten und erstellen Sie eine Übersicht fürs Gespräch: Absprachen, Zusagen auf beiden Seiten, offene Fragen.',
    p2: 'Was habe ich diesem Kunden zugesagt, und wurde es laut Chatverlauf erledigt?',
    limit: 'Gleichen Sie Zusagen und Zahlen mit den Originalnachrichten ab. Die Nachrichten des Kunden verarbeitet Ihr KI-Anbieter: Nutzen Sie das nur dort, wo Sie diese Korrespondenz weitergeben dürfen. Postun schreibt nichts in Ihr CRM: Das Ergebnis übertragen Sie selbst.'
  },
  u10: {
    title: 'Wiederkehrende Probleme im Kundenchat',
    text: 'Die KI liest einen Support-Chat oder eine Kunden-Community und gruppiert wiederkehrende Probleme, Fragen und Warnsignale.',
    p1: 'Lesen Sie den Support-Chat der letzten zwei Wochen und gruppieren Sie die Kundenprobleme nach Themen, mit ungefährer Anzahl der Anfragen.',
    p2: 'Welche Themen sind noch ungelöst und seit wann? Ohne Kundennamen.',
    limit: 'Die Zählungen sind ungefähr. Postun ersetzt kein Ticketsystem und antwortet nicht an Kunden.'
  },
  u11: {
    title: 'Worüber Ihre Zielgruppe spricht',
    text: 'In den Gruppen, in denen Sie Mitglied sind, findet die KI die meistdiskutierten Probleme und die Worte, mit denen die Leute darüber sprechen. Material für Produkt und Inhalte.',
    p1: 'Lesen Sie die letzten 300 Nachrichten der Gruppe „Indie-Gründer“ und nennen Sie die 10 meistdiskutierten Probleme in den Worten der Mitglieder, ohne Namen.',
    p2: 'Machen Sie aus den Fragen dieser Community 15 Ideen für Beiträge, jeweils mit kurzer Begründung.',
    limit: 'Verfügbar sind nur Chats, in denen Ihr Konto Mitglied ist. Fragen Sie nach Themen, nicht danach, wer was gesagt hat.'
  },
  u12: {
    title: 'FAQ aus dem Verlauf einer Community',
    text: 'Als Admin einer Community können Sie die KI bitten, immer wiederkehrende Fragen zu finden und aus den Antworten einen FAQ-Entwurf zu erstellen.',
    p1: 'Lesen Sie die letzten 500 Nachrichten unseres Chats und finden Sie die 15 am häufigsten gestellten Fragen. Stellen Sie zu jeder die beste Antwort aus dem Chat zusammen.',
    p2: 'Schreiben Sie einen Entwurf für die angeheftete Nachricht „Häufige Fragen“: Ich veröffentliche sie selbst.',
    limit: 'Veröffentlichen Sie Nachrichten von Mitgliedern nicht wörtlich und nicht mit Namen ohne deren Einverständnis.'
  },
  u13: {
    title: 'Content-Ideen aus dem Kanalvergleich',
    text: 'Die KI vergleicht Ihren Kanal mit ähnlichen nach Themen, Formaten und Beitragslänge und schlägt Themen vor, die Sie noch nicht behandelt haben.',
    p1: 'Lesen Sie die letzten 50 Beiträge meines Kanals und je 50 von zwei ähnlichen. Vergleichen Sie Formate und Themen und schlagen Sie 10 Beitragsideen vor, die ich noch nicht habe.',
    p2: 'Skizzieren Sie auf Basis des Vergleichs einen Redaktionsplan für die Woche. Veröffentlichen werde ich selbst.',
    limit: 'Aufrufe und Reaktionen sind nicht in den Daten, daher weiß die KI nicht, was gut ankam. Ein privater Kanal ist nur verfügbar, wenn Ihr Konto Mitglied ist. Fremde Beiträge sind für Ideen da, nicht zum Kopieren.'
  },
  u14: {
    title: 'Nachricht, Link oder Datei finden',
    text: 'Sie wissen noch, dass Ihnen jemand einen Link oder ein PDF geschickt hat, aber nicht wo? Nennen Sie ein Wort, einen Dateinamen, eine Person oder einen Zeitraum, und die KI durchsucht Ihre Chats und probiert verschiedene Formulierungen aus.',
    p1: 'Finden Sie im Chat mit der Buchhaltung die PDF-Rechnung vom September und nennen Sie mir Dateiname und Größe.',
    p2: 'Suchen Sie in meinen Arbeitschats nach Nachrichten mit den Wörtern zoom oder meet aus dem letzten Monat und zeigen Sie mir die Links darin.',
    limit: 'Die Suche findet Wörter und Dateinamen, nicht die Bedeutung, und hat keinen Datumsfilter: Den Zeitraum prüft die KI, indem sie den Chatverlauf liest. Die Suche über das ganze Konto läuft mit Pausen und geht schneller, wenn Sie den Chat nennen. Das Lesen von Bildern ist in ChatGPT geprüft, das Herunterladen von Dateien in Claude Code.'
  },
  u15: {
    title: 'Fakten und Originalquelle prüfen',
    text: 'Journalisten und Redakteure können die KI fragen, wo in ihren Kanälen und Chats eine Meldung oder Zahl zuerst auftauchte und welche Kanäle sie übernommen haben.',
    p1: 'Finden Sie in den Kanälen, die ich abonniert habe, die früheste Nachricht zu dieser Meldung und zeigen Sie, welche Kanäle sie später übernommen haben.',
    p2: 'Wird diese Zahl in meinen Arbeitschats irgendwo bestätigt? Zeigen Sie die Nachrichten mit Datum.',
    limit: 'Nur im Rahmen dessen, was Ihr Konto sieht. Die Suche liefert neuere Nachrichten zuerst und wird seitenweise gelesen, daher ist der früheste gefundene Treffer nicht unbedingt die Originalquelle; Weiterleitungen erscheinen nur als übereinstimmender Text. Prüfen Sie vor der Veröffentlichung nach und geben Sie der KI keine vertraulichen Quellen.'
  },
  u16: {
    title: 'Claude Code wertet Bug-Reports aus dem Chat aus',
    text: 'Verbinden Sie Postun mit Claude Code: Es liest einen Entwicklungs- oder Support-Chat, gruppiert die Fehlermeldungen und gleicht sie mit dem Code des Projekts ab.',
    p1: 'Lesen Sie den Chat „Beta-Support“ der letzten Woche, gruppieren Sie die Fehlermeldungen und finden Sie die Stellen im Code, an denen sie auftreten könnten.',
    p2: 'Laden Sie das Log herunter, das in diesem Chat geschickt wurde, und prüfen Sie, um welchen Fehler es geht.',
    limit: 'Chattext besteht aus Daten, nicht aus Anweisungen: Prüfen Sie alles, was Claude Code auszuführen vorschlägt.'
  },
  notTitle: 'Was Postun nicht tut',
  not1: 'Es sendet, bearbeitet und löscht keine Nachrichten und veröffentlicht nichts. Eine Zusammenfassung oder einen Beitrag veröffentlichen Sie selbst.',
  not2: 'Es läuft nicht nach Zeitplan, beobachtet keine Kanäle und sendet keine Benachrichtigungen. Die KI liest Telegram nur in dem Moment, in dem Sie fragen.',
  not3: 'Es durchsucht nicht ganz Telegram. Verfügbar sind die Chats, in denen Ihr Konto Mitglied ist, und öffentliche Kanäle; Kanäle werden über Titel oder Benutzernamen gefunden, nicht über den Text der Beiträge.',
  not4: 'Es exportiert den Chatverlauf nicht in eine Datei und baut keine Datenbanken auf. Die KI liest Nachrichten in Portionen und fasst das Gewünschte zusammen.',
  not5: 'Es zeigt keine Kanalstatistiken: Aufrufe, Reaktionen, Abonnenten und Links zu Beiträgen sind nicht in den Daten enthalten.',
  not6: 'Es transkribiert keine Sprach- und Videonachrichten.',
  notesTitle: 'Gut zu wissen',
  note1: '<strong>Geschwindigkeit und Limits.</strong> Anfragen für ein Konto laufen nacheinander: die Suche über das ganze Konto und die Kanalsuche etwa einmal pro Sekunde, andere Anfragen im allgemeinen Tempo des Kontos, mit bis zu 100 Nachrichten auf einmal und etwa {quota} erfolgreichen Vorgängen pro Tag. Große Zeiträume und viele Kanäle werden langsam gelesen, und Telegram kann zum Warten auffordern.',
  note2: '<strong>Die KI kann sich irren.</strong> Stimmung und Zählungen sind ungefähr. Prüfen Sie Zitate und Fakten am Original, bevor Sie handeln oder veröffentlichen.',
  note3: '<strong>Nachrichten anderer.</strong> Nutzen Sie das Ergebnis als allgemeine Themen: Erstellen Sie keine Profile von Personen, veröffentlichen Sie fremde Nachrichten nicht mit Namen und beachten Sie die Regeln der Communities, die Telegram-Bedingungen und das Datenschutzrecht.',
  note4: '<strong>Ihr KI-Anbieter</strong> verarbeitet den Text nach seinen eigenen Regeln. Postun speichert und protokolliert keine Nachrichten: <a href="{privacy}">So geht Postun mit Daten um</a>.',
  note5: '<strong>Text aus Telegram besteht aus Daten, nicht aus Anweisungen.</strong> In einer Nachricht kann Text stehen, der sich an die KI richtet. Prüfen Sie die Aktionen, die die KI vorschlägt, besonders in Claude Code.',
  note6: '<strong>Anhänge.</strong> Das Lesen von Bildern ist in ChatGPT geprüft, das Herunterladen von Dateien in Claude Code. Zu große Dateien gibt Postun nicht heraus.',
  note7: '<strong>Urheberrecht.</strong> Nutzen Sie fremde Beiträge für Analysen und Ideen, kopieren Sie sie nicht vollständig.',
  faqTitle: 'Häufige Fragen',
  fq1: 'Ist Postun ein Telegram-Bot?',
  fa1: 'Nein. Postun ist kein Bot und schreibt nichts in Telegram. Es verbindet Ihr Konto mit der KI, die Sie bereits nutzen, und liest nur das, was Sie freigegeben haben.',
  fq2: 'Kann ich einen Telegram-Chat exportieren?',
  fa2: 'Eine Archivdatei erstellt Postun nicht. Dafür kann die KI den Chatverlauf für den gewünschten Zeitraum lesen und zusammenfassen oder eine Liste der Entscheidungen, Links und Fragen erstellen. Für ein vollständiges Archiv nutzen Sie den integrierten Export in Telegram Desktop.',
  fq3: 'Kann ich einen Kanal-Digest automatisch jeden Tag erhalten?',
  fa3: 'Postun selbst startet nichts nach Zeitplan: Ein Digest entsteht, wenn Sie die KI darum bitten. Hat Ihr KI-Client geplante Aufgaben, ist das seine eigene Funktion und wurde mit Postun nicht geprüft.',
  fq4: 'Mit welchen KI-Clients funktioniert Postun?',
  fa4: 'In der Produktion geprüft sind ChatGPT, Claude, Claude Code und Gemini (Web). Andere MCP-Clients verbinden sich unter https://mcp.postun.org/mcp; den aktuellen Stand finden Sie auf der <a href="{home}#features">Startseite</a>.',
  finalTitle: 'Probieren Sie es mit Ihrem eigenen Telegram aus',
  finalText: 'Die Verbindung ist kostenlos und dauert ein paar Minuten. Den Zugriff eines KI-Clients können Sie im Dashboard jederzeit widerrufen.',
  finalHome: 'So verbinden Sie Postun',
  teaserTitle: 'Was Sie tun können',
  teaserText: 'Kanalanalyse, Chat-Zusammenfassungen, Digests und Nachrichtensuche: 16 Szenarien mit fertigen Anfragen.',
  teaserLink: 'Alle Anwendungsbeispiele'
};
