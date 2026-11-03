# Browser-Migration: Fortschritt und offene Arbeiten

Stand: 2. November 2026

## Zielbild

OpenIDEA wird als Hybridprodukt weiterentwickelt:

- **Tauri Desktop** bleibt ein dauerhaft unterstütztes Produkt. Native
  Funktionen, Commands und Abhängigkeiten werden nicht entfernt, nur um den
  Browser-Build zu ermöglichen.
- **Browser + Rust/WASM** erhält schrittweise Funktionen, die mit Browser-APIs
  und expliziter Nutzerfreigabe sicher umgesetzt werden können.
- Der Browser erhält keinen stillen Zugriff auf beliebige Pfade, Prozesse,
  PTYs, native Watcher oder beliebige TCP-/UDP-Verbindungen.
- Remote-Dienste sind nicht freigegeben. Serviceabhängige Funktionen bleiben
  bis zu einer Produktentscheidung über Betrieb, Authentifizierung, Trust und
  Datenverarbeitung zurückgestellt.
- Aktuelles Browserziel: **Chrome 122+**. Unterstützung weiterer Browser ist
  noch nicht entschieden.

Der detaillierte Architektur- und PR-Plan steht in
[`web-only-migration-plan.md`](web-only-migration-plan.md). Der
Command-/Feature-Status wird in [`command-inventory.md`](command-inventory.md)
geführt.

## Meilensteine

| PR     | Ergebnis                                                                                  | Status                                             |
| ------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| PR 1–3 | Browser-Build-Basis, Plattformgrenze, Browser-Command-/Event-Vertrag und Command-Inventar | **Committed**, `f5e9d7f2`                          |
| PR 4   | Reiner Rust/WASM-Core ohne Tauri-/Host-Abhängigkeit im WASM-Crate                         | **Committed**, `3df143b4`                          |
| PR 5   | VFS-Adaptervertrag bei Erhalt des nativen Backends                                        | **Committed**, `6332a9a4`                          |
| PR 6   | Browser-Dateiadapter und IndexedDB-Persistenz als erster Browser-Datei-Schnitt            | **Committed**, `2eaaa394`                          |
| PR 7   | Browserfähige Funktionen inkrementell portieren                                           | **In Arbeit**                                      |
| PR 8   | Hybrid-Release, CI und Artefakte für Browser und Desktop                                  | **Noch nicht begonnen**; Tauri wird nicht entfernt |

Die jüngsten abgeschlossenen Commits im Verlauf:

- `d83e7342` — Browser-App-Metadaten (`app_info`)
- `71bb8a93` — Browserdateien in der Recent-Liste anzeigen, wieder öffnen und
  entfernen, ohne gespeicherten Inhalt zu löschen

## Erreicht

### Browser-Grundlage und Plattformgrenze

- Separater Browser-Build-Modus ohne Tauri-Initialisierung.
- Tauri- und Browseradapter für Plattformfunktionen; der Desktoppfad bleibt
  erhalten.
- Browser-Command-Dispatcher mit typisierten `unavailable`-Fehlern statt
  success-förmiger No-op-Antworten.
- Capability-Registry mit `available`, `unsupported` und
  `permission-required`.
- Browser-Command-/Event-/Stream-Vertrag und Command-Inventar.
- `app_info` liefert Browser-Metadaten mit Plattform `web`.
- Browserfähige Imports lassen Tauri-Globals und Tauri-Laufzeit außen vor.

### Rust/WASM und VFS

- Eigenes `ide-wasm`-Crate mit enger WASM-Schnittstelle für reine
  Text-/Koordinaten-/Dokumentfunktionen.
- Native Parser-/Tree-sitter-Abhängigkeiten werden nicht pauschal in den
  WASM-Core gezogen.
- VFS-Vertrag ergänzt; nativer VFS-Adapter und Desktopsemantik bleiben
  bestehen.

### Browserdateien und Welcome

