extension dsc
targetScope = 'local'

resource myScript 'Microsoft.DSC.Transitional/PowerShellScript@0.1.0' = {
    getScript: 'echo hello'
}
