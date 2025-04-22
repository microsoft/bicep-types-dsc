// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { Command } from "commander";
import { version } from "../package.json";
// TODO: import { TypeFactory } from "bicep-types";
import axios from "axios";
import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020";

type UnknownJson = Record<string, unknown>;

async function loadSchema(uri: string): Promise<UnknownJson> {
  const response = await axios.get(uri);
  return response.data as UnknownJson;
}

async function getManifestValidator(): Promise<Ajv2020> {
  const manifestUri =
    "https://aka.ms/dsc/schemas/v3/bundled/resource/manifest.json";
  const manifestSchema = await loadSchema(manifestUri);
  // TODO: Our published schema has the old $id, so we need to override it
  manifestSchema.$id = manifestUri;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  (manifestSchema as any).properties.$schema.enum.push(
    "https://aka.ms/dsc/schemas/v3/bundled/resource/manifest.json"
  );
  const ajv = new Ajv2020({ loadSchema: loadSchema, strict: false });
  addFormats(ajv);
  ajv.addSchema(manifestSchema, manifestUri, true);
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

  const manifestValidator = await getManifestValidator();
  if (program.opts().debug) console.log(manifestValidator.schemas);

  const uri =
    "https://raw.githubusercontent.com/PowerShell/DSC/refs/heads/main/registry/registry.dsc.resource.json";
  const schema = await loadSchema(uri);
  const validate = manifestValidator.addSchema(schema);

  console.log(validate.errors);
}

await main();
