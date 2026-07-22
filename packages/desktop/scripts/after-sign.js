const path = require("node:path");

const { smokePackagedDesktopApp } = require("./smoke-packaged-desktop-app.js");

const APP_BUNDLE_NAME = "Paseo Reforged";

exports.default = async function afterSign(context) {
  if (process.env.PASEO_DESKTOP_SMOKE !== "1") {
    return;
  }

  if (context.electronPlatformName !== "darwin") {
    return;
  }

  await smokePackagedDesktopApp({
    appPath: path.join(context.appOutDir, `${APP_BUNDLE_NAME}.app`),
  });
};
