# Stundenbuch

Lernzeit tracken, auswerten und mit Freunden vergleichen. Stoppuhr, Fokus-Bewertung, Wochenziele, Level, Serien, Abzeichen, Statistiken und Ranglisten für Lerngruppen. Läuft im Browser und lässt sich am Handy wie eine App installieren.

**Technik:** HTML, CSS und JavaScript ohne Build-Schritt · Supabase (Datenbank und Login) · GitHub Pages (Hosting)

---

## Einrichtung (ca. 30 Minuten, einmalig)

### 1. Supabase-Projekt anlegen

1. Auf [supabase.com](https://supabase.com) mit deinem GitHub-Konto anmelden.
2. **New project** wählen.
   - Name: `stundenbuch`
   - Database Password: ein sicheres Passwort erzeugen und in deinem Passwortmanager speichern (die App braucht es nicht, aber du für spätere Wartung)
   - Region: **Central EU (Frankfurt)**, damit die Daten in der EU liegen
3. **Create new project** und ein bis zwei Minuten warten.

### 2. Datenbank einrichten

1. Links **SQL Editor** öffnen, dann **New query**.
2. Den kompletten Inhalt der Datei `supabase/schema.sql` hineinkopieren.
3. **Run** klicken. Unten erscheint „Success. No rows returned“.

Damit gibt es die Tabellen und die Zugriffsregeln: Jeder ändert nur seine eigenen Daten, und lesen darf man nur die Daten von Leuten aus derselben Gruppe.

### 3. Schlüssel in `config.js` eintragen

1. Im Supabase-Dashboard **Project Settings → API Keys** öffnen und den **Publishable key** kopieren (beginnt mit `sb_publishable_`). Falls dort nur „anon“ und „service_role“ stehen, nimm den **anon**-Schlüssel, der funktioniert genauso.
2. Die **Project URL** kopieren (Form `https://abcdefgh.supabase.co`). Du findest sie auf der Startseite des Projekts oder unter **Project Settings → Data API**.
3. Beide Werte in `config.js` eintragen:

```js
window.STUNDENBUCH_CONFIG = {
  supabaseUrl: "https://abcdefgh.supabase.co",
  supabaseKey: "sb_publishable_…",
};
```

Der Publishable Key darf öffentlich auf GitHub liegen. Die Sicherheit kommt von den Zugriffsregeln aus Schritt 2. Den **Secret Key** (`sb_secret_…`, früher `service_role`) trägst du **nie** in eine Datei dieses Projekts ein.

### 4. Anmeldung einstellen

1. **Authentication → Sign In / Providers → Email** öffnen.
2. **Confirm email** ausschalten und speichern.
   Grund: Der eingebaute E-Mail-Versand von Supabase schickt nur an Mitglieder deines Supabase-Teams und nur wenige Mails pro Stunde. Deine Freunde würden die Bestätigungsmail also nie bekommen. (Wie du das später änderst, steht unten unter „Passwort vergessen“.)
3. Optional: Im selben Bereich die Mindestlänge für Passwörter auf 8 setzen. Die App verlangt das ohnehin.

### 5. Auf GitHub veröffentlichen

1. Auf GitHub **New repository** wählen, Name `stundenbuch`, **Public**, **Create repository**.
2. Auf der neuen Seite **uploading an existing file** anklicken und den **Inhalt** des Projektordners hineinziehen: alle Dateien und die Ordner `icons` und `supabase`. Dann **Commit changes**.
3. **Settings → Pages**: Unter „Branch“ **main** und **/(root)** wählen, **Save**.
4. Nach etwa einer Minute steht oben die Adresse, z. B. `https://deinname.github.io/stundenbuch/`.

### 6. Adresse in Supabase hinterlegen

**Authentication → URL Configuration**:
- **Site URL**: deine GitHub-Pages-Adresse
- **Redirect URLs**: dieselbe Adresse noch einmal hinzufügen

### 7. Loslegen

1. Die Seite öffnen, **Registrieren**, Spitznamen und Fächer festlegen.
2. Unter **Rangliste** eine Gruppe erstellen und den **Einladungslink** an deine Freunde schicken. Wer den Link öffnet, wird nach der Anmeldung direkt gefragt, ob er beitreten will. Alternativ geben sie den sechsstelligen Code ein.

### Als App aufs Handy

- **Android (Chrome):** Menü ⋮ → **App installieren** oder **Zum Startbildschirm hinzufügen**
- **iPhone (Safari):** Teilen-Symbol → **Zum Home-Bildschirm**

---

## Gut zu wissen

**Passwort vergessen:** Die Funktion ist eingebaut, verschickt aber nur Mails, wenn du einen eigenen Mail-Dienst einrichtest. Brevo zum Beispiel ist bis 300 Mails am Tag kostenlos. Das geht unter **Authentication → Emails → SMTP Settings**. Danach kannst du auch „Confirm email“ wieder einschalten. Bis dahin kannst du als Projektbesitzer ein Passwort im Dashboard unter **Authentication → Users** zurücksetzen.

**Pausiertes Projekt:** Kostenlose Supabase-Projekte werden pausiert, wenn sie längere Zeit (etwa eine Woche) nicht benutzt werden. Dann zeigt die Seite einen Verbindungsfehler. Im Dashboard auf **Restore project** klicken, nach ein paar Minuten läuft alles wieder. Wer regelmäßig lernt, merkt davon nichts.

**Änderungen am Code:** Wenn du Dateien änderst und neu hochlädst, erhöhe in `sw.js` die Versionsnummer (`stundenbuch-v1` → `stundenbuch-v2`). Sonst zeigen installierte Apps eventuell noch kurz die alte Version.

**Daten übernehmen:** Unter **Profil → Daten** kannst du eine Sicherung aus der Browser-Version des Stundenbuchs (die Datei `stundenbuch-sicherung-….json`) hochladen. Fächer werden über den Namen zugeordnet, doppelte Einheiten übersprungen.

**Konto löschen:** Unter **Profil → Konto**. Dabei werden alle eigenen Daten endgültig gelöscht. Gruppen, die man selbst erstellt hat, werden mit aufgelöst.

---

## Falls du es später öffentlich machen willst

Für einen Freundeskreis reicht die Einrichtung oben. Sobald Fremde sich anmelden oder du Geld verlangst, kommen in Deutschland dazu:

- Impressum und Datenschutzerklärung auf der Seite
- ein Auftragsverarbeitungsvertrag (AVV/DPA) mit Supabase, abschließbar im Supabase-Dashboard
- eigener Mail-Dienst (siehe oben) und eine eigene Domain
- je nach Umfang eine Gewerbeanmeldung

Das ist keine Rechtsberatung. Kläre das vor einem öffentlichen Start mit jemandem, der sich auskennt.

---

## Projektaufbau

```
index.html            Seitenaufbau und Design (Neubrutalism)
app.js                App-Logik: Anmeldung, Timer, Statistik, Gruppen
config.js             Deine Supabase-Adresse und dein Publishable Key
supabase.js           Supabase-Bibliothek (Version 2.117.2, unverändert)
sw.js                 Service Worker: Installierbarkeit, Zwischenspeicher
manifest.webmanifest  App-Name, Farben, Symbole
icons/                App-Symbole
supabase/schema.sql   Tabellen, Zugriffsregeln, Gruppen-Funktionen
```

### Datenmodell

| Tabelle | Inhalt |
|---|---|
| `profiles` | Spitzname, Fächer mit Wochenzielen, laufender Timer (eine Zeile pro Konto) |
| `sessions` | eine Zeile pro Lerneinheit: Fach, Beginn, Minuten, Fokus |
| `groups` | Lerngruppen mit Name und Einladungscode |
| `group_members` | wer in welcher Gruppe ist |

Gruppen werden nur über die Datenbankfunktionen `create_group` und `join_group` angelegt bzw. betreten. So kann niemand ohne gültigen Code in eine Gruppe gelangen.

### Zählregeln

- **XP:** 1 XP pro Minute, dazu 50 XP pro erreichtem Wochenziel in einem Fach
- **Level:** Level *L* beginnt bei 30 · *L* · (*L* − 1) XP
- **Serie:** Tage in Folge mit mindestens 20 Minuten Lernzeit
