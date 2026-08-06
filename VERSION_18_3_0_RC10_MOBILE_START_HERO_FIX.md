# Version 18.3.0 RC10 – Mobile Start- und Hero-Fix

- Smartphone-Hero nutzt die komplette Kachelfläche im Seitenverhältnis 4:5.
- Das Hintergrundfoto füllt die Kachel mit `object-fit: cover` vollständig aus.
- Hero-Bild, Overlay und Blur-Hintergrund übernehmen denselben Kachelradius.
- Service Worker lädt JavaScript und CSS bevorzugt frisch aus dem Netzwerk.
- Veraltete PWA-Caches werden beim Aktivieren entfernt.
- Bei veralteten Chunk-Dateien führt die App einmalig eine automatische Cache-Reparatur aus.
