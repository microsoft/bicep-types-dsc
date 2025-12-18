extension dsc
targetScope = 'local'

resource toggleDarkMode 'Microsoft.DSC.Transitional/PowerShellScript@0.1.0' = {
    setScript: 'dark-mode'
}

resource myInfo 'Microsoft/OSInfo@0.1.0' existing = {}

output family string = myInfo.family

output info object = myInfo
