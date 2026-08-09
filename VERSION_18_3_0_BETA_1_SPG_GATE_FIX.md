# 18.3.0-beta.1 – SPG Smart-Gate Fix

Behebt die Erkennung von SPG-Mannschaftsnamen wie `SPG TSU Ainet/SU Oberlienz U17`.
Der bisherige Smart-Gate-Filter erkannte diese Spiele wegen des Slash direkt nach `Ainet` nicht und startete daher den ÖFB-Abruf nicht.
