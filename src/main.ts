// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { JsonSchemaDraft202012 } from "@hyperjump/json-schema/draft-2020-12";
import {
  buildIndex,
  type ObjectTypeProperty,
  ObjectTypePropertyFlags,
  ScopeType,
  TypeFactory,
  TypeReference,
  type TypeSettings,
  writeIndexJson,
  writeTypesJson,
} from "bicep-types";
import { Command } from "commander";
import { promises as fs } from "fs";
import log from "loglevel";
import { $ } from "zx";
import { version } from "../package.json";

// Covers the basic required pieces from a DSC resource manifest.
interface ResourceSchema {
  type: string;
  kind: string;
  version: string;
  manifest: {
    schema: {
      embedded?: JsonSchemaDraft202012;
      command?: {
        executable: string;
        args: string[];
      };
    };
  };
}

// Recursively maps the resource's schema to Bicep types.
function createType(
  factory: TypeFactory,
  schema: JsonSchemaDraft202012,
): TypeReference {
  // TODO: What do?
  if (typeof schema === "boolean") {
    throw new Error("Boolean definitions are not supported!");
  }

  log.debug(`Processing schema with title: ${schema.title ?? "unknown"}`);

  // TODO: What about 'enum', 'const' etc.?
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
        // TODO: What is 'sensitive', maybe case?
        undefined,
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
            // TODO: 'Required', 'ReadOnly' etc.
            flags: ObjectTypePropertyFlags.None,
            description:
              typeof value !== "boolean" ? value.description : undefined,
          },
        ]),
      );

      // TODO: 'additionalProperties' and 'sensitive'
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

  const dscResourceList = await $`dsc resource list -o json`;
  const resources = dscResourceList.stdout
    .split("\n") // DSC is silly and emits individual lines of JSON objects
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as ResourceSchema)
    .filter((resource) => resource.kind === "resource");

  const factory = new TypeFactory();

  // TODO: Add DSC's built-in functions using 'factory.addFunctionType()' which
  // will require 'dsc schema' to emit their signatures.

  for (const resource of resources) {
    const type = resource.type;
    const version = resource.version;
    const schema = resource.manifest.schema;

    let manifest: JsonSchemaDraft202012;
    if (schema.embedded !== undefined) {
      manifest = schema.embedded;
    } else if (schema.command !== undefined) {
      let dscResourceSchema;
      try {
        dscResourceSchema = await $`dsc resource schema -r ${type} -o json`;
      } catch (error) {
        log.error(`Failed to retrieve schema for resource ${type}:`, error);
        continue;
      }
      manifest = JSON.parse(dscResourceSchema.stdout) as JsonSchemaDraft202012;
    } else {
      log.error(`No schema defined for resource ${type}`);
      continue;
    }

    try {
      const bodyType = createType(factory, manifest);
      factory.addResourceType(
        `${type}@${version}`, // No version because DSC doesn't use them here
        bodyType,
        ScopeType.DesiredStateConfiguration,
        ScopeType.DesiredStateConfiguration,
      );
    } catch (error) {
      log.error(`Failed to create type for resource ${type}:`, error);
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
  await $`bicep publish-extension --target ${options.output}/dsc.tgz ${options.output}/index.json`;

  return 0;
}

// I'm still just a C programmer.
process.exit(await main());
