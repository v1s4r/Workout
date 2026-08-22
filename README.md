# Track Your Health

Dein persönliches Trainings-Logbuch für Push/Pull-Splits & Co. — Pläne, Sätze, Gewichte und Fortschritt, direkt im Browser, mit eigenem Login pro Person und automatischer Cloud-Synchronisierung zwischen PC und Handy.

Keine Installation, kein Build-Prozess, keine Abhängigkeiten außer dem Browser — nur statische Dateien.

## Features

- **Eigenes Konto pro Person**: Login-Bildschirm vor der App — jede*r bekommt einen privaten Trainingsbereich, niemand sieht die Daten anderer (Supabase Row Level Security)
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

### 2. E-Mail-Bestätigung

Standardmäßig verlangt Supabase eine Bestätigungs-Mail bei der Registrierung, bevor man sich anmelden kann. Das lässt sich unter **Authentication → Providers → Email → „Confirm email"** ein-/ausschalten. Für eine App, die mehrere Personen nutzen, ist „aktiviert" die sicherere Wahl (verhindert, dass sich jemand mit einer fremden E-Mail-Adresse anmeldet).

### Sync-Verhalten

- Beim Anmelden wird zuerst der Cloud-Stand des eigenen Kontos geladen (falls vorhanden). Gibt es noch keinen, wird — nur beim allerersten Login auf einem Gerät — ein eventuell schon vorhandener lokaler Trainingsstand übernommen; sonst startet man mit einem leeren Trainingsbereich.
- Jede Änderung wird danach automatisch (mit kurzer Verzögerung) in die Cloud gespeichert.
- Das ist "Last-Write-Wins"-Sync (kein Zusammenführen einzelner Sätze) — für die Nutzung an einem Gerät nach dem anderen völlig ausreichend. Werden auf zwei Geräten gleichzeitig Änderungen gemacht, gewinnt der zuletzt gespeicherte Stand.

### Wer darf was sehen?

Die Row-Level-Security-Regeln aus Schritt 1 sorgen dafür, dass jedes Konto ausschließlich seine eigene Zeile in `training_data` lesen und schreiben kann — auch technisch versierte Nutzer*innen kommen über den öffentlichen Anon-Key nicht an fremde Trainingsdaten. Es gibt aktuell keine Admin-Ansicht, über die du als Betreiber*in fremde Konten einsehen könntest (das müsste bei Bedarf gesondert gebaut werden).

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
