const { withAppBuildGradle } = require("expo/config-plugins");

/** Keeps release Hermes compilation within the hosted Android runner memory budget. */
function withHermesMemoryBudget(config) {
  return withAppBuildGradle(config, (modConfig) => {
    const marker = "// @paseo-hermes-memory-budget";
    if (modConfig.modResults.contents.includes(marker)) return modConfig;

    const insertion = `\n    ${marker}\n    hermesFlags = ["-O"]\n`;
    const reactBlock = "react {";
    const index = modConfig.modResults.contents.indexOf(reactBlock);
    if (index < 0) {
      throw new Error("Could not configure Hermes memory budget without an app react block");
    }
    const insertionIndex = index + reactBlock.length;
    modConfig.modResults.contents =
      modConfig.modResults.contents.slice(0, insertionIndex) +
      insertion +
      modConfig.modResults.contents.slice(insertionIndex);
    return modConfig;
  });
}

module.exports = withHermesMemoryBudget;
