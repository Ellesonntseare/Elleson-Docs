$ErrorActionPreference = 'Stop'
$destination = Join-Path $env:LOCALAPPDATA 'Programs\Elleson Docs'
$application = Join-Path $destination 'Elleson Docs.exe'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Get-ChildItem -LiteralPath $PSScriptRoot | Copy-Item -Destination $destination -Recurse -Force
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $shortcut = $shell.CreateShortcut((Join-Path $folder 'Elleson Docs.lnk'))
  $shortcut.TargetPath = $application
  $shortcut.WorkingDirectory = $destination
  $shortcut.IconLocation = "$application,0"
  $shortcut.Save()
}
$registration = 'HKCU:\Software\Classes\Applications\Elleson Docs.exe'
New-Item -Path "$registration\shell\open\command" -Force | Out-Null
Set-Item -LiteralPath "$registration\shell\open\command" -Value ('"' + $application + '" "%1"')
New-ItemProperty -LiteralPath $registration -Name FriendlyAppName -Value 'Elleson Docs' -PropertyType String -Force | Out-Null
New-Item -Path "$registration\SupportedTypes" -Force | Out-Null
foreach ($extension in @('.pdf', '.doc', '.docx')) {
  New-ItemProperty -LiteralPath "$registration\SupportedTypes" -Name $extension -Value '' -PropertyType String -Force | Out-Null
}
Start-Process -FilePath $application
