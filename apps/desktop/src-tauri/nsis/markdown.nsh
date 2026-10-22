; Register an optional per-user Markdown handler. Never set .md's default value
; or Windows' protected UserChoice: the user chooses their preferred editor.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\dev.veil.desktop.Markdown" "" "Markdown document"
  WriteRegStr HKCU "Software\Classes\dev.veil.desktop.Markdown\DefaultIcon" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
  WriteRegStr HKCU "Software\Classes\dev.veil.desktop.Markdown\shell\open" "FriendlyAppName" "Veil"
  WriteRegStr HKCU "Software\Classes\dev.veil.desktop.Markdown\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\.md\OpenWithProgids" "dev.veil.desktop.Markdown" ""
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "Veil"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".md" ""
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Push $R0
  ReadRegStr $R0 HKCU "Software\Classes\dev.veil.desktop.Markdown\shell\open\command" ""
  StrCmp $R0 '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"' 0 veil_markdown_done
  DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "dev.veil.desktop.Markdown"
  DeleteRegKey HKCU "Software\Classes\dev.veil.desktop.Markdown"
  DeleteRegKey HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  veil_markdown_done:
  Pop $R0
!macroend
