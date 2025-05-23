// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// DSC is planning to update from draft-07 to draft-2020-12 and its compatible
// enough to just start using it here (and the draft-07 type is hard to use).
import type { JsonSchemaDraft202012 } from "@hyperjump/json-schema/draft-2020-12";
import {
  buildIndex,
  type ObjectTypeProperty,
  ObjectTypePropertyFlags,
  ResourceFlags,
  ScopeType,
  TypeBaseKind,
  TypeFactory,
  TypeReference,
  type TypeSettings,
  writeIndexJson,
  writeTypesJson,
} from "bicep-types";
import { Command } from "commander";
import { promises as fs } from "fs";
import log from "loglevel";
import { $, usePwsh } from "zx";
import { version } from "../package.json";

// Covers the basic required pieces from a DSC resource manifest.
interface ResourceSchema {
  type: string;
  kind: string;
  version: string;
  manifest: {
    schema?: {
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
    log.warn("Schema was unexpectedly a boolean!");
    return factory.addBooleanType();
  }

  log.debug(`Processing schema with title: ${schema.title ?? "unknown"}`);

  // TODO: What about 'enum', 'const' etc.?
  if (schema.type === undefined) {
    // We're looking at a ref to a definition.
    log.warn(`Returning Any type for ${schema.$ref ?? "unknown"}!`);
    return factory.addAnyType();
  }

  // TODO: Handle array?
  if (Array.isArray(schema.type)) {
    // We're processing an anyOf etc.
    log.warn(`Returning Any type for array: ${schema.type.join(", ")}!`);
    return factory.addAnyType();
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
        // TODO: What is 'sensitive', maybe case? No, sounds like secure.
        true,
        schema.minLength,
        schema.maxLength,
        schema.pattern,
      );
    }

    case "array": {
      if (schema.items === undefined) {
        log.warn("Array type missing items definition!");
        return factory.addAnyType();
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

      // TODO: Parse schema.definitions (requires draft-07 and investigation).
      if ("definitions" in schema) {
        log.warn("Not yet handling definitions!");
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
  } else {
    log.setLevel("info");
  }

  const isWindows = process.platform === "win32";

  // Otherwise the zx library tries to use bash on Windows
  if (isWindows) {
    usePwsh();
  }

  const resourceList = await $`dsc resource list -o json`;
  log.info(`Listing resources took ${resourceList.duration} ms.`);
  const resources = resourceList
    .lines() // DSC is silly and emits individual lines of JSON objects
    .map((line) => JSON.parse(line) as ResourceSchema);

  // TODO: Use an upcoming --all flag so we don't have to handle every adapter.
  if (isWindows) {
    const resourceList =
      await $`dsc resource list -o json -a Microsoft.Windows/WindowsPowerShell`;
    log.info(`Listing PowerShell resources took ${resourceList.duration} ms.`);

    resources.concat(
      resourceList.lines().map((line) => JSON.parse(line) as ResourceSchema),
    );
  }

  const factory = new TypeFactory();

  // TODO: Add DSC's built-in functions using 'factory.addFunctionType()' which
  // will require 'dsc schema' to emit their signatures.

  for (const resource of resources) {
    const type = resource.type;
    const schema = resource.manifest.schema;

    let manifest: JsonSchemaDraft202012;
    if (schema?.embedded !== undefined) {
      manifest = schema.embedded;
    } else if (schema?.command !== undefined) {
      try {
        const commandSchema = await $`dsc resource schema -r ${type} -o json`;
        log.info(
          `Getting schema for resource ${type} took ${commandSchema.duration} ms.`,
        );
        manifest = JSON.parse(commandSchema.stdout) as JsonSchemaDraft202012;
      } catch (error) {
        log.error(`Failed to retrieve schema for resource ${type}:`, error);
        continue;
      }
    } else {
      // TODO: Add a body type that represented a nested config and add the resource
      log.error(`No schema defined for resource ${type}!`);
      continue;
    }

    try {
      log.info(`Generating Bicep type from schema for resource ${type}...`);
      const bodyType = createType(factory, manifest);
      factory.addResourceType(
        // TODO: Remove version and fix completion not to include '@'
        `${type}@${resource.version}`,
        ScopeType.DesiredStateConfiguration,
        undefined,
        bodyType,
        ResourceFlags.None,
      );
    } catch (error) {
      log.error(`Failed to create Bicep type for resource ${type}:`, error);
    }
  }

  // TODO: Get these numbers to match: we're at 5/11 right now.
  log.info(
    `Generated ${factory.types.filter((x) => x.type === TypeBaseKind.ResourceType).length} Bicep types from ${resources.length} resources!`,
  );

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
