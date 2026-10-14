// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, state words (features, scene variables, widget
// rows), the scene action answers and the "Test the connection" report. Four
// languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './qnap/client.js';

export const LANGUAGE_FALLBACK = 'en';

/** The text of a multi-language object in a language, English otherwise. */
export const pick = (value, language) =>
  value?.[language] ?? value?.[LANGUAGE_FALLBACK] ?? Object.values(value ?? {})[0] ?? '';

/** "Name: detail", with the French space before the colon. */
export const labelled = (name, detail, language) =>
  language === 'fr' ? `${name} : ${detail}` : `${name}: ${detail}`;

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  notConfigured: {
    en: 'Enter the address of the NAS, a user name and a password in the configuration.',
    fr: "Saisissez l'adresse du NAS, un nom d'utilisateur et un mot de passe dans la configuration.",
    de: 'Gib die Adresse des NAS, einen Benutzernamen und ein Passwort in der Konfiguration ein.',
    es: 'Introduzca la dirección del NAS, un nombre de usuario y una contraseña en la configuración.',
  },
  invalidAddress: {
    en: 'Address not understood, e.g. 192.168.1.50 or https://192.168.1.50',
    fr: 'Adresse incomprise, ex. 192.168.1.50 ou https://192.168.1.50',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.50 oder https://192.168.1.50',
    es: 'Dirección no válida, p. ej. 192.168.1.50 o https://192.168.1.50',
  },
};

