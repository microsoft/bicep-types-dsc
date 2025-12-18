extension dsc
targetScope = 'local'

resource myInfo 'Microsoft/OSInfo@0.1.0' existing = {}

output family string = myInfo.family

output info object = myInfo
