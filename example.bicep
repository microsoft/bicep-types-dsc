extension dsc
targetScope = 'local'

resource myEcho 'Microsoft.DSC.Debug/Echo@1.0.0' = {
    output: 'hello'
}

resource myInfo 'Microsoft/OSInfo@0.1.0' existing = {}
