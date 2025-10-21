extension dsc
targetScope = 'desiredStateConfiguration'

resource someprocessresource 'Microsoft/Process@0.1.0' = {
  name: 'pwsh'
  pid: 1234
}
