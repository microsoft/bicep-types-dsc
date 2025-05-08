// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import {
  buildIndex,
  type ObjectTypeProperty,
  ObjectTypePropertyFlags,
  ResourceFlags,
  ScopeType,
  TypeFactory,
  TypeReference,
  type TypeSettings,
  writeIndexJson,
  writeTypesJson,
} from "bicep-types";
import { Command } from "commander";
import { promises as fs } from "fs";
import type { JSONSchema7, JSONSchema7Definition } from "json-schema";
import log from "loglevel";
import { version } from "../package.json";

// Covers the basic required pieces from a DSC resource manifest.
interface ManifestSchema {
  type: string;
  version: string;
  schema: {
    embedded?: JSONSchema7;
    command?: unknown;
  };
}

// Recursively maps the resource's schema to Bicep types.
function createType(
  factory: TypeFactory,
  schema: JSONSchema7Definition,
): TypeReference {
  // TODO: What do?
  if (typeof schema === "boolean") {
    throw new Error("Boolean definitions are not supported!");
  }

  log.debug(`Processing schema with title: ${schema.title ?? "unknown"}`);

  if (schema.type === undefined) {
    throw new Error("Schema type is undefined!");
  }

  // TODO: Handle array?
  if (Array.isArray(schema.type)) {
    throw new Error("Array schema types are not supported!");
  }

  log.debug(`Schema type is: ${schema.type}`);

  switch (schema.type) {
    case "null": {
      return factory.addNullType();
    }

    case "boolean": {
      return factory.addBooleanType();
    }

    case "integer":
    case "number": {
      return factory.addIntegerType(schema.minimum, schema.maximum);
    }

    case "string": {
      return factory.addStringType(
        undefined, // sensitive
        schema.minLength,
        schema.maxLength,
        schema.pattern,
      );
    }

    case "array": {
      if (schema.items === undefined) {
        throw new Error("Array type missing items definition!");
      }

      // TODO: Handle boolean and array?
      if (typeof schema.items === "boolean" || Array.isArray(schema.items)) {
        throw new Error("Unsupported items type in array type!");
      }

      return factory.addArrayType(
        createType(factory, schema.items),
        schema.minLength,
        schema.maxLength,
      );
    }

    case "object": {
      if (schema.properties === undefined) {
        throw new Error("Object type missing properties definition!");
      }

      // Is this seriously the only way to map one Record into another in TypeScript?!
      const properties: Record<string, ObjectTypeProperty> = Object.fromEntries(
        Object.entries(schema.properties).map(([key, value]) => [
          key,
          {
            type: createType(factory, value),
            flags: ObjectTypePropertyFlags.None,
            description:
              typeof value !== "boolean" ? value.description : undefined,
          },
        ]),
      );

      return factory.addObjectType(schema.title ?? "object", properties);
    }
  }
}

async function main(): Promise<number> {
  const program = new Command();
  program
    .version(version)
    .description(
      "A CLI tool for generating Bicep types from DSC resource manifests' embedded schemas",
    )
    .option("-d, --debug", "Enable debug logging")
    .option("-o, --output <directory>", "Specify the output directory", "out");
  await program.parseAsync(process.argv);
  const options: { debug?: boolean; output: string } = program.opts();
  if (options.debug) {
    log.setLevel("debug");
  }

  const resourceManifests: ManifestSchema[] = [];

  // TODO: CLI option to parse defaults or otherwise given paths.
  for (const path of [
    "./DSC/osinfo/osinfo.dsc.resource.json",
    "./DSC/process/process.dsc.resource.json",
    "./DSC/reboot_pending/reboot_pending.dsc.resource.json",
    "./DSC/resources/brew/brew.dsc.resource.json",
  ]) {
    const fileContent = await fs.readFile(path, "utf-8");
    resourceManifests.push(JSON.parse(fileContent) as ManifestSchema);
  }

  const factory = new TypeFactory();

  for (const resourceManifest of resourceManifests) {
    const type = resourceManifest.type;
    if (resourceManifest.schema.command) {
      // TODO: Run `dsc schema` command and extract the generated schema to parse.
      log.error(`Command-based schema for ${type} not yet supported!`);
      continue;
    }

    if (resourceManifest.schema.embedded === undefined) {
      // TODO: Right now this is all that's supported and therefore required.
      log.error(`Embedded schema for ${type} is not defined!`);
      continue;
    }

    // Top-level definition for the DSC resource.
    const bodySchema: JSONSchema7 = {
      type: "object",
      properties: {
        // TODO: Is 'name' actually required by DSC?
        name: { type: "string" },
        // The resource's properties need to be nested under 'properties' object.
        properties: {
          type: "object",
          properties: resourceManifest.schema.embedded.properties,
        },
      },
    };

    try {
      const bodyType = createType(factory, bodySchema);
      factory.addResourceType(
        `${type}@${resourceManifest.version}`,
        ScopeType.DesiredStateConfiguration,
        undefined,
        bodyType,
        ResourceFlags.None,
      );
    } catch (error) {
      log.error(`Failed to process schema for ${type}:`, error);
    }
  }

  const settings: TypeSettings = {
    name: "DesiredStateConfiguration",
    isSingleton: true,
    version: version,
  };

  await fs.mkdir(options.output, { recursive: true }); // recursive ignores existing directory
  const typesContent = writeTypesJson(factory.types);
  await fs.writeFile(`${options.output}/types.json`, typesContent, "utf-8");
  // Organization of the types files is arbitrary, meaning for simplicity's sake
  // we can just use one file, even though the indexer is setup to index many
  // types files. Hence this one-element array.
  const typeFiles = [
    {
      relativePath: "types.json",
      types: factory.types,
    },
  ];
  const index = buildIndex(typeFiles, log.warn.bind(log), settings); // bind avoids incorrectly scoping 'this'
  const indexContent = writeIndexJson(index);
  await fs.writeFile(`${options.output}/index.json`, indexContent, "utf-8");
  // The command `bicep publish-extension` takes 'index.json' and creates a tarball that is a Bicep extension.

  return 0;
}

// I'm still just a C programmer.
process.exit(await main());
