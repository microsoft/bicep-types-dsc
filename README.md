# DSC to Bicep Types Generator

This is a work-in-progress app to convert DSC type definitions to Bicep's format.

DSC types are defined inside each resource manifest.
For now, only embedded schemas are supported.

Run this app to generate `out/types.json` and `out/index.json`.
Then run `bicep publish-extension --target out/dsc.tgz out/index.json`.
Move this file to wherever you'll refer to it in Bicep's configuration.

In `bicepconfig.json` enable extensibility and add the extension:

```json
{
  "experimentalFeaturesEnabled": {
    "desiredStateConfiguration": true,
    "extensibility": true,
    "localDeploy": true,
    "typedVariables": true
  },
  "extensions": {
    "dsc": "./dsc.tgz"
  },
  "implicitExtensions": []
}
```

Then at the top of your Bicep file, enable both the extension and the target scope:

```bicep
extension dsc
targetScope = 'desiredStateConfiguration'
```

Now you'll have resource completions for DSC.
However, it won't work yet. Two issues to solve:

1. Enabling these Bicep configs moves to ARMv2 which emits resources as a dict instead of an array.
2. A new 'imports' property (with our extension) is emmited.

We actually don't have to use the version,
but the Bicep extension likes to auto-complete type with `@`.