- Ausgewählte Textdateien lassen sich im Browser öffnen und editieren.
- Mit File System Access API können Änderungen in die Quelldatei geschrieben
  werden; fehlende oder verweigerte Berechtigung wird explizit behandelt.
- Fallback ohne File System Access API: Dateiauswahl über Browser-Dateidialog,
  Speichern als Download.
- Browserdokumente werden in IndexedDB gespeichert und erscheinen in Recent
  Files. Wiederöffnen nach Reload funktioniert; aus Recents entfernen löscht
  den gespeicherten Inhalt nicht.
- Browser-Workspaces können mehrere ausdrücklich freigegebene Ordner
  gruppieren. Handles liegen in IndexedDB; Berechtigungen werden erneut
  abgefragt. Browsen/Öffnen benötigt Leseberechtigung; Anlegen/Speichern
  fordert Schreibberechtigung erst bei Bedarf an. Unterstützte Textdateien
  lassen sich navigieren, öffnen und speichern. Ein Root kann per erneuter
  Verzeichnisauswahl ersetzt werden; offene Workspace-Dateien speichern danach
  über den neuen Root-Handle. Bei verweigertem Schreiben bleiben Änderungen in
  IndexedDB und werden beim erneuten Öffnen wiederhergestellt.
- Neue unterstützte Textdateien können im aktuellen Workspace-Ordner angelegt
  und direkt im Editor geöffnet werden. Vorhandene Dateien werden nicht
  überschrieben.
- Browser-Datei-Backups lassen sich als versioniertes JSON importieren und
  exportieren. Backups enthalten Dokumentinhalte, aber keine Workspace-Handles
  oder Berechtigungsfreigaben.
- Browser-Textdateien müssen gültiges UTF-8 sein und dürfen höchstens 50 MiB
  groß sein; ungültige oder größere Dateien werden mit einer Erklärung
  abgewiesen, statt stillschweigend beschädigt zu werden.
- Ohne Verzeichnis-API zeigt die Oberfläche den Fallback/Grund an; ausgewählte
  Einzeldateien bleiben nutzbar.

### Dokumentation und Checks

- Der Migrationsplan beschreibt jetzt das Hybridziel und erhält Tauri
  ausdrücklich.
- Die Command-Inventur hält Browserdateien, Workspaces und ihre Grenzen fest.
- Im aktuellen PR-7-Arbeitsstand wurden zuletzt erfolgreich ausgeführt:
  - Browser-Produktionsbuild einschließlich WASM-Build und Typecheck.
  - Fokussierte Vitest-Suite: **31 Tests bestanden**.
  - Browser-Welcome-Playwright-Suite: **4 E2E-Tests bestanden**.
  - Oxlint und Oxfmt-Prüfung aller geänderten Dateien.
  - `git diff --check`. Der repository-weite Oxfmt-Check meldet weiterhin
    Formatabweichungen in 1.650 nicht geänderten Dateien.

## PR-7-Arbeitsstand

Der aktuelle PR-7-Schnitt deckt Browser-Welcome, explizit freigegebene
Dateien/Ordner, Workspace-Textdateien sowie Backup-Import/-Export ab. Die
Browser-E2E-Szenarien prüfen:

1. Einzeldatei öffnen, nach Reload wieder öffnen und aus Recents entfernen,
   ohne deren gespeicherten Inhalt zu löschen.
2. Workspace mit mehreren Roots anlegen, Roots umschalten, Quelldatei ändern,
   Änderung speichern und Workspace nach Reload wiederherstellen.
3. Neue Workspace-Textdatei anlegen, editieren und in die Quelldatei speichern.
4. Backup importieren/exportieren und prüfen, dass keine Handles im Export
   enthalten sind.
5. Fehlenden Directory Picker und den Einzeldatei-Fallback sichtbar behandeln.

**Git-Status:** Der oben beschriebene aktuelle PR-7-Schnitt ist noch
uncommitted. Vor einem Commit die gesamte Diff prüfen; nicht zu diesem Vorhaben
gehörende Änderungen nicht übernehmen.

