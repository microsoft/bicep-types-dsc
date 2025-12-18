extension dsc
targetScope = 'local'

output myOutput string = 'Hello, World!'

resource myEcho 'Microsoft.DSC.Debug/Echo@1.0.0' = {
    output: 'Hello, World!'
}

output echo string = myEcho.output

resource myInfo 'Microsoft/OSInfo@0.1.0' existing = {}

output info object = myInfo

output family string = myInfo.family
