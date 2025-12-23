extension dsc
targetScope = 'local'

@allowed(['toggle', 'on', 'off'])
@description('Dark or light color mode')
param darkMode string = 'toggle'

var prefix = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion'
var keys = [
  {
    name: 'AccentColorMenu'
    path: '${prefix}\\Explorer\\Accent'
  }
  {
    name: 'StartColorMenu'
    path: '${prefix}\\Explorer\\Accent'
  }
  {
    name: 'AppsUseLightTheme'
    path: '${prefix}\\Themes\\Personalize'
  }
  {
    name: 'SystemUsesLightTheme'
    path: '${prefix}\\Themes\\Personalize'
  }
]

resource currentRegistryKey 'Microsoft.Windows/Registry@1.0.0' existing = {
  keyPath: keys[^1].path
  valueName: keys[^1].name
}

var current int = currentRegistryKey.valueData.DWord

var valueData = darkMode == 'toggle'
  ? (current + 1) % 2 // flip the bit
  : darkMode == 'on' ? 0 : 1

resource registryThemeKeys 'Microsoft.Windows/Registry@1.0.0' = [
  for key in keys: {
    keyPath: key.path
    valueName: key.name
    valueData: { DWord: valueData }
  }
]