## Noch zu tun

### PR 7 — erforderlich, bevor der PR als abgeschlossen gelten kann

- [ ] Die PR-7-Zielmenge festlegen. Der PR ist ein inkrementeller
      Migrationsschritt, keine vollständige Browser-Parität und nicht die Portierung
      aller 41 Command-Domains.
- [ ] Jede ausgelieferte Browserfunktion im Command-Inventar klassifizieren:
      Browser/WASM, Browser-API, nicht verfügbar oder serviceabhängig. Status und
      UI-Verhalten müssen übereinstimmen.
- [ ] Noch nicht migrierte, tatsächlich benötigte reine Funktionen auswählen
      und als kleine End-to-End-Schnitte portieren; nicht nur Command-Stubs
      hinzufügen. Kandidaten erst nach Prüfung ihrer Abhängigkeiten wählen.
- [x] Für Workspace-Browsing und Öffnen nur Leseberechtigung anfordern;
      Schreibberechtigung erst für Datei-Anlage und Speichern anfordern. Den
      verweigerten Schreibzugriff mit erhaltenem Editorinhalt testen.
- [x] Bei verweigertem Workspace-Schreibzugriff den Entwurf in IndexedDB
      erhalten, Fehler klar anzeigen und den Entwurf beim erneuten Öffnen
      wiederherstellen.
- [x] Datei-/Workspace-Import und -Export als Verhalten dokumentieren:
      Workspace-Handles und Berechtigungen werden nicht exportiert; Inhalte bleiben
      bei Workspace-Entfernung erhalten.
- [x] Größenlimit und Encoding für Browser-Textdateien explizit festlegen;
      übergroße und ungültige UTF-8-Dateien werden verständlich abgelehnt.
- [ ] Binäre Vorschau und `bytes`-Commands separat portieren, falls diese für
      den Browserumfang benötigt werden.
- [ ] Gesamte PR-Diff einschließlich der älteren uncommitted
      Hybrid-Planänderung reviewen und danach den PR-7-Schnitt committen, wenn der
      Nutzer dies freigibt.

### Bewusst nicht Teil dieses Browser-Schnitts

- Native Projektinitialisierung, Projektkonfiguration und Desktop-
  Workspace-IPC.
- LSP, DAP/Debugger, Terminal/PTY, Prozessstart, Toolchains, Docker und SSH.
- Native VCS-/Git-Operationen, Repository-Cloning und Remote Development.
- Arbiträre lokale Pfade, native File-Watcher, Symlinks, Trash und
  Betriebssystem-Metadaten.
- Remote-Dienste ohne separate Produktentscheidung.
- Vollständige Portierung der übrigen Command-Domains; die Inventarklassifikation
  ist ein Zielbild und behauptet nicht, dass die Commands bereits laufen.

### PR 8 — später

- Hybrid-CI und saubere Builds für Browser und Tauri Desktop sicherstellen.
- Dokumentation, Entwicklungsvoraussetzungen und Release-Artefakte für beide
  Editionen festlegen.
- Browser-Bundle/Dependency-Graph auf Abwesenheit nativer/Tauri-Laufzeit prüfen.
- Keine Tauri-Abhängigkeit oder Desktopfunktion entfernen, solange ein
  unterstützter Desktop-/Testpfad sie benötigt.

## Entscheidungen, die noch offen sind

- Welche Funktionen sind für die erste Browser-Veröffentlichung verpflichtend?
  Besonders Terminal, LSP, Debugger, Git, SSH und Datenbankzugriff.
- Sind authentifizierte Remote-Dienste für einzelne dieser Funktionen erlaubt?
- Soll Browserunterstützung über Chrome 122+ hinausgehen?
- Welche UX soll für widerrufene Handles, Speicherquota und nicht unterstützte
  Dateitypen verbindlich gelten?
