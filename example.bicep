extension dsc
targetScope = 'local'

resource myScript 'Microsoft.DSC.Debug/Echo@1.0.0' = {
    output: 'hello'
}
