# QNAP

Verfolge ein QNAP-NAS mit QTS oder QuTS hero in Gladys: Prozessor, Speicher,
Temperaturen, Lüfter, Netzwerk, Volumes, Festplatten und die USV, die es
teilt, mit Szenen, wenn ein Volume oder eine Festplatte Aufmerksamkeit braucht
oder ein Firmware-Update erscheint, und einem Dashboard-Widget.

Die Integration **liest**. Das Einzige, was sie auf dem NAS tun kann, ist, es
aus einer Szene neu zu starten oder herunterzufahren, und das nur, wenn du es
in der Konfiguration erlaubt hast (standardmäßig aus).

> **Ohne die Hardware entwickelt: Rückmeldungen willkommen.** Die Integration
> liest dieselbe Web-API wie die Home-Assistant-Integration und die Bibliothek
> qnapstats, geprüft an echten Antworten von neun QNAP-Modellen (QTS 4.2 bis
> 4.5). Fehlt etwas oder stimmt ein Wert auf deinem NAS nicht, eröffne bitte
> ein Issue: <https://github.com/guim31/gladys-qnap/issues>.

Nicht mit QNAP verbunden. Weder von QNAP Systems, Inc. unterstützt noch
gesponsert. QNAP, QTS und QuTS hero sind Marken ihrer Inhaber.

## Was du bekommst

Nach der Konfiguration schlägt der Tab **Entdecken** folgende Geräte vor.
Füge die hinzu, die du verfolgen willst: Nichts wird ohne dich angelegt.

### Das NAS

- **Online**: 1, solange das NAS antwortet, 0, sobald es nicht mehr antwortet.
- **Prozessor** und **Arbeitsspeicher**: Auslastung in %.
- **Prozessortemperatur** und **Systemtemperatur** in °C (wenn das Modell sie
  liefert: Manche ARM-Modelle haben keinen Prozessorsensor).
- **Lüfter 1 (U/min)**, **Lüfter 2 (U/min)** …: die Drehzahl jedes
  Systemlüfters. Gladys kennt keine Einheit „U/min“: Der Wert ist eine
  einfache Zahl, der Name nennt die Einheit.
- **Empfang** und **Senden** jeder Netzwerkschnittstelle (`Empfang LAN 1`,
  `Senden LAN 1` …) in Mbit/s.
- **Laufzeit** in Tagen.
- **Firmware-Version**, z. B. `5.2.1.3000 build 20261001`.
- **Update verfügbar**: 1, wenn das NAS eine neuere Firmware anbietet (alle
  6 Stunden geprüft; braucht ein Administratorkonto, siehe unten).

### Volumes

Ein Gerät pro Volume (`DataVol1` …):

- **Belegter Speicher** in %;
- **Kapazität** und **Freier Speicher** in GB;
- **Zustand**: Bereit, Wiederaufbau (RAID-Wiederaufbau, -Neusynchronisierung
  oder -Migration läuft), Gestört oder anormal;
- **Warnung**: 1, wenn der Zustand Aufmerksamkeit braucht, sonst 0 — praktisch
  in Szenen und im Verlauf.

QTS liefert für jedes Volume einen Zustandscode, und nur der Code eines
bereiten Volumes ist sicher bekannt. Jeder andere Code erscheint als
**Gestört oder anormal** und löst die Warnung aus: Ein beeinträchtigtes
RAID zu verpassen ist schlimmer als ein Fehlalarm. Der Code steht in den
Protokollen: Melde ihn bitte zusammen mit dem, was QTS anzeigt.

### Festplatten

Ein Gerät pro Festplatte, ihr Modell als Modell des Geräts:

- **Temperatur** in °C;
- **Zustand**: die SMART-Übersicht von QTS — Gut, Warnung oder Fehler;
- **Warnung**: 1 bei Warnung oder Fehler.

Die Festplatten werden höchstens alle 5 Minuten gelesen, egal wie das
Aktualisierungsintervall eingestellt ist.

