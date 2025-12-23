extension dsc
targetScope = 'local'

@allowed(['toggle', 'on', 'off'])
@description('Dark or light color mode')
param darkMode string = 'toggle'

resource darkModeScript 'Microsoft.DSC.Transitional/PowerShellScript@0.1.0' = [
  for arg in [darkMode, 'status']: {
    // This CLI uses no argument to mean toggle
    setScript: 'dark-mode ${arg == 'toggle' ? '' : arg}'
  }
]

// Print out the status (which we got in the second script)
output darkModeStatus string = darkModeScript[^1].output[?0] ?? 'unknown'

@description('Packages to get')
param packages array

resource brew 'DSC.PackageManagement/Brew@0.1.0' existing = [
  for package in packages: {
    packageName: package
  }
]

output brewOutput array = brew
