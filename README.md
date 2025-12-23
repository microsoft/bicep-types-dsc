# DSC to Bicep Types Generator

This is a work-in-progress app to convert DSC type definitions to Bicep's
format, and now includes a DSC gRPC server (written in Rust) to support `bicep
local-deploy`.

With no arguments, this app will attempt to get the schemas for each available
DSC resource by shelling out to `dsc` (and each resources subcommands if the
manifest isn't embedded, so be sure to have a build of DSC in the `PATH`.

The app will then run `bicep publish-extension ... --target out/dsc.tgz` where
the rest of the arguments are the generated types (in the `out` directory) and
the `dscbicep` binary, which currently only exists in DSC's `biecp-gRPC` branch.

That emitted tarball is an OCI artifact recognized by Bicep as an extension,
which we then need to configure. Note that that the only experimental feature of
Bicep we're using now is [Local Deploy][]. The extension contains the generated
type definitions and `dscbicep`, which is a small gRPC server that handles
requests from `bicep local-deploy` by calling into `dsc-lib`. At no point are we
passing JSON files to DSC, or calling the `dsc` CLI. Using Local Deploy, Bicep
_remains_ the orchestrator of Bicep code, meaning that everything just works.
The gRPC server is implemented in in [PR #1330][].

On Windows, Rust doesn't really support Unix Domain Sockets so Bicep needed to
be patched to prefer Named Pipes. Until [PR #18712][] is merged and a new release is
out, a developer build of that will be needed too. This does not apply to macOS.

[local deploy]: https://github.com/Azure/bicep/blob/main/docs/experimental/local-deploy.md
[PR #1330]: https://github.com/PowerShell/DSC/pull/1330
[PR #18712]: https://github.com/Azure/bicep/pull/18712

In `bicepconfig.json` enable extensibility and add the extension:

```json
{
  "experimentalFeaturesEnabled": {
    "localDeploy": true
  },
  "extensions": {
    "dsc": "./out/dsc.tgz"
  },
  "implicitExtensions": []
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
debugging.

## Building

1. Install [Node.js](https://nodejs.org/en/download), for this extension
2. Install [Rust](https://rust-lang.org/tools/install/), for DSC
3. Install [.NET SDK](https://dotnet.microsoft.com/en-us/download), for Bicep
4. Clone this repo: `git clone https://github.com/microsoft/bicep-types-dsc.git`
5. Clone DSC feature branch: `git clone -b bicep-gRPC https://github.com/andyleejordan/DSC.git`
6. Clone Bicep feature branch: `git clone -b named-pipes https://github.com/andyleejordan/bicep.git`
7. Open this project's multi-root workspace: `code bicep-types-dsc/bicep-types-dsc.code-workspace`
8. Run `Publish Extension` VS Code workspace build task, equivalent to:
    - `cd dsc && ./build.ps1 -Project dscbicep`
    - `cd bicep-types-dsc && npm start` (might need `npm install` first)
9. Run `Build CLI` VS Code Bicep task, equivalent to:
    - `cd bicep && dotnet build src/Bicep.Cli/Bicep.Cli.csproj`

DSC sometimes needs the CFS Cargo feed updated. A Microsoft employee can add
`-UseCFS` to the build command. This project sometimes needs the CFS NPM feed
updated. A Microsoft employee can follow a GUI-driven login procedure.
