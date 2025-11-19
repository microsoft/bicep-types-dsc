extension dsc
// TODO: This currently requires using local deploy.
targetScope = 'local'

resource myEcho 'Microsoft/Process@0.1.0' = {
    cmdline: 'pwsh'
    pid: 1234
}

resource myResource 'Foo/Bar@1.2.3' = {
    field: 'value'
    okay: true
}
