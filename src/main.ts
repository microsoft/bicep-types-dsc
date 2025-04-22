// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { Command } from "commander";
import { version } from "../package.json";
// TODO: import { TypeFactory } from "bicep-types";
import axios from "axios";
import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020";

type UnknownJson = Record<string, unknown>;

async function fetchSchema(uri: string): Promise<UnknownJson> {
  const response = await axios.get(uri);
  return response.data as UnknownJson;
}

async function getManifestValidator(): Promise<Ajv2020> {
  const manifestUri =
    "https://aka.ms/dsc/schemas/v3/bundled/resource/manifest.json";
  const manifestSchema = await fetchSchema(manifestUri);
  const ajv = new Ajv2020();
  addFormats(ajv);
  ajv.addSchema(manifestSchema, manifestUri);
  return ajv;
}

async function main() {
  const program = new Command();
  program
    .version(version)
    .description(
      "A CLI tool for generating Bicep types from DSC resource schemas"
    )
    .option("-d, --debug", "Enable debug logging");
  await program.parseAsync(process.argv);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const manifestValidator = await getManifestValidator();
  /*
  const uri =
    "https://raw.githubusercontent.com/PowerShell/DSC/refs/heads/main/registry/registry.dsc.resource.json";
  const schema = await fetchSchema(uri);
  const validate = manifestValidator.compile(schema);

  if (validate(schema)) {
    console.log("Schema is valid. Iterating over properties:");
    for (const key in schema) {
      if (Object.prototype.hasOwnProperty.call(schema, key)) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        console.log(`${key}: ${schema[key]}`);
      }
    }
  } else {
    console.error("Schema validation failed:", validate.errors);
  }
  */
}

await main();