### Die USV

Wenn das NAS seine USV teilt (siehe unten), ein weiteres Gerät:

- **Batterie** in %;
- **Restlaufzeit** in Minuten;
- **Last** in %;
- **Batteriebetrieb**: 1 im Batteriebetrieb, 0 am Netz;
- **Batterie schwach**: 1, wenn die USV eine schwache Batterie meldet.

## Bevor du beginnst

### Ein eigenes Konto

Lege auf dem NAS ein Konto für Gladys an (Systemsteuerung → Berechtigungen →
Benutzer), ohne Zugriff auf die freigegebenen Ordner und ohne Anwendung.

- **Zum Lesen**: Auf aktuellen QTS- und QuTS-hero-Versionen (mit
  **delegierter Verwaltung**) gib diesem Konto die Rolle
  **Systemüberwachung**. Auf älteren Firmwares ohne delegierte Verwaltung muss
  das Konto in der Gruppe **Administratoren** sein: QTS bietet keinen anderen
  Nur-Lese-Zugriff auf diese Informationen.
- **Für Firmware-Prüfung, Neustart und Herunterfahren**: QTS erlaubt das nur
  einem Administrator. Mit einem Systemüberwachungs-Konto funktioniert alles
  andere; **Update verfügbar** bleibt ohne Wert und die Szenenaktionen werden
  abgelehnt.

Melde dich einmal mit diesem Konto an der QTS-Weboberfläche an und bestätige
alle Vereinbarungen oder Assistenten, die QTS zuerst zeigt: Bis dahin kann QTS
das Konto ablehnen.

### 2-Stufen-Verifizierung

Die Integration kann keinen Code der 2-Stufen-Verifizierung eingeben: Nimm ein
Konto **ohne** 2-Stufen-Verifizierung. Schreibt deine Sicherheitsrichtlinie
sie für alle Konten vor, halte das NAS aus dem Internet heraus, gib dem
Gladys-Konto ein langes Zufallspasswort und kein weiteres Recht, und
beschränke die Adressen, die das NAS erreichen dürfen (Systemsteuerung →
Sicherheit → Zulassen-/Ablehnen-Liste), auf dein lokales Netzwerk.

### HTTP oder HTTPS

- **HTTP** (standardmäßig Port 8080): QTS erhält das Passwort Base64-kodiert,
  was keine Verschlüsselung ist. In Ordnung in einem Heimnetz, dem du vertraust.
