// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { Command } from "commander";
import { version } from "../package.json";

function main() {
  const program = new Command();
  program
    .version(version)
    .description(
      "A CLI tool for generating Bicep types from DSC resource schemas"
    )
    .option("-d, --debug", "Enable debug logging")
    .argument("<file>", "The schema file to process");
  program.parse(process.argv);

  if (program.opts().debug) {
    console.log("Debug logging enabled!");
    console.log(program.args);
  }
}

main();
