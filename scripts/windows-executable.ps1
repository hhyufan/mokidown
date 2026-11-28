param(
    [Parameter(Mandatory)][string]$ExecutablePath,
    [ValidatePattern('^[a-fA-F0-9]{40}$')][string]$Thumbprint,
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
$executable = Get-Item -LiteralPath $ExecutablePath
$sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
function Get-SdkTool([string]$name) {
    $tool = Get-ChildItem -Path (Join-Path $sdk "*/x64/$name") -File |
        Sort-Object FullName -Descending | Select-Object -First 1
    if (!$tool) { throw "Windows SDK $name was not found." }
    return $tool.FullName
}

$mt = Get-SdkTool 'mt.exe'
$manifestPath = [IO.Path]::GetTempFileName()
try {
    & $mt -nologo "-inputresource:$($executable.FullName);#1" "-out:$manifestPath"
    if ($LASTEXITCODE -ne 0) { throw "Could not read manifest from $($executable.Name)." }
    $manifest = [xml](Get-Content -LiteralPath $manifestPath -Raw)
    $namespaces = [System.Xml.XmlNamespaceManager]::new($manifest.NameTable)
    $namespaces.AddNamespace('asm', 'urn:schemas-microsoft-com:asm.v1')
    $namespaces.AddNamespace('uac', 'urn:schemas-microsoft-com:asm.v3')
    $level = $manifest.SelectSingleNode('/asm:assembly/uac:trustInfo/uac:security/uac:requestedPrivileges/uac:requestedExecutionLevel', $namespaces)
    if (!$level -or $level.level -ne 'asInvoker' -or $level.uiAccess -ne 'false') {
        throw "$($executable.Name) must declare asInvoker with uiAccess=false."
    }
} finally {
    Remove-Item -LiteralPath $manifestPath
}

if ($Thumbprint) {
    if (!$VerifyOnly) {
        $signTool = Get-SdkTool 'signtool.exe'
        & $signTool sign /sha1 $Thumbprint /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $executable.FullName
        if ($LASTEXITCODE -ne 0) { throw "SignTool failed to sign $($executable.Name)." }
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $executable.FullName
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $Thumbprint -or !$signature.TimeStamperCertificate) {
        throw "Signature verification failed for $($executable.Name) ($($signature.Status))."
    }
}
