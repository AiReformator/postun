import { readCookie } from '@postun/contracts';
import { esc } from './http';

export const LOCALES = ['en', 'ru', 'es', 'pt', 'de'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LANG_COOKIE = '__Host-postun_lang';
const LANG_MAX_AGE = 31_536_000;

/** Values are trusted markup written in this file; {placeholders} are always HTML-escaped on substitution. */
const en = {
  'err.title': 'Error',
  'err.code': 'Code: {code}',
  'err.generic': 'The request could not be completed.',
  'err.CONFIG_MISSING': 'The service is not configured yet. Please try again later.',
  'err.UNAUTHENTICATED': 'Sign-in is required.',
  'err.FORBIDDEN': 'This operation is not available.',
  'err.INVALID_INPUT': 'Invalid request.',
  'err.UPSTREAM_UNAVAILABLE': 'An external service is temporarily unavailable. Please try again.',
  'err.INTERNAL': 'Internal error. Please try again later.',
  'login.title': 'Sign in',
  'login.retry': 'Sign in again',
  'login.sessionLost': 'Your sign-in session was not found, has expired or was already used. Please start signing in again.',
  'login.cancelled': 'Telegram sign-in was cancelled or not confirmed.',
  'login.badResponse': 'Invalid response from Telegram.',
  'login.upstream': 'Telegram is temporarily unavailable. Please try again.',
  'login.verifyFailed': 'Could not verify the Telegram sign-in.',
  'login.failed': 'Could not complete sign-in.',
  'login.closedTitle': 'Beta is closed for now',
  'login.closed': 'Sign-up for the Postun beta is not open yet. Please check back later.',
  'root.text': 'Postun sign-in service (beta). Go to the <a href="{url}">dashboard</a>.',
  'terms.title': 'Beta terms',
  'terms.intro': 'Postun is an experimental project in open beta. Availability is not guaranteed and features may change.',
  'terms.li1': 'Postun reads your Telegram messages only when you request it through the AI client you chose, and does not keep an archive of your conversations.',
  'terms.li2': 'The Telegram session is stored in encrypted form; encryption does not make the service "zero-knowledge".',
  'terms.li3': 'You can disconnect an account, revoke a client\'s access or delete your profile at any time.',
  'terms.full': 'Full beta terms',
  'terms.privacy': 'Data handling',
  'terms.accept': 'I have read and accept the beta terms (version {version})',
  'terms.continue': 'Continue',
  'terms.mustAccept': 'You need to accept the terms to continue.',
  'oauth.suspended': 'Your profile is temporarily suspended.',
  'oauth.badRequest': 'Invalid authorization request.',
  'oauth.clientCheck': 'Could not verify the client application.',
  'oauth.noAccountsTitle': 'No accounts',
  'oauth.noAccounts': 'First connect your Telegram account in the <a href="{url}">Postun dashboard</a>, then connect the AI client again.',
  'oauth.title': 'Connect an AI client',
  'oauth.intro': 'The application <strong>{client}</strong> is requesting access to your Telegram data (read-only).',
  'oauth.publisher': 'Publisher: <strong>{domain}</strong>.',
  'oauth.selfRegistered': 'The application registered itself; its name has not been verified.',
  'oauth.tokensTo': 'Tokens will be sent to <strong>{host}</strong>.',
  'oauth.loopback': '<strong>Access will be sent to an application on your computer.</strong> Continue only if you have just started the sign-in from it yourself.',
  'oauth.accountsTitle': 'Which accounts to open to the client',
  'oauth.accountsHint': 'Select at least one. Accounts connected later will not be added here automatically.',
  'oauth.scopesTitle': 'Permissions (read-only)',
  'oauth.approve': 'Allow',
  'oauth.deny': 'Deny',
  'oauth.pickRequired': 'Select at least one account and one permission, then start the connection again.',
  'oauth.accountUnavailable': 'One of the selected accounts is unavailable. Start the connection again.',
  'oauth.scopesNotRequested': 'Permissions were selected that the client did not request.',
  'oauth.stale': 'The confirmation page has expired or was already used. If you already pressed Allow, return to the app and check whether it is connected. Otherwise start the connection again in the app.',
  'oauth.repeat': 'You have already allowed this connection. Return to the app: it should be connected. If it is not, start the connection again in the app.',
  'account.fallback': 'Telegram account',
  'scope.accounts:read': 'Accounts (accounts:read)',
  'scope.dialogs:read': 'Chat list (dialogs:read)',
  'scope.messages:read': 'Messages and search (messages:read)',
  'scope.channels:read': 'Public channels (channels:read)',
  'scope.media:read': 'Files and media (media:read)'
} as const;

export type MessageKey = keyof typeof en;
type Dictionary = Record<MessageKey, string>;

const ru: Dictionary = {
  'err.title': 'Ошибка',
  'err.code': 'Код: {code}',
  'err.generic': 'Не удалось выполнить запрос.',
  'err.CONFIG_MISSING': 'Сервис ещё не настроен. Попробуйте позже.',
  'err.UNAUTHENTICATED': 'Требуется вход.',
  'err.FORBIDDEN': 'Операция недоступна.',
  'err.INVALID_INPUT': 'Некорректный запрос.',
  'err.UPSTREAM_UNAVAILABLE': 'Внешний сервис временно недоступен. Попробуйте ещё раз.',
  'err.INTERNAL': 'Внутренняя ошибка. Попробуйте ещё раз позже.',
  'login.title': 'Вход',
  'login.retry': 'Войти заново',
  'login.sessionLost': 'Сессия входа не найдена, истекла или уже использована. Начните вход заново.',
  'login.cancelled': 'Вход через Telegram отменён или не подтверждён.',
  'login.badResponse': 'Некорректный ответ Telegram.',
  'login.upstream': 'Telegram временно недоступен. Попробуйте ещё раз.',
  'login.verifyFailed': 'Не удалось подтвердить вход через Telegram.',
  'login.failed': 'Не удалось завершить вход.',
  'login.closedTitle': 'Бета пока закрыта',
  'login.closed': 'Регистрация в бета-тестировании Postun пока не открыта. Загляните позже.',
  'root.text': 'Сервис входа Postun (бета). Перейдите в <a href="{url}">кабинет</a>.',
  'terms.title': 'Условия беты',
  'terms.intro': 'Postun — экспериментальный проект в открытом бета-тестировании. Доступность не гарантируется, функции могут меняться.',
  'terms.li1': 'Postun читает ваши сообщения Telegram только по вашим запросам через выбранного ИИ-клиента и не ведёт архив переписки.',
  'terms.li2': 'Сессия Telegram хранится в зашифрованном виде; шифрование не делает сервис «нулевого знания».',
  'terms.li3': 'Вы можете отключить аккаунт, отозвать доступ клиента или удалить профиль в любой момент.',
  'terms.full': 'Полные условия беты',
  'terms.privacy': 'Обработка данных',
  'terms.accept': 'Я прочитал(а) и принимаю условия бета-тестирования (версия {version})',
  'terms.continue': 'Продолжить',
  'terms.mustAccept': 'Нужно принять условия, чтобы продолжить.',
  'oauth.suspended': 'Профиль временно приостановлен.',
  'oauth.badRequest': 'Некорректный запрос авторизации.',
  'oauth.clientCheck': 'Не удалось проверить приложение клиента.',
  'oauth.noAccountsTitle': 'Нет аккаунтов',
  'oauth.noAccounts': 'Сначала подключите свой Telegram-аккаунт в <a href="{url}">кабинете Postun</a>, затем повторите подключение ИИ-клиента.',
  'oauth.title': 'Подключение ИИ-клиента',
  'oauth.intro': 'Приложение <strong>{client}</strong> запрашивает доступ к вашим данным Telegram (только чтение).',
  'oauth.publisher': 'Издатель: <strong>{domain}</strong>.',
  'oauth.selfRegistered': 'Приложение зарегистрировало себя само, его название не проверено.',
  'oauth.tokensTo': 'Токены будут отправлены на <strong>{host}</strong>.',
  'oauth.loopback': '<strong>Доступ будет отправлен приложению на вашем компьютере.</strong> Продолжайте, только если вы сами только что запустили вход из него.',
  'oauth.accountsTitle': 'Какие аккаунты открыть клиенту',
  'oauth.accountsHint': 'Отметьте хотя бы один. Аккаунты, подключённые позже, сюда автоматически не добавятся.',
  'oauth.scopesTitle': 'Разрешения (только чтение)',
  'oauth.approve': 'Разрешить',
  'oauth.deny': 'Отклонить',
  'oauth.pickRequired': 'Выберите хотя бы один аккаунт и одно разрешение, затем начните подключение заново.',
  'oauth.accountUnavailable': 'Один из выбранных аккаунтов недоступен. Начните подключение заново.',
  'oauth.scopesNotRequested': 'Выбраны разрешения, которые клиент не запрашивал.',
  'oauth.stale': 'Страница подтверждения устарела или уже использована. Если вы уже нажали «Разрешить», вернитесь в приложение и проверьте, подключено ли оно. Если нет, начните подключение в приложении заново.',
  'oauth.repeat': 'Вы уже разрешили это подключение. Вернитесь в приложение — оно должно быть подключено. Если подключения нет, начните его в приложении заново.',
  'account.fallback': 'Аккаунт Telegram',
  'scope.accounts:read': 'Аккаунты (accounts:read)',
  'scope.dialogs:read': 'Список чатов (dialogs:read)',
  'scope.messages:read': 'Сообщения и поиск (messages:read)',
  'scope.channels:read': 'Публичные каналы (channels:read)',
  'scope.media:read': 'Файлы и медиа (media:read)'
};

const pt: Dictionary = {
  'err.title': 'Erro',
  'err.code': 'Código: {code}',
  'err.generic': 'Não foi possível concluir a solicitação.',
  'err.CONFIG_MISSING': 'O serviço ainda não foi configurado. Tente novamente mais tarde.',
  'err.UNAUTHENTICATED': 'É necessário fazer login.',
  'err.FORBIDDEN': 'Esta operação não está disponível.',
  'err.INVALID_INPUT': 'Solicitação inválida.',
  'err.UPSTREAM_UNAVAILABLE': 'Um serviço externo está temporariamente indisponível. Tente novamente.',
  'err.INTERNAL': 'Erro interno. Tente novamente mais tarde.',
  'login.title': 'Entrar',
  'login.retry': 'Entrar novamente',
  'login.sessionLost': 'A sessão de login não foi encontrada, expirou ou já foi usada. Inicie o login novamente.',
  'login.cancelled': 'O login pelo Telegram foi cancelado ou não foi confirmado.',
  'login.badResponse': 'Resposta inválida do Telegram.',
  'login.upstream': 'O Telegram está temporariamente indisponível. Tente novamente.',
  'login.verifyFailed': 'Não foi possível verificar o login pelo Telegram.',
  'login.failed': 'Não foi possível concluir o login.',
  'login.closedTitle': 'O beta está fechado por enquanto',
  'login.closed': 'O cadastro no beta do Postun ainda não está aberto. Volte mais tarde.',
  'root.text': 'Serviço de login do Postun (beta). Acesse o <a href="{url}">painel</a>.',
  'terms.title': 'Termos do beta',
  'terms.intro': 'O Postun é um projeto experimental em beta aberto. A disponibilidade não é garantida e os recursos podem mudar.',
  'terms.li1': 'O Postun lê as suas mensagens do Telegram somente quando você solicita, por meio do cliente de IA escolhido, e não mantém um arquivo das suas conversas.',
  'terms.li2': 'A sessão do Telegram é armazenada de forma criptografada; a criptografia não torna o serviço "zero-knowledge".',
  'terms.li3': 'Você pode desconectar uma conta, revogar o acesso de um cliente ou excluir o seu perfil a qualquer momento.',
  'terms.full': 'Termos completos do beta',
  'terms.privacy': 'Tratamento de dados',
  'terms.accept': 'Li e aceito os termos do beta (versão {version})',
  'terms.continue': 'Continuar',
  'terms.mustAccept': 'Você precisa aceitar os termos para continuar.',
  'oauth.suspended': 'O seu perfil está temporariamente suspenso.',
  'oauth.badRequest': 'Solicitação de autorização inválida.',
  'oauth.clientCheck': 'Não foi possível verificar o aplicativo cliente.',
  'oauth.noAccountsTitle': 'Nenhuma conta',
  'oauth.noAccounts': 'Primeiro conecte a sua conta do Telegram no <a href="{url}">painel do Postun</a> e depois conecte o cliente de IA novamente.',
  'oauth.title': 'Conectar um cliente de IA',
  'oauth.intro': 'O aplicativo <strong>{client}</strong> está solicitando acesso aos seus dados do Telegram (somente leitura).',
  'oauth.publisher': 'Editor: <strong>{domain}</strong>.',
  'oauth.selfRegistered': 'O aplicativo se registrou por conta própria; o nome dele não foi verificado.',
  'oauth.tokensTo': 'Os tokens serão enviados para <strong>{host}</strong>.',
  'oauth.loopback': '<strong>O acesso será enviado a um aplicativo no seu computador.</strong> Continue somente se você mesmo acabou de iniciar o login por ele.',
  'oauth.accountsTitle': 'Quais contas liberar para o cliente',
  'oauth.accountsHint': 'Selecione pelo menos uma. As contas conectadas depois não serão adicionadas aqui automaticamente.',
  'oauth.scopesTitle': 'Permissões (somente leitura)',
  'oauth.approve': 'Permitir',
  'oauth.deny': 'Negar',
  'oauth.pickRequired': 'Selecione pelo menos uma conta e uma permissão e inicie a conexão novamente.',
  'oauth.accountUnavailable': 'Uma das contas selecionadas não está disponível. Inicie a conexão novamente.',
  'oauth.scopesNotRequested': 'Foram selecionadas permissões que o cliente não solicitou.',
  'oauth.stale': 'A página de confirmação expirou ou já foi usada. Se você já clicou em Permitir, volte ao aplicativo e verifique se ele está conectado. Caso contrário, inicie a conexão novamente no aplicativo.',
  'oauth.repeat': 'Você já permitiu esta conexão. Volte ao aplicativo: ele deve estar conectado. Se não estiver, inicie a conexão novamente no aplicativo.',
  'account.fallback': 'Conta do Telegram',
  'scope.accounts:read': 'Contas (accounts:read)',
  'scope.dialogs:read': 'Lista de conversas (dialogs:read)',
  'scope.messages:read': 'Mensagens e busca (messages:read)',
  'scope.channels:read': 'Canais públicos (channels:read)',
  'scope.media:read': 'Arquivos e mídia (media:read)'
};

const es: Dictionary = {
  'err.title': 'Error',
  'err.code': 'Código: {code}',
  'err.generic': 'No se pudo completar la solicitud.',
  'err.CONFIG_MISSING': 'El servicio aún no está configurado. Inténtalo de nuevo más tarde.',
  'err.UNAUTHENTICATED': 'Se requiere iniciar sesión.',
  'err.FORBIDDEN': 'Esta operación no está disponible.',
  'err.INVALID_INPUT': 'Solicitud no válida.',
  'err.UPSTREAM_UNAVAILABLE': 'Un servicio externo no está disponible temporalmente. Inténtalo de nuevo.',
  'err.INTERNAL': 'Error interno. Inténtalo de nuevo más tarde.',
  'login.title': 'Iniciar sesión',
  'login.retry': 'Iniciar sesión de nuevo',
  'login.sessionLost': 'No se encontró tu sesión de inicio, ha caducado o ya se usó. Vuelve a iniciar sesión.',
  'login.cancelled': 'El inicio de sesión con Telegram se canceló o no se confirmó.',
  'login.badResponse': 'Respuesta no válida de Telegram.',
  'login.upstream': 'Telegram no está disponible temporalmente. Inténtalo de nuevo.',
  'login.verifyFailed': 'No se pudo verificar el inicio de sesión con Telegram.',
  'login.failed': 'No se pudo completar el inicio de sesión.',
  'login.closedTitle': 'La beta está cerrada por ahora',
  'login.closed': 'El registro en la beta de Postun aún no está abierto. Vuelve más tarde.',
  'root.text': 'Servicio de inicio de sesión de Postun (beta). Ve al <a href="{url}">panel</a>.',
  'terms.title': 'Condiciones de la beta',
  'terms.intro': 'Postun es un proyecto experimental en beta abierta. No se garantiza la disponibilidad y las funciones pueden cambiar.',
  'terms.li1': 'Postun lee tus mensajes de Telegram solo cuando lo solicitas a través del cliente de IA que elijas, y no crea un repositorio de tus conversaciones.',
  'terms.li2': 'La sesión de Telegram se almacena cifrada; el cifrado no convierte el servicio en «zero-knowledge».',
  'terms.li3': 'Puedes desconectar una cuenta, revocar el acceso de un cliente o eliminar tu perfil en cualquier momento.',
  'terms.full': 'Condiciones completas de la beta',
  'terms.privacy': 'Tratamiento de datos',
  'terms.accept': 'He leído y acepto las condiciones de la beta (versión {version})',
  'terms.continue': 'Continuar',
  'terms.mustAccept': 'Debes aceptar las condiciones para continuar.',
  'oauth.suspended': 'Tu perfil está suspendido temporalmente.',
  'oauth.badRequest': 'Solicitud de autorización no válida.',
  'oauth.clientCheck': 'No se pudo verificar la aplicación cliente.',
  'oauth.noAccountsTitle': 'Sin cuentas',
  'oauth.noAccounts': 'Primero conecta tu cuenta de Telegram en el <a href="{url}">panel de Postun</a> y después vuelve a conectar el cliente de IA.',
  'oauth.title': 'Conectar un cliente de IA',
  'oauth.intro': 'La aplicación <strong>{client}</strong> solicita acceso a tus datos de Telegram (solo lectura).',
  'oauth.publisher': 'Publicado por: <strong>{domain}</strong>.',
  'oauth.selfRegistered': 'La aplicación se registró por sí misma; su nombre no ha sido verificado.',
  'oauth.tokensTo': 'Los tokens se enviarán a <strong>{host}</strong>.',
  'oauth.loopback': '<strong>El acceso se enviará a una aplicación de tu equipo.</strong> Continúa solo si acabas de iniciar tú mismo el inicio de sesión desde ella.',
  'oauth.accountsTitle': 'Cuentas a las que dar acceso al cliente',
  'oauth.accountsHint': 'Selecciona al menos una. Las cuentas que conectes más adelante no se añadirán aquí automáticamente.',
  'oauth.scopesTitle': 'Permisos (solo lectura)',
  'oauth.approve': 'Permitir',
  'oauth.deny': 'Denegar',
  'oauth.pickRequired': 'Selecciona al menos una cuenta y un permiso, y vuelve a iniciar la conexión.',
  'oauth.accountUnavailable': 'Una de las cuentas seleccionadas no está disponible. Vuelve a iniciar la conexión.',
  'oauth.scopesNotRequested': 'Se seleccionaron permisos que el cliente no solicitó.',
  'oauth.stale': 'La página de confirmación ha caducado o ya se usó. Si ya pulsaste Permitir, vuelve a la aplicación y comprueba si está conectada. Si no, vuelve a iniciar la conexión desde la aplicación.',
  'oauth.repeat': 'Ya permitiste esta conexión. Vuelve a la aplicación: debería estar conectada. Si no lo está, vuelve a iniciar la conexión desde la aplicación.',
  'account.fallback': 'Cuenta de Telegram',
  'scope.accounts:read': 'Cuentas (accounts:read)',
  'scope.dialogs:read': 'Lista de chats (dialogs:read)',
  'scope.messages:read': 'Mensajes y búsqueda (messages:read)',
  'scope.channels:read': 'Canales públicos (channels:read)',
  'scope.media:read': 'Archivos y multimedia (media:read)'
};

const de: Dictionary = {
  'err.title': 'Fehler',
  'err.code': 'Code: {code}',
  'err.generic': 'Die Anfrage konnte nicht ausgeführt werden.',
  'err.CONFIG_MISSING': 'Der Dienst ist noch nicht konfiguriert. Bitte versuchen Sie es später erneut.',
  'err.UNAUTHENTICATED': 'Anmeldung erforderlich.',
  'err.FORBIDDEN': 'Dieser Vorgang ist nicht verfügbar.',
  'err.INVALID_INPUT': 'Ungültige Anfrage.',
  'err.UPSTREAM_UNAVAILABLE': 'Ein externer Dienst ist vorübergehend nicht erreichbar. Bitte versuchen Sie es erneut.',
  'err.INTERNAL': 'Interner Fehler. Bitte versuchen Sie es später erneut.',
  'login.title': 'Anmelden',
  'login.retry': 'Erneut anmelden',
  'login.sessionLost': 'Die Anmeldesitzung wurde nicht gefunden, ist abgelaufen oder wurde bereits verwendet. Bitte starten Sie die Anmeldung erneut.',
  'login.cancelled': 'Die Anmeldung über Telegram wurde abgebrochen oder nicht bestätigt.',
  'login.badResponse': 'Ungültige Antwort von Telegram.',
  'login.upstream': 'Telegram ist vorübergehend nicht erreichbar. Bitte versuchen Sie es erneut.',
  'login.verifyFailed': 'Die Anmeldung über Telegram konnte nicht bestätigt werden.',
  'login.failed': 'Die Anmeldung konnte nicht abgeschlossen werden.',
  'login.closedTitle': 'Die Beta ist vorerst geschlossen',
  'login.closed': 'Die Registrierung für die Postun-Beta ist noch nicht geöffnet. Schauen Sie bitte später wieder vorbei.',
  'root.text': 'Anmeldedienst von Postun (Beta). Zum <a href="{url}">Dashboard</a>.',
  'terms.title': 'Beta-Bedingungen',
  'terms.intro': 'Postun ist ein experimentelles Projekt in der offenen Beta. Verfügbarkeit wird nicht garantiert, Funktionen können sich ändern.',
  'terms.li1': 'Postun liest Ihre Telegram-Nachrichten nur auf Ihre Anfrage über den von Ihnen gewählten KI-Client und führt kein Archiv Ihrer Unterhaltungen.',
  'terms.li2': 'Die Telegram-Sitzung wird verschlüsselt gespeichert; die Verschlüsselung macht den Dienst nicht „zero-knowledge“.',
  'terms.li3': 'Sie können jederzeit ein Konto trennen, den Zugriff eines Clients widerrufen oder Ihr Profil löschen.',
  'terms.full': 'Vollständige Beta-Bedingungen',
  'terms.privacy': 'Datenverarbeitung',
  'terms.accept': 'Ich habe die Beta-Bedingungen (Version {version}) gelesen und akzeptiere sie',
  'terms.continue': 'Weiter',
  'terms.mustAccept': 'Sie müssen die Bedingungen akzeptieren, um fortzufahren.',
  'oauth.suspended': 'Ihr Profil ist vorübergehend gesperrt.',
  'oauth.badRequest': 'Ungültige Autorisierungsanfrage.',
  'oauth.clientCheck': 'Die Client-Anwendung konnte nicht überprüft werden.',
  'oauth.noAccountsTitle': 'Keine Konten',
  'oauth.noAccounts': 'Verbinden Sie zuerst Ihr Telegram-Konto im <a href="{url}">Postun-Dashboard</a> und verbinden Sie danach den KI-Client erneut.',
  'oauth.title': 'KI-Client verbinden',
  'oauth.intro': 'Die Anwendung <strong>{client}</strong> fordert Zugriff auf Ihre Telegram-Daten an (nur Lesen).',
  'oauth.publisher': 'Herausgeber: <strong>{domain}</strong>.',
  'oauth.selfRegistered': 'Die Anwendung hat sich selbst registriert; ihr Name wurde nicht überprüft.',
  'oauth.tokensTo': 'Die Token werden an <strong>{host}</strong> gesendet.',
  'oauth.loopback': '<strong>Der Zugriff wird an eine Anwendung auf Ihrem Computer gesendet.</strong> Fahren Sie nur fort, wenn Sie die Anmeldung gerade selbst von dort aus gestartet haben.',
  'oauth.accountsTitle': 'Welche Konten für den Client freigegeben werden',
  'oauth.accountsHint': 'Wählen Sie mindestens eines aus. Später verbundene Konten werden hier nicht automatisch hinzugefügt.',
  'oauth.scopesTitle': 'Berechtigungen (nur Lesen)',
  'oauth.approve': 'Erlauben',
  'oauth.deny': 'Ablehnen',
  'oauth.pickRequired': 'Wählen Sie mindestens ein Konto und eine Berechtigung aus und starten Sie die Verbindung dann erneut.',
  'oauth.accountUnavailable': 'Eines der ausgewählten Konten ist nicht verfügbar. Starten Sie die Verbindung erneut.',
  'oauth.scopesNotRequested': 'Es wurden Berechtigungen ausgewählt, die der Client nicht angefordert hat.',
  'oauth.stale': 'Die Bestätigungsseite ist abgelaufen oder wurde bereits verwendet. Wenn Sie bereits auf Erlauben geklickt haben, kehren Sie zur App zurück und prüfen Sie, ob sie verbunden ist. Andernfalls starten Sie die Verbindung in der App erneut.',
  'oauth.repeat': 'Sie haben diese Verbindung bereits erlaubt. Kehren Sie zur App zurück – sie sollte verbunden sein. Falls nicht, starten Sie die Verbindung in der App erneut.',
  'account.fallback': 'Telegram-Konto',
  'scope.accounts:read': 'Konten (accounts:read)',
  'scope.dialogs:read': 'Chatliste (dialogs:read)',
  'scope.messages:read': 'Nachrichten und Suche (messages:read)',
  'scope.channels:read': 'Öffentliche Kanäle (channels:read)',
  'scope.media:read': 'Dateien und Medien (media:read)'
};

export const DICTIONARIES: Record<Locale, Dictionary> = { en, ru, es, pt, de };

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/** `{name}` placeholders are replaced with HTML-escaped values; the dictionary text itself is trusted markup. */
export function t(locale: Locale, key: MessageKey, vars: Record<string, string> = {}): string {
  const raw = DICTIONARIES[locale][key];
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? esc(vars[name] as string) : m));
}

