const { withAppBuildGradle } = require("expo/config-plugins");

const marker = "// @paseo-hermes-memory-budget";

/** Builds the React Native Gradle configuration managed by this plugin */
function createHermesBuildConfiguration(disableReleaseSourceMaps) {
  const sourceMapOverride = disableReleaseSourceMaps
    ? '    extraPackagerArgs = ["--sourcemap-output", ""]\n'
    : "";

  return `\n    ${marker}\n    hermesFlags = ["-O"]\n${sourceMapOverride}`;
}

/** Updates the managed React Native Gradle block without duplicating it */
function configureHermesMemoryBudget(contents, disableReleaseSourceMaps) {
  const configuration = createHermesBuildConfiguration(disableReleaseSourceMaps);
  const knownConfigurations = [
    createHermesBuildConfiguration(false),
    createHermesBuildConfiguration(true),
  ];

  for (const knownConfiguration of knownConfigurations) {
    if (contents.includes(knownConfiguration)) {
      return contents.replace(knownConfiguration, configuration);
    }
  }

  if (contents.includes(marker)) {
    throw new Error("Could not update the existing Hermes memory budget configuration");
  }

  const reactBlock = "react {";
  const index = contents.indexOf(reactBlock);
  if (index < 0) {
    throw new Error("Could not configure Hermes memory budget without an app react block");
  }

  const insertionIndex = index + reactBlock.length;
  return contents.slice(0, insertionIndex) + configuration + contents.slice(insertionIndex);
}

/** Keeps release Hermes compilation within the hosted Android runner memory budget. */
function withHermesMemoryBudget(config) {
  return withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = configureHermesMemoryBudget(
      modConfig.modResults.contents,
      process.env.PASEO_RELEASE_SOURCEMAPS === "0",
    );
    return modConfig;
  });
}

module.exports = withHermesMemoryBudget;
module.exports.configureHermesMemoryBudget = configureHermesMemoryBudget;
