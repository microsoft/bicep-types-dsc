# DSC to Bicep Types Generator

This is a work-in-progress app to convert DSC type definitions to Bicep's format
and includes a DSC gRPC server (written in Rust, and part of the DSC project) to
support `bicep local-deploy`.

With no arguments, this app will attempt to get the schemas for each available
DSC resource by shelling out to `dsc` (and each resources subcommands if the
manifest isn't embedded), so be sure to have a build of DSC in the `PATH`.

The app will then run `bicep publish-extension ... --target out/dsc.tgz` where
the rest of the arguments are the generated types (in the `out` directory) and
the `dsc-bicep-ext` binary. This can also be published an Azure Container
Registry, as I've done for the available demo.

That emitted tarball is an OCI artifact recognized by Bicep as an extension,
which we then need to configure. We are using the experimental feature of Bicep,
[Local Deploy][]. The extension contains the generated type definitions and
`dsc-bicep-ext`, which is a small gRPC server that handles requests from `bicep
local-deploy` by calling into `dsc-lib`. At no point are we passing JSON files
to DSC, or calling the `dsc` CLI. Using Local Deploy, Bicep _remains_ the
orchestrator of Bicep code, meaning that everything just works. The gRPC server
is implemented in in [PR #1330][].

[local deploy]: https://github.com/Azure/bicep/blob/main/docs/experimental/local-deploy.md
[PR #1330]: https://github.com/PowerShell/DSC/pull/1330

In `bicepconfig.json` enable `localDeploy` and add the extension (a demo version
is available on a public ACR instance, linked in this example):

```json
{
  "experimentalFeaturesEnabled": {
    "localDeploy": true
  },
  "extensions": {
    "dsc": "br:contosobicepdsc1.azurecr.io/extensions/dsc:latest"
  }
}
```

Then at the top of your Bicep file, enable both the extension and the _local_ target scope:

```bicep
extension dsc
targetScope = 'local'
```

See `example.bicep`, `macos.bicep`, `windows.bicep` and their associated
`.bicepparam` files for more detailed examples.

Use the `Local Deploy` VS Code task to launch one of the examples. It's
equivalent to: `bicep local-deploy example.bicepparam`, but patches the path to
the dev build of Bicep and has some environment variables you can edit for
debugging. Once the next pre-release of DSC is available, you will be able to
use this Bicep extension by just installing DSC.

On Windows you can run run the demo with:

```pwsh
$env:PATH += ";C:\path\to\DSC"
bicep local-deploy .\windows.bicepparam
```

## Building

1. Install [Node.js](https://nodejs.org/en/download), for this extension
2. Install [Rust](https://rust-lang.org/tools/install/), for DSC
3. Install [.NET SDK](https://dotnet.microsoft.com/en-us/download), for Bicep
4. Clone this repo: `git clone https://github.com/microsoft/bicep-types-dsc.git`
5. Clone DSC: `git clone https://github.com/powershell/DSC.git`
6. Clone Bicep: `git clone https://github.com/azure/bicep.git`
7. Open this project's multi-root workspace: `code bicep-types-dsc/bicep-types-dsc.code-workspace`
9. Run `Publish Extension` VS Code workspace build task, equivalent to:
    - `cd dsc && ./build.ps1 -Project dsc-bicep-ext`
    - `cd bicep-types-dsc && npm start` (need to `npm install` first)
10. Run `Build CLI` VS Code Bicep task, equivalent to:
    - `cd bicep && dotnet build src/Bicep.Cli/Bicep.Cli.csproj`

DSC sometimes needs the CFS Cargo feed updated. A Microsoft employee can add
`-UseCFS` to the build command. This project sometimes needs the CFS NPM feed
updated. A Microsoft employee can follow a GUI-driven login procedure.
