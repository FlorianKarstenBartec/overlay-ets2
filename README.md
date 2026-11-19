# Overlay ETS2

Kleines Always-on-top Overlay für Euro Truck Simulator 2 und TruckersMP.

Es liest denselben lokalen FPH-Telemetry-Feed wie SpedV unter `127.0.0.1:25552`.

![Overlay im Spiel](docs/screenshots/ingame.png)

Oben links sitzt die Tour-Anzeige. Unten rechts bleibt der normale ETS2-Route-Advisor. So hast du Ziel, Rest und Ankunft dauerhaft im Blick.

## Tour-HUD

![Tour-HUD](docs/screenshots/tour-hud.png)

| Bereich | Inhalt |
| --- | --- |
| Tour-Zeile | Zielstadt, Ladung, Gewicht in Tonnen |
| Firma | Empfängerfirma |
| Rest | Verbleibende km laut Ingame-Navigation |
| Dauer | Geschätzte Realzeit bis zum Ziel |
| Ankunft | Voraussichtliche Ankunftszeit |
| Tempomat | Gesetzte Geschwindigkeit, grau aus, grün an |
| Balken | Gefahren / Gesamt-Navi-km |
| Flaggen | Start- und Zielland unter dem Balken |

`F9` blendet das Tour-HUD ein und aus. Im Infobereich sitzt ein LKW-Tray-Icon. Links-Klick schaltet das Overlay, Rechts-Klick öffnet das Menü.

## Uhr

![Uhr](docs/screenshots/clock.png)

Kleine Realzeit-Uhr oben rechts. Sie bleibt sichtbar, solange das Spiel verbunden ist. Die Tour-Anzeige kann dagegen bei Pause ohne Auftrag ausblenden.

## Dauer und Ankunft

Die Ingame-Zeitskala fließt nicht in die Rechnung ein.

```
Dauer = Rest-km / (Durchschnitt km/h)
```

Den Durchschnitt legst du beim ersten Start fest (Standard 90 km/h) und kannst ihn später unter Tray → **Einstellungen…** ändern. Kurze Stadt- oder Autobahn-Stücke reißen die Schätzung nicht um. Nach genug Strecke und Zeit auf dem Auftrag mischt sich ein Tour-Schnitt langsam ein.

Stehst du, bleibt die Dauer stehen. Die Ankunftszeit wandert nach hinten.

### Fähre

Ist die erste stabile Navi-Strecke klar länger als die geplante Job-km, wird die Differenz einmal als Fähre gelockt. Dauer und Ankunft rechnen ohne diesen Anteil. Der Fortschrittsbalken behält die volle Navi-Länge.

Spätere Umwege, falsch Abbiegen oder entfernte Wegpunkte folgen dem aktuellen Navi. Sie gelten nicht als neue Fähre.

### Balken

- Gesamt kommt aus der Navi-Strecke und wird pro Auftrag gespeichert. Ein Neustart des Overlays behält `gefahren / gesamt`.
- Wird die Route länger, wächst das Total. Nimmst du einen Marker wieder weg, ohne dich zu bewegen, schrumpft das Total zurück.
- Die Zahl unter **Rest** ist dieselbe Reststrecke wie am Balken (`gesamt − gefahren`).

## Voraussetzungen

- Windows
- FPH Telemetry (kommt mit FPH SpedV) und Antwort auf `http://127.0.0.1:25552/api/ets2/telemetry`
- Euro Truck Simulator 2 (TruckersMP funktioniert genauso)

Andere lokale Server mit demselben JSON-Format gehen über `ETS2_TELEMETRY_URL`.

## Installation (Spieler)

Kein Node.js nötig.

1. Unter [Releases](https://github.com/FlorianKarstenBartec/overlay-ets2/releases) die aktuelle `Setup.exe` laden
2. Installer ausführen (Desktop- und Startmenü-Verknüpfung)
3. Overlay starten – beim ersten Mal Durchschnitts-km/h setzen
4. FPH/SpedV laufen lassen, dann ETS2/TMP starten

Läuft das Spiel, aber die Telemetry fehlt, zeigt das Tour-Fenster: **Keine Telemetry – FPH/SpedV starten**.

## Entwicklung

Node.js 18 oder neuer:

```bash
git clone https://github.com/FlorianKarstenBartec/overlay-ets2.git
cd overlay-ets2
npm install
npm start
```

Nach `npm install` reicht auch ein Doppelklick auf `start.bat`.

Installer bauen:

```bash
npm run dist
```

Die Setup.exe liegt danach unter `dist/`.

## Bedienung

| Eingabe | Aktion |
| --- | --- |
| F9 | Tour-HUD ein oder aus |
| Tray links | Tour-HUD ein oder aus |
| Tray rechts | Einstellungen, Mit Windows starten, Beenden |

Das Tour-HUD blendet aus, wenn das Spiel pausiert ist und kein Auftrag läuft, und wenn weder Spiel noch Telemetry da sind. Die Uhr bleibt bei verbundenem Spiel.

## Konfiguration

Einstellungen liegen unter `%AppData%/overlay-ets2/settings.json`.

| Umgebungsvariable | Standard | Bedeutung |
| --- | --- | --- |
| `ETS2_TELEMETRY_URL` | `http://127.0.0.1:25552/api/ets2/telemetry` | Telemetry-URL |
| `ETS2_POLL_MS` | `150` | Abfrageintervall in ms |
| `ETS2_SEED_SPEED` | `90` | Fallback-Durchschnitt nur ohne settings.json |

## Projektstruktur

```
main.js              Fenster, Tray, Settings, Autostart, IPC
preload.js           Bridge in den Renderer
renderer/
  app.js             HUD-Zustand, Balken, Ankunftsbanner
  settings.html      Einstellungen (km/h, Autostart)
  telemetry.js       Mapping vom FPH-JSON
  eta.js             Dauer und Ankunft in Realzeit
  ferry.js           Fähren-Lock und ETA-Rest
  routeStore.js      localStorage für Fortschritt über Neustarts
  cities.js          Stadt zu ISO-Land für Flaggen
  index.html         Tour-HUD
  clock.html         Uhr
docs/screenshots/    Bilder für diese README
```

## Lizenz

MIT. Siehe [LICENSE](LICENSE).
