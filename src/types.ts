// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { get as getReference } from "@hyperjump/json-pointer";
import type {
  JsonSchemaDraft202012,
  JsonSchemaDraft202012Object,
} from "@hyperjump/json-schema/draft-2020-12";
import {
  type ObjectTypeProperty,
  ObjectTypePropertyFlags,
  TypeFactory,
  TypeReference,
} from "bicep-types";
import log from "loglevel";

// Recursively maps the resource's schema to Bicep types.
export function createType(
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
      // TODO: Pattern properties
      if (schema.properties === undefined) {
        return factory.addAnyType();
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

      const additionalProperties = schema.additionalProperties
        ? createType(factory, rootSchema, "", schema.additionalProperties)
        : undefined;

      return factory.addObjectType(title, properties, additionalProperties);
    }
  }
}
