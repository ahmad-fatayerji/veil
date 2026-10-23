param([Parameter(Mandatory = $true)][string]$Archive)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskDestination = [System.IO.Path]::GetFullPath((Join-Path $taskRoot '.local\discord-social-sdk'))
if (!$taskDestination.StartsWith($taskRoot + '\')) { throw 'Invalid SDK destination.' }
$taskPackage = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Archive).Path)
try {
    foreach ($taskName in @('License-Notices.txt', 'include/discordpp.h', 'include/cdiscord.h', 'lib/release/discord_partner_sdk.lib', 'bin/release/discord_partner_sdk.dll')) {
        $taskEntry = $taskPackage.GetEntry('discord_social_sdk/' + $taskName)
        if (!$taskEntry -or $taskEntry.Length -gt 64MB) { throw "Missing or unexpected SDK asset: $taskName" }
        $taskPath = [System.IO.Path]::GetFullPath((Join-Path $taskDestination $taskName))
        if (!$taskPath.StartsWith($taskDestination + '\')) { throw 'Invalid SDK asset path.' }
        New-Item -ItemType Directory -Path (Split-Path -Parent $taskPath) -Force | Out-Null
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($taskEntry, $taskPath, $true)
    }
} finally { $taskPackage.Dispose() }
Write-Output "Windows x64 SDK assets staged in $taskDestination. Vendor files are ignored by Git."
