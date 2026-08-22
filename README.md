# Track Your Health

Dein persönliches Trainings-Logbuch für Push/Pull-Splits & Co. — Pläne, Sätze, Gewichte und Fortschritt, direkt im Browser, offline-fähig, optional mit deiner eigenen Supabase-Cloud synchronisiert zwischen PC und Handy.

Keine Installation, kein Build-Prozess, keine Abhängigkeiten außer dem Browser — nur statische Dateien.

## Features

- **Trainingspläne** anlegen, umbenennen, löschen (z. B. Push A/B, Pull A/B)
- **Workout-Modus**: Sätze mit Gewicht & Wiederholungen eintragen, Vergleich zum letzten Mal direkt daneben, Trainings- & Pausen-Timer
- **Fortschritt**: Verlaufs-Chart pro Übung inkl. PR-Erkennung
- **Workoutz**: kompakte Tabellenansicht aller Sessions zum schnellen Nachschauen/Bearbeiten
- **Statistiken**: Sessions diese Woche, Tage-Streak, Gesamtzahl Einheiten
- **Offline-first**: alles läuft über `localStorage`, funktioniert ohne Internet
- **Cloud-Sync (optional)**: eigenes Supabase-Projekt verbinden → Daten stehen auf allen Geräten zur Verfügung
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

## Cloud-Sync mit Supabase einrichten

Die App funktioniert komplett ohne Supabase (nur lokal, pro Gerät). Für Sync zwischen mehreren Geräten:

### 1. Tabelle & Sicherheitsregeln anlegen

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

### 2. E-Mail-Bestätigung (optional)

Standardmäßig verlangt Supabase eine Bestätigungs-Mail bei der Registrierung. Für den schnellen Eigengebrauch kannst du das unter **Authentication → Providers → Email → "Confirm email"** deaktivieren. Für den produktiven Einsatz empfiehlt sich, es aktiviert zu lassen.

### 3. Zugangsdaten in der App eintragen

Im Supabase-Dashboard unter **Project Settings → API**:
- **Project URL** (z. B. `https://xxxxxxxx.supabase.co`)
- **anon / public key** (kein Geheimnis — dieser Key ist für den Browser gedacht, der eigentliche Schutz läuft über die Row-Level-Security-Regeln von oben)

Beide Werte in der App unter **Konto → Supabase-Projekt verbinden** eintragen und speichern. Danach registrieren oder anmelden — die App synchronisiert automatisch bei jeder Änderung.

Die Zugangsdaten werden nur lokal im Browser (`localStorage`) gespeichert, nicht im Code/Repo.

### Sync-Verhalten

- Jede Änderung wird lokal sofort gespeichert und (wenn verbunden) mit kurzer Verzögerung in die Cloud gepusht.
- Beim Anmelden auf einem neuen Gerät wird geprüft, ob der Cloud-Stand neuer ist als der lokale — bei Unterschieden fragt die App nach, welcher Stand übernommen werden soll.
- Das ist "Last-Write-Wins"-Sync (kein Zusammenführen einzelner Sätze) — für den Einsatz an einem Gerät gleichzeitig völlig ausreichend. Bei echter Parallelnutzung an zwei Geräten zur exakt gleichen Zeit gewinnt der zuletzt gespeicherte Stand.

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
