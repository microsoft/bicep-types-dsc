// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { get as getReference } from "@hyperjump/json-pointer";
import type {
  JsonSchemaDraft202012,
  JsonSchemaDraft202012Object,
} from "@hyperjump/json-schema/draft-2020-12";
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
import { $, usePwsh } from "zx";
import { version } from "../package.json";

// Covers the basic required pieces from a DSC resource manifest.
interface ResourceInfo {
  type: string;
  kind: string;
  version: string;
  manifest: {
    schema: {
      embedded?: JsonSchemaDraft202012Object;
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
  rootSchema: JsonSchemaDraft202012,
  title: string,
  schema: JsonSchemaDraft202012,
): TypeReference {
  // This is a short circuit indicating any value is valid
  if (typeof schema === "boolean") {
    if (schema) {
      return factory.addAnyType();
    } else {
      throw new Error("Schema was false!");
    }
  }

  // TODO: This will only work for root schema references, not references by URI.
  if (schema.$ref) {
    // Slice off the '#'
    // TODO: Move up
    const subSchema = getReference(
      schema.$ref.slice(1),
      rootSchema,
    ) as JsonSchemaDraft202012Object;
    log.debug(`Followed ${schema.$ref}`);
    // TODO: This is a rough resolution, we'll want to merge instead of replace.
    schema = subSchema;
  }

  log.debug(`Processing schema with title: ${title}`);

  if (schema.anyOf) {
    const elements = schema.anyOf.map((i) =>
      createType(factory, rootSchema, "", i),
    );
    return factory.addUnionType(elements);
  }

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
        // TODO: What is 'sensitive', maybe case?
        undefined,
        schema.minLength,
        schema.maxLength,
        schema.pattern,
      );
    }

    case "array": {
      const items = schema.items
        ? createType(factory, rootSchema, title, schema.items)
        : factory.addAnyType();

      return factory.addArrayType(items, schema.minLength, schema.maxLength);
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
            type: createType(factory, rootSchema, key, value),
            // TODO: 'Required', 'ReadOnly' etc.
            flags: ObjectTypePropertyFlags.None,
            description:
              typeof value !== "boolean" ? value.description : undefined,
          },
        ]),
      );

      if (Object.keys(properties).length === 0) {
        throw new Error("Object properties were empty!");
      }

      // TODO: 'additionalProperties' and 'sensitive'
      if (schema.additionalProperties) {
        log.debug(`Not handling additional properties for ${title}`);
      }
      return factory.addObjectType(title, properties);
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
    .option("-o, --output <directory>", "Specify the output directory", "out")
    .option("-r, --resources <names...>", "Specific DSC resources", []);
  await program.parseAsync(process.argv);
  const options: {
    debug?: boolean;
    output: string;
    resources: string[];
  } = program.opts();
  if (options.debug) {
    log.setLevel("debug");
  }

  if (process.platform === "win32") {
    usePwsh();
  }

  let resources: ResourceInfo[] = [];
  for (const resource of options.resources) {
    log.debug(`Getting resource manifest for ${resource}`);
    const dscResourceList = await $`dsc resource list -o json ${resource}`;
    resources.push(JSON.parse(dscResourceList.stdout) as ResourceInfo);
  }

  if (resources.length == 0) {
    log.debug("Getting all resources' manifests");
    const dscResourceList = await $`dsc resource list -o json`;
    resources = dscResourceList
      .lines() // DSC is silly and emits individual lines of JSON objects
      .map((line) => JSON.parse(line) as ResourceInfo)
      .filter((resource) => resource.kind === "resource");
  }

  const factory = new TypeFactory();

  // TODO: Add DSC's built-in functions using 'factory.addFunctionType()' which
  // will require 'dsc schema' to emit their signatures.

  for (const resource of resources) {
    const type = resource.type;
    const version = resource.version;

    let schema: JsonSchemaDraft202012Object;
    if (resource.manifest.schema.embedded !== undefined) {
      schema = resource.manifest.schema.embedded;
    } else if (resource.manifest.schema.command !== undefined) {
      try {
        const commandSchema = await $`dsc resource schema -r ${type} -o json`;
        schema = JSON.parse(
          commandSchema.stdout,
        ) as JsonSchemaDraft202012Object;
      } catch (error) {
        log.error(`Failed to retrieve schema for resource ${type}:`, error);
        continue;
      }
    } else {
      log.error(`No schema defined for resource ${type}`);
      continue;
    }

    try {
      log.debug(`Adding resource type ${type}`);
      // TODO: How to handle 'latest' or '1.x' SemVer wildcards etc.
      const bodyType = createType(factory, schema, type, schema);
      factory.addResourceType(
        `${type}@${version}`,
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
