extension dsc
targetScope = 'local'

resource osInfo 'Microsoft/OSInfo@0.1.0' existing = {}
output osInfo object = osInfo

resource pwshScript 'Microsoft.DSC.Transitional/PowerShellScript@0.1.0' = {
    setScript: 'Get-Date'
}

output date array = pwshScript.output
