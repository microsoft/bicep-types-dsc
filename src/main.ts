// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { JsonSchemaDraft202012Object } from "@hyperjump/json-schema/draft-2020-12";
import {
  AllExceptExtension,
  buildIndex,
  CrossFileTypeReference,
  TypeFactory,
  type TypeSettings,
  writeIndexJson,
  writeTypesJson,
} from "bicep-types";
import { Command } from "commander";
import { promises as fs } from "fs";
import log from "loglevel";
import { $, ProcessOutput, usePwsh } from "zx";
import { version } from "../package.json";
import { createType } from "./types";

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

async function publish(output: string): Promise<ProcessOutput> {
  // The command `bicep publish-extension` takes 'index.json' and creates a
  // tarball (OCI artifact) that is a Bicep extension, with the bundled gRPC
  // server.
  //
  // TODO: Handle cross-compilation and release binaries.
  const dscBicep = `../DSC/bin/debug/dscbicep`;
  const binFlags = [];
  if (process.platform === "win32") {
    binFlags.push("--bin-win-x64", `${dscBicep}.exe`);
  } else if (process.platform === "darwin") {
    binFlags.push("--bin-osx-arm64", dscBicep);
  }

  return $`bicep publish-extension ${output}/index.json ${binFlags} --target ${output}/dsc.tgz --force`;
}

async function main(): Promise<number> {
  log.setDefaultLevel("info");
  const program = new Command()
    .version(version)
    .description(
      "A CLI tool for generating Bicep types from DSC resource manifests' embedded schemas",
    )
    .option("-d, --debug", "Enable debug logging")
    .option("-o, --output <directory>", "Specify the output directory", "out")
    .option("-r, --resources <names...>", "Specific DSC resources", [])
    .option("-p, --publish", "Skip type generation and only publish");

  await program.parseAsync(process.argv);

  const options: {
    debug?: boolean;
    output: string;
    resources: string[];
    publish?: boolean;
  } = program.opts();

  if (options.debug) {
    log.setLevel("debug");
  }

  if (process.platform === "win32") {
    usePwsh();
  }

  if (options.publish) {
    await publish(options.output);
    return 0;
  }

  let resources: ResourceInfo[] = [];
  for (const resource of options.resources) {
    log.info(`Getting resource manifest for ${resource}.`);
    const dscResourceList = await $`dsc resource list -o json ${resource}`;
    resources.push(JSON.parse(dscResourceList.stdout) as ResourceInfo);
  }

  if (resources.length == 0) {
    log.info("Getting all resources' manifests...");
    const dscResourceList = await $`dsc resource list -o json`;
    resources = dscResourceList
      .lines() // DSC is silly and emits individual lines of JSON objects
      .map((line) => JSON.parse(line) as ResourceInfo)
      .filter((resource) => resource.kind === "resource")
      // Debug builds contain a bunch of Test resources
      .filter((resource) => !resource.type.startsWith("Test/"))
      // TODO: snake_case resource name is crashing Bicep
      .filter(
        (resource) => resource.type !== "Microsoft.OpenSSH.SSHD/sshd_config",
      );
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
        log.error(`Failed to retrieve schema for resource: ${type}`, error);
        continue;
      }
    } else {
      log.error(`No schema defined for resource: ${type}`);
      continue;
    }

    // Add "name" property to schema if it doesn't exist
    // TODO: Just add the type directly to the factory instead of adding it here.
    if (schema.properties && !("name" in schema.properties)) {
      schema.properties.name = {
        type: "string",
        readOnly: false,
      };
    }

    try {
      const name = `${type}@${version}`;
      log.info(`Adding resource type: ${name}`);
      // TODO: How to handle 'latest' or '1.x' SemVer wildcards etc.
      const bodyType = createType(factory, schema, type, schema);
      factory.addResourceType(
        name,
        bodyType,
        AllExceptExtension,
        AllExceptExtension,
      );
    } catch (error) {
      log.error(`Failed to create type for resource: ${type}:`, error);
    }
  }

  const fallbackType = factory.addResourceType(
    "fallback",
    factory.addAnyType(),
    AllExceptExtension,
    AllExceptExtension,
  );

  const fallbackResource = new CrossFileTypeReference(
    "types.json",
    fallbackType.index,
  );

  const settings: TypeSettings = {
    name: "DesiredStateConfiguration",
    isSingleton: true,
    version: version,
  };

  await fs.mkdir(options.output, { recursive: true }); // recursive ignores existing directory

  // Organization of the types files is arbitrary, meaning for simplicity's sake
  // we can just use one file, even though the indexer is setup to index many
  // types files. Hence this one-element array.
  const typesContent = writeTypesJson(factory.types);
  await fs.writeFile(`${options.output}/types.json`, typesContent, "utf-8");

  const typeFiles = [
    {
      relativePath: "types.json",
      types: factory.types,
    },
  ];

  const index = buildIndex(
    typeFiles,
    log.warn.bind(log), // bind avoids incorrectly scoping 'this'
    settings,
    fallbackResource,
  );

  const indexContent = writeIndexJson(index);
  await fs.writeFile(`${options.output}/index.json`, indexContent, "utf-8");

  await publish(options.output);

  return 0;
}

// I'm still just a C programmer.
process.exit(await main());