- **HTTPS** (standardmäßig Port 443): Das Passwort ist verschlüsselt. Das von
  QTS erzeugte Zertifikat ist selbstsigniert: Aktiviere **Selbstsigniertes
  Zertifikat akzeptieren** oder installiere auf dem NAS ein anerkanntes
  Zertifikat (Let's Encrypt).

### Die USV teilen

QTS bietet keinen dokumentierten Weg, seine USV-Seite zu lesen. Die
Integration liest die USV so, wie andere QNAP-NAS es tun: mit Network UPS
Tools (NUT), Port 3493.

1. Auf dem NAS: Systemsteuerung → Externes Gerät → USV, aktiviere
   **Netzwerk-USV-Unterstützung aktivieren** (Netzwerk-USV-Master).
2. Trage die IP-Adresse des Rechners, auf dem Gladys läuft, bei den erlaubten
   IP-Adressen ein.

Mehr braucht es nicht: Das Lesen der USV verlangt kein Passwort. Ohne diese
Einstellung findet die Integration einfach keine USV.

## Konfiguration

1. Öffne den Tab **Konfiguration** der Integration.
2. **NAS-Adresse**: seine IP-Adresse in deinem Netzwerk, z. B.
   `192.168.1.50`: HTTP auf Port 8080. `https://192.168.1.50` nutzt HTTPS auf
   Port 443; gib den Port an, wenn du ihn geändert hast
   (`https://192.168.1.50:5001`).
3. **Benutzername** und **Passwort** des Kontos oben. Das Passwort wird nie
   protokolliert.
4. **Selbstsigniertes Zertifikat akzeptieren**: nur HTTPS, siehe oben.
5. **Aktualisierungsintervall**: jede Minute (Standard), alle 2 oder
   5 Minuten.
6. **USV des NAS lesen**: standardmäßig an; schalte es aus, wenn das NAS keine
   USV hat.
7. **Szenen dürfen das NAS neu starten oder herunterfahren**: standardmäßig
   aus. Lass es aus, außer eine Szene braucht es wirklich.
8. **Sprache der Namen und Zustände**: standardmäßig Französisch. Gladys
   teilt der Integration deine Sprache nicht mit: Funktionsnamen, Zustände und
   Szenenvariablen nutzen diese.
9. Speichere und nutze dann **Verbindung testen**: Die Aktion liest das NAS
   und seine USV sofort und zeigt, was sie gefunden hat, z. B. „NAS:
   verbunden, TS-464, QTS 5.2.1.3000 build 20261001, 1 Volume(s),
   4 Festplatte(n), USV gelesen“. Füge danach die Geräte im Tab **Entdecken**
   hinzu.

## Dashboard-Widget

Füge das Widget **QNAP-NAS** zu einem Dashboard hinzu: zwei Anzeigen
(Prozessor, Speicher), die Temperatur, dann eine Liste, in der zuerst steht,
was Aufmerksamkeit braucht (ein Volume, eine Festplatte, ein Lüfter mit
Warnung, die USV im Batteriebetrieb, ein Firmware-Update), danach jedes Volume
mit Belegung und freiem Speicher, die USV und die Laufzeit. Die Schaltfläche
**Aktualisieren** liest das NAS erneut. Ein NAS, das nicht antwortet, wird in
Worten gemeldet.

## Szenenauslöser

- **Volume beeinträchtigt**: Ein Volume wechselt zu Wiederaufbau oder
  Gestört oder anormal; erneut, wenn es schlimmer wird. Filter: ein
  Volume oder alle (leer). Variablen: das NAS, das Volume, sein Zustand.
- **Festplattenwarnung**: QTS stuft eine Festplatte als Warnung oder Fehler
  ein; erneut beim Wechsel von Warnung zu Fehler. Filter: eine Festplatte oder
  alle. Variablen: das NAS, die Festplatte, ihr Modell, ihr Zustand, ihre
  Temperatur.
- **Firmware-Update verfügbar**: Das NAS bietet ein neueres QTS oder QuTS hero
  an; einmal pro Version. Variablen: das NAS, die installierte Version, die
  neue.

Diese Auslöser gelten für alle Volumes und Festplatten, ob zu Gladys
hinzugefügt oder nicht, und wiederholen sich nicht nach einem Neustart von
Gladys oder der Integration. Der Zustand beim allerersten Lesen wird ohne
Ereignis gespeichert.

## Szenenaktionen

- **QNAP-NAS neu starten** und **QNAP-NAS herunterfahren**: abgelehnt, außer
  **Szenen dürfen das NAS neu starten oder herunterfahren** ist aktiviert und
  das Konto ist Administrator. Ein heruntergefahrenes NAS wird von Hand
  wieder eingeschaltet, oder per Wake-on-LAN, wenn du es auf dem NAS
  aktiviert hast.

## Szenenideen

- **Ein beeinträchtigtes RAID**: Auslöser **Volume beeinträchtigt** →
  Nachricht „{{triggerEvent.data.volume_name}} ist
  {{triggerEvent.data.state}}“ an das ganze Haus, und eine Lampe wird rot.
- **Eine müde Festplatte**: Auslöser **Festplattenwarnung** → Nachricht mit
  Festplatte, Modell und Temperatur, um vor dem Ausfall Ersatz zu bestellen.
- **Stromausfall**: Auslöser „Gerätezustand“ auf **Batteriebetrieb** = 1 →
  Nachricht; dann, wenn **Batterie** unter 30 % fällt, die Aktion
  **QNAP-NAS herunterfahren** (Option aktiviert). QTS kann sich auch selbst
  nach seiner eigenen USV-Einstellung herunterfahren: Nimm das, wenn es
  reicht.
- **Updates**: Auslöser **Firmware-Update verfügbar** → Nachricht am
  Sonntagmorgen mit `{{triggerEvent.data.new_version}}`.
- **Ein zu heißes NAS**: Auslöser „Gerätezustand“ auf **Systemtemperatur**
  über 50 °C → Nachricht.

## Wie oft das NAS gelesen wird

Bei jeder Aktualisierung drei Anfragen an die Web-API des NAS (System,
Volumes, Netzwerk); die Festplatten alle 5 Minuten; die Firmware-Prüfung alle
6 Stunden; die USV bei jeder Aktualisierung (alle 10 Minuten, solange das NAS
keine teilt). Nur geänderte Werte gehen an Gladys, jeder Wert mindestens alle
6 Stunden.

Die Integration hält ihre Sitzung zwischen zwei Lesevorgängen und über
Neustarts hinweg offen (unter `/data` gespeichert, nie in den Protokollen): So
füllt sie das Verbindungsprotokoll des NAS nicht mit einer Anmeldung pro
Minute. Ein abgelehntes Passwort wird nie von selbst erneut versucht: QTS
sperrt eine Adresse nach einigen Fehlversuchen. Korrigiere es und speichere,
oder nutze **Verbindung testen**.

## Fehlerbehebung

- **„Benutzername oder Passwort abgelehnt“**: Prüfe sie mit einer Anmeldung
  an der QTS-Weboberfläche. Zu viele Fehlversuche können die Adresse von
  Gladys gesperrt haben: Systemsteuerung → Sicherheit → IP-Zugriffsschutz.
- **„dieses Konto nutzt die 2-Stufen-Verifizierung“**: Nimm ein Konto ohne
  sie.
- **„dieses Konto darf das System nicht lesen“**: Gib ihm die Rolle
  Systemüberwachung oder nimm es in die Gruppe Administratoren auf.
- **„HTTPS-Zertifikat abgelehnt“**: Aktiviere **Selbstsigniertes Zertifikat
  akzeptieren**.
- **„keine QTS-Oberfläche unter dieser Adresse“**: Prüfe den Port
  (Systemsteuerung → Allgemeine Einstellungen → Systemport; HTTPS-Port unter
  Webserver/Sicherheit).
- **„antwortet nicht“**: Ist das NAS an, im selben Netzwerk, und stimmt die
  Adresse?
- **Keine USV**: Prüfe die Netzwerk-USV-Unterstützung des NAS und dass die
  Adresse des Gladys-Rechners erlaubt ist. **Verbindung testen** meldet „USV
  verweigert (erlaubte IP-Adressen?)“, wenn das NAS Gladys ablehnt.
- **Mehr Details**: Setze `LOG_LEVEL=debug` für die Integration, um jeden
  Lesevorgang in ihren Protokollen zu sehen.

## Einschränkungen

- Ein NAS pro Installation der Integration.
- Ohne die Hardware entwickelt: Die Volume-Zustandscodes außer „bereit“ sind
  von QNAP nicht dokumentiert. QuTS hero sollte wie QTS antworten, wurde aber
  nicht getestet.
- Die Nur-Lese-Rolle (Systemüberwachung) reicht nicht für die
  Firmware-Prüfung; Neustart und Herunterfahren brauchen einen Administrator.
- Keine Steuerung von Anwendungen, freigegebenen Ordnern, Snapshots, Container
  Station oder virtuellen Maschinen.
- Festplatten ohne SMART (manche USB-Gehäuse) und Erweiterungseinheiten können
  fehlen oder unvollständig sein.
- Gladys kennt keine Einheit „U/min“: Die Lüfterdrehzahlen sind einfache
  Zahlen.
