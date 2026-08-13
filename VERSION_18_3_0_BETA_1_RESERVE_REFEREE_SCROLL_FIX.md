# Reserve-Schiedsrichter & Mobile-Spielcenter Scroll Fix

- Schiedsrichter wird nur noch aus einem lokalen ÖFB-DOM-Bereich übernommen, der zugleich zum erwarteten Heim- und Gastteam des konkreten Spiels gehört.
- Globale Schiedsrichter-Fallbacks aus dem gesamten Seitentext werden für das Match verworfen.
- Bei zukünftigen Spielen ohne offiziellen Schiedsrichter wird ein alter/falsch zugeordneter Wert beim nächsten Spielbericht-Sync entfernt.
- Mobile Spielcenter-Scroll-Sperre aus der vorherigen Scroll-Fix-Version wieder integriert: Hintergrund wird fixiert, nur der Vordergrund scrollt.
- Bottom-Navigation wird während des mobilen Spielcenters ausgeblendet und iOS Safe-Areas werden berücksichtigt.
