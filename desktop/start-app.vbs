Option Explicit
Dim shell, fso, root, nodeExe, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
If Not fso.FileExists(nodeExe) Then nodeExe = shell.ExpandEnvironmentStrings("%AppData%\npm\node.exe")
If Not fso.FileExists(nodeExe) Then nodeExe = "node.exe"
cmd = Chr(34) & nodeExe & Chr(34) & " " & Chr(34) & root & "\launcher.js" & Chr(34)
shell.Run cmd, 0, False