// One short explanation per error kind (src/qnap/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer (is it on, is the address right?)',
    fr: "ne répond pas (est-il allumé, l'adresse est-elle juste ?)",
    de: 'antwortet nicht (ist es an, stimmt die Adresse?)',
    es: 'no responde (¿está encendido, es correcta la dirección?)',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'user name or password refused; fix them, then save',
    fr: "nom d'utilisateur ou mot de passe refusé ; corrigez-les puis enregistrez",
    de: 'Benutzername oder Passwort abgelehnt; korrigiere sie und speichere',
    es: 'nombre de usuario o contraseña rechazados; corríjalos y guarde',
  },
  [ERROR_KINDS.OTP]: {
    en: 'this account uses 2-step verification: use an account without it',
    fr: "ce compte utilise la vérification en 2 étapes : utilisez un compte qui ne l'a pas",
    de: 'dieses Konto nutzt die 2-Stufen-Verifizierung: Nimm ein Konto ohne sie',
    es: 'esta cuenta usa la verificación en 2 pasos: use una cuenta sin ella',
  },
  [ERROR_KINDS.PERMISSION]: {
    en: 'this account may not read the system: give it System Monitoring',
    fr: 'ce compte ne peut pas lire le système : donnez-lui la Surveillance du système',
    de: 'dieses Konto darf das System nicht lesen: Gib ihm die Systemüberwachung',
    es: 'esta cuenta no puede leer el sistema: concédale la Supervisión del sistema',
  },
  [ERROR_KINDS.CERTIFICATE]: {
    en: 'HTTPS certificate refused: tick "Accept a self-signed certificate"',
    fr: 'certificat HTTPS refusé : cochez « Accepter un certificat auto-signé »',
    de: 'HTTPS-Zertifikat abgelehnt: Aktiviere „Selbstsigniertes Zertifikat akzeptieren“',
    es: 'certificado HTTPS rechazado: marque «Aceptar un certificado autofirmado»',
  },
  [ERROR_KINDS.NOT_QNAP]: {
    en: 'no QTS interface at this address (port 8080 or 443?)',
    fr: "pas d'interface QTS à cette adresse (port 8080 ou 443 ?)",
    de: 'keine QTS-Oberfläche unter dieser Adresse (Port 8080 oder 443?)',
    es: 'no hay interfaz QTS en esta dirección (¿puerto 8080 o 443?)',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The state of a volume (src/qnap/model.js VOLUME_STATES), in words.
export const VOLUME_STATE_TEXT = {
  ready: { en: 'Ready', fr: 'Prêt', de: 'Bereit', es: 'Listo' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  rebuilding: {
    en: 'Rebuilding',
    fr: 'Reconstruction',
    de: 'Wiederaufbau',
    es: 'Reconstruyendo',
  },
  abnormal: {
    en: 'Degraded or abnormal',
    fr: 'Dégradé ou anormal',
    de: 'Gestört oder anormal',
    es: 'Degradado o anómalo',
  },
};

// The SMART summary of a disk (src/qnap/model.js DISK_STATES), in words.
export const DISK_STATE_TEXT = {
  good: { en: 'Good', fr: 'Bon', de: 'Gut', es: 'Bueno' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  warning: { en: 'Warning', fr: 'Avertissement', de: 'Warnung', es: 'Advertencia' },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
};

// The scene actions (src/app.js).
export const POWER_TEXT = {
  disabled: {
    en: 'Restarting and shutting down the NAS are disabled in the configuration of the integration.',
    fr: "Le redémarrage et l'arrêt du NAS sont désactivés dans la configuration de l'intégration.",
    de: 'Neustart und Herunterfahren des NAS sind in der Konfiguration der Integration deaktiviert.',
    es: 'El reinicio y el apagado del NAS están desactivados en la configuración de la integración.',
  },
  notConnected: {
    en: 'The NAS is not connected: nothing was sent.',
    fr: "Le NAS n'est pas connecté : rien n'a été envoyé.",
    de: 'Das NAS ist nicht verbunden: Nichts wurde gesendet.',
    es: 'El NAS no está conectado: no se ha enviado nada.',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'connected',
    volumes: (count) => `${count} volume(s)`,
    disks: (count) => `${count} disk(s)`,
    ups: 'UPS read',
    upsDenied: 'UPS refused (allowed IP addresses?)',
    notAdmin: 'not an administrator: restart and shutdown refused',
  },
  fr: {
    ok: 'connecté',
    volumes: (count) => `${count} volume(s)`,
    disks: (count) => `${count} disque(s)`,
    ups: 'onduleur lu',
    upsDenied: 'onduleur refusé (adresses IP autorisées ?)',
    notAdmin: 'pas administrateur : redémarrage et arrêt refusés',
  },
  de: {
    ok: 'verbunden',
    volumes: (count) => `${count} Volume(s)`,
    disks: (count) => `${count} Festplatte(n)`,
    ups: 'USV gelesen',
    upsDenied: 'USV verweigert (erlaubte IP-Adressen?)',
    notAdmin: 'kein Administrator: Neustart und Herunterfahren verweigert',
  },
  es: {
    ok: 'conectado',
    volumes: (count) => `${count} volumen(es)`,
    disks: (count) => `${count} disco(s)`,
    ups: 'SAI leído',
    upsDenied: 'SAI rechazado (¿direcciones IP permitidas?)',
    notAdmin: 'no es administrador: reinicio y apagado rechazados',
  },
};

// Short units, for the widget rows.
export const UNIT_TEXT = {
  gigabyte: { en: 'GB', fr: 'Go', de: 'GB', es: 'GB' },
  terabyte: { en: 'TB', fr: 'To', de: 'TB', es: 'TB' },
  day: { en: 'd', fr: 'j', de: 'T', es: 'd' },
  hour: { en: 'h', fr: 'h', de: 'Std.', es: 'h' },
};

const LOCALES = { en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

export const formatNumber = (value, language, digits = 1) =>
  new Intl.NumberFormat(LOCALES[language] ?? LOCALES.en, {
    maximumFractionDigits: digits,
  }).format(value);

export const formatPercent = (value, language) => `${formatNumber(value, language, 0)} %`;

/** Bytes as GB, or TB from 1000 GB on (decimal units). */
export function formatSize(bytes, language) {
  const gigabytes = bytes / 1e9;
  if (gigabytes >= 1000) {
    return `${formatNumber(gigabytes / 1000, language, 1)} ${pick(UNIT_TEXT.terabyte, language)}`;
  }
  return `${formatNumber(gigabytes, language, gigabytes < 10 ? 1 : 0)} ${pick(UNIT_TEXT.gigabyte, language)}`;
}

/** Seconds as "12 d 4 h". */
export function formatUptime(seconds, language) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const day = pick(UNIT_TEXT.day, language);
  const hour = pick(UNIT_TEXT.hour, language);
  return days > 0 ? `${days} ${day} ${hours} ${hour}` : `${hours} ${hour}`;
}
