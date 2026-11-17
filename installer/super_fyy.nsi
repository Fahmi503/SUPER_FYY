; SUPER FYY — Windows NSIS Installer Configuration
; Product: SUPER FYY Universal AI Development Workspace
; Target: %LOCALAPPDATA%\Programs\Super Fyy
; Data: %LOCALAPPDATA%\SuperFyy (Strictly Preserved on Uninstall)

!define PRODUCT_NAME "Super Fyy"
!define PRODUCT_VERSION "1.0.0"
!define PRODUCT_PUBLISHER "Fahmi503"
!define PRODUCT_DIR_REGKEY "Software\Microsoft\Windows\CurrentVersion\App Paths\super-fyy.exe"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"

SetCompressor /SOLID lzma

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "SuperFyy-Setup-${PRODUCT_VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Super Fyy"
RequestExecutionLevel user

Section "MainSection" SEC01
  SetOutPath "$INSTDIR"
  SetOverwrite ifnewer
  
  File /r "dist\*.*"
  File /r "node_modules\*.*"
  File "package.json"
  File "super-fyy.bat"

  ; Create Shortcuts
  CreateDirectory "$SMPROGRAMS\Super Fyy"
  CreateShortCut "$SMPROGRAMS\Super Fyy\Super Fyy.lnk" "$INSTDIR\super-fyy.bat" "" "$INSTDIR\icon.ico" 0
  CreateShortCut "$DESKTOP\Super Fyy.lnk" "$INSTDIR\super-fyy.bat" "" "$INSTDIR\icon.ico" 0
SectionEnd

Section -Post
  WriteUninstaller "$INSTDIR\uninst.exe"
  WriteRegStr HKCU "${PRODUCT_DIR_REGKEY}" "" "$INSTDIR\super-fyy.bat"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayName" "$(^Name)"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "UninstallString" "$INSTDIR\uninst.exe"
SectionEnd

Section Uninstall
  ; Delete application binary files only
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\Super Fyy\Super Fyy.lnk"
  RMDir "$SMPROGRAMS\Super Fyy"
  Delete "$DESKTOP\Super Fyy.lnk"
  DeleteRegKey HKCU "${PRODUCT_UNINST_KEY}"
  DeleteRegKey HKCU "${PRODUCT_DIR_REGKEY}"
  
  ; CRITICAL DATA PRESERVATION RULE:
  ; NEVER delete $LOCALAPPDATA\SuperFyy where SQLite project memories live!
SectionEnd
