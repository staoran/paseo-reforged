const { withAppBuildGradle } = require("expo/config-plugins");

/** Keeps APK Hermes compilation below the hosted runner's memory limit */
function configureHermesApkMemoryBudget(contents) {
  // Identifies the injected flags when prebuild runs more than once
  const marker = "// @paseo-hermes-apk-memory-budget";
  if (contents.includes(marker)) return contents;

  // React Native reads Hermes flags from the app's Gradle react block
  const reactBlock = "react {";
  const index = contents.indexOf(reactBlock);
  if (index < 0) {
    throw new Error("Could not configure APK Hermes memory budget without an app react block");
  }

  const insertion = `\n    ${marker}\n    hermesFlags = ["-Og", "-output-source-map"]\n`;
  const insertionIndex = index + reactBlock.length;
  return contents.slice(0, insertionIndex) + insertion + contents.slice(insertionIndex);
}

/** Applies the APK-only Hermes flags during Android prebuild */
function withHermesApkMemoryBudget(config) {
  return withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = configureHermesApkMemoryBudget(modConfig.modResults.contents);
    return modConfig;
  });
}

module.exports = withHermesApkMemoryBudget;
module.exports.configureHermesApkMemoryBudget = configureHermesApkMemoryBudget;
