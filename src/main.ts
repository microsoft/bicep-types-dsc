// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import axios from "axios";
import {
  type ObjectTypeProperty,
  ObjectTypePropertyFlags,
  ResourceFlags,
  ScopeType,
  TypeFactory,
  TypeReference,
} from "bicep-types";
import { Command } from "commander";
import { version } from "../package.json";

interface ManifestSchema {
  type: string;
  version: string;
  description: string;
  schema: {
    embedded?: Schema;
    command?: unknown;
  };
}

interface Schema {
  type: string;
  title?: string;
  description?: string;
  maximum?: number;
  minimum?: number;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  items?: Schema;
  properties: Record<string, Schema>;
}

function createType(factory: TypeFactory, schema: Schema): TypeReference {
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
        true,
        schema.minLength,
        schema.maxLength,
        schema.pattern,
      );
    }
    case "array": {
      if (!schema.items) {
        throw new Error(`Array type missing items definition: ${schema.type}`);
      }
      return factory.addArrayType(
        createType(factory, schema.items),
        schema.minLength,
        schema.maxLength,
      );
    }
    case "object": {
      const properties: Record<string, ObjectTypeProperty> = Object.fromEntries(
        Object.entries(schema.properties).map(([key, value]) => [
          key,
          {
            type: createType(factory, value),
            flags: ObjectTypePropertyFlags.None,
            description: value.description,
          },
        ]),
      );
      return factory.addObjectType(schema.title ?? "object", properties);
    }
    default: {
      throw new Error(`Unsupported schema type: ${schema.type}`);
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

  // TODO: Iterate over all schemas not just this test one
  const uri =
    "https://raw.githubusercontent.com/PowerShell/DSC/refs/heads/main/process/process.dsc.resource.json";
  const response = await axios.get(uri);
  const resource = response.data as ManifestSchema;

  if (resource.schema.command) {
    console.error("TODO: Handle commands schema!");
    return 1;
  }

  if (!resource.schema.embedded) {
    console.error("Embedded schema is not defined!");
    return 1;
  }

  const factory = new TypeFactory();
  const bodyType = createType(factory, resource.schema.embedded);

  factory.addResourceType(
    `${resource.type}@${resource.version}`,
    ScopeType.DesiredStateConfiguration,
    undefined,
    bodyType,
    ResourceFlags.None,
  );

  return 0;
}

process.exit(await main());
