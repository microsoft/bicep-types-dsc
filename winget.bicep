extension dsc
targetScope = 'local'

metadata winget = { processor: { identifier: 'dscv3' } }

@description('Packages to install')
param packages array

resource wingetPackage 'Microsoft.WinGet/Package@1.12.460' = [
  for package in packages: {
    id: package
  }
]

resource wingetUserSettings 'Microsoft.WinGet/UserSettingsFile@1.12.460' = {
  settings: {}
}

resource wingetAdminSettings 'Microsoft.WinGet/AdminSettings@1.12.460' = {
  settings: {
    LocalManifestFiles: false
    ProxyCommandLineOptions: false
    BypassCertificatePinningForMicrosoftStore: false
    InstallerHashOverride: false
    LocalArchiveMalwareScanOverride: false
  }
}
