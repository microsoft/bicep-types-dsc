// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020";
import axios from "axios";
import {
  ResourceFlags,
  ScopeType,
  TypeFactory,
  TypeReference,
} from "bicep-types";
import { Command } from "commander";
import { version } from "../package.json";

type UnknownJson = Record<string, unknown>;

async function loadSchema(uri: string): Promise<UnknownJson> {
  const response = await axios.get(uri);
  return response.data as UnknownJson;
}

async function main() {
  const program = new Command();
  program
    .version(version)
    .description(
      "A CLI tool for generating Bicep types from DSC resource schemas",
    )
    .option("-d, --debug", "Enable debug logging");
  await program.parseAsync(process.argv);

  // The base schema is JSON 2020-12 hence the use of Ajv2020
  // The loadSchema function will fetch everything referenced during compileAsync()
  const ajv = new Ajv2020({ loadSchema: loadSchema, strict: false });
  // URI formats have to be added manually to ajv
  addFormats(ajv);
  const manifestUri =
    "https://aka.ms/dsc/schemas/v3/bundled/resource/manifest.json";
  const manifestSchema = await loadSchema(manifestUri);
  // It has two names because of the aka.ms so we register it twice
  ajv.addSchema(manifestSchema, manifestUri);
  const validateResource = await ajv.compileAsync(manifestSchema);

  // TODO: Iterate over all schemas not just this test one
  const uri =
    "https://raw.githubusercontent.com/PowerShell/DSC/refs/heads/main/registry/registry.dsc.resource.json";
  const schema = await loadSchema(uri);
  const dscType = schema.type as string;
  console.log(`DSC type: ${dscType}`);
  validateResource(schema);
  // TODO: Uhh ok great I can validate the schema but how do I iterate over it?

  // TODO: The body needs to be a transform from the schema to the relevant Bicep types
  const factory = new TypeFactory();
  factory.addResourceType(
    `${dscType}@v1`,
    ScopeType.DesiredStateConfiguration,
    undefined,
    new TypeReference(1),
    ResourceFlags.None,
  );
}

await main();
