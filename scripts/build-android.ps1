param(
  [Parameter(Mandatory)][string]$Jdk,
  [Parameter(Mandatory)][string]$BuildTools,
  [Parameter(Mandatory)][string]$AndroidJar,
  [Parameter(Mandatory)][string]$Output
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$env:JAVA_HOME = (Resolve-Path -LiteralPath $Jdk).Path
$BuildTools = (Resolve-Path -LiteralPath $BuildTools).Path
$AndroidJar = (Resolve-Path -LiteralPath $AndroidJar).Path
$build = (New-Item -ItemType Directory -Force (Join-Path $repo '.build')).FullName
$stage = (New-Item -ItemType Directory (Join-Path $build ([Guid]::NewGuid().ToString('N')))).FullName

function Invoke-Build([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program exited with $LASTEXITCODE" }
}

$drawable = (New-Item -ItemType Directory -Force "$stage/res/drawable").FullName
$classes = (New-Item -ItemType Directory "$stage/classes").FullName
$dex = (New-Item -ItemType Directory "$stage/dex").FullName
Invoke-Build 'node' @("$repo/scripts/build-offline.mjs")
Copy-Item -LiteralPath "$repo/.build/android-assets" -Destination "$stage/assets" -Recurse
Invoke-Build 'python' @('-c', 'from PIL import Image; import sys; Image.open(sys.argv[1]).resize((192, 192), Image.Resampling.LANCZOS).save(sys.argv[2])', "$repo/web/logo.png", "$drawable/elleson_docs.png")
Invoke-Build "$BuildTools/aapt2.exe" @('compile', '--dir', "$stage/res", '-o', "$stage/res.zip")
Invoke-Build "$BuildTools/aapt2.exe" @('link', '--manifest', "$repo/android/AndroidManifest.xml", '--min-sdk-version', '26', '--target-sdk-version', '35', '-I', $AndroidJar, '-o', "$stage/unsigned.apk", "$stage/res.zip")
$javaSources = @(Get-ChildItem -LiteralPath "$repo/android" -Filter '*.java' | Select-Object -ExpandProperty FullName)
Invoke-Build "$Jdk/bin/javac.exe" (@('--release', '8', '-cp', $AndroidJar, '-d', $classes) + $javaSources)
$javaClasses = @(Get-ChildItem -LiteralPath $classes -Recurse -Filter '*.class' | Select-Object -ExpandProperty FullName)
Invoke-Build "$BuildTools/d8.bat" (@('--min-api', '26', '--lib', $AndroidJar, '--output', $dex) + $javaClasses)
Invoke-Build "$Jdk/bin/jar.exe" @('uf', "$stage/unsigned.apk", '-C', $dex, 'classes.dex')
Invoke-Build "$Jdk/bin/jar.exe" @('uf', "$stage/unsigned.apk", '-C', $stage, 'assets')
Invoke-Build "$BuildTools/zipalign.exe" @('-f', '-P', '16', '4', "$stage/unsigned.apk", "$stage/aligned.apk")

$key = Join-Path $build 'elleson-docs-sideload.p12'
$passwordFile = Join-Path $build 'elleson-docs-signing-password.dpapi'
if (!(Test-Path -LiteralPath $key)) {
  $password = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
  ConvertTo-SecureString $password -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $passwordFile
}
$securePassword = Get-Content -LiteralPath $passwordFile | ConvertTo-SecureString
$env:ELLESON_DOCS_APK_PASSWORD = [Net.NetworkCredential]::new('', $securePassword).Password
try {
  if (!(Test-Path -LiteralPath $key)) {
    Invoke-Build "$Jdk/bin/keytool.exe" @('-genkeypair', '-storetype', 'PKCS12', '-keystore', $key, '-storepass:env', 'ELLESON_DOCS_APK_PASSWORD', '-alias', 'elleson-docs', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Elleson Docs Android')
  }
  Invoke-Build "$BuildTools/apksigner.bat" @('sign', '--ks', $key, '--ks-key-alias', 'elleson-docs', '--ks-pass', 'env:ELLESON_DOCS_APK_PASSWORD', '--out', "$stage/signed.apk", "$stage/aligned.apk")
  Invoke-Build "$BuildTools/apksigner.bat" @('verify', '--verbose', "$stage/signed.apk")
  Invoke-Build "$BuildTools/zipalign.exe" @('-c', '-P', '16', '4', "$stage/signed.apk")
  & "$BuildTools/aapt2.exe" dump badging "$stage/signed.apk" | Select-String '^(package:|minSdkVersion:|targetSdkVersion:|launchable-activity:)'
  if ($LASTEXITCODE -ne 0) { throw 'APK metadata could not be read.' }
  Copy-Item -LiteralPath "$stage/signed.apk" -Destination $Output -Force
} finally {
  Remove-Item Env:ELLESON_DOCS_APK_PASSWORD -ErrorAction SilentlyContinue
}
