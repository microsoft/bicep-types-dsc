// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import {
  type ObjectTypeProperty,
  ObjectTypePropertyFlags,
  ResourceFlags,
  ScopeType,
  TypeFactory,
  TypeReference,
} from "bicep-types";
import { Command } from "commander";
import { promises as fs } from "fs";
import type { JSONSchema7, JSONSchema7Definition } from "json-schema";
import { version } from "../package.json";

interface ManifestSchema {
  type: string;
  version: string;
  schema: {
    embedded?: JSONSchema7;
    command?: unknown;
  };
}

function createType(
  factory: TypeFactory,
  schema: JSONSchema7Definition,
): TypeReference {
  // TODO: What do?
  if (typeof schema === "boolean") {
    throw new Error("Boolean definitions are not supported!");
  }

  console.debug(`Processing schema: ${schema.title ?? "unknown"}`);

  if (schema.type === undefined) {
    throw new Error("Schema type is undefined!");
  }

  // TODO: Handle array?
  if (Array.isArray(schema.type)) {
    throw new Error("Array schema types are not supported!");
  }

  console.debug(`Schema type is: ${schema.type}`);

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
      "A CLI tool for generating Bicep types from DSC resource schemas",
    )
    .option("-d, --debug", "Enable debug logging");
  await program.parseAsync(process.argv);

  const resourceManifests: ManifestSchema[] = [];

  // TODO: CLI option to parse defaults
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
  const resourceTypes: TypeReference[] = [];

  for (const resourceManifest of resourceManifests) {
    if (resourceManifest.schema.command) {
      // TODO: Run `dsc schema` command and extract the generated schema to parse.
      console.error(`Command-based schema for  not yet supported!`);
      continue;
    }

    if (resourceManifest.schema.embedded === undefined) {
      // TODO: Right now this is all that's supported and therefore required.
      console.error("Embedded schema is not defined!");
      continue;
    }

    resourceTypes.push(
      factory.addResourceType(
        `${resourceManifest.type}@${resourceManifest.version}`,
        ScopeType.DesiredStateConfiguration,
        undefined,
        createType(factory, resourceManifest.schema.embedded),
        ResourceFlags.None,
      ),
    );
  }

  return 0;
}

// I'm still just a C programmer.
process.exit(await main());
