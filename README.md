# Track Your Health

Dein persönliches Trainings-Logbuch für Push/Pull-Splits & Co. — Pläne, Sätze, Gewichte und Fortschritt, direkt im Browser, mit eigenem Login pro Person und automatischer Cloud-Synchronisierung zwischen PC und Handy.

Keine Installation, kein Build-Prozess, keine Abhängigkeiten außer dem Browser — nur statische Dateien.

## Features

- **Eigenes Konto pro Person**: Login-Bildschirm vor der App — jede*r bekommt einen privaten Trainingsbereich, niemand sieht die Daten anderer (Supabase Row Level Security)
- **Admin-Bereich für dich als Betreiber*in**: Mitglieder per Namenssuche finden, ihre Trainingspläne einsehen und bearbeiten — geschützt über ein `is_admin`-Flag in der Datenbank, nicht nur über eine Code-Abfrage in der App
- **Trainingspläne** anlegen, umbenennen, löschen (z. B. Push A/B, Pull A/B)
- **Workout-Modus**: Sätze mit Gewicht & Wiederholungen eintragen, Vergleich zum letzten Mal direkt daneben, Trainings- & Pausen-Timer
- **Fortschritt**: Verlaufs-Chart pro Übung inkl. PR-Erkennung
- **Workouts**: kompakte Tabellenansicht aller Sessions zum schnellen Nachschauen/Bearbeiten
- **Statistiken**: Sessions diese Woche, Tage-Streak, Gesamtzahl Einheiten
- **Cloud-Sync**: automatisch bei jeder Änderung, sobald man angemeldet ist — gleicher Stand auf allen Geräten
- **Backup**: Trainingsdaten jederzeit als JSON-Datei exportieren/importieren
- **PWA**: auf dem Handy "Zum Home-Bildschirm hinzufügen" → startet wie eine native App

## Hosting (GitHub Pages)

1. Repo → **Settings → Pages**
2. Unter „Build and deployment" → Source: **Deploy from a branch**
3. Branch: `main` (oder den Branch, auf dem diese Dateien liegen), Ordner: `/ (root)`
4. Speichern — nach kurzer Zeit ist die App unter `https://<dein-username>.github.io/<repo-name>/` erreichbar

Da alles statische Dateien sind (`index.html`, `style.css`, `app.js`, …), funktioniert das ohne weiteren Build-Schritt.

## App am Handy installieren

- **iOS (Safari)**: Seite öffnen → Teilen-Symbol → „Zum Home-Bildschirm"
- **Android (Chrome)**: Seite öffnen → Menü (⋮) → „App installieren" bzw. „Zum Startbildschirm hinzufügen"

Die App merkt sich danach ihr eigenes Icon, startet ohne Browser-Leiste und funktioniert auch offline (Service Worker cached die App-Shell).

## Cloud-Sync mit Supabase (bereits eingerichtet)

Die App ist fest mit einem Supabase-Projekt verbunden — die Projekt-URL und der öffentliche „Publishable/Anon"-Key stehen als Konstanten am Anfang von `app.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). Das ist bewusst so: dieser Key ist für den Browser gedacht und öffentlich sichtbar (genau wie bei jeder anderen Supabase-App) — den eigentlichen Zugriffsschutz übernimmt Row Level Security (siehe unten). Niemand außer dir sieht oder verändert diese Verbindung; Besucher*innen der App bekommen nur den Anmelde-Bildschirm zu sehen.

Wer die App öffnet, muss sich zuerst registrieren oder anmelden (E-Mail + Passwort) — erst danach betritt man den eigenen, privaten Trainingsbereich. Jedes Konto sieht ausschließlich seine eigenen Daten.

Falls du irgendwann ein anderes Supabase-Projekt verwenden willst: `SUPABASE_URL`/`SUPABASE_ANON_KEY` in `app.js` austauschen und neu deployen.

### 1. Tabelle & Sicherheitsregeln anlegen (einmalig, schon erledigt)

Im Supabase-Dashboard → **SQL Editor** → folgendes Skript einmalig ausführen:

```sql
create table if not exists public.training_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.training_data enable row level security;

create policy "Nutzer sehen nur ihre eigenen Daten"
  on public.training_data for select
  using (auth.uid() = user_id);

create policy "Nutzer schreiben nur ihre eigenen Daten"
  on public.training_data for insert
  with check (auth.uid() = user_id);

create policy "Nutzer aktualisieren nur ihre eigenen Daten"
  on public.training_data for update
  using (auth.uid() = user_id);
```

Das stellt sicher, dass jede*r Nutzer*in ausschließlich die eigene Zeile lesen und schreiben kann — selbst mit dem öffentlichen Anon-Key im Browser.

### 2. Profile & Admin-Zugriff einrichten (einmalig, schon erledigt)

