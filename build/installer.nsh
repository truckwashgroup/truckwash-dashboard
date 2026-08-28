; ===========================================================================
;  Extra stappen bij het installeren
;
;  Aanleiding: bij het bijwerken kwam de installer twee keer vast te zitten.
;
;   1. "Truckwash1 Dashboard kan niet automatisch worden afgesloten."
;      De standaardaanpak van NSIS krijgt het venster soms niet dicht, zeker
;      niet als er nog een achtergrondproces van Electron leeft. We sluiten
;      het proces daarom zelf af voordat we beginnen.
;
;   2. "Het deïnstalleren van oude applicatiebestanden is mislukt: 2."
;      Dat kwam doordat de installer zonder beheerdersrechten draaide terwijl
;      de oude versie in Program Files stond. Dat is opgelost door de
;      installatie op perMachine te zetten; deze stappen maken het geheel
;      alleen wat robuuster.
; ===========================================================================

!macro customInit
  DetailPrint "Controleren of Truckwash1 Dashboard nog draait..."

  ; /T sluit ook de renderer- en GPU-processen die Electron opstart.
  nsExec::Exec 'taskkill /F /T /IM "Truckwash1 Dashboard.exe"'
  Pop $0

  ; Even wachten tot Windows de bestandsvergrendelingen echt heeft losgelaten;
  ; zonder die pauze mislukt het verwijderen alsnog.
  Sleep 1500
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /T /IM "Truckwash1 Dashboard.exe"'
  Pop $0
  Sleep 1000
!macroend
