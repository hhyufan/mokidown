param(
    [Parameter(Mandatory)][string]$InstallerPath,
    [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$Thumbprint
)

$ErrorActionPreference = 'Stop'
$installer = Get-Item -LiteralPath $InstallerPath
$sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$signTool = Get-ChildItem -LiteralPath $sdk -Filter signtool.exe -Recurse -File |
    Where-Object { $_.Directory.Name -eq 'x64' } |
    Sort-Object FullName -Descending | Select-Object -First 1
if (!$signTool) { throw 'Windows SDK SignTool was not found.' }

& $signTool.FullName sign /sha1 $Thumbprint /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $installer.FullName
if ($LASTEXITCODE -ne 0) { throw 'SignTool failed to sign the installer.' }
$signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $Thumbprint -or !$signature.TimeStamperCertificate) {
    throw "Installer signature verification failed ($($signature.Status))."
}