Ebenfalls im **SQL Editor** ausführen — legt eine `profiles`-Tabelle an (für die Namenssuche im Admin-Bereich) und erlaubt Konten mit `is_admin = true`, alle Trainingsdaten zu sehen und zu bearbeiten:

```sql
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Jede*r sieht das eigene Profil"
  on public.profiles for select using (auth.uid() = id);
create policy "Jede*r legt das eigene Profil an"
  on public.profiles for insert with check (auth.uid() = id);
create policy "Jede*r bearbeitet das eigene Profil"
  on public.profiles for update using (auth.uid() = id);

create policy "Admin sieht alle Profile"
  on public.profiles for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

create policy "Admin sieht alle Trainingsdaten"
  on public.training_data for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
create policy "Admin bearbeitet alle Trainingsdaten"
  on public.training_data for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
create policy "Admin legt Trainingsdaten für Mitglieder an"
  on public.training_data for insert
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
```

Danach dich selbst zum Admin machen — einmal in der App registrieren/anmelden (damit dein Profil existiert), dann im SQL Editor mit deiner eigenen E-Mail-Adresse:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'DEINE-E-MAIL@beispiel.de');
```

Danach einmal ab- und wieder anmelden — unten erscheint dann der zusätzliche **„Admin"**-Tab.

**Wie der Admin-Zugriff geschützt ist:** Der 4-stellige Code (`0816`, in `app.js` als `ADMIN_PIN` hinterlegt) sperrt den Admin-Tab nur vor versehentlichem Antippen — er ist **keine** echte Sicherheitsmaßnahme, da er im Quellcode für jede*n sichtbar ist. Die tatsächliche Berechtigung kommt ausschließlich aus dem `is_admin`-Flag in der Datenbank, serverseitig über die Row-Level-Security-Regeln oben durchgesetzt. Nur ein Konto, das du selbst per SQL auf `is_admin = true` gesetzt hast, kommt an fremde Trainingsdaten heran — unabhängig vom Code.

Im Admin-Bereich kannst du nach dem Anzeigenamen eines Mitglieds suchen (den jede*r unter **Konto → Anzeigename** selbst setzen kann), das Konto öffnen und darin wie gewohnt Pläne/Übungen/Sätze bearbeiten sowie den Trainingsverlauf zurücksetzen. Über **„Verlassen"** kommst du zurück zur Mitgliederliste.

### 3. E-Mail-Bestätigung

Standardmäßig verlangt Supabase eine Bestätigungs-Mail bei der Registrierung, bevor man sich anmelden kann. Das lässt sich unter **Authentication → Providers → Email → „Confirm email"** ein-/ausschalten. Für eine App, die mehrere Personen nutzen, ist „aktiviert" die sicherere Wahl (verhindert, dass sich jemand mit einer fremden E-Mail-Adresse anmeldet).

### Sync-Verhalten

- Beim Anmelden wird zuerst der Cloud-Stand des eigenen Kontos geladen (falls vorhanden). Gibt es noch keinen, wird — nur beim allerersten Login auf einem Gerät — ein eventuell schon vorhandener lokaler Trainingsstand übernommen; sonst startet man mit einem leeren Trainingsbereich.
- Jede Änderung wird danach automatisch (mit kurzer Verzögerung) in die Cloud gespeichert.
- Das ist "Last-Write-Wins"-Sync (kein Zusammenführen einzelner Sätze) — für die Nutzung an einem Gerät nach dem anderen völlig ausreichend. Werden auf zwei Geräten gleichzeitig Änderungen gemacht, gewinnt der zuletzt gespeicherte Stand.

### Wer darf was sehen?

Die Row-Level-Security-Regeln aus Schritt 1 sorgen dafür, dass jedes Konto ausschließlich seine eigene Zeile in `training_data` lesen und schreiben kann — auch technisch versierte Nutzer*innen kommen über den öffentlichen Anon-Key nicht an fremde Trainingsdaten heran. Die einzige Ausnahme ist ein Konto mit `is_admin = true` (Schritt 2) — das ist bewusst so und nur für dich als Betreiber*in gedacht.

## Projektstruktur

```
index.html      App-Shell, Meta-Tags, Icon-Sprite
style.css       komplettes Design-System (Farben, Layout, Komponenten)
app.js          gesamte App-Logik (State, Rendering, Events, Sync)
manifest.json   PWA-Manifest
sw.js           Service Worker (Offline-Cache der App-Shell)
icons/          Logo & App-Icons in allen benötigten Größen
```

## Lokal entwickeln

Kein Build nötig — einfach über einen simplen Webserver öffnen (nicht direkt als `file://`, da der Service Worker und `fetch` das nicht erlauben):

```bash
python3 -m http.server 8080
# dann im Browser: http://localhost:8080
```

## Daten-Backup

Unter **Konto → Daten-Backup** kann der komplette Trainingsstand jederzeit als JSON-Datei heruntergeladen und auf einem anderen Gerät wieder importiert werden — unabhängig von Supabase.