/** Value for <html lang>. */
export const htmlLang = (locale: Locale): string => (locale === 'pt' ? 'pt-BR' : locale);

function fromQuery(req: Request): Locale | null {
  const v = new URL(req.url).searchParams.get('lang');
  return isLocale(v) ? v : null;
}

function fromAcceptLanguage(header: string | null): Locale | null {
  if (!header || header.length > 512) return null;
  const ranges = header
    .split(',')
    .map((part, i) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(p)?.[1]).find((x) => x !== undefined);
      const w = q === undefined ? 1 : Number(q);
      return { base: tag.trim().toLowerCase().split('-')[0] ?? '', w: Number.isFinite(w) ? w : 0, i };
    })
    .filter((r) => r.w > 0)
    .sort((a, b) => b.w - a.w || a.i - b.i);
  for (const r of ranges) if (isLocale(r.base)) return r.base;
  return null;
}

/** ?lang= (valid only) > cookie > Accept-Language (by base language) > en. Raw input is never reflected. */
export function pickLocale(req: Request): Locale {
  const cookie = readCookie(req, LANG_COOKIE);
  return fromQuery(req) ?? (isLocale(cookie) ? cookie : null) ?? fromAcceptLanguage(req.headers.get('accept-language')) ?? DEFAULT_LOCALE;
}

/** Set-Cookie value remembering an explicit, valid ?lang= choice; null when the request carries none. */
export function langCookie(req: Request): string | null {
  const l = fromQuery(req);
  return l ? `${LANG_COOKIE}=${l}; Path=/; Secure; SameSite=Lax; Max-Age=${LANG_MAX_AGE}` : null;
}

export function scopeLabel(locale: Locale, scope: string): string {
  const key = `scope.${scope}`;
  return key in DICTIONARIES[locale] ? t(locale, key as MessageKey) : scope;
}

export function hasKey(key: string): key is MessageKey {
  return key in en;
}
